// APEX — Professional leverage sizing calculator
// Formula: leverage = riskPct / slDistancePct
// Ensures if SL is hit, we lose exactly riskPct of available capital.

export type TradeType = 'Scalp' | 'DayTrade' | 'Swing'

export interface LeverageCaps {
  min:   number
  max:   number
  ideal: number
}

export const LEVERAGE_CAPS: Record<TradeType, LeverageCaps> = {
  Scalp:     { min: 5,  max: 25, ideal: 15 },
  DayTrade:  { min: 3,  max: 15, ideal: 8  },
  Swing:     { min: 1,  max: 7,  ideal: 4  },
}

export interface LeverageResult {
  leverage:       number   // recommended leverage (capped, rounded)
  slDistancePct:  number   // % distance entry→SL
  positionSize:   number   // USD position size
  riskUSD:        number   // max loss if SL hit
  cap:            LeverageCaps
  warning?:       string
}

// Minimum SL distance by trade type to avoid hunting
const MIN_SL_PCT: Record<TradeType, number> = {
  Scalp:    0.25,   // 0.25%
  DayTrade: 0.50,   // 0.50%
  Swing:    1.00,   // 1.00%
}

export function calculateLeverage(
  tradeType:       TradeType,
  entryPrice:      number,
  slPrice:         number,
  availableCapital: number,
  riskPct:         number,   // e.g. 0.05 = 5%
): LeverageResult {
  const cap = LEVERAGE_CAPS[tradeType]
  const slDistancePct = Math.abs(entryPrice - slPrice) / entryPrice * 100
  const minSl = MIN_SL_PCT[tradeType]

  // If SL is dangerously close, warn but don't reject
  const warning = slDistancePct < minSl
    ? `SL muy cercano (${slDistancePct.toFixed(2)}% < mínimo ${minSl}% para ${tradeType})`
    : undefined

  // Core formula: leverage = riskPct / slDistancePct
  const rawLeverage = slDistancePct > 0 ? (riskPct * 100) / slDistancePct : cap.ideal

  // Clamp to trade-type caps
  const leverage = Math.max(cap.min, Math.min(cap.max, Math.round(rawLeverage * 10) / 10))

  const riskUSD     = availableCapital * riskPct
  const positionSize = riskUSD / (slDistancePct / 100)

  return { leverage, slDistancePct, positionSize, riskUSD, cap, warning }
}

export function formatLeverageForNotification(result: LeverageResult, tradeType: TradeType): string {
  const lines = [
    `⚡ Apalancamiento: <b>${result.leverage}x</b> (rango ${tradeType}: ${result.cap.min}x–${result.cap.max}x)`,
    `📏 Dist. SL: ${result.slDistancePct.toFixed(2)}% | Riesgo: $${result.riskUSD.toFixed(0)}`,
  ]
  if (result.warning) lines.push(`⚠️ ${result.warning}`)
  return lines.join('\n')
}

export function formatLeverageTableForPrompt(): string {
  return [
    'TABLA DE APALANCAMIENTO (APEX Professional Sizing):',
    '  Scalp:    5x–25x (ideal 15x) | SL mín 0.25% | fórmula: leverage = riskPct% / slDist%',
    '  DayTrade: 3x–15x (ideal 8x)  | SL mín 0.50%',
    '  Swing:    1x–7x  (ideal 4x)  | SL mín 1.00%',
    'Ejemplo: riesgo 5%, SL a 1% → leverage = 5%/1% = 5x (Swing ✓)',
    'Ejemplo: riesgo 5%, SL a 0.5% → leverage = 5%/0.5% = 10x (DayTrade/Scalp ✓)',
  ].join('\n')
}
