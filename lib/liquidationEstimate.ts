// APEX — Liquidation bias estimate
// NOT real liquidation cluster data (that needs either a paid feed like
// CoinGlass or an always-on WebSocket listener -- neither fits this
// serverless architecture). This grounds the estimate in real derivatives
// data instead of assuming every position opened at today's price: positive
// funding + LSR>1 means longs are paying shorts and outnumber them --
// crowded-long conditions carry more downside liquidation risk, and vice
// versa for negative funding / LSR<1. Shared by LiqHeatmap.tsx (dashboard)
// and decide (agent context) so both reason from the same numbers.

export interface LiquidationBias {
  longBias:  number   // 0.5-2, multiplier on long-liquidation weight (below price)
  shortBias: number   // 0.5-2, multiplier on short-liquidation weight (above price)
  label:     string   // human-readable direction
}

export function estimateLiquidationBias(funding: number | null | undefined, lsr: number | null | undefined): LiquidationBias {
  const f = funding ?? 0
  const r = lsr ?? 1
  const longBias  = Math.max(0.5, Math.min(2, 1 + f * 20 + (r - 1) * 0.3))
  const shortBias = Math.max(0.5, Math.min(2, 1 - f * 20 - (r - 1) * 0.3))
  const label = longBias > shortBias
    ? 'sesgo hacia liquidaciones long — mercado sobre-apalancado largo'
    : shortBias > longBias
      ? 'sesgo hacia liquidaciones short — mercado sobre-apalancado corto'
      : 'sin sesgo direccional claro'
  return { longBias, shortBias, label }
}
