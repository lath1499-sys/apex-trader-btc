import useSWR from 'swr'
import { useEffect, useRef, useCallback } from 'react'
import { useApexStore } from '@/store/apexStore'
import type { MarketData, OrderBook } from '@/lib/types'
import type { Kline } from '@/lib/types'
import { calcVWAP, calcCVD, detectBOSCHoCH, getICTKillzones, detectScalpSignals } from '@/lib/scalpSignals'
import { ntfyScalpSignal, ntfyTPHit, ntfySLHit, ntfyApproachingSL, ntfyTrailingSL } from '@/lib/ntfy'

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

  // Helper: recompute VWAP, CVD, BOS/CHoCH, Killzones and run scalp signal detection
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

    // Run scalp signal detection when scalp mode is active
    if (!useApexStore.getState().scalpMode) return
    const st    = useApexStore.getState()
    const price = st.mkt.price
    if (!price) return
    const k15m   = st.rawK['15m'] ?? []
    const k1h    = st.rawK['1h']  ?? []
    const fvg15m = st.fvgs['15m']
    const sig   = detectScalpSignals(
      price, k15m, k1h,
      vwapResult, cvd, bc, kz,
      fvg15m, st.liquidity, st.orderBook, st.mkt.funding,
    )
    // Only fire NTFY when a new non-null scalp signal appears
    const prev = useApexStore.getState().scalpSignal
    if (sig && (!prev || prev.entry !== sig.entry || prev.side !== sig.side)) {
      ntfyScalpSignal({
        side:         sig.side,
        entry:        sig.entry,
        sl:           sig.sl,
        tp1:          sig.tp1,
        killzone:     sig.killzone,
        duration:     sig.duration,
        cvdSignal:    sig.cvdSignal,
        qualityLabel: sig.qualityLabel,
      })
    }
    // Only replace the active signal with a genuinely new one (different entry/side).
    // If detectScalpSignals returns null, keep the current active signal alive.
    if (sig) {
      const prev = useApexStore.getState().scalpSignal
      const isNew = !prev || prev.entry !== sig.entry || prev.side !== sig.side
      if (isNew) setScalpSignal(sig)
    }
    // null → do nothing; signal persists until SL/TP hit or manual close
  }, [setVwap, setCvdData, setBosChoch, setKillzones, setScalpSignal])

  // ── Scalp SL/TP price monitoring ─────────────────────────────────────────
  const mktForScalp    = useApexStore(s => s.mkt)
  const scalpSignalRef = useApexStore(s => s.scalpSignal)

  useEffect(() => {
    const sig   = scalpSignalRef
    const price = mktForScalp.price
    if (!sig || !price || !scalpMode) return

    const isLong = sig.side === 'LONG'
    const sigObj = { side: sig.side, entry: sig.entry, sl: sig.sl, tradeType: 'Scalp' as const }

    // SL warning — tighter threshold for scalps (0.3%)
    if (!sig.slWarningFired) {
      const distToSL = isLong
        ? (price - sig.sl) / sig.entry
        : (sig.sl - price) / sig.entry
      if (distToSL > 0 && distToSL < 0.003) {
        ntfyApproachingSL(sigObj, price, distToSL * 100)
        setScalpSignal({ ...sig, slWarningFired: true })
        return
      }
    }

    // TP/SL hits
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
      // Only null if the signal is still active — prevents double-close race condition
      const cur = useApexStore.getState().scalpSignal
      if (!cur || cur.status === 'active') setScalpSignal(null)
    }

    if (slHit) {
      ntfySLHit(sigObj, sig.sl, pnlPct(sig.sl))
      closeScalp('sl_hit', sig.sl)
    } else if (tp3Hit) {
      ntfyTPHit(sigObj, 'tp3', sig.tp3, pnlPct(sig.tp3))
      closeScalp('tp3_hit', sig.tp3)
    } else if (tp2Hit && sig.status !== 'tp2_hit') {
      ntfyTPHit(sigObj, 'tp2', sig.tp2, pnlPct(sig.tp2))
      setScalpSignal({ ...sig, status: 'tp2_hit' })
    } else if (tp1Hit && sig.status === 'active') {
      ntfyTPHit(sigObj, 'tp1', sig.tp1, pnlPct(sig.tp1))
      ntfyTrailingSL(sigObj, sig.entry)
      setScalpSignal({ ...sig, status: 'tp1_hit' })
    }
  }, [mktForScalp.price, scalpSignalRef, scalpMode, setScalpSignal, pushScalpHistory])

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
