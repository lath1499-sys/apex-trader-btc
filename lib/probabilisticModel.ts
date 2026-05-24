// APEX — Probabilistic Win-Rate Model
// Replaces binary "signal yes/no" with probability estimates.
// Every signal now has a calculated win probability based on historical
// base rates adjusted by contextual factors.

import type { SignalRecord } from './types'
import type { RegimeAnalysis } from './marketRegime'

export interface ProbabilityScore {
  winProbability:    number                  // 0-100, estimated chance of reaching TP1
  expectedValue:     number                  // positive = good trade in R units
  kellyCriterion:    number                  // optimal position size as % of capital
  confidenceInterval: [number, number]       // 90% CI on win probability
  sampleSize:        number                  // how many historical trades inform this
  factors: { name: string; contribution: number; direction: '+' | '-' }[]
}

// ── Base rates (empirical crypto futures research) ──────────────────────────

const BASE_RATES = {
  Scalp:    { baseWinRate: 0.52, avgWin: 1.5, avgLoss: 1.0 },
  DayTrade: { baseWinRate: 0.48, avgWin: 2.0, avgLoss: 1.0 },
  Swing:    { baseWinRate: 0.42, avgWin: 3.5, avgLoss: 1.0 },
}

const ADJ = {
  STRONG_TREND:          +0.08,
  RANGING_PENALTY:       -0.06,
  BREAKOUT:              +0.05,
  SCORE_8_PLUS:          +0.12,
  SCORE_6_7:             +0.05,
  ENGULFING:             +0.08,
  STAR_PATTERN:          +0.12,
  THREE_CANDLE:          +0.10,
  FVG_PRESENT:           +0.07,
  LONDON_KZ:             +0.08,
  NY_AM_KZ:              +0.10,
  NY_PM_KZ:              +0.05,
  ASIA_KZ:               -0.08,
  FG_EXTREME_FEAR_LONG:  +0.10,
  FG_EXTREME_GREED_SHORT:+0.10,
  FUNDING_NEG_LONG:      +0.06,
  FUNDING_EXT_SHORT:     +0.08,
  RSI_OVERSOLD_LONG:     +0.07,
  RSI_OVERBOUGHT_SHORT:  +0.07,
  ALL_3_TF:              +0.12,
  TWO_TF:                +0.06,
  MULTI_TF_PATTERN:      +0.08,
}

// ── Main export ─────────────────────────────────────────────────────────────

export interface SignalContext {
  side:        'LONG' | 'SHORT'
  tradeType:   'Scalp' | 'DayTrade' | 'Swing'
  score:       number
  entry:       number
  sl:          number
  tp1:         number
  killzone?:   string | null
  fg?:         number
  funding?:    number
  patterns?:   Array<{ name: string; type: 'bullish' | 'bearish' }>
  inds?:       Record<string, { bias: string }>
}

export function calcWinProbability(
  signal:        SignalContext,
  regime:        RegimeAnalysis | null,
  signalHistory: SignalRecord[],
): ProbabilityScore {
  const base = BASE_RATES[signal.tradeType] ?? BASE_RATES.DayTrade
  let winRate  = base.baseWinRate
  const factors: ProbabilityScore['factors'] = []

  const add = (name: string, val: number) => {
    if (Math.abs(val) < 0.001) return
    winRate += val
    factors.push({ name, contribution: Math.round(Math.abs(val) * 100), direction: val > 0 ? '+' : '-' })
  }

  // Regime
  if (regime) {
    if (regime.regime.includes('STRONG_TREND')) add('Régimen tendencia fuerte', ADJ.STRONG_TREND)
    if (regime.regime === 'RANGING')            add('Mercado lateral (negativo)', ADJ.RANGING_PENALTY)
    if (regime.regime === 'BREAKOUT_IMMINENT')  add('Breakout inminente', ADJ.BREAKOUT)
  }

  // Score
  const totalScore = signal.score
  if (totalScore >= 8) add('Score muy alto (8+)', ADJ.SCORE_8_PLUS)
  else if (totalScore >= 6) add('Score alto (6-7)', ADJ.SCORE_6_7)

  // Candle patterns
  const patterns = signal.patterns ?? []
  patterns.forEach(p => {
    const relevant = signal.side === 'LONG' ? p.type === 'bullish' : p.type === 'bearish'
    if (!relevant) return
    if (p.name.includes('Star') || p.name.includes('Morning') || p.name.includes('Evening'))
      add(`Patrón ${p.name}`, ADJ.STAR_PATTERN)
    else if (p.name.includes('Engulfing') || p.name.includes('Kicker'))
      add(`Patrón ${p.name}`, ADJ.ENGULFING)
    else if (p.name.includes('Soldiers') || p.name.includes('Crows') || p.name.includes('Three'))
      add(`Patrón ${p.name}`, ADJ.THREE_CANDLE)
  })
  if (patterns.length >= 2) add('Confluencia multi-patrón', ADJ.MULTI_TF_PATTERN)

  // Killzone (scalp)
  if (signal.tradeType === 'Scalp' && signal.killzone) {
    if (signal.killzone.includes('NY AM'))   add('NY Open Killzone', ADJ.NY_AM_KZ)
    else if (signal.killzone.includes('London')) add('London Open Killzone', ADJ.LONDON_KZ)
    else if (signal.killzone.includes('PM'))     add('NY PM Killzone', ADJ.NY_PM_KZ)
    else if (signal.killzone.includes('Asia') || signal.killzone.includes('ASIA'))
      add('Sesión Asia (negativo)', ADJ.ASIA_KZ)
  }

  // Sentiment
  const fg       = signal.fg ?? 50
  const funding  = signal.funding ?? 0
  if (signal.side === 'LONG'  && fg < 20)     add('Miedo extremo — contrarian long', ADJ.FG_EXTREME_FEAR_LONG)
  if (signal.side === 'SHORT' && fg > 80)     add('Codicia extrema — contrarian short', ADJ.FG_EXTREME_GREED_SHORT)
  if (signal.side === 'LONG'  && funding < -0.01) add('Funding negativo — favorable long', ADJ.FUNDING_NEG_LONG)
  if (signal.side === 'SHORT' && funding > 0.05)  add('Funding extremo — favorable short', ADJ.FUNDING_EXT_SHORT)

  // Multi-TF alignment
  const inds = signal.inds ?? {}
  const bullTFs = Object.values(inds).filter(i => i.bias === 'ALCISTA').length
  const bearTFs = Object.values(inds).filter(i => i.bias === 'BAJISTA').length
  const alignedCount = signal.side === 'LONG' ? bullTFs : bearTFs
  if (alignedCount >= 3)      add('3 timeframes alineados', ADJ.ALL_3_TF)
  else if (alignedCount >= 2) add('2 timeframes alineados', ADJ.TWO_TF)

  // Clamp to realistic range
  winRate = Math.max(0.25, Math.min(0.80, winRate))

  // Self-learning: blend with actual history for same type/side
  const similar = signalHistory.filter(h =>
    h.idea.tradeType === signal.tradeType &&
    h.idea.side === signal.side &&
    h.pnl != null &&
    h.status !== 'active',
  )
  if (similar.length >= 5) {
    const histWR    = similar.filter(h => (h.pnl ?? 0) > 0).length / similar.length
    const histWeight = Math.min(0.5, similar.length / 50)
    winRate = winRate * (1 - histWeight) + histWR * histWeight
    add(`Historial real (${similar.length} trades)`, (histWR - base.baseWinRate) * histWeight)
  }

  // R:R for EV
  const risk   = Math.abs(signal.entry - signal.sl)
  const reward = Math.abs(signal.tp1 - signal.entry)
  const rr     = risk > 0 ? reward / risk : 1.5
  const ev     = winRate * rr - (1 - winRate) * 1.0

  // Kelly criterion (half-Kelly for safety)
  const kelly     = Math.max(0, (winRate * (rr + 1) - 1) / rr)
  const halfKelly = kelly / 2

  // Wilson confidence interval (90%)
  const n  = Math.max(similar.length, 10)
  const z  = 1.645
  const lo = Math.max(0, (winRate + z*z/(2*n) - z * Math.sqrt(winRate*(1-winRate)/n + z*z/(4*n*n))) / (1 + z*z/n))
  const hi = Math.min(1, (winRate + z*z/(2*n) + z * Math.sqrt(winRate*(1-winRate)/n + z*z/(4*n*n))) / (1 + z*z/n))

  return {
    winProbability:     Math.round(winRate * 100),
    expectedValue:      parseFloat(ev.toFixed(3)),
    kellyCriterion:     parseFloat((halfKelly * 100).toFixed(1)),
    confidenceInterval: [Math.round(lo * 100), Math.round(hi * 100)],
    sampleSize:         similar.length,
    factors:            factors.sort((a, b) => b.contribution - a.contribution),
  }
}
