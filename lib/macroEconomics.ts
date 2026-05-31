// APEX — Macro Economics Module
// Fetches CPI, Fed Rate, GDP, M2, 10Y Treasury from FRED API (free key required)
// FRED_API_KEY env var — null-safe: returns null when key missing

export interface MacroIndicators {
  cpi: {
    current: number
    prev:    number
    yoy:     number
    trend:   'RISING' | 'FALLING' | 'STABLE'
    btcImpact: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    note:    string
  }
  fedRate: {
    current: number
    prev:    number
    trend:   'HIKING' | 'CUTTING' | 'HOLD'
    btcImpact: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    note:    string
  }
  gdp: {
    growthRate: number
    trend:      'ACCELERATING' | 'DECELERATING' | 'NEGATIVE'
    btcImpact:  'BULLISH' | 'BEARISH' | 'NEUTRAL'
    note:       string
  }
  m2: {
    current:   number
    yoyChange: number
    trend:     'EXPANDING' | 'CONTRACTING' | 'STABLE'
    btcImpact: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    note:      string
  }
  treasury10y: {
    yield:     number
    trend:     'RISING' | 'FALLING' | 'STABLE'
    btcImpact: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    note:      string
  }
  overallSignal: 'STRONGLY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONGLY_BEARISH'
  overallScore:  number   // -10 to +10
  summary:       string
  lastUpdated:   string
}

type Obs = { value: string }[]

function getObs(r: PromiseSettledResult<{ observations?: Obs }>): Obs {
  if (r.status !== 'fulfilled') return []
  return (r.value?.observations ?? []).filter(o => o.value !== '.')
}

export async function fetchMacroIndicators(): Promise<MacroIndicators | null> {
  const FRED_KEY = process.env.FRED_API_KEY ?? ''
  if (!FRED_KEY) return null

  const BASE = 'https://api.stlouisfed.org/fred/series/observations'
  const p = (id: string) =>
    `${BASE}?series_id=${id}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=13`

  try {
    const [cpiRes, fedRes, gdpRes, m2Res, t10yRes] = await Promise.allSettled([
      fetch(p('CPIAUCSL')).then(r => r.json()),          // CPI All Urban Consumers
      fetch(p('FEDFUNDS')).then(r => r.json()),           // Fed Funds Rate
      fetch(p('A191RL1Q225SBEA')).then(r => r.json()),   // Real GDP Growth Rate
      fetch(p('M2SL')).then(r => r.json()),               // M2 Money Supply
      fetch(p('DGS10')).then(r => r.json()),              // 10-Year Treasury
    ] as const)

    const cpiObs  = getObs(cpiRes  as PromiseSettledResult<{ observations?: Obs }>)
    const fedObs  = getObs(fedRes  as PromiseSettledResult<{ observations?: Obs }>)
    const gdpObs  = getObs(gdpRes  as PromiseSettledResult<{ observations?: Obs }>)
    const m2Obs   = getObs(m2Res   as PromiseSettledResult<{ observations?: Obs }>)
    const t10yObs = getObs(t10yRes as PromiseSettledResult<{ observations?: Obs }>)

    // ── CPI ────────────────────────────────────────────────────────────────────
    const cpiCurr  = parseFloat(cpiObs[0]?.value  ?? '0')
    const cpiPrev  = parseFloat(cpiObs[1]?.value  ?? '0')
    const cpiYear  = parseFloat(cpiObs[12]?.value ?? '0')
    const cpiYoY   = cpiYear > 0 ? (cpiCurr - cpiYear) / cpiYear * 100 : 0
    const cpiTrend: MacroIndicators['cpi']['trend'] =
      cpiCurr > cpiPrev * 1.001 ? 'RISING' : cpiCurr < cpiPrev * 0.999 ? 'FALLING' : 'STABLE'
    const cpiBtc: MacroIndicators['cpi']['btcImpact'] =
      cpiYoY > 4 ? 'BEARISH' : cpiYoY < 2.5 && cpiTrend === 'FALLING' ? 'BULLISH' : 'NEUTRAL'
    const cpiNote =
      cpiYoY > 4
        ? `IPC interanual ${cpiYoY.toFixed(1)}% — inflación alta, Fed mantiene tasas altas → bearish BTC`
        : cpiYoY < 2.5 && cpiTrend === 'FALLING'
        ? `IPC interanual ${cpiYoY.toFixed(1)}% cayendo — Fed puede recortar tasas → alcista BTC`
        : `IPC interanual ${cpiYoY.toFixed(1)}% — inflación moderada, Fed en modo observación`

    // ── Fed Rate ───────────────────────────────────────────────────────────────
    const fedCurr  = parseFloat(fedObs[0]?.value ?? '0')
    const fedPrev  = parseFloat(fedObs[1]?.value ?? '0')
    const fedTrend: MacroIndicators['fedRate']['trend'] =
      fedCurr > fedPrev + 0.1 ? 'HIKING' : fedCurr < fedPrev - 0.1 ? 'CUTTING' : 'HOLD'
    const fedBtc: MacroIndicators['fedRate']['btcImpact'] =
      fedTrend === 'CUTTING' ? 'BULLISH' : fedTrend === 'HIKING' ? 'BEARISH' : 'NEUTRAL'
    const fedNote =
      fedTrend === 'CUTTING'
        ? `Fed recortando tasas ${fedPrev.toFixed(2)}% → ${fedCurr.toFixed(2)}% — liquidez aumentando → muy alcista BTC`
        : fedTrend === 'HIKING'
        ? `Fed subiendo tasas ${fedPrev.toFixed(2)}% → ${fedCurr.toFixed(2)}% — costo de capital sube → bajista BTC`
        : `Fed en pausa (${fedCurr.toFixed(2)}%) — mercado espera señales de próximo movimiento`

    // ── GDP ────────────────────────────────────────────────────────────────────
    const gdpCurr  = parseFloat(gdpObs[0]?.value ?? '0')
    const gdpPrev  = parseFloat(gdpObs[1]?.value ?? '0')
    const gdpTrend: MacroIndicators['gdp']['trend'] =
      gdpCurr > gdpPrev + 0.5 ? 'ACCELERATING' : gdpCurr < 0 ? 'NEGATIVE' : 'DECELERATING'
    const gdpBtc: MacroIndicators['gdp']['btcImpact'] =
      gdpTrend === 'NEGATIVE' ? 'BEARISH' : gdpCurr > 2.5 ? 'BULLISH' : 'NEUTRAL'
    const gdpNote =
      gdpTrend === 'NEGATIVE'
        ? `PIB negativo (${gdpCurr.toFixed(1)}%) — recesión en progreso → risk-off`
        : gdpCurr > 2.5
        ? `PIB fuerte +${gdpCurr.toFixed(1)}% — economía sólida → favorable BTC`
        : `PIB ${gdpCurr.toFixed(1)}% — crecimiento moderado, neutral para BTC`

    // ── M2 ─────────────────────────────────────────────────────────────────────
    const m2Curr  = parseFloat(m2Obs[0]?.value  ?? '0')
    const m2Year  = parseFloat(m2Obs[12]?.value ?? '0')
    const m2YoY   = m2Year > 0 ? (m2Curr - m2Year) / m2Year * 100 : 0
    const m2Trend: MacroIndicators['m2']['trend'] =
      m2YoY > 2 ? 'EXPANDING' : m2YoY < -2 ? 'CONTRACTING' : 'STABLE'
    const m2Btc: MacroIndicators['m2']['btcImpact'] =
      m2Trend === 'EXPANDING' ? 'BULLISH' : m2Trend === 'CONTRACTING' ? 'BEARISH' : 'NEUTRAL'
    const m2Note =
      m2Trend === 'EXPANDING'
        ? `M2 creciendo +${m2YoY.toFixed(1)}% interanual ($${(m2Curr / 1000).toFixed(0)}T) — expansión monetaria → demanda BTC`
        : m2Trend === 'CONTRACTING'
        ? `M2 contrayéndose ${m2YoY.toFixed(1)}% — QT activo → menos liquidez para activos de riesgo`
        : `M2 estable (+${m2YoY.toFixed(1)}%) — liquidez neutral`

    // ── 10Y Treasury ───────────────────────────────────────────────────────────
    const t10yCurr  = parseFloat(t10yObs[0]?.value ?? '0')
    const t10yPrev  = parseFloat(t10yObs[5]?.value ?? '0')
    const t10yTrend: MacroIndicators['treasury10y']['trend'] =
      t10yCurr > t10yPrev + 0.1 ? 'RISING' : t10yCurr < t10yPrev - 0.1 ? 'FALLING' : 'STABLE'
    const t10yBtc: MacroIndicators['treasury10y']['btcImpact'] =
      t10yTrend === 'FALLING' ? 'BULLISH' : t10yTrend === 'RISING' ? 'BEARISH' : 'NEUTRAL'
    const t10yNote =
      t10yTrend === 'RISING'
        ? `Treasury 10Y subiendo (${t10yCurr.toFixed(2)}%) — tasa libre de riesgo más atractiva → presión bajista BTC`
        : t10yTrend === 'FALLING'
        ? `Treasury 10Y cayendo (${t10yCurr.toFixed(2)}%) — inversores buscan más rendimiento → favorable BTC`
        : `Treasury 10Y estable (${t10yCurr.toFixed(2)}%) — sin presión de tasas`

    // ── Composite score ────────────────────────────────────────────────────────
    const sm = { BULLISH: 2, NEUTRAL: 0, BEARISH: -2 } as const
    const overallScore =
      sm[cpiBtc] +
      sm[fedBtc]  * 2 +   // Fed rate most important
      sm[gdpBtc] +
      sm[m2Btc]  * 1.5 +  // M2 second most important
      sm[t10yBtc]

    const overallSignal: MacroIndicators['overallSignal'] =
      overallScore >= 7  ? 'STRONGLY_BULLISH' :
      overallScore >= 3  ? 'BULLISH'          :
      overallScore <= -7 ? 'STRONGLY_BEARISH' :
      overallScore <= -3 ? 'BEARISH'          : 'NEUTRAL'

    const summary = [
      `Entorno macro: ${overallSignal.replace(/_/g, ' ')} para BTC (score ${overallScore.toFixed(1)}/10).`,
      `Fed: ${fedNote}.`,
      `Inflación: ${cpiNote}.`,
      m2Note + '.',
      overallScore > 3
        ? 'El contexto macro favorece posiciones largas con horizonte de días/semanas.'
        : overallScore < -3
        ? 'El contexto macro es hostil — reducir tamaño de posiciones y favorecer shorts.'
        : 'El contexto macro es neutral — señales técnicas son el factor dominante.',
    ].join(' ')

    return {
      cpi:         { current: cpiCurr,  prev: cpiPrev,  yoy: cpiYoY,  trend: cpiTrend,  btcImpact: cpiBtc,  note: cpiNote },
      fedRate:     { current: fedCurr,  prev: fedPrev,  trend: fedTrend,  btcImpact: fedBtc,  note: fedNote },
      gdp:         { growthRate: gdpCurr, trend: gdpTrend, btcImpact: gdpBtc, note: gdpNote },
      m2:          { current: m2Curr,   yoyChange: m2YoY, trend: m2Trend,  btcImpact: m2Btc,  note: m2Note },
      treasury10y: { yield: t10yCurr,   trend: t10yTrend, btcImpact: t10yBtc, note: t10yNote },
      overallSignal,
      overallScore,
      summary,
      lastUpdated: new Date().toISOString(),
    }
  } catch (err) {
    console.error('[MacroEcon] Error:', err)
    return null
  }
}

// ── Section 2: Fed Expectations ───────────────────────────────────────────────

export interface FedExpectations {
  nextMeetingDate: string
  cutProbability:  number
  hikeProbability: number
  holdProbability: number
  impliedRate:     number
  marketSentiment: 'EXPECTING_CUT' | 'EXPECTING_HIKE' | 'EXPECTING_HOLD' | 'UNCERTAIN'
  btcImplication:  string
  yieldCurve: {
    t10y2y:   number | null
    t10y3m:   number | null
    inverted: boolean
    signal:   'RECESSION_RISK_HIGH' | 'SLIGHT_INVERSION' | 'NORMAL'
  }
  signalAdjustment: number   // how much to adjust bull/bear score (-2 to +2)
  sofr:    number | null
  fedRate: { current: number; trend: 'HIKING' | 'CUTTING' | 'HOLD' }
}

function getNextFOMCDate(from: Date): string {
  const fomcDates = ['2026-06-18', '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-10']
  const future = fomcDates.find(d => new Date(d) > from)
  return future ?? fomcDates[fomcDates.length - 1]
}

const FED_FALLBACK: FedExpectations = {
  nextMeetingDate:  getNextFOMCDate(new Date()),
  cutProbability:   30, hikeProbability: 5, holdProbability: 65,
  impliedRate:      0,
  marketSentiment:  'EXPECTING_HOLD',
  btcImplication:   'Expectativas Fed: sin datos disponibles',
  yieldCurve:       { t10y2y: null, t10y3m: null, inverted: false, signal: 'NORMAL' },
  signalAdjustment: 0,
  sofr:             null,
  fedRate:          { current: 0, trend: 'HOLD' },
}

export async function fetchFedExpectations(currentFedRate: number): Promise<FedExpectations> {
  const FRED_KEY = process.env.FRED_API_KEY ?? ''
  if (!FRED_KEY) return { ...FED_FALLBACK, impliedRate: currentFedRate, fedRate: { current: currentFedRate, trend: 'HOLD' } }

  try {
    // SOFR = best proxy for near-term Fed expectations
    // T10Y2Y = most watched yield curve spread by traders
    // T10Y3M = recession predictor (negative = inversion)
    // FEDFUNDS = actual Fed Funds rate (trend detection)
    const [sofrRes, t10y3mRes, t10y2yRes, fedfundsRes] = await Promise.allSettled([
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`).then(r => r.json()),
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y3M&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`).then(r => r.json()),
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`).then(r => r.json()),
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`).then(r => r.json()),
    ] as const)

    type FredResp = PromiseSettledResult<{ observations?: { value: string }[] }>
    const getVal = (res: FredResp, idx = 0): number | null => {
      if (res.status !== 'fulfilled') return null
      const obs = (res.value?.observations ?? []).filter(o => o.value !== '.')
      return obs[idx] ? parseFloat(obs[idx].value) : null
    }

    const sofrCurrent = getVal(sofrRes  as FredResp, 0)
    const t10y3m      = getVal(t10y3mRes as FredResp, 0)
    const t10y2y      = getVal(t10y2yRes as FredResp, 0)
    const fedCurrent  = getVal(fedfundsRes as FredResp, 0) ?? currentFedRate
    const fedPrev     = getVal(fedfundsRes as FredResp, 2) ?? currentFedRate

    // ── Cut / hike probability from yield curve ───────────────────────────────
    // Yield curve inversion is the single best predictor of Fed pivots
    let cutProb  = 30
    let hikeProb = 5
    let holdProb = 65
    let sofrNote = ''

    if (t10y2y !== null) {
      if (t10y2y < -1.0) {
        cutProb = 75; holdProb = 20; hikeProb = 5
      } else if (t10y2y < -0.5) {
        cutProb = 55; holdProb = 35; hikeProb = 10
      } else if (t10y2y < 0) {
        cutProb = 40; holdProb = 50; hikeProb = 10
      } else if (t10y2y > 0.5) {
        cutProb = 15; holdProb = 60; hikeProb = 25
      }
    }

    // SOFR vs Fed Funds spread (SOFR below Fed Funds = market front-running cuts)
    if (sofrCurrent !== null && fedCurrent > 0) {
      const spread = sofrCurrent - fedCurrent
      if (spread < -0.25) {
        cutProb  = Math.min(90, cutProb + 15)
        sofrNote = `SOFR ${spread.toFixed(2)}% bajo Fed Funds — mercado anticipando recortes`
      }
    }

    const fedTrend: FedExpectations['fedRate']['trend'] =
      fedCurrent > fedPrev + 0.1 ? 'HIKING' : fedCurrent < fedPrev - 0.1 ? 'CUTTING' : 'HOLD'

    // Normalize probabilities
    const total  = cutProb + holdProb + hikeProb
    cutProb  = Math.round(cutProb  / total * 100)
    holdProb = Math.round(holdProb / total * 100)
    hikeProb = 100 - cutProb - holdProb

    const marketSentiment: FedExpectations['marketSentiment'] =
      cutProb  > 55 ? 'EXPECTING_CUT'  :
      hikeProb > 55 ? 'EXPECTING_HIKE' :
      holdProb > 65 ? 'EXPECTING_HOLD' : 'UNCERTAIN'

    // ── BTC implication ───────────────────────────────────────────────────────
    // BTC reacts to EXPECTATION CHANGES — discounting happens weeks before decisions
    const btcImplication = (() => {
      if (sofrNote) return sofrNote + ' — alcista BTC'
      if (marketSentiment === 'EXPECTING_CUT' && cutProb > 70) {
        return `Mercado descuenta recortes con ${cutProb}% probabilidad — BTC YA está siendo comprado anticipando liquidez. Longs ahora, reducir en anuncio oficial.`
      }
      if (marketSentiment === 'EXPECTING_CUT') {
        return `${cutProb}% probabilidad de recorte — expectativas dovish moderadas. BTC favorecido pero señales técnicas dominan.`
      }
      if (marketSentiment === 'EXPECTING_HIKE') {
        return `Mercado precio subida de tasas (${hikeProb}%) — BEARISH BTC inmediato. Reducir exposición larga.`
      }
      if (t10y2y !== null && t10y2y < -0.5) {
        return `Curva de rendimiento invertida (${t10y2y.toFixed(2)}%) — señal histórica de recesión futura + cortes de tasas. Largo plazo alcista para BTC cuando la Fed pivote.`
      }
      return `Expectativas de tasas neutrales (${holdProb}% probabilidad de pausa). Fed en modo observador — BTC sigue factores técnicos.`
    })()

    const signalAdjustment =
      cutProb  > 65 ?  2 :
      cutProb  > 45 ?  1 :
      hikeProb > 55 ? -2 :
      hikeProb > 35 ? -1 : 0

    const yieldSignal: FedExpectations['yieldCurve']['signal'] =
      (t10y2y ?? 0) < -0.5 ? 'RECESSION_RISK_HIGH' :
      (t10y2y ?? 0) < 0    ? 'SLIGHT_INVERSION'    : 'NORMAL'

    return {
      nextMeetingDate:  getNextFOMCDate(new Date()),
      cutProbability:   cutProb,
      hikeProbability:  hikeProb,
      holdProbability:  holdProb,
      impliedRate:      fedCurrent - (cutProb > 50 ? 0.25 : 0),
      marketSentiment,
      btcImplication,
      yieldCurve: { t10y2y, t10y3m, inverted: (t10y2y ?? 0) < 0, signal: yieldSignal },
      signalAdjustment,
      sofr:    sofrCurrent,
      fedRate: { current: fedCurrent, trend: fedTrend },
    }
  } catch (err) {
    console.error('[FedExpectations] Error:', err)
    return { ...FED_FALLBACK, impliedRate: currentFedRate, fedRate: { current: currentFedRate, trend: 'HOLD' } }
  }
}
