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
  ntfyApproachingSL, ntfyAboutToExpire, ntfyTrailingSL, ntfyStopMoved,
} from '@/lib/ntfy'
import { evaluateStopManagement } from '@/lib/stopManagement'

const DEDUP_PCT = 0.005  // 0.5% price move required before saving same-side signal again

export function useSignalHistory() {
  const tradeHistory     = useApexStore(s => s.tradeHistory)
  const rawK             = useApexStore(s => s.rawK)
  const mkt              = useApexStore(s => s.mkt)
  const inds             = useApexStore(s => s.inds)
  const setSignalHistory = useApexStore(s => s.setSignalHistory)

  // Hydrate: try Supabase first, fall back to localStorage
  // Then subscribe to Realtime so cron-created signals appear without refresh
  useEffect(() => {
    const load = async () => {
      const cloud = await loadSignalsFromCloud()
      if (cloud && cloud.length) {
        setSignalHistory(cloud)
        return
      }
      const saved = loadSignalHistory()
      if (saved.length) setSignalHistory(saved)
    }
    load().catch(() => {
      const saved = loadSignalHistory()
      if (saved.length) setSignalHistory(saved)
    })

    // Realtime: push INSERT/UPDATE events straight into state
    const sb = getSupabase()
    if (!sb) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (sb as any)
      .channel('apex_signals_realtime')
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
      .subscribe()

    return () => { (sb as any).removeChannel(channel) }
  }, [setSignalHistory])

  // Sync new trade ideas → signal records
  // Multiple concurrent signals allowed — up to 5 active simultaneously
  // Dedup: same-side signal requires 0.5% price move
  useEffect(() => {
    if (!tradeHistory.length) return
    const current = loadSignalHistory()

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
    const current = loadSignalHistory()
    if (!current.some(r => r.status === 'active' || r.status === 'pending_confirmation')) return

    // ── 1. TP/SL hit detection ────────────────────────────────────────────────
    let updated = updateSignalStatusesByPrice(current, price)

    // Fire NTFY for any status transitions (active → tp*_hit / sl_hit)
    updated.forEach((rec, i) => {
      const old = current[i]
      if (old.status !== 'active' || rec.status === 'active') return
      const idea   = rec.idea
      const isLong = idea.side === 'LONG'
      const sig    = { side: idea.side, entry: idea.price, sl: idea.sl, tradeType: idea.tradeType }
      if (rec.status === 'sl_hit') {
        ntfySLHit(sig, idea.sl, rec.pnl ?? 0)
      } else if (rec.status === 'tp1_hit') {
        ntfyTPHit(sig, 'tp1', idea.tp1, rec.pnl ?? 0)
        ntfyTrailingSL(sig, isLong ? idea.price * 0.9998 : idea.price * 1.0002)
      } else if (rec.status === 'tp2_hit') {
        ntfyTPHit(sig, 'tp2', idea.tp2, rec.pnl ?? 0)
      } else if (rec.status === 'tp3_hit') {
        ntfyTPHit(sig, 'tp3', idea.tp3, rec.pnl ?? 0)
      }
    })

    // ── 2. SL warning + expiry warning on still-active records ───────────────
    const SL_WARN_THRESHOLD = 0.005  // 0.5% from SL
    const EXPIRY_MINS: Record<string, number> = { Scalp: 120, DayTrade: 36 * 60, Swing: 168 * 60 }
    const nowMs  = Date.now()
    const nowIso = new Date(nowMs).toISOString()

    updated = updated.map(rec => {
      if (rec.status !== 'active') return rec
      const idea   = rec.idea
      const isLong = idea.side === 'LONG'
      const sig    = { side: idea.side, entry: idea.price, sl: idea.sl, tradeType: idea.tradeType }
      let changed  = false
      let next     = { ...rec }

      // SL approaching warning (only once)
      if (!rec.slWarningFired) {
        const distToSL = isLong
          ? (price - idea.sl) / idea.price
          : (idea.sl - price) / idea.price
        if (distToSL > 0 && distToSL < SL_WARN_THRESHOLD) {
          ntfyApproachingSL(sig, price, distToSL * 100)
          next = { ...next, slWarningFired: true }
          changed = true
        }
      }

      // Expiry warning — 30 min before auto-close (only once)
      if (!rec.expiryWarningFired) {
        const minsAlive = (nowMs - new Date(rec.createdAt).getTime()) / 60_000
        const maxMins   = EXPIRY_MINS[idea.tradeType] ?? EXPIRY_MINS.DayTrade
        const minsLeft  = maxMins - minsAlive
        if (minsLeft > 0 && minsLeft <= 30) {
          ntfyAboutToExpire(sig, Math.round(minsLeft))
          next = { ...next, expiryWarningFired: true }
          changed = true
        }
      }

      return changed ? next : rec
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
    const current = loadSignalHistory()
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
