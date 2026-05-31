// APEX — Global Liquidity Index
// Fed balance sheet (WALCL) + US M2 supply as proxy for global liquidity.
// BTC has ~83% correlation with global liquidity over 12-month periods.

export interface GlobalLiquidity {
  m2Growth:        number   // US M2 YoY %
  fedBalanceSheet: number   // Fed balance sheet size (trillions USD)
  bsChange:        string   // EXPANDING | CONTRACTING | STABLE
  liquidityIndex:  number   // composite score 0-100
  trend:           'EXPANDING' | 'CONTRACTING' | 'NEUTRAL'
  btcCorrelation:  string
  historicalNote:  string
}

export async function fetchGlobalLiquidity(): Promise<GlobalLiquidity | null> {
  const FRED_KEY = process.env.FRED_API_KEY ?? ''
  if (!FRED_KEY) return null

  try {
    const [m2Res, bsRes] = await Promise.allSettled([
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=13`).then(r => r.json()) as Promise<{ observations?: { value: string }[] }>,
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=13`).then(r => r.json()) as Promise<{ observations?: { value: string }[] }>,
    ])

    const getObs = (r: PromiseSettledResult<{ observations?: { value: string }[] }>) =>
      r.status === 'fulfilled' ? (r.value?.observations ?? []).filter(o => o.value !== '.') : []

    const m2Obs = getObs(m2Res)
    const bsObs = getObs(bsRes)

    const m2Now  = parseFloat(m2Obs[0]?.value  ?? '0')
    const m2Year = parseFloat(m2Obs[12]?.value ?? '0')
    const m2YoY  = m2Year > 0 ? (m2Now - m2Year) / m2Year * 100 : 0

    const bsNow    = parseFloat(bsObs[0]?.value ?? '0') / 1e6   // convert millions → trillions
    const bsPrev   = parseFloat(bsObs[4]?.value ?? '0') / 1e6   // 4 weeks ago
    const bsChange = bsNow > bsPrev * 1.005 ? 'EXPANDING' : bsNow < bsPrev * 0.995 ? 'CONTRACTING' : 'STABLE'

    const m2Score       = m2YoY > 5 ? 80 : m2YoY > 2 ? 60 : m2YoY > 0 ? 50 : m2YoY > -2 ? 40 : 20
    const bsScore       = bsChange === 'EXPANDING' ? 70 : bsChange === 'CONTRACTING' ? 30 : 50
    const liquidityIndex = (m2Score + bsScore) / 2

    const trend: GlobalLiquidity['trend'] =
      liquidityIndex > 60 ? 'EXPANDING' :
      liquidityIndex < 40 ? 'CONTRACTING' : 'NEUTRAL'

    const btcCorrelation =
      trend === 'EXPANDING'
        ? `Liquidez global en expansión (score ${liquidityIndex.toFixed(0)}/100) — históricamente BTC sube 3-6 meses después de expansión de M2`
        : trend === 'CONTRACTING'
        ? `Liquidez global contrayéndose (score ${liquidityIndex.toFixed(0)}/100) — BTC bajo presión, correlación histórica negativa`
        : `Liquidez global neutral (score ${liquidityIndex.toFixed(0)}/100) — sin viento de cola ni en contra para BTC`

    const historicalNote =
      trend === 'EXPANDING'
        ? 'En expansiones de M2 pasadas (2020, 2021): BTC subió 300%+ en los 12 meses siguientes'
        : trend === 'CONTRACTING'
        ? 'En contracciones de M2 (2022): BTC cayó 70%+ — el ciclo de liquidez es el factor más importante de largo plazo'
        : 'Liquidez neutral: BTC sigue factores técnicos y de sentimiento a corto plazo'

    return { m2Growth: m2YoY, fedBalanceSheet: bsNow, bsChange, liquidityIndex, trend, btcCorrelation, historicalNote }
  } catch {
    return null
  }
}
