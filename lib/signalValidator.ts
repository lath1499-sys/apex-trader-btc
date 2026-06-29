// APEX Signal Validator — detects close-price/status mismatches before they hit the DB.
// Called in handleSignalEvent for all terminal events.

export interface ValidationResult {
  correctStatus: string
  correctReason: string
  warning:       string | null
}

export function validateSignalClose(
  signal:     { side: string; entry: number; sl: number; tp1: number; tp2: number; tp3: number; tp1_hit?: boolean; tp2_hit?: boolean; status?: string },
  closePrice: number,
): ValidationResult {
  const isLong     = signal.side === 'LONG'
  const entry      = signal.entry
  const entryDiff  = Math.abs(closePrice - entry) / entry
  const tp1Diff    = Math.abs(closePrice - signal.tp1) / signal.tp1
  const tp2Diff    = Math.abs(closePrice - signal.tp2) / signal.tp2

  // Close at entry (±0.3%) after TP1 hit → breakeven, not TP2
  if ((signal.tp1_hit || signal.status === 'tp1_hit') && !signal.tp2_hit && entryDiff < 0.003) {
    const bankedApprox = 0  // can't compute without tp1ClosePct here
    const warning = signal.status === 'tp2_hit'
      ? `MISREPORT DETECTED: status was tp2_hit but close price $${Math.round(closePrice).toLocaleString()} is near entry $${Math.round(entry).toLocaleString()} (${(entryDiff*100).toFixed(2)}%), not TP2 $${Math.round(signal.tp2).toLocaleString()}`
      : null
    return {
      correctStatus: 'breakeven',
      correctReason: `Closed at breakeven (~entry $${Math.round(entry).toLocaleString()}) after TP1`,
      warning,
    }
  }

  // Close near TP2 (±0.5%) and TP1 was hit → genuine TP2
  if ((signal.tp1_hit || signal.status === 'tp1_hit') && tp2Diff < 0.005) {
    return { correctStatus: 'tp2_hit', correctReason: `TP2 reached at $${Math.round(closePrice).toLocaleString()}`, warning: null }
  }

  // Close near TP1 (±0.5%) after TP2 hit → SL floored at TP1
  if ((signal.tp2_hit || signal.status === 'tp2_hit') && tp1Diff < 0.005) {
    return { correctStatus: 'closed_manual', correctReason: `SL at TP1 floor triggered after TP2`, warning: null }
  }

  // Close below entry on a LONG (or above on SHORT) without TP1 → full loss
  const isPureSlLoss = !signal.tp1_hit && (
    isLong  ? closePrice < entry
            : closePrice > entry
  )
  if (isPureSlLoss) {
    return { correctStatus: 'sl_hit', correctReason: `Stop loss hit at $${Math.round(closePrice).toLocaleString()}`, warning: null }
  }

  return { correctStatus: signal.status ?? 'closed_manual', correctReason: 'Close validated', warning: null }
}
