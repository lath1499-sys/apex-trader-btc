import type { SignalRecord, TradeIdea, SignalStatus } from './types'
import type { Kline } from './types'

const LS_KEY   = 'apex_signal_history'
const MAX_RECS = 200


export function loadSignalHistory(): SignalRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as SignalRecord[]).map(r => ({
      ...r,
      idea: { ...r.idea, ts: new Date(r.idea.ts) },
    }))
  } catch { return [] }
}

export function saveSignalHistory(records: SignalRecord[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(records.slice(0, MAX_RECS))) } catch { /* quota */ }
}

export function makeSignalRecord(idea: TradeIdea): SignalRecord {
  return {
    id:          Date.now().toString(),
    createdAt:   new Date().toISOString(),
    idea,
    status:      'active',
    exitPrice:   null,
    exitTs:      null,
    pnlR:        null,
    pnl:         null,
    closedAt:    null,
    closeReason: null,
  }
}

function pnlPct(entry: number, exit: number, isLong: boolean): number {
  return isLong ? (exit - entry) / entry * 100 : (entry - exit) / entry * 100
}

function pnlR(entry: number, sl: number, exit: number, isLong: boolean): number {
  const risk = Math.abs(entry - sl)
  if (risk === 0) return 0
  return isLong ? (exit - entry) / risk : (entry - exit) / risk
}

// Real-time update against current price (runs on every mkt tick)
export function updateSignalStatusesByPrice(
  records: SignalRecord[],
  currentPrice: number,
): SignalRecord[] {
  let changed = false
  const updated = records.map(rec => {
    if (rec.status !== 'active') return rec
    const { idea } = rec
    const isLong   = idea.side === 'LONG'
    const now      = new Date().toISOString()

    const hit = (target: number) =>
      isLong ? currentPrice >= target : currentPrice <= target
    const slHit = isLong ? currentPrice <= idea.sl : currentPrice >= idea.sl

    if (slHit) {
      changed = true
      return { ...rec, status: 'sl_hit' as SignalStatus,
        exitPrice: idea.sl, exitTs: now, closedAt: now,
        pnl: pnlPct(idea.price, idea.sl, isLong),
        pnlR: pnlR(idea.price, idea.sl, idea.sl, isLong) }
    }
    if (hit(idea.tp3)) {
      changed = true
      return { ...rec, status: 'tp3_hit' as SignalStatus,
        exitPrice: idea.tp3, exitTs: now, closedAt: now,
        pnl: pnlPct(idea.price, idea.tp3, isLong),
        pnlR: pnlR(idea.price, idea.sl, idea.tp3, isLong) }
    }
    // TP2 partial — only if TP1 already hit; move SL to TP1
    if (!rec.tp2Hit && rec.tp1Hit && hit(idea.tp2)) {
      changed = true
      return { ...rec, tp2Hit: true, status: 'active' as SignalStatus,
        idea: { ...idea, sl: idea.tp1 } }
    }
    // TP1 partial — move SL to entry (breakeven)
    if (!rec.tp1Hit && hit(idea.tp1)) {
      changed = true
      return { ...rec, tp1Hit: true, status: 'active' as SignalStatus,
        idea: { ...idea, sl: idea.price } }
    }
    return rec
  })
  return changed ? updated : records
}

// Candle-based update for more accurate TP/SL fills using OHLC
export function updateSignalStatuses(
  records: SignalRecord[],
  klines: Kline[],
): SignalRecord[] {
  return records.map(rec => {
    if (rec.status !== 'active') return rec
    const { idea } = rec
    const signalMs = new Date(rec.createdAt).getTime()
    const isLong   = idea.side === 'LONG'
    const now      = new Date().toISOString()

    // Mutable working record — TP1/TP2 partial closes mutate it in-loop
    let working = { ...rec }

    for (const k of klines) {
      if (k.t <= signalMs) continue
      const wi    = working.idea
      const kTs   = new Date(k.t).toISOString()
      const slHit = isLong ? k.l <= wi.sl  : k.h >= wi.sl
      const canTP1 = isLong ? k.h >= wi.tp1 : k.l <= wi.tp1
      const canTP2 = isLong ? k.h >= wi.tp2 : k.l <= wi.tp2
      const canTP3 = isLong ? k.h >= wi.tp3 : k.l <= wi.tp3

      if (slHit && !canTP1) {
        return { ...working, status: 'sl_hit', exitPrice: wi.sl, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, wi.sl, isLong), pnlR: pnlR(idea.price, wi.sl, wi.sl, isLong) }
      }
      if (canTP3) {
        return { ...working, status: 'tp3_hit', exitPrice: wi.tp3, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, wi.tp3, isLong), pnlR: pnlR(idea.price, idea.sl, wi.tp3, isLong) }
      }
      // TP2 partial — move SL to TP1
      if (!working.tp2Hit && working.tp1Hit && canTP2) {
        working = { ...working, tp2Hit: true, status: 'active' as SignalStatus,
          idea: { ...wi, sl: wi.tp1 } }
        continue
      }
      // TP1 partial — move SL to entry (breakeven)
      if (!working.tp1Hit && canTP1) {
        working = { ...working, tp1Hit: true, status: 'active' as SignalStatus,
          idea: { ...wi, sl: idea.price } }
        continue
      }
      if (slHit) {
        return { ...working, status: 'sl_hit', exitPrice: wi.sl, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, wi.sl, isLong), pnlR: pnlR(idea.price, wi.sl, wi.sl, isLong) }
      }
    }
    return working
  })
}

export function closeManualSignal(
  records: SignalRecord[],
  id: string,
  closePrice: number,
  reason: string,
): SignalRecord[] {
  return records.map(rec => {
    if (rec.id !== id) return rec
    const { idea } = rec
    const isLong = idea.side === 'LONG'
    const now    = new Date().toISOString()
    return {
      ...rec,
      status:      'closed_manual' as SignalStatus,
      exitPrice:   closePrice,
      exitTs:      now,
      closedAt:    now,
      closeReason: reason,
      pnl:         pnlPct(idea.price, closePrice, isLong),
      pnlR:        pnlR(idea.price, idea.sl, closePrice, isLong),
    }
  })
}

export interface SignalStats {
  total: number; resolved: number; wins: number
  winRate: number; totalPnlR: number; avgPnlR: number
}

export function calcSignalStats(records: SignalRecord[]): SignalStats {
  const resolved  = records.filter(r => r.status !== 'active' && r.status !== 'expired')
  const wins      = resolved.filter(r => r.status !== 'sl_hit')
  const totalPnlR = resolved.reduce((s, r) => s + (r.pnlR ?? 0), 0)
  return {
    total:    records.length,
    resolved: resolved.length,
    wins:     wins.length,
    winRate:  resolved.length ? wins.length / resolved.length : 0,
    totalPnlR,
    avgPnlR:  resolved.length ? totalPnlR / resolved.length : 0,
  }
}
