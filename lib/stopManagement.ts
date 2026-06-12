// APEX — Stop Management: Breakeven + Trailing SL
// After TP1 hit → move SL to breakeven.
// After TP2 hit → trail SL to TP1.
// After 2R gain → trail behind recent structure.

import type { Kline } from './types'
import type { SignalRecord } from './types'

export interface StopUpdate {
  action:       'move_to_breakeven' | 'trail_to_tp1' | 'trail_tighter' | 'trail_behind_structure'
  newSL:        number
  reason:       string
  oldSL:        number
  pnlProtected: number   // % P&L now protected (may be 0 at breakeven)
}

export function evaluateStopManagement(
  rec:          SignalRecord,
  currentPrice: number,
  klines:       Kline[],
): StopUpdate | null {
  if (!rec || rec.status !== 'active') return null

  const idea    = rec.idea
  const isLong  = idea.side === 'LONG'
  const entry   = idea.price
  const sl      = idea.sl    // current SL (may have been updated already in rec)
  const currentSL = (rec as { sl?: number }).sl ?? sl   // prefer patched SL if present
  const slDist  = Math.abs(entry - currentSL)
  if (slDist === 0) return null

  const currentMoveR = isLong
    ? (currentPrice - entry) / slDist
    : (entry - currentPrice) / slDist

  // ── RULE 1: Move to breakeven after TP1 hit ──────────────────────────────
  const tp1Reached = isLong
    ? currentPrice >= idea.tp1
    : currentPrice <= idea.tp1

  const breakevenSet = rec.breakevenSet ?? false

  if (tp1Reached && !breakevenSet) {
    const buffer = slDist * 0.1   // 10% of original SL distance as safety buffer
    const newSL  = isLong ? entry + buffer : entry - buffer
    if ((isLong && newSL > currentSL) || (!isLong && newSL < currentSL)) {
      return {
        action:       'move_to_breakeven',
        newSL,
        reason:       `TP1 alcanzado - SL movido a breakeven (+${(buffer / entry * 100).toFixed(2)}%)`,
        oldSL:        currentSL,
        pnlProtected: buffer / entry * 100,
      }
    }
  }

  // ── RULE 2: Trail SL to TP1 after TP2 hit ────────────────────────────────
  const tp2Reached = isLong
    ? currentPrice >= idea.tp2
    : currentPrice <= idea.tp2

  const trailing2Set = rec.trailing2Set ?? false

  if (tp2Reached && !trailing2Set) {
    const newSL = idea.tp1
    if ((isLong && newSL > currentSL) || (!isLong && newSL < currentSL)) {
      return {
        action:       'trail_to_tp1',
        newSL,
        reason:       `TP2 alcanzado - SL trailing a TP1 ($${Math.round(newSL).toLocaleString()})`,
        oldSL:        currentSL,
        pnlProtected: Math.abs(idea.tp1 - entry) / entry * 100,
      }
    }
  }

  // ── RULE 3: Structure-based trailing after 2R gain ────────────────────────
  const trailingActive = rec.trailingActive ?? false

  if (currentMoveR >= 2.0 && trailingActive && klines.length >= 5) {
    const recentCandles = klines.slice(-5)
    if (isLong) {
      const swingLow = Math.min(...recentCandles.map(k => k.l))
      if (swingLow > currentSL && swingLow < currentPrice) {
        return {
          action:       'trail_behind_structure',
          newSL:        swingLow,
          reason:       `Trailing SL detras de estructura - swing low $${Math.round(swingLow).toLocaleString()}`,
          oldSL:        currentSL,
          pnlProtected: (swingLow - entry) / entry * 100,
        }
      }
    } else {
      const swingHigh = Math.max(...recentCandles.map(k => k.h))
      if (swingHigh < currentSL && swingHigh > currentPrice) {
        return {
          action:       'trail_behind_structure',
          newSL:        swingHigh,
          reason:       `Trailing SL detras de estructura - swing high $${Math.round(swingHigh).toLocaleString()}`,
          oldSL:        currentSL,
          pnlProtected: (entry - swingHigh) / entry * 100,
        }
      }
    }
  }

  return null
}
