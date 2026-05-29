// APEX — Self-Learning Agent
// Computes dynamic weights from historical signal outcomes stored in Supabase.
// The agent gets smarter after every win and loss.

export interface LearnedWeights {
  sessionWeights:      Record<string, number>           // 0.7 = penalize, 1.3 = boost
  regimeWeights:       Record<string, { long: number; short: number }>
  rsiWeight:           number
  macdWeight:          number
  patternWeight:       number
  minScoreAdjustment:  number  // +1 = stricter, -1 = looser, based on recent WR
  totalDecisions:      number
  winRate:             number
  avgWinPct:           number
  avgLossPct:          number
  lastUpdated:         string
}

export const DEFAULT_WEIGHTS: LearnedWeights = {
  sessionWeights:     {},
  regimeWeights:      {},
  rsiWeight:          1.0,
  macdWeight:         1.0,
  patternWeight:      1.0,
  minScoreAdjustment: 0,
  totalDecisions:     0,
  winRate:            0,
  avgWinPct:          0,
  avgLossPct:         0,
  lastUpdated:        new Date().toISOString(),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item)
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

function winRateWeight(wr: number): number {
  // >60% WR → boost 1.3×, <40% WR → penalize 0.7×, otherwise neutral
  return wr > 0.60 ? 1.3 : wr < 0.40 ? 0.7 : 1.0
}

export async function calcLearnedWeights(
  supabase: SupabaseClient,
): Promise<LearnedWeights> {
  if (!supabase) return DEFAULT_WEIGHTS

  try {
    // Read last 200 closed signals from apex_signals
    const { data, error } = await supabase
      .from('apex_signals')
      .select('id,side,trade_type,pnl,status,reasons,created_at')
      .not('pnl', 'is', null)
      .neq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error || !data || data.length < 5) {
      return DEFAULT_WEIGHTS
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const closed: any[] = data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wins   = closed.filter((s: any) => (s.pnl ?? 0) > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const losses = closed.filter((s: any) => (s.pnl ?? 0) <= 0)

    const winRate  = wins.length / closed.length
    const avgWinPct  = wins.length   > 0 ? wins.reduce((a: number, s: { pnl: number }) => a + s.pnl, 0) / wins.length : 0
    const avgLossPct = losses.length > 0 ? losses.reduce((a: number, s: { pnl: number }) => a + Math.abs(s.pnl), 0) / losses.length : 0

    // ── Per-session weights (using trade_type as proxy until apex_decisions has session) ──
    const sessionWeights: Record<string, number> = {}

    // ── Per-regime weights ──────────────────────────────────────────────────────
    const regimeWeights: Record<string, { long: number; short: number }> = {}

    // ── Per-type weights → boost/penalize specific tradeType+side combos ───────
    const byType = groupBy(closed, (s: { trade_type: string; side: string; pnl: number }) => `${s.trade_type}_${s.side}`)
    for (const [key, trades] of Object.entries(byType)) {
      if (trades.length < 4) continue
      const wr = trades.filter(t => (t.pnl ?? 0) > 0).length / trades.length
      // Store in sessionWeights with the combo key for use as WeightMap-style lookup
      sessionWeights[key] = winRateWeight(wr)
    }

    // ── Indicator reliability ────────────────────────────────────────────────────
    // Proxied from 'reasons' field which is a JSONB array of { s, txt } objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withRSI  = closed.filter((s: any) => Array.isArray(s.reasons) && s.reasons.some((r: { txt?: string }) => r.txt?.includes('RSI')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withMacd = closed.filter((s: any) => Array.isArray(s.reasons) && s.reasons.some((r: { txt?: string }) => r.txt?.includes('MACD')))

    function calcIndicatorWeight(group: { pnl: number }[]): number {
      if (group.length < 5) return 1.0
      const wr = group.filter(t => t.pnl > 0).length / group.length
      return Math.max(0.5, Math.min(1.5, 0.5 + wr * 1.5))
    }

    // ── minScoreAdjustment — based on last 20 trades ───────────────────────────
    const recent20   = closed.slice(0, 20)
    const recent20WR = recent20.length > 0
      ? recent20.filter((t: { pnl: number }) => t.pnl > 0).length / recent20.length
      : 0.5
    // <40% recently → demand higher score (+1), >65% → relax threshold (-1)
    const minScoreAdjustment = recent20WR < 0.40 ? 1 : recent20WR > 0.65 ? -1 : 0



    return {
      sessionWeights,
      regimeWeights,
      rsiWeight:          calcIndicatorWeight(withRSI),
      macdWeight:         calcIndicatorWeight(withMacd),
      patternWeight:      1.0,
      minScoreAdjustment,
      totalDecisions:     closed.length,
      winRate,
      avgWinPct,
      avgLossPct,
      lastUpdated:        new Date().toISOString(),
    }
  } catch (err) {
    console.error('[APEX Learning] Error calculating weights:', err)
    return DEFAULT_WEIGHTS
  }
}
