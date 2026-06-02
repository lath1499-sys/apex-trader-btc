import type { SignalRecord } from './types'
import type { IndicatorMap } from './types'
import type { MarketData } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Auto-close evaluation — runs on every price/indicator refresh
// Returns a close action when a signal should be closed autonomously
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoCloseResult {
  shouldClose:  boolean
  reason:       string
  closeType:    'tp1_hit' | 'tp2_hit' | 'tp3_hit' | 'sl_hit' | 'auto_close' | 'expired'
  closePrice:   number
  pnl:          number
  pnlR:         number
}

function calcPnl(entry: number, sl: number, exit: number, isLong: boolean) {
  const pnl  = isLong ? (exit - entry) / entry * 100 : (entry - exit) / entry * 100
  const risk  = Math.abs(entry - sl)
  const gain  = Math.abs(exit - entry)
  const pnlR  = risk > 0 ? (isLong ? (exit > entry ? 1 : -1) : (exit < entry ? 1 : -1)) * gain / risk : 0
  return { pnl, pnlR }
}

export function evaluateAutoClose(
  record:       SignalRecord,
  currentPrice: number,
  inds:         IndicatorMap,
  mkt:          MarketData,
): AutoCloseResult | null {
  const idea   = record.idea
  const isLong = idea.side === 'LONG'
  const hoursAlive = (Date.now() - new Date(record.createdAt).getTime()) / 3_600_000

  const close = (
    closeType: AutoCloseResult['closeType'],
    closePrice: number,
    reason: string,
  ): AutoCloseResult => {
    const { pnl, pnlR } = calcPnl(idea.price, idea.sl, closePrice, isLong)
    return { shouldClose: true, reason, closeType, closePrice, pnl, pnlR }
  }

  // ── 1. Hard stops (TP/SL already handled by updateSignalStatusesByPrice) ──
  // Only handle smart-exit conditions here to avoid duplication

  // ── 3. Bias flipped strongly (4H) ─────────────────────────────────────────
  if (hoursAlive > 1) {
    const i4 = inds?.['4h']
    if (i4) {
      const biasFlipped =
        (isLong  && i4.bias === 'BAJISTA' && i4.score <= -5) ||
        (!isLong && i4.bias === 'ALCISTA' && i4.score >= 5)
      if (biasFlipped)
        return close('auto_close', currentPrice,
          `Sesgo 4H revertido fuertemente (score ${i4.score}/9) — señal contraria dominante`)
    }
  }

  // ── 4. Funding extreme against position ───────────────────────────────────
  if (idea.tradeType !== 'Scalp' && mkt.funding != null) {
    if (isLong && mkt.funding > 0.08)
      return close('auto_close', currentPrice,
        `Funding +${mkt.funding.toFixed(3)}% extremo — costo de mantener muy alto`)
  }

  return null
}
