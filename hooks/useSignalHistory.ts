import { useEffect, useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import {
  loadSignalHistory, saveSignalHistory,
  updateSignalStatuses,
  updateSignalStatusesByPrice,
} from '@/lib/signalHistory'
// evaluateAutoClose removed — auto-close is disabled, server agent is sole signal closer.
import { saveSignalToCloud, loadSignalsFromCloud, getSupabase, transformSignal } from '@/lib/supabase'
// NTFY intentionally removed — server agent (app/api/agent/route.ts) sends all push notifications.
import { evaluateStopManagement } from '@/lib/stopManagement'
import type { ScalpSignal, ScalpStatus } from '@/lib/scalpSignals'
import type { SignalRecord } from '@/lib/types'

/** Re-shape a closed SignalRecord (from Supabase) into a ScalpSignal for the history display */
function signalRecordToScalp(r: SignalRecord): ScalpSignal {
  const idea = r.idea
  return {
    id:           r.id,
    side:         idea.side,
    entry:        idea.price,          // SignalRecord nests under idea.price
    sl:           idea.sl,
    tp1:          idea.tp1,
    tp2:          idea.tp2,
    tp3:          idea.tp3,
    confidence:   idea.confidence,
    reasons:      idea.reasons.map(rs => rs.txt),
    type:         'Scalp',
    duration:     r.closeReason ?? '',
    maxLeverage:  idea.maxLev,
    killzone:     r.killzone ?? null,
    bosChoch:     r.bosChoch ?? null,
    cvdSignal:    r.cvdSignal ?? null,
    vwapRelation: r.vwapRelation ?? '',
    qualityLabel: idea.confidence,
    score:        (idea as { score?: number }).score ?? 0,
    ts:           new Date(r.createdAt),
    status:       r.status as ScalpStatus,
    createdAt:    new Date(r.createdAt).getTime(),
    closedAt:     r.closedAt ? new Date(r.closedAt).getTime() : undefined,
    closePrice:   r.exitPrice ?? undefined,
    pnl:          r.pnl ?? undefined,
    tp1Hit:       r.tp1Hit,
    tp2Hit:       r.tp2Hit,
    slWarningFired: r.slWarningFired,
  }
}


export function useSignalHistory() {
  const rawK             = useApexStore(s => s.rawK)
  const mkt              = useApexStore(s => s.mkt)
  const inds             = useApexStore(s => s.inds)
  const setSignalHistory = useApexStore(s => s.setSignalHistory)
  const pushScalpHistory = useApexStore(s => s.pushScalpHistory)
  const setScalpSignals  = useApexStore(s => s.setScalpSignals)

  // Hydrate: try Supabase first, fall back to localStorage
  // Then subscribe to Realtime AND poll every 60s so cron signals always appear
  useEffect(() => {
    const syncFromCloud = async () => {
      const cloud = await loadSignalsFromCloud()
      if (!cloud?.length) return
      // Merge: NEVER remove existing signals — only update or add.
      // Replacing the whole array caused signals to disappear on every 60s poll.
      const current = useApexStore.getState().signalHistory
      const merged = [...current]
      cloud.forEach(s => {
        const idx = merged.findIndex(x => x.id === s.id)
        if (idx >= 0) merged[idx] = s   // update status / fields in place
        else merged.unshift(s)           // new signal from Supabase — prepend
      })
      setSignalHistory(merged)
      // Sync closed scalps into scalpHistory store so historial tab shows them
      merged
        .filter(r => r.idea?.tradeType === 'Scalp' && r.status !== 'active')
        .forEach(r => pushScalpHistory(signalRecordToScalp(r)))

      // ── Sync ALL active scalps into scalpSignals[] array (authoritative UI source) ──
      const activeScalps = merged
        .filter(r => r.idea?.tradeType === 'Scalp' && r.status === 'active')
        .map(r => signalRecordToScalp(r))
      setScalpSignals(activeScalps)

      // Keep legacy scalpSignal (single) in sync for useMarketData compat
      const activeScalpRec = merged.find(r => r.idea?.tradeType === 'Scalp' && r.status === 'active')
      if (activeScalpRec) {
        const currentScalp = useApexStore.getState().scalpSignal
        if (!currentScalp || currentScalp.status !== 'active') {
          useApexStore.getState().setScalpSignal(signalRecordToScalp(activeScalpRec))
        }
      } else {
        // No active scalps in Supabase — clear the legacy single signal too
        useApexStore.getState().setScalpSignal(null)
      }
    }

    // Initial load
    syncFromCloud().catch(() => {
      const saved = loadSignalHistory()
      if (!saved.length) return
      setSignalHistory(prev => {
        const merged = [...prev]
        saved.forEach(s => {
          const idx = merged.findIndex(x => x.id === s.id)
          if (idx >= 0) merged[idx] = s
          else merged.unshift(s)
        })
        return merged
      })
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

  // tradeHistory signal generation removed — server agent is sole signal source.
  // pushTradeIdea has no callers; this effect was dead code generating ghost signals.

  // Real-time price update: TP/SL detection + warnings + auto-close
  useEffect(() => {
    const price = mkt.price
    if (!price) return
    // Use store state (includes Supabase-loaded signals); localStorage only has client signals
    const current = useApexStore.getState().signalHistory
    if (!current.some(r => r.status === 'active' || r.status === 'pending_confirmation' || r.status === 'tp1_hit' || r.status === 'tp2_hit')) return

    // ── 1. TP/SL hit detection ────────────────────────────────────────────────
    let updated = updateSignalStatusesByPrice(current, price)

    // Note: NTFY is sent server-side only (app/api/agent/route.ts).
    // Client-side status changes update local UI only.

    // ── 2. SL warning on still-active records ────────────────────────────────
    const SL_WARN_THRESHOLD = 0.005  // 0.5% from SL
    const nowIso = new Date().toISOString()

    updated = updated.map(rec => {
      if (rec.status !== 'active') return rec
      const idea   = rec.idea
      const isLong = idea.side === 'LONG'

      // SL approaching warning — flag only (no client NTFY; server sends push)
      if (!rec.slWarningFired) {
        const distToSL = isLong
          ? (price - idea.sl) / idea.price
          : (idea.sl - price) / idea.price
        if (distToSL > 0 && distToSL < SL_WARN_THRESHOLD) {
          return { ...rec, slWarningFired: true }
        }
      }

      return rec
    })

    // ── 3. Trailing stop / breakeven management ────────────────────────────────
    const k4h = rawK['4h'] ?? []
    updated = updated.map(rec => {
      if (rec.status !== 'active') return rec
      const tf = rec.idea.tradeType === 'Scalp' ? (rawK['15m'] ?? k4h) : k4h
      const stopUpdate = evaluateStopManagement(rec, price, tf)
      if (!stopUpdate) return rec
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
    // Merge into latest store state — never shrink the array (race-safe functional update)
    setSignalHistory(prev => {
      const merged = [...prev]
      updated.forEach(s => {
        const idx = merged.findIndex(x => x.id === s.id)
        if (idx >= 0) merged[idx] = s
        else merged.unshift(s)
      })
      return merged
    })
    // Sync ONLY non-terminal changes to Supabase (SL moves, warning flags).
    // Server agent is sole authority for closing signals — client must NOT write
    // sl_hit / tp*_hit / breakeven back to Supabase or it races with the server.
    updated
      .filter((r, i) => r !== current[i] && (r.status === 'active' || r.status === 'pending_confirmation' || r.status === 'tp1_hit' || r.status === 'tp2_hit'))
      .forEach(r => saveSignalToCloud(r).catch(() => {}))
  }, [mkt.price, mkt, inds, rawK, setSignalHistory])

  // Candle-based update for accurate OHLC TP/SL fills (runs on kline refresh)
  useEffect(() => {
    // Use store state — same reason as price-update effect above
    const current = useApexStore.getState().signalHistory
    if (!current.some(r => r.status === 'active' || r.status === 'tp1_hit' || r.status === 'tp2_hit')) return
    const klines = rawK['1h'] ?? rawK['4h'] ?? []
    if (!klines.length) return
    const updated = updateSignalStatuses(current, klines)
    const changed = updated.some((r, i) => r.status !== current[i].status)
    if (!changed) return
    saveSignalHistory(updated)
    // Merge — never replace (candle-based TP/SL detection must not shrink the array)
    setSignalHistory(prev => {
      const merged = [...prev]
      updated.forEach(s => {
        const idx = merged.findIndex(x => x.id === s.id)
        if (idx >= 0) merged[idx] = s
        else merged.unshift(s)
      })
      return merged
    })
  }, [rawK, setSignalHistory])
}

// ── Performance stats from Supabase (real closed signals) ────────────────────

export interface PerformanceStats {
  total:      number
  wins:       number
  losses:     number
  breakevens: number
  winRate:    number   // wins / (wins + losses), excludes breakevens
  totalPnl:   number
  avgPnl:     number
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
  const wins       = (data as any[]).filter(s => s.pnl > 0.1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const losses     = (data as any[]).filter(s => s.pnl < -0.1 && s.status !== 'breakeven')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const breakevens = (data as any[]).filter(s => s.status === 'breakeven' || Math.abs(s.pnl ?? 0) <= 0.1)

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

  const decisive = wins.length + losses.length   // excludes breakevens from WR calc
  return {
    total:      data.length,
    wins:       wins.length,
    losses:     losses.length,
    breakevens: breakevens.length,
    winRate:    decisive > 0 ? Math.round(wins.length / decisive * 100) : 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    totalPnl:   (data as any[]).reduce((a: number, s: any) => a + s.pnl, 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    avgPnl:     (data as any[]).reduce((a: number, s: any) => a + s.pnl, 0) / data.length,
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
