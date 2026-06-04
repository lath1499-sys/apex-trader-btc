import type { SignalRecord } from './types'

// Key: `${tradeType}_${side}` e.g. 'Scalp_LONG'
export type WeightMap = Record<string, number>

const MIN_SAMPLES = 3   // need at least this many resolved signals to adjust
const W_MIN = 0.65      // floor multiplier (bad combination)
const W_MAX = 1.35      // ceiling multiplier (great combination)

/**
 * Derives score multipliers from recent signal history.
 * At 50% WR → 1.0x (neutral), 80% WR → ~1.24x, 20% WR → ~0.76x.
 * Requires ≥3 resolved samples per combination to activate.
 */
export function getLearnedWeights(history: SignalRecord[]): WeightMap {
  const resolved = history
    .filter(r => r.status !== 'active' && r.status !== 'pending_confirmation')
    .slice(0, 40)

  const acc: Record<string, { wins: number; total: number }> = {}

  for (const rec of resolved) {
    const key = `${rec.idea.tradeType}_${rec.idea.side}`
    if (!acc[key]) acc[key] = { wins: 0, total: 0 }
    acc[key].total++
    if (rec.status !== 'sl_hit') acc[key].wins++
  }

  const weights: WeightMap = {}
  for (const [key, { wins, total }] of Object.entries(acc)) {
    if (total < MIN_SAMPLES) continue
    const wr = wins / total
    // Linear map: 0% WR → W_MIN, 100% WR → W_MAX
    weights[key] = W_MIN + wr * (W_MAX - W_MIN)
  }

  return weights
}
