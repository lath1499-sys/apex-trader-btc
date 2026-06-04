import useSWR from 'swr'
import { useEffect, useRef, useCallback } from 'react'
import { useApexStore } from '@/store/apexStore'
import type { MarketData, OrderBook } from '@/lib/types'
import type { Kline } from '@/lib/types'
import { calcVWAP, calcCVD, detectBOSCHoCH, getICTKillzones } from '@/lib/scalpSignals'
// NTFY intentionally removed — server agent sends all push notifications.
import { saveSignalToCloud } from '@/lib/supabase'
import type { SignalRecord } from '@/lib/types'

interface BinanceResponse {
  market: Record<string, number | string | boolean | null>
  orderBook: OrderBook | null
  klines: Record<string, Kline[]>
  error?: string
}

async function fetcher(url: string): Promise<BinanceResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<BinanceResponse>
}

interface FastResponse {
  price: number | null
  orderBook: OrderBook | null
  klines1m: Kline[]
}

export function useMarketData() {
  const setMkt       = useApexStore(s => s.setMkt)
  const setRawK      = useApexStore(s => s.setRawK)
  const setOrderBook = useApexStore(s => s.setOrderBook)
  const setConn      = useApexStore(s => s.setConn)
  const scalpMode      = useApexStore(s => s.scalpMode)
  const setVwap        = useApexStore(s => s.setVwap)
  const setCvdData     = useApexStore(s => s.setCvdData)
  const setBosChoch    = useApexStore(s => s.setBosChoch)
  const setKillzones   = useApexStore(s => s.setKillzones)
  const setScalpSignal  = useApexStore(s => s.setScalpSignal)
  const pushScalpHistory = useApexStore(s => s.pushScalpHistory)
  const klines1mRef     = useRef<Kline[]>([])

  const { data, error, isLoading } = useSWR<BinanceResponse>(
    '/api/binance',
    fetcher,
    { refreshInterval: 45_000, revalidateOnFocus: false, dedupingInterval: 10_000 }
  )

  // Helper: recompute VWAP, CVD, BOS/CHoCH, Killzones for display only
  // Signal GENERATION is 100% server-side (app/api/agent/route.ts via Vercel Cron)
  // Browser is READ-ONLY: displays signals loaded from Supabase, monitors SL/TP on existing signals
  const recalcScalpIndicators = useCallback((k1m: Kline[]) => {
    if (k1m.length < 5) return
    const vwapResult  = calcVWAP(k1m)
    const cvd         = calcCVD(k1m)
    const bc          = detectBOSCHoCH(k1m)
    const kz          = getICTKillzones()
    setVwap(vwapResult)
    setCvdData(cvd)
    setBosChoch(bc)
    setKillzones(kz)
    // No signal generation here — server agent handles all detection and saves to Supabase
  }, [setVwap, setCvdData, setBosChoch, setKillzones])

  // ── Scalp SL/TP price monitoring ─────────────────────────────────────────
  const mktForScalp    = useApexStore(s => s.mkt)
  const scalpSignalRef = useApexStore(s => s.scalpSignal)

  useEffect(() => {
    const sig   = scalpSignalRef
    const price = mktForScalp.price
    if (!sig || !price) return

    const isLong = sig.side === 'LONG'

    // SL warning — flag only (no client NTFY; server sends push every 5 min)
    if (!sig.slWarningFired) {
      const distToSL = isLong
        ? (price - sig.sl) / sig.entry
        : (sig.sl - price) / sig.entry
      if (distToSL > 0 && distToSL < 0.003) {
        setScalpSignal({ ...sig, slWarningFired: true })
        return
      }
    }

    // TP/SL hits — update local UI state and persist close to Supabase (no NTFY from browser)
    const slHit  = isLong ? price <= sig.sl  : price >= sig.sl
    const tp1Hit = isLong ? price >= sig.tp1 : price <= sig.tp1
    const tp2Hit = isLong ? price >= sig.tp2 : price <= sig.tp2
    const tp3Hit = isLong ? price >= sig.tp3 : price <= sig.tp3
    const pnlPct = (exit: number) => isLong
      ? (exit - sig.entry) / sig.entry * 100
      : (sig.entry - exit) / sig.entry * 100

    const closeScalp = (closeStatus: 'sl_hit' | 'tp1_hit' | 'tp2_hit' | 'tp3_hit', exitPrice: number) => {
      const closed: typeof sig = {
        ...sig,
        status:     closeStatus,
        closedAt:   Date.now(),
        closePrice: exitPrice,
        pnl:        pnlPct(exitPrice),
      }
      pushScalpHistory(closed)
      // Clear active signal
      const cur = useApexStore.getState().scalpSignal
      if (!cur || cur.status === 'active') setScalpSignal(null)
      // Persist close to Supabase so server agent doesn't re-open on next run
      const allSigs = useApexStore.getState().signalHistory ?? []
      const supaRec = allSigs.find(r =>
        r.idea.tradeType === 'Scalp' && r.status === 'active' && r.idea.side === sig.side,
      )
      if (supaRec) {
        const updatedRec: SignalRecord = {
          ...supaRec,
          status:      closeStatus,
          exitPrice:   exitPrice,
          exitTs:      new Date().toISOString(),
          pnl:         pnlPct(exitPrice),
          closedAt:    new Date().toISOString(),
          closeReason: closeStatus,
        }
        saveSignalToCloud(updatedRec).catch(() => {})
      }
    }

    if (slHit) {
      closeScalp('sl_hit', sig.sl)
    } else if (tp3Hit) {
      closeScalp('tp3_hit', sig.tp3)
    } else if (tp2Hit && sig.status !== 'tp2_hit') {
      setScalpSignal({ ...sig, status: 'tp2_hit' })
    } else if (tp1Hit && sig.status === 'active') {
      setScalpSignal({ ...sig, status: 'tp1_hit' })
    }
  }, [mktForScalp.price, scalpSignalRef, setScalpSignal, pushScalpHistory])

  // ── Fast 10s refresh (scalp mode only) ────────────────────────────────────
  useEffect(() => {
    if (!scalpMode) return
    const tick = setInterval(async () => {
      try {
        const res  = await fetch('/api/binance?fast=1')
        if (!res.ok) return
        const data = await res.json() as FastResponse
        // Merge new 1m candles into ref (append latest, keep last 100)
        if (data.klines1m?.length) {
          const merged = [...klines1mRef.current, ...data.klines1m]
            .filter((k, i, arr) => arr.findIndex(x => x.t === k.t) === i)
            .sort((a, b) => a.t - b.t)
            .slice(-100)
          klines1mRef.current = merged
          setRawK({ ...useApexStore.getState().rawK, '1m': merged })
          recalcScalpIndicators(merged)
        }
        if (data.orderBook) setOrderBook(data.orderBook)
        if (data.price) {
          const prev = useApexStore.getState().mkt
          setMkt({ ...prev, price: data.price, ts: new Date() })
        }
      } catch { /* silent — don't break normal data flow */ }
    }, 10_000)
    return () => clearInterval(tick)
  }, [scalpMode, recalcScalpIndicators, setRawK, setOrderBook, setMkt])

  useEffect(() => {
    if (!data || data.error) return

    const m = data.market
    const mkt: MarketData = {
      loading:     false,
      price:       typeof m.price      === 'number' ? m.price      : undefined,
      change:      typeof m.change     === 'number' ? m.change     : undefined,
      high:        typeof m.high       === 'number' ? m.high       : undefined,
      low:         typeof m.low        === 'number' ? m.low        : undefined,
      vol:         typeof m.vol        === 'number' ? m.vol        : undefined,
      funding:     typeof m.funding    === 'number' ? m.funding    : undefined,
      mark:        typeof m.mark       === 'number' ? m.mark       : undefined,
      index:       typeof m.index      === 'number' ? m.index      : undefined,
      oi:          typeof m.oi         === 'number' ? m.oi         : undefined,
      lsr:         typeof m.lsr        === 'number' ? m.lsr        : undefined,
      longPct:     typeof m.longPct    === 'number' ? m.longPct    : undefined,
      shortPct:    typeof m.shortPct   === 'number' ? m.shortPct   : undefined,
      fg:          typeof m.fg         === 'number' ? m.fg         : undefined,
      fgLabel:     typeof m.fgLabel    === 'string' ? m.fgLabel    : undefined,
      bybitPrice:  typeof m.bybitPrice === 'number' ? m.bybitPrice : undefined,
      krakenPrice: typeof m.krakenPrice === 'number' ? m.krakenPrice : undefined,
      ts: new Date(),
    }

    setMkt(mkt)
    const klines = data.klines ?? {}
    setRawK(klines)
    // Seed 1m ref from main fetch so scalp indicators have data immediately
    if (klines['1m']?.length) {
      klines1mRef.current = klines['1m']
      recalcScalpIndicators(klines['1m'])
    }
    setOrderBook(data.orderBook ?? null)
    setConn({
      binanceSpot: !!mkt.price,
      binanceFut:  !!mkt.funding,
      fg:          !!mkt.fg,
      ts: new Date(),
    })

    if (mkt.price) {
      try {
        document.title = `₿ $${Math.round(mkt.price).toLocaleString()} ${(mkt.change ?? 0) >= 0 ? '▲' : '▼'}${Math.abs(mkt.change ?? 0).toFixed(2)}% — APEX`
      } catch { /* SSR guard */ }
    }
  }, [data, setMkt, setRawK, setOrderBook, setConn, recalcScalpIndicators])

  return { isLoading, error: error as Error | undefined }
}
