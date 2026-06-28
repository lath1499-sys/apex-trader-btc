// APEX — Professional leverage sizing calculator
// Formula: leverage = riskPct / slDistancePct (fraction, not %)
// Ensures that if SL is hit, we lose exactly riskPct of available capital.
// Config is loaded from Supabase (apex_leverage_config) so the UI can override it.

export type TradeType = 'Scalp' | 'DayTrade' | 'Swing'

export interface TradeTypeRow {
  leverageMin:   number
  leverageMax:   number
  leverageIdeal: number
  slMinPct:      number   // fraction: 0.004 = 0.4%
  slMaxPct:      number   // fraction: 0.015 = 1.5%
  label:         string
}

export const DEFAULT_LEVERAGE_CONFIG: Record<TradeType, TradeTypeRow> = {
  Scalp: {
    leverageMin:   15,
    leverageMax:   25,
    leverageIdeal: 20,
    slMinPct:      0.004,   // 0.4%
    slMaxPct:      0.015,   // 1.5%
    label:         'Scalp',
  },
  DayTrade: {
    leverageMin:   10,
    leverageMax:   20,
    leverageIdeal: 15,
    slMinPct:      0.010,   // 1.0%
    slMaxPct:      0.035,   // 3.5%
    label:         'DayTrade',
  },
  Swing: {
    leverageMin:   7,
    leverageMax:   10,
    leverageIdeal: 8,
    slMinPct:      0.025,   // 2.5%
    slMaxPct:      0.080,   // 8.0%
    label:         'Swing',
  },
}

export type TradeTypeConfig = typeof DEFAULT_LEVERAGE_CONFIG

export interface LeverageInput {
  tradeType:        TradeType
  entryPrice:       number
  slPrice:          number
  availableCapital: number
  riskPct:          number   // fraction: 0.05 = 5%
}

export interface LeverageResult {
  leverage:        number    // final capped leverage (integer)
  positionSizeUSD: number    // position size so that loss at SL = riskUSD
  marginRequired:  number    // positionSizeUSD / leverage
  riskUSD:         number    // availableCapital * riskPct
  slDistancePct:   number    // fraction: e.g. 0.01 for 1%
  reasoning:       string    // human-readable explanation
}

export async function getLeverageConfig(sb: { from: (t: string) => unknown }): Promise<TradeTypeConfig> {
  try {
    const q = sb.from('apex_leverage_config') as {
      select: (cols: string) => Promise<{ data: Array<{
        trade_type:     string
        leverage_min:   number
        leverage_max:   number
        leverage_ideal: number
        sl_min_pct:     number
        sl_max_pct:     number
      }> | null }>
    }
    const { data } = await q.select('*')
    if (!data || data.length === 0) return DEFAULT_LEVERAGE_CONFIG

    const merged: TradeTypeConfig = {
      Scalp:    { ...DEFAULT_LEVERAGE_CONFIG.Scalp    },
      DayTrade: { ...DEFAULT_LEVERAGE_CONFIG.DayTrade },
      Swing:    { ...DEFAULT_LEVERAGE_CONFIG.Swing    },
    }
    for (const row of data) {
      const key = row.trade_type as TradeType
      if (merged[key]) {
        merged[key] = {
          ...merged[key],
          leverageMin:   row.leverage_min,
          leverageMax:   row.leverage_max,
          leverageIdeal: row.leverage_ideal,
          slMinPct:      row.sl_min_pct,
          slMaxPct:      row.sl_max_pct,
        }
      }
    }
    return merged
  } catch {
    return DEFAULT_LEVERAGE_CONFIG
  }
}

export function calculateLeverage(
  config:     LeverageInput,
  typeConfig: TradeTypeRow,
): LeverageResult {
  const { entryPrice, slPrice, availableCapital, riskPct, tradeType } = config

  const slDistancePct  = Math.abs(entryPrice - slPrice) / entryPrice
  const riskUSD        = availableCapital * riskPct

  // Core formula: leverage = risk% / sl%
  const formulaLeverage = slDistancePct > 0 ? riskPct / slDistancePct : typeConfig.leverageIdeal

  // Clamp to trade-type range and round to integer
  const leverage = Math.round(
    Math.max(typeConfig.leverageMin, Math.min(typeConfig.leverageMax, formulaLeverage))
  )

  const positionSizeUSD = slDistancePct > 0 ? riskUSD / slDistancePct : riskUSD * leverage
  const marginRequired  = positionSizeUSD / leverage

  // SL validation message
  let slNote = ''
  if (slDistancePct < typeConfig.slMinPct) {
    slNote = `SL ajustado (${(slDistancePct * 100).toFixed(2)}%) — mín recomendado ${(typeConfig.slMinPct * 100).toFixed(1)}%`
  } else if (slDistancePct > typeConfig.slMaxPct) {
    slNote = `SL amplio (${(slDistancePct * 100).toFixed(2)}%) — máx recomendado ${(typeConfig.slMaxPct * 100).toFixed(1)}%`
  }

  const reasoning = [
    `SL: ${(slDistancePct * 100).toFixed(2)}% | Fórmula: ${(riskPct * 100).toFixed(0)}%/${(slDistancePct * 100).toFixed(2)}% = ${formulaLeverage.toFixed(1)}x`,
    `Rango ${tradeType}: ${typeConfig.leverageMin}x–${typeConfig.leverageMax}x → final: ${leverage}x`,
    slNote,
  ].filter(Boolean).join(' | ')

  return { leverage, positionSizeUSD, marginRequired, riskUSD, slDistancePct, reasoning }
}

export function formatLeverageForNotification(result: LeverageResult, tradeType: TradeType): string {
  const cfg = DEFAULT_LEVERAGE_CONFIG[tradeType]
  return [
    `⚡ Apalancamiento: <b>${result.leverage}x</b> (rango ${tradeType}: ${cfg.leverageMin}x–${cfg.leverageMax}x)`,
    `📏 Dist. SL: ${(result.slDistancePct * 100).toFixed(2)}% | Riesgo: $${result.riskUSD.toFixed(0)}`,
  ].join('\n')
}

export function formatLeverageTableForPrompt(): string {
  const d = DEFAULT_LEVERAGE_CONFIG
  return [
    'TABLA DE APALANCAMIENTO (APEX Professional Sizing):',
    `  Scalp:    ${d.Scalp.leverageMin}x–${d.Scalp.leverageMax}x (ideal ${d.Scalp.leverageIdeal}x) | SL ${(d.Scalp.slMinPct*100).toFixed(1)}%–${(d.Scalp.slMaxPct*100).toFixed(1)}%`,
    `  DayTrade: ${d.DayTrade.leverageMin}x–${d.DayTrade.leverageMax}x (ideal ${d.DayTrade.leverageIdeal}x) | SL ${(d.DayTrade.slMinPct*100).toFixed(1)}%–${(d.DayTrade.slMaxPct*100).toFixed(1)}%`,
    `  Swing:    ${d.Swing.leverageMin}x–${d.Swing.leverageMax}x (ideal ${d.Swing.leverageIdeal}x) | SL ${(d.Swing.slMinPct*100).toFixed(1)}%–${(d.Swing.slMaxPct*100).toFixed(1)}%`,
    'Fórmula: leverage = riskPct / slDist (ambos como fracción)',
    'Ejemplo: riesgo 5%, SL 2% → 0.05/0.02 = 2.5x → clamped a mín Swing 7x',
    'Ejemplo: riesgo 5%, SL 0.5% → 0.05/0.005 = 10x → DayTrade ✓',
  ].join('\n')
}
