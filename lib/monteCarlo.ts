// APEX — Monte Carlo Risk Simulation
// Simulates 1,000 possible outcomes before showing a signal.
// Prevents over-confidence. Rejects signals with high ruin probability.

export interface MonteCarloResult {
  median:          number   // median P&L % after N trades
  percentile10:    number   // worst 10% scenario
  percentile90:    number   // best 90% scenario
  maxDrawdownP50:  number   // typical max drawdown
  maxDrawdownP90:  number   // bad-case max drawdown
  ruinProbability: number   // chance of -50% portfolio in next N trades
  simulations:     number
  description:     string
}

export function runMonteCarlo(
  winRate:       number,
  avgWinR:       number,   // avg win in R units
  avgLossR:      number,   // avg loss in R units (positive)
  riskPerTrade:  number,   // % of capital per trade
  numTrades      = 20,
  simulations    = 1000,
): MonteCarloResult {
  const outcomes:     number[] = []
  const maxDrawdowns: number[] = []

  for (let sim = 0; sim < simulations; sim++) {
    let capital = 100
    let peak    = 100
    let maxDD   = 0

    for (let t = 0; t < numTrades; t++) {
      const isWin  = Math.random() < winRate
      const change = isWin
        ? capital * (riskPerTrade / 100) * avgWinR
        : -capital * (riskPerTrade / 100) * avgLossR

      capital += change
      capital  = Math.max(0, capital)

      if (capital > peak) peak = capital
      const dd = peak > 0 ? (peak - capital) / peak * 100 : 0
      if (dd > maxDD) maxDD = dd
    }

    outcomes.push(capital - 100)
    maxDrawdowns.push(maxDD)
  }

  outcomes.sort((a, b) => a - b)
  maxDrawdowns.sort((a, b) => a - b)

  const ruinCount = outcomes.filter(o => o < -50).length
  const p10       = outcomes[Math.floor(simulations * 0.1)]
  const p50       = outcomes[Math.floor(simulations * 0.5)]
  const p90       = outcomes[Math.floor(simulations * 0.9)]
  const ddP50     = maxDrawdowns[Math.floor(simulations * 0.5)]
  const ddP90     = maxDrawdowns[Math.floor(simulations * 0.9)]

  const desc =
    `En ${numTrades} trades similares: mediana ${p50 >= 0 ? '+' : ''}${p50.toFixed(1)}%, ` +
    `peor 10%: ${p10.toFixed(1)}%, mejor 90%: +${p90.toFixed(1)}%`

  return {
    median:          parseFloat(p50.toFixed(2)),
    percentile10:    parseFloat(p10.toFixed(2)),
    percentile90:    parseFloat(p90.toFixed(2)),
    maxDrawdownP50:  parseFloat(ddP50.toFixed(2)),
    maxDrawdownP90:  parseFloat(ddP90.toFixed(2)),
    ruinProbability: parseFloat((ruinCount / simulations * 100).toFixed(1)),
    simulations,
    description:     desc,
  }
}
