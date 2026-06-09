// Kelly Criterion + Position Sizing
// Used by TradeIdeasPanel and agent route for safe capital allocation

export interface CapitalConfig {
  totalCapital: number      // total portfolio in USDT
  maxRiskPerTrade: number   // max % to risk per trade (e.g. 2%)
  maxOpenTrades: number     // max concurrent positions (e.g. 3)
  maxDailyLoss: number      // max daily loss % before stopping (e.g. 5%)
  maxWeeklyLoss: number     // max weekly loss % (e.g. 10%)
  leverageLimit: number     // absolute max leverage (e.g. 10x)
}

export interface PositionSize {
  riskAmount: number        // $ amount to risk
  positionSize: number      // $ size of position
  leverage: number          // recommended leverage
  contracts: number         // BTC contracts
  stopLossDistance: number  // $ distance to SL
  maxLoss: number           // max $ loss if SL hit
  kellyFraction: number     // Kelly % used
  recommendation: string    // human readable advice
}

export const DEFAULT_CONFIG: CapitalConfig = {
  totalCapital:    1000,
  maxRiskPerTrade: 2,
  maxOpenTrades:   3,
  maxDailyLoss:    6,    // was 5
  maxWeeklyLoss:   12,   // was 10
  leverageLimit:   10,
}

export function calcPositionSize(
  signal: { entry: number; sl: number; maxLeverage?: number },
  config: CapitalConfig,
  winProbability: number,  // 0-100
  winRate: number,         // historical win rate 0-100
  avgWinR: number,         // average win in R units
  avgLossR: number,        // average loss in R units
): PositionSize {
  const price      = signal.entry
  const slDist     = Math.abs(signal.entry - signal.sl)
  const slDistPct  = price > 0 ? slDist / price : 0

  // ── Full Kelly Criterion ──────────────────────────────────
  // Kelly % = (b*p - q) / b
  // b = avg win / avg loss ratio
  // p = win probability
  // q = loss probability (1 - p)
  const p = winProbability / 100
  const q = 1 - p
  const b = avgLossR > 0 ? avgWinR / avgLossR : 1

  const fullKelly  = (b * p - q) / b
  const halfKelly  = Math.max(0, fullKelly / 2)              // half-Kelly for safety
  const kellyFraction = Math.min(halfKelly, config.maxRiskPerTrade / 100)

  const riskAmount    = config.totalCapital * kellyFraction
  const positionSize  = slDistPct > 0 ? riskAmount / slDistPct : 0
  const capitalPerTrade = config.totalCapital / Math.max(1, config.maxOpenTrades)
  const rawLeverage   = capitalPerTrade > 0 ? positionSize / capitalPerTrade : 1

  const maxAllowedLeverage = Math.min(
    signal.maxLeverage ?? 5,
    config.leverageLimit,
  )
  const leverage           = Math.min(Math.max(1, Math.round(rawLeverage)), maxAllowedLeverage)
  const actualPositionSize = capitalPerTrade * leverage
  const contracts          = price > 0 ? actualPositionSize / price : 0
  const maxLoss            = contracts * slDist

  const riskPct       = (kellyFraction * 100).toFixed(1)
  const recommendation = kellyFraction <= 0
    ? '❌ Kelly negativo — no tomar este trade (EV negativo)'
    : kellyFraction < 0.005
    ? `⚠️ Kelly muy bajo (${riskPct}%) — señal de baja calidad, tamaño mínimo`
    : kellyFraction < 0.02
    ? `✅ Riesgo ${riskPct}% del capital ($${riskAmount.toFixed(0)}) — tamaño conservador`
    : `✅ Riesgo ${riskPct}% del capital ($${riskAmount.toFixed(0)}) — tamaño normal`

  return {
    riskAmount:       parseFloat(riskAmount.toFixed(2)),
    positionSize:     parseFloat(actualPositionSize.toFixed(2)),
    leverage,
    contracts:        parseFloat(contracts.toFixed(4)),
    stopLossDistance: parseFloat(slDist.toFixed(2)),
    maxLoss:          parseFloat(maxLoss.toFixed(2)),
    kellyFraction:    parseFloat((kellyFraction * 100).toFixed(2)),
    recommendation,
  }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

export async function loadCapitalConfig(
  supabase: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { single: () => Promise<{ data: unknown }> } } } } | null,
): Promise<CapitalConfig> {
  if (!supabase) return DEFAULT_CONFIG
  try {
    const { data } = await supabase
      .from('apex_capital_config')
      .select('*')
      .eq('id', 'default')
      .single()
    if (!data) return DEFAULT_CONFIG
    const d = data as Record<string, unknown>
    return {
      totalCapital:    Number(d['total_capital'])    || DEFAULT_CONFIG.totalCapital,
      maxRiskPerTrade: Number(d['max_risk_per_trade']) || DEFAULT_CONFIG.maxRiskPerTrade,
      maxOpenTrades:   Number(d['max_open_trades'])  || DEFAULT_CONFIG.maxOpenTrades,
      maxDailyLoss:    Number(d['max_daily_loss'])   || DEFAULT_CONFIG.maxDailyLoss,
      maxWeeklyLoss:   Number(d['max_weekly_loss'])  || DEFAULT_CONFIG.maxWeeklyLoss,
      leverageLimit:   Number(d['leverage_limit'])   || DEFAULT_CONFIG.leverageLimit,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveCapitalConfig(
  supabase: { from: (t: string) => { upsert: (d: unknown) => Promise<unknown> } } | null,
  config: CapitalConfig,
): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('apex_capital_config').upsert({
      id:                'default',
      total_capital:     config.totalCapital,
      max_risk_per_trade: config.maxRiskPerTrade,
      max_open_trades:   config.maxOpenTrades,
      max_daily_loss:    config.maxDailyLoss,
      max_weekly_loss:   config.maxWeeklyLoss,
      leverage_limit:    config.leverageLimit,
      updated_at:        new Date().toISOString(),
    })
  } catch {
    // silent — non-critical
  }
}
