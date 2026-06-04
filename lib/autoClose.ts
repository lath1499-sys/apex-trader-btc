// autoClose.ts — intentionally disabled
// Signals ONLY close on: SL hit, TP hit, or manual close.
// No time-based expiry. No condition-based auto-close. Zero tolerance.
// All SL/TP monitoring happens in app/api/agent/route.ts (server, every 5 min).

import type { SignalRecord } from './types'
import type { IndicatorMap } from './types'
import type { MarketData } from './types'

export interface AutoCloseResult {
  shouldClose:  boolean
  reason:       string
  closeType:    'sl_hit'
  closePrice:   number
  pnl:          number
  pnlR:         number
}

// Always returns null — auto-close is disabled.
// Kept as a stub to avoid import errors in useSignalHistory.ts.
export function evaluateAutoClose(
  _record:       SignalRecord,
  _currentPrice: number,
  _inds:         IndicatorMap,
  _mkt:          MarketData,
): AutoCloseResult | null {
  return null
}
