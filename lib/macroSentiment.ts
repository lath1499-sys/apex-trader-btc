// APEX — Macro Sentiment Analyzer
// Combines F&G, funding, price action, news and L/S ratio into a single
// macro context score that the agent uses to bias signal generation.

interface NewsFeedItem {
  title?: string
  body?:  string
  tag?:   string
}

export interface MacroSentiment {
  score:          number   // -100 (extreme fear) to +100 (extreme greed)
  label:          string   // "MUY BAJISTA" | "BAJISTA" | "NEUTRAL" | "ALCISTA" | "MUY ALCISTA"
  topEvents:      string[] // top 4 macro events affecting market right now
  cryptoSpecific: string   // BTC-specific macro context
  usdStrength:    string   // "FUERTE" | "DEBIL" | "NEUTRAL"
  riskAppetite:   string   // "RISK_ON" | "RISK_OFF" | "NEUTRAL"
  sources:        string[]
  confidence:     number   // 0-100
  updatedAt:      string
}

export function analyzeMacroSentiment(
  news:          NewsFeedItem[],
  fg:            number,   // Fear & Greed 0-100
  funding:       number,   // futures funding rate
  lsr:           number,   // long/short ratio
  priceChange24h: number,  // BTC 24h change %
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _onchain:      any,      // reserved for future on-chain signals
): MacroSentiment {

  let score = 0
  const events:  string[] = []
  const sources: string[] = []

  // ── Fear & Greed (35% weight) ─────────────────────────────────────────────
  const fgScore = ((fg - 50) / 50) * 35
  score += fgScore
  sources.push(`F&G: ${fg}/100`)
  if (fg < 20) events.push(`Pánico extremo en el mercado (F&G ${fg}) — históricamente zona de compra`)
  if (fg > 80) events.push(`Euforia extrema (F&G ${fg}) — históricamente zona de venta`)
  if (fg >= 20 && fg <= 35) events.push(`Miedo elevado (F&G ${fg}) — sesgo de rebote posible`)
  if (fg >= 65 && fg <= 80) events.push(`Codicia elevada (F&G ${fg}) — precaución en longs`)

  // ── Funding Rate (15% weight) ─────────────────────────────────────────────
  const fundingScore = Math.max(-15, Math.min(15, funding * -300))
  score += fundingScore
  sources.push(`Funding: ${funding > 0 ? '+' : ''}${funding.toFixed(4)}%`)
  if (funding > 0.05) events.push(`Funding extremo +${funding.toFixed(3)}% — longs sobreextendidos, riesgo de liquidación`)
  if (funding < -0.01) events.push(`Funding negativo ${funding.toFixed(3)}% — shorts pagando, potencial squeeze alcista`)

  // ── Price Action (20% weight) ─────────────────────────────────────────────
  const priceScore = Math.max(-20, Math.min(20, priceChange24h * 2))
  score += priceScore
  if (priceChange24h < -5) events.push(`Caída brusca ${priceChange24h.toFixed(1)}% en 24h — presión vendedora fuerte`)
  if (priceChange24h > 5)  events.push(`Rally fuerte +${priceChange24h.toFixed(1)}% en 24h — momentum alcista`)

  // ── News Sentiment (20% weight) ──────────────────────────────────────────
  const bullNews  = news.filter(n => n.tag === 'bullish').length
  const bearNews  = news.filter(n => n.tag === 'bearish').length
  const totalNews = bullNews + bearNews

  if (totalNews > 0) {
    const newsScore = ((bullNews - bearNews) / totalNews) * 20
    score += newsScore
    sources.push(`Noticias: ${bullNews}📈 ${bearNews}📉`)

    const macroKeywords = [
      { words: ['fed', 'fomc', 'powell', 'rates', 'interest'],       label: 'Fed/tasas' },
      { words: ['iran', 'war', 'conflict', 'geopolitical', 'guerra'], label: 'Geopolítica' },
      { words: ['sec', 'regulation', 'ban', 'legal', 'regulación'],   label: 'Regulación crypto' },
      { words: ['etf', 'institutional', 'blackrock', 'fidelity'],      label: 'Institucional' },
      { words: ['inflation', 'cpi', 'pce', 'inflación'],              label: 'Inflación' },
      { words: ['recession', 'gdp', 'unemployment', 'recesión'],      label: 'Macro economía' },
      { words: ['china', 'dollar', 'dxy', 'yuan'],                    label: 'Dólar/China' },
      { words: ['hack', 'exploit', 'scam', 'breach'],                 label: 'Seguridad crypto' },
    ]

    for (const kw of macroKeywords) {
      const relevant = news.filter(n =>
        kw.words.some(w =>
          (n.title ?? '').toLowerCase().includes(w) ||
          (n.body  ?? '').toLowerCase().includes(w)
        )
      )
      if (relevant.length >= 2) {
        const bullCount = relevant.filter(n => n.tag === 'bullish').length
        const bearCount = relevant.filter(n => n.tag === 'bearish').length
        const sentiment = bullCount > bearCount ? 'alcista' : 'bajista'
        events.push(`${kw.label}: ${relevant.length} noticias recientes (tono ${sentiment})`)
      }
    }
  }

  // ── L/S Ratio (10% weight) ────────────────────────────────────────────────
  const lsrScore = lsr > 1.3 ? -10 : lsr < 0.7 ? 10 : 0
  score += lsrScore
  sources.push(`L/S: ${lsr.toFixed(2)}`)
  if (lsr > 1.5) events.push(`L/S ratio ${lsr.toFixed(2)} — mayoría longs, riesgo de cascada bajista`)
  if (lsr < 0.65) events.push(`L/S ratio ${lsr.toFixed(2)} — mayoría shorts, potencial squeeze alcista`)

  // ── Clamp & classify ─────────────────────────────────────────────────────
  score = Math.max(-100, Math.min(100, score))

  const label =
    score >= 60  ? 'MUY ALCISTA' :
    score >= 20  ? 'ALCISTA'     :
    score >= -20 ? 'NEUTRAL'     :
    score >= -60 ? 'BAJISTA'     : 'MUY BAJISTA'

  const riskAppetite = score >= 20 ? 'RISK_ON' : score <= -20 ? 'RISK_OFF' : 'NEUTRAL'

  const usdStrength =
    priceChange24h < -3 && fg < 40 ? 'FUERTE' :
    priceChange24h > 3  && fg > 60 ? 'DEBIL'  : 'NEUTRAL'

  const cryptoContext =
    funding > 0.05  ? 'Futuros sobrecalentados — posible cascada de liquidaciones longs' :
    funding < -0.01 ? 'Shorts dominando futuros — setup para squeeze alcista' :
    fg < 20         ? 'Capitulación en progreso — buscar fondos con confluencias técnicas' :
    fg > 80         ? 'Euforia — reducir tamaño, riesgo de corrección fuerte' :
    priceChange24h < -5 ? 'Venta agresiva — esperar estabilización antes de entrar' :
    priceChange24h > 5  ? 'Impulso alcista — buscar retrocesos para largo' :
    'Mercado en equilibrio — señales técnicas predominan'

  return {
    score:          Math.round(score),
    label,
    topEvents:      events.slice(0, 4),
    cryptoSpecific: cryptoContext,
    usdStrength,
    riskAppetite,
    sources,
    confidence:     Math.min(90, 40 + totalNews * 3 + (fg !== 50 ? 20 : 0)),
    updatedAt:      new Date().toISOString(),
  }
}

export function getMacroSignalBias(sentiment: MacroSentiment): {
  longBias:    number   // multiplier for bull score (0.5–1.5)
  shortBias:   number   // multiplier for bear score
  skipSignal:  boolean
  reason:      string
} {
  // Extreme bearish — only shorts, heavily penalize longs
  if (sentiment.riskAppetite === 'RISK_OFF' && sentiment.score < -70) {
    return { longBias: 0.5, shortBias: 1.5, skipSignal: false,
      reason: 'Entorno macro muy bajista — solo shorts con alta confluencia' }
  }
  // Extreme bullish — heavily favor longs
  if (sentiment.riskAppetite === 'RISK_ON' && sentiment.score > 70) {
    return { longBias: 1.5, shortBias: 0.5, skipSignal: false,
      reason: 'Entorno macro muy alcista — longs favorecidos' }
  }
  // Neutral — modest adjustment
  if (Math.abs(sentiment.score) < 15) {
    return { longBias: 0.9, shortBias: 0.9, skipSignal: false,
      reason: 'Macro neutral — señales técnicas predominan' }
  }
  const absScore  = Math.abs(sentiment.score)
  const longBias  = sentiment.score > 0 ? 1.0 + absScore / 200 : 1.0 - absScore / 200
  const shortBias = sentiment.score < 0 ? 1.0 + absScore / 200 : 1.0 - absScore / 200
  return { longBias, shortBias, skipSignal: false, reason: sentiment.cryptoSpecific }
}
