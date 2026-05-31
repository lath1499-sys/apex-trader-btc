import type { SignalRecord, TradeIdea, SignalStatus } from './types'
import type { Kline } from './types'

const LS_KEY   = 'apex_signal_history'
const MAX_RECS = 200

const EXPIRY: Record<string, number> = {
  Scalp:    2  * 60 * 60 * 1000,
  DayTrade: 36 * 60 * 60 * 1000,  // 36h — matches autoClose.ts
  Swing:    7  * 24 * 60 * 60 * 1000,
}

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

    // Expiry check
    const age = Date.now() - new Date(rec.createdAt).getTime()
    if (age > (EXPIRY[idea.tradeType] ?? EXPIRY.DayTrade)) {
      changed = true
      return {
        ...rec,
        status:      'expired' as SignalStatus,
        closedAt:    now,
        exitTs:      now,
        closeReason: `${idea.tradeType} expirado tras ${Math.round(age / 3_600_000)}h`,
      }
    }

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
    if (hit(idea.tp2)) {
      changed = true
      return { ...rec, status: 'tp2_hit' as SignalStatus,
        exitPrice: idea.tp2, exitTs: now,
        pnl: pnlPct(idea.price, idea.tp2, isLong),
        pnlR: pnlR(idea.price, idea.sl, idea.tp2, isLong) }
    }
    if (hit(idea.tp1)) {
      changed = true
      return { ...rec, status: 'tp1_hit' as SignalStatus,
        exitPrice: idea.tp1, exitTs: now,
        pnl: pnlPct(idea.price, idea.tp1, isLong),
        pnlR: pnlR(idea.price, idea.sl, idea.tp1, isLong) }
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
    const expiry   = EXPIRY[idea.tradeType] ?? EXPIRY.DayTrade

    if (Date.now() - signalMs > expiry) {
      const ageH = Math.round((Date.now() - signalMs) / 3_600_000)
      const ts   = new Date().toISOString()
      return {
        ...rec,
        status:      'expired' as SignalStatus,
        closedAt:    ts,
        exitTs:      ts,
        closeReason: `${idea.tradeType} expirado tras ${ageH}h`,
      }
    }

    const isLong = idea.side === 'LONG'
    const now    = new Date().toISOString()

    for (const k of klines) {
      if (k.t <= signalMs) continue
      const slHit  = isLong ? k.l <= idea.sl  : k.h >= idea.sl
      const tp1Hit = isLong ? k.h >= idea.tp1 : k.l <= idea.tp1
      const tp2Hit = isLong ? k.h >= idea.tp2 : k.l <= idea.tp2
      const tp3Hit = isLong ? k.h >= idea.tp3 : k.l <= idea.tp3
      const kTs    = new Date(k.t).toISOString()

      if (slHit && !tp1Hit) {
        return { ...rec, status: 'sl_hit', exitPrice: idea.sl, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, idea.sl, isLong), pnlR: pnlR(idea.price, idea.sl, idea.sl, isLong) }
      }
      if (tp3Hit) {
        return { ...rec, status: 'tp3_hit', exitPrice: idea.tp3, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, idea.tp3, isLong), pnlR: pnlR(idea.price, idea.sl, idea.tp3, isLong) }
      }
      if (tp2Hit) {
        return { ...rec, status: 'tp2_hit', exitPrice: idea.tp2, exitTs: kTs,
          pnl: pnlPct(idea.price, idea.tp2, isLong), pnlR: pnlR(idea.price, idea.sl, idea.tp2, isLong) }
      }
      if (tp1Hit) {
        return { ...rec, status: 'tp1_hit', exitPrice: idea.tp1, exitTs: kTs,
          pnl: pnlPct(idea.price, idea.tp1, isLong), pnlR: pnlR(idea.price, idea.sl, idea.tp1, isLong) }
      }
      if (slHit) {
        return { ...rec, status: 'sl_hit', exitPrice: idea.sl, exitTs: kTs, closedAt: kTs,
          pnl: pnlPct(idea.price, idea.sl, isLong), pnlR: pnlR(idea.price, idea.sl, idea.sl, isLong) }
      }
    }
    return rec
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
