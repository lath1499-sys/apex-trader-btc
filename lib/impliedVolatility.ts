// lib/impliedVolatility.ts — IV Rank & Percentile from Deribit DVOL
// Pure calculation module — no fetch here, data comes from /api/options proxy.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IVData {
  currentIV:    number   // DVOL current value (annualized %)
  ivRank:       number   // 0-100: position within 30d min-max range
  ivPercentile: number   // 0-100: % of hourly samples below current IV
  min30d:       number   // 30-day DVOL low
  max30d:       number   // 30-day DVOL high
  regime:       'low' | 'normal' | 'elevated' | 'extreme'
  signal:       'buy_vol' | 'sell_vol' | 'neutral'
  label:        string   // human-readable summary
}

// Full options panel data returned by /api/options
export interface OptionsData {
  // Max Pain & PCR (already existed)
  maxPain:         number
  maxPainDistance: string   // signed % string e.g. "-2.34"
  putCallRatio:    number
  sentiment:       'bullish' | 'bearish' | 'neutral'
  totalCallOI:     number
  totalPutOI:      number
  expiryDate:      string
  daysToExpiry:    number
  btcPrice:        number
  // IV Rank (new — Section 4)
  iv:              IVData | null
}

// ── Pure Calculation ──────────────────────────────────────────────────────────

/**
 * Given current DVOL and an array of historical DVOL closes (30d hourly),
 * returns IV rank, percentile, regime and trading signal.
 */
export function calcIV(current: number, history: number[]): IVData {
  if (!history.length) {
    return {
      currentIV: current, ivRank: 50, ivPercentile: 50,
      min30d: current, max30d: current,
      regime: 'normal', signal: 'neutral',
      label: `DVOL ${current.toFixed(1)}%`,
    }
  }

  const min30d = Math.min(...history)
  const max30d = Math.max(...history)
  const range  = max30d - min30d

  const ivRank       = range > 0 ? Math.round((current - min30d) / range * 100) : 50
  const below        = history.filter(v => v < current).length
  const ivPercentile = Math.round(below / history.length * 100)

  const regime: IVData['regime'] =
    ivRank >= 75 ? 'extreme' :
    ivRank >= 50 ? 'elevated' :
    ivRank >= 25 ? 'normal' : 'low'

  // Trading signal: low IV → options cheap → buy vol; high IV → sell vol
  const signal: IVData['signal'] =
    ivRank <= 20 ? 'buy_vol' :
    ivRank >= 80 ? 'sell_vol' : 'neutral'

  const label = `DVOL ${current.toFixed(1)}% · IVR ${ivRank} · ${regime.toUpperCase()}`

  return {
    currentIV: parseFloat(current.toFixed(2)),
    ivRank, ivPercentile,
    min30d: parseFloat(min30d.toFixed(2)),
    max30d: parseFloat(max30d.toFixed(2)),
    regime, signal, label,
  }
}

// ── Context string for agent prompt ──────────────────────────────────────────

export function ivContext(iv: IVData): string {
  const arrow = iv.signal === 'buy_vol' ? '📉 opciones baratas' : iv.signal === 'sell_vol' ? '📈 opciones caras' : '➡️ neutral'
  return `DVOL ${iv.currentIV.toFixed(1)}% (IVR ${iv.ivRank}/100 · ${iv.regime}) ${arrow}`
}
