import { useEffect, useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import {
  loadSignalHistory, saveSignalHistory,
  makeSignalRecord, updateSignalStatuses,
  updateSignalStatusesByPrice,
} from '@/lib/signalHistory'
import { evaluateAutoClose }             from '@/lib/autoClose'
import { saveSignalToCloud, loadSignalsFromCloud, getSupabase, transformSignal } from '@/lib/supabase'
import {
  ntfyAutoClose, ntfyTPHit, ntfySLHit,
  ntfyApproachingSL, ntfyTrailingSL, ntfyStopMoved,
} from '@/lib/ntfy'
import { evaluateStopManagement } from '@/lib/stopManagement'

const DEDUP_PCT = 0.005  // 0.5% price move required before saving same-side signal again

export function useSignalHistory() {
  const tradeHistory     = useApexStore(s => s.tradeHistory)
  const rawK             = useApexStore(s => s.rawK)
  const mkt              = useApexStore(s => s.mkt)
  const inds             = useApexStore(s => s.inds)
  const setSignalHistory = useApexStore(s => s.setSignalHistory)
  const pushScalpHistory = useApexStore(s => s.pushScalpHistory)

  // Hydrate: try Supabase first, fall back to localStorage
  // Then subscribe to Realtime AND poll every 60s so cron signals always appear
  useEffect(() => {
    const syncFromCloud = async () => {
      const cloud = await loadSignalsFromCloud()
      if (!cloud?.length) return
      // Merge: keep any local-only signals not yet in cloud, update rest
      const current = useApexStore.getState().signalHistory
      const cloudIds = new Set(cloud.map(s => s.id))
      const localOnly = current.filter(s => !cloudIds.has(s.id))
      const merged = [...cloud, ...localOnly]
      setSignalHistory(merged)
      // Sync scalp signals into scalpHistory store so CandleChart + historial see them
      // transformSignal already sets idea.tradeType — filter by it rather than isScalp
      merged
        .filter(r => r.idea?.tradeType === 'Scalp' && r.status !== 'active')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .forEach(r => pushScalpHistory(r as any))
    }

    // Initial load
    syncFromCloud().catch(() => {
      const saved = loadSignalHistory()
      if (saved.length) setSignalHistory(saved)
    })

    // ── Polling fallback (60s) — guarantees new cron signals appear even if
    //    Supabase Realtime publication is not enabled for apex_signals ──────
    const pollInterval = setInterval(() => {
      syncFromCloud().catch(() => { /* silent — realtime covers this */ })
    }, 60_000)

    // ── Realtime: instant push for INSERT/UPDATE (with reconnect on 1006) ──
    const sb = getSupabase()
    if (!sb) return () => clearInterval(pollInterval)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed    = false   // set on cleanup so reconnect doesn't fire after unmount
    let subscribeId  = 0       // incremented on each subscribe(); guards stale CLOSED callbacks

    const subscribe = () => {
      if (destroyed) return
      const myId = ++subscribeId   // capture this subscription's ID
      // Remove old channel — this may trigger CLOSED on the old callback,
      // but myId !== subscribeId will be false there so it's ignored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (channel) { (sb as any).removeChannel(channel); channel = null }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel = (sb as any)
        .channel('apex_signals_realtime', {
          config: { broadcast: { self: false } },
        })
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'apex_signals' },
          (payload: { eventType: string; new: Record<string, unknown> }) => {
            const cur = useApexStore.getState().signalHistory
            if (payload.eventType === 'INSERT') {
              if (cur.some(s => s.id === String(payload.new.id))) return
              setSignalHistory([transformSignal(payload.new), ...cur])
            }
            if (payload.eventType === 'UPDATE') {
              setSignalHistory(cur.map(s =>
                s.id === String(payload.new.id) ? transformSignal(payload.new) : s
              ))
            }
          },
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .subscribe((status: string, err?: any) => {
          if (myId !== subscribeId) return   // stale callback from a removed channel — ignore
          if (status === 'SUBSCRIBED') {
            console.log('[APEX Realtime] apex_signals live')
            // Sync signals on every successful (re)connect to catch any missed INSERTs
            syncFromCloud().catch(() => {})
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            console.warn(`[APEX Realtime] ${status} — reconectando en 5s…`)
            reconnectTimer = setTimeout(subscribe, 5_000)
          } else if (err) {
            console.error('[APEX Realtime] error:', err)
          }
        })
    }

    subscribe()

    return () => {
      destroyed = true
      clearInterval(pollInterval)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (channel) (sb as any).removeChannel(channel)
    }
  }, [setSignalHistory])

  // Sync new trade ideas → signal records
  // Multiple concurrent signals allowed — up to 5 active simultaneously
  // Dedup: same-side signal requires 0.5% price move
  useEffect(() => {
    if (!tradeHistory.length) return
    // Prefer store state (includes Supabase-loaded signals) over localStorage
    // localStorage only has client-generated signals; cron signals only exist in Supabase
    const storeHistory = useApexStore.getState().signalHistory
    const current = storeHistory.length > 0 ? storeHistory : loadSignalHistory()

    // For dedup: track the most-recent active entry per side
    const lastActiveBySide: Record<string, number> = {}
    for (const r of current) {
      if (r.status === 'active' || r.status === 'pending_confirmation') {
        if (!lastActiveBySide[r.idea.side]) {
          lastActiveBySide[r.idea.side] = r.idea.price
        }
      }
    }

    const activeCount = current.filter(r => r.status === 'active').length

    const newRecs = tradeHistory.filter(idea => {
      // Cap at 5 concurrent active signals
      if (activeCount >= 5) return false
      const lastEntry = lastActiveBySide[idea.side]
      if (!lastEntry) return true
      // Require 0.5% price move to add another same-side signal
      return Math.abs(idea.price - lastEntry) / lastEntry >= DEDUP_PCT
    }).map(idea => makeSignalRecord(idea))  // all signals start as 'active'

    if (!newRecs.length) return
    const merged = [...newRecs, ...current].slice(0, 200)
    saveSignalHistory(merged)
    setSignalHistory(merged)
    // Cloud sync: save new records asynchronously (fire-and-forget)
    newRecs.forEach(r => saveSignalToCloud(r).catch(() => {}))
  }, [tradeHistory, setSignalHistory])

  // Real-time price update: TP/SL detection + warnings + auto-close
  useEffect(() => {
    const price = mkt.price
    if (!price) return
    // Use store state (includes Supabase-loaded signals); localStorage only has client signals
    const current = useApexStore.getState().signalHistory
    if (!current.some(r => r.status === 'active' || r.status === 'pending_confirmation')) return

    // ── 1. TP/SL hit detection ────────────────────────────────────────────────
    let updated = updateSignalStatusesByPrice(current, price)

    // Fire NTFY for status transitions and partial TP hits
    updated.forEach((rec, i) => {
      const old    = current[i]
      const idea   = rec.idea
      const isLong = idea.side === 'LONG'
      const sig    = { side: idea.side, entry: idea.price, sl: idea.sl, tradeType: idea.tradeType }

      // Full closes (status changed from active)
      if (old.status === 'active' && rec.status !== 'active') {
        if (rec.status === 'sl_hit') {
          ntfySLHit(sig, idea.sl, rec.pnl ?? 0)
        } else if (rec.status === 'tp3_hit') {
          ntfyTPHit(sig, 'tp3', idea.tp3, rec.pnl ?? 0)
        } else if (rec.status === 'auto_close') {
          // bias-flip or funding close — no specific TP NTFY
        }
      }

      // Partial TP1 hit — stays active, SL moved to entry
      if (!old.tp1Hit && rec.tp1Hit) {
        ntfyTPHit(sig, 'tp1', idea.tp1, 0)
        ntfyTrailingSL(sig, isLong ? idea.price : idea.price)
      }

      // Partial TP2 hit — stays active, SL moved to TP1
      if (!old.tp2Hit && rec.tp2Hit) {
        ntfyTPHit(sig, 'tp2', idea.tp2, 0)
      }
    })

    // ── 2. SL warning on still-active records ────────────────────────────────
    const SL_WARN_THRESHOLD = 0.005  // 0.5% from SL
    const nowIso = new Date().toISOString()

    updated = updated.map(rec => {
      if (rec.status !== 'active') return rec
      const idea   = rec.idea
      const isLong = idea.side === 'LONG'
      const sig    = { side: idea.side, entry: idea.price, sl: idea.sl, tradeType: idea.tradeType }

      // SL approaching warning (only once)
      if (!rec.slWarningFired) {
        const distToSL = isLong
          ? (price - idea.sl) / idea.price
          : (idea.sl - price) / idea.price
        if (distToSL > 0 && distToSL < SL_WARN_THRESHOLD) {
          ntfyApproachingSL(sig, price, distToSL * 100)
          return { ...rec, slWarningFired: true }
        }
      }

      return rec
    })

    // ── 3. Auto-close evaluation ──────────────────────────────────────────────
    const autoCloseEnabled = (() => {
      try { return localStorage.getItem('apex_auto_close') !== 'false' } catch { return true }
    })()

    if (autoCloseEnabled) {
      updated = updated.map(rec => {
        if (rec.status !== 'active') return rec
        const result = evaluateAutoClose(rec, price, inds, mkt)
        if (!result) return rec
        ntfyAutoClose(
          { side: rec.idea.side, entry: rec.idea.price, closePrice: result.closePrice },
          result.reason,
          result.pnl,
        )
        return {
          ...rec,
          status:      result.closeType === 'expired' ? 'expired' : 'auto_close',
          exitPrice:   result.closePrice,
          exitTs:      nowIso,
          closedAt:    nowIso,
          closeReason: result.reason,
          pnl:         result.pnl,
          pnlR:        result.pnlR,
        } as typeof rec
      })
    }

    // ── 4. Trailing stop / breakeven management ────────────────────────────────
    const k4h = rawK['4h'] ?? []
    updated = updated.map(rec => {
      if (rec.status !== 'active') return rec
      const tf = rec.idea.tradeType === 'Scalp' ? (rawK['15m'] ?? k4h) : k4h
      const stopUpdate = evaluateStopManagement(rec, price, tf)
      if (!stopUpdate) return rec
      ntfyStopMoved({ side: rec.idea.side, idea: rec.idea }, stopUpdate)
      return {
        ...rec,
        idea:          { ...rec.idea, sl: stopUpdate.newSL },
        breakevenSet:  stopUpdate.action === 'move_to_breakeven' ? true : (rec as { breakevenSet?: boolean }).breakevenSet,
        trailing2Set:  stopUpdate.action === 'trail_to_tp1'      ? true : (rec as { trailing2Set?: boolean }).trailing2Set,
        trailingActive: stopUpdate.pnlProtected > 0              ? true : (rec as { trailingActive?: boolean }).trailingActive,
        stopHistory:   [
          ...((rec as { stopHistory?: unknown[] }).stopHistory ?? []),
          { from: stopUpdate.oldSL, to: stopUpdate.newSL, reason: stopUpdate.reason, ts: nowIso },
        ],
      } as typeof rec
    })

    // Persist only if anything changed
    const anyChanged = updated.some((r, i) => r !== current[i])
    if (!anyChanged) return
    saveSignalHistory(updated)
    setSignalHistory(updated)
    // Sync changed records to Supabase (stop updates, status changes, warnings)
    updated.filter((r, i) => r !== current[i]).forEach(r => saveSignalToCloud(r).catch(() => {}))
  }, [mkt.price, mkt, inds, rawK, setSignalHistory])

  // Candle-based update for accurate OHLC TP/SL fills (runs on kline refresh)
  useEffect(() => {
    // Use store state — same reason as price-update effect above
    const current = useApexStore.getState().signalHistory
    if (!current.some(r => r.status === 'active')) return
    const klines = rawK['1h'] ?? rawK['4h'] ?? []
    if (!klines.length) return
    const updated = updateSignalStatuses(current, klines)
    const changed = updated.some((r, i) => r.status !== current[i].status)
    if (!changed) return
    saveSignalHistory(updated)
    setSignalHistory(updated)
  }, [rawK, setSignalHistory])
}

// ── Performance stats from Supabase (real closed signals) ────────────────────

export interface PerformanceStats {
  total:    number
  wins:     number
  losses:   number
  winRate:  number
  totalPnl: number
  avgPnl:   number
  byType:   Array<{ type: string; total: number; winRate: number; avgPnl: number }>
  byConf:   Array<{ conf: string; total: number; winRate: number }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any

export async function loadPerformanceStats(sb: SbClient): Promise<PerformanceStats | null> {
  if (!sb) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('apex_signals') as any)
    .select('side, trade_type, pnl, status, confidence, created_at')
    .not('pnl', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error || !data || !data.length) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wins   = (data as any[]).filter(s => s.pnl > 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const losses = (data as any[]).filter(s => s.pnl <= 0)

  const byType = ['Scalp', 'DayTrade', 'Swing'].map(type => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (data as any[]).filter(s => s.trade_type === type)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gWins = group.filter(s => s.pnl > 0)
    return {
      type,
      total:   group.length,
      winRate: group.length > 0 ? Math.round(gWins.length / group.length * 100) : 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      avgPnl:  group.length > 0 ? group.reduce((a: number, s: any) => a + s.pnl, 0) / group.length : 0,
    }
  })

  const byConf = ['ALTA', 'MEDIA', 'BAJA'].map(conf => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (data as any[]).filter(s => s.confidence === conf)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gWins = group.filter(s => s.pnl > 0)
    return {
      conf,
      total:   group.length,
      winRate: group.length > 0 ? Math.round(gWins.length / group.length * 100) : 0,
    }
  })

  return {
    total:    data.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate:  Math.round(wins.length / data.length * 100),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    totalPnl: (data as any[]).reduce((a: number, s: any) => a + s.pnl, 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    avgPnl:   (data as any[]).reduce((a: number, s: any) => a + s.pnl, 0) / data.length,
    byType,
    byConf,
  }
}

export function usePerformanceStats(): PerformanceStats | null {
  const [stats, setStats] = useState<PerformanceStats | null>(null)
  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return
    loadPerformanceStats(sb)
      .then(s => { if (s) setStats(s) })
      .catch(() => {})
  }, [])
  return stats
}
