import type { MarketData, IndicatorMap, TradeIdea, TradeReason, OrderBook, Kline, SignalRecord } from './types'
import type { WeightMap } from './scoreWeights'
import type { LearnedWeights } from './selfLearning'
import { detectCandlePatterns } from './candlePatterns'
import { detectMarketRegime }   from './marketRegime'
import { calcWinProbability }   from './probabilisticModel'
import { runMonteCarlo }        from './monteCarlo'
import { findPatternConfluence }   from './patternConfluence'
import { shouldGenerateSignal, getCurrentTradingSession } from './tradingHours'

type RawK = Partial<Record<string, Kline[]>>

// At least 1 of the last 4 completed candles must close in trade direction
function confirmCandles(klines: Kline[] | undefined, side: 'LONG' | 'SHORT'): boolean {
  if (!klines || klines.length < 3) return true
  const recent = klines.slice(-5, -1)  // last 4 completed candles (exclude forming)
  const ok = (k: Kline) => side === 'LONG' ? k.c > k.o : k.c < k.o
  return recent.some(ok)
}

const MIN_CONF: Record<string, number> = { Scalp: 4, DayTrade: 5, Swing: 6 }

function expScore(sc: number): string {
  if (sc >= 8) return 'Señal de libro'
  if (sc >= 6) return 'Buena señal'
  if (sc >= 4) return 'Señal marginal'
  return 'Señal especulativa'
}

export function scoreTradeIdea(
  mkt: MarketData,
  inds: IndicatorMap,
  ob: OrderBook | null,
  rawK: RawK,
  weights?: WeightMap,
  signalHistory: SignalRecord[] = [],
  learnedWeights?: LearnedWeights,
): TradeIdea | null {
  const i4 = inds['4h'], i1 = inds['1h'], i1d = inds['1d'], i15 = inds['15m']
  if (!i4 || !i1) return null

  // ── MARKET REGIME ────────────────────────────────────────────────────────
  const k4h = rawK['4h'] ?? []
  const regime = k4h.length >= 20 ? detectMarketRegime(k4h) : null

  let bull = 0, bear = 0
  const reasons: TradeReason[] = []
  const b  = (txt: string) => reasons.push({ s: 'bull', txt })
  const be = (txt: string) => reasons.push({ s: 'bear', txt })

  // ── INDICADORES MULTI-TF ─────────────────────────────────────────────────
  // 4H bias siempre cuenta (+1); si 1H confirma suma otro +1
  if (i4.bias === 'ALCISTA') { bull++; b('4H alcista') }
  if (i4.bias === 'BAJISTA') { bear++; be('4H bajista') }
  if (i4.bias === 'ALCISTA' && i1.bias === 'ALCISTA') { bull++; b('1H confirma alcista') }
  if (i4.bias === 'BAJISTA' && i1.bias === 'BAJISTA') { bear++; be('1H confirma bajista') }
  if (i1d?.bias === 'ALCISTA') { bull++; b('1D alcista') }
  if (i1d?.bias === 'BAJISTA') { bear++; be('1D bajista') }
  if (i4.rsi <= 32 && i1.rsi <= 38)  { bull += 2; b('RSI sobreventa 4H+1H') }
  if (i4.rsi >= 68 && i1.rsi >= 65)  { bear += 2; be('RSI sobrecompra 4H+1H') }
  // Extreme oversold / overbought — higher weight for reversal probability
  if (i4.rsi <= 25) { bull += 3; b('RSI 4H extremadamente sobrevendido — rebote de alta probabilidad') }
  if (i4.rsi >= 75) { bear += 3; be('RSI 4H extremadamente sobrecomprado — corrección de alta probabilidad') }
  if (i4.stoch.k != null && i4.stoch.k <= 5)  { bull += 2; b('Stoch 4H en mínimo absoluto — reversión inminente') }
  if (i4.stoch.k != null && i4.stoch.k >= 95) { bear += 2; be('Stoch 4H en máximo absoluto — reversión inminente') }
  if (i4.rsi <= 25 && i4.stoch.k != null && i4.stoch.k <= 5) { bull += 2; b('RSI+Stoch doble sobreventa extrema — confluencia de reversión') }
  if (i4.rsi >= 75 && i4.stoch.k != null && i4.stoch.k >= 95) { bear += 2; be('RSI+Stoch doble sobrecompra extrema — confluencia de reversión') }
  if (i4.macd.hist > 0 && i4.macd.hist > i4.macd.prev) { bull++; b('MACD 4H acelerando') }
  if (i4.macd.hist < 0 && i4.macd.hist < i4.macd.prev) { bear++; be('MACD 4H bajista') }
  if (i4.stoch.k != null && i4.stoch.k < 20) { bull++; b('Stoch sobreventa') }
  if (i4.stoch.k != null && i4.stoch.k > 80) { bear++; be('Stoch sobrecompra') }

  // ── RSI 50-CRUCE ─────────────────────────────────────────────────────────
  if (i4.prevRsi < 50 && i4.rsi >= 50) { bull++; b('RSI 4H cruzó 50 al alza') }
  if (i4.prevRsi > 50 && i4.rsi <= 50) { bear++; be('RSI 4H cruzó 50 a la baja') }
  if (i1.prevRsi < 50 && i1.rsi >= 50) { bull++; b('RSI 1H cruzó 50 al alza') }
  if (i1.prevRsi > 50 && i1.rsi <= 50) { bear++; be('RSI 1H cruzó 50 a la baja') }

  // ── MACD HISTOGRAM FLIP ──────────────────────────────────────────────────
  if (i4.macd.prev < 0 && i4.macd.hist > 0) { bull++; b('MACD 4H giró positivo') }
  if (i4.macd.prev > 0 && i4.macd.hist < 0) { bear++; be('MACD 4H giró negativo') }

  // ── EMA STACK (Chart) ────────────────────────────────────────────────────
  const price = mkt.price ?? 0
  const e50 = i4.ema['e50'], e200 = i4.ema['e200']
  if (e50 && e200 && price > e50 && e50 > e200) { bull++; b('Precio > EMA50 > EMA200 (4H)') }
  if (e50 && e200 && price < e50 && e50 < e200) { bear++; be('Precio < EMA50 < EMA200 (4H)') }

  // ── FIBONACCI PROXIMITY (Indicadores) ────────────────────────────────────
  if (i4.fib?.length) {
    const nearFib = i4.fib.find(f => !f.isExt && f.active && Math.abs(f.price - price) / price < 0.005)
    if (nearFib) {
      const isSupport = nearFib.level >= 0.5
      if (isSupport) { bull++; b(`Fib ${nearFib.label} soporte activo`) }
      else           { bear++; be(`Fib ${nearFib.label} resistencia activa`) }
    }
  }

  // ── VOLUMEN (Chart / rawK) ────────────────────────────────────────────────
  const k4 = rawK['4h']
  if (k4 && k4.length >= 21) {
    const avgVol = k4.slice(-21, -1).reduce((s, k) => s + k.v, 0) / 20
    const lastVol = k4[k4.length - 1].v
    if (lastVol > avgVol * 1.8) {
      if (i4.bias === 'ALCISTA') { bull++; b('Volumen 4H x1.8 confirma alza') }
      else if (i4.bias === 'BAJISTA') { bear++; be('Volumen 4H x1.8 confirma caída') }
    }
  }

  // ── HEATMAP DE LIQUIDACIONES ──────────────────────────────────────────────
  // Estima clusters de liq en ±4% del precio actual
  if (price) {
    const LEVS = [2, 3, 5, 10, 15, 20, 25, 50, 100]
    let nearLongLiq = 0, nearShortLiq = 0
    LEVS.forEach(lv => {
      const longLiqPrice  = price * (1 - 1 / lv)
      const shortLiqPrice = price * (1 + 1 / lv)
      const w = 1 / lv
      if (Math.abs(longLiqPrice  - price) / price < 0.04) nearLongLiq  += w
      if (Math.abs(shortLiqPrice - price) / price < 0.04) nearShortLiq += w
    })
    // Muchas liq largas cerca = riesgo bajista; muchas liq cortas cerca = squeeze alcista
    if (nearShortLiq > nearLongLiq * 1.5) { bull++; b('Cluster liq cortas cerca (posible squeeze)') }
    if (nearLongLiq  > nearShortLiq * 1.5) { bear++; be('Cluster liq largas cerca (riesgo cascada)') }
  }

  // ── ORDER BOOK (OBook) ────────────────────────────────────────────────────
  if (ob?.bids?.length && ob?.asks?.length) {
    const bidVol = ob.bids.slice(0, 15).reduce((s, [, v]) => s + parseFloat(v), 0)
    const askVol = ob.asks.slice(0, 15).reduce((s, [, v]) => s + parseFloat(v), 0)
    const ratio  = bidVol / (askVol || 1)
    if (ratio > 1.4) { bull++; b(`OBook: bids ${ratio.toFixed(1)}x vs asks`) }
    if (ratio < 0.7) { bear++; be(`OBook: asks ${(1/ratio).toFixed(1)}x vs bids`) }
  }

  // ── FUNDING + SENTIMIENTO (Mercado) ──────────────────────────────────────
  if (mkt.funding != null && mkt.funding < -0.01) { bull++; b('Funding negativo') }
  if (mkt.funding != null && mkt.funding > 0.05)  { bear++; be('Funding extremo') }
  if (mkt.lsr != null && mkt.lsr < 0.65) { bull++; b('L/S bajo (sesgo corto)') }
  if (mkt.lsr != null && mkt.lsr > 1.7)  { bear++; be('L/S alto (euforia larga)') }
  if (mkt.fg != null && mkt.fg < 20) { bull++; b('Miedo extremo') }
  if (mkt.fg != null && mkt.fg > 80) { bear++; be('Codicia extrema') }

  // ── MOMENTO DE MERCADO (Mercado / 24h) ───────────────────────────────────
  if (mkt.change != null && mkt.change < -6 && i4.rsi < 40) { bull++; b('Caída > 6% + RSI bajo (rebote)') }
  if (mkt.change != null && mkt.change > 6  && i4.rsi > 60) { bear++; be('Subida > 6% + RSI alto (agotamiento)') }

  // ── PATRONES DE VELAS JAPONESAS (4H) — Steve Nison ───────────────────────
  const patterns4h = detectCandlePatterns(k4 ?? [], 10)
  for (const p of patterns4h) {
    if (p.pattern.type === 'bullish' && p.pattern.strength === 3) {
      bull += 2; b(`${p.pattern.name} (${p.confidence}%) — ${p.pattern.description}`)
    } else if (p.pattern.type === 'bullish' && p.pattern.strength === 2) {
      bull += 1; b(`${p.pattern.name} — ${p.pattern.description}`)
    } else if (p.pattern.type === 'bearish' && p.pattern.strength === 3) {
      bear += 2; be(`${p.pattern.name} (${p.confidence}%) — ${p.pattern.description}`)
    } else if (p.pattern.type === 'bearish' && p.pattern.strength === 2) {
      bear += 1; be(`${p.pattern.name} — ${p.pattern.description}`)
    }
    // Special extra weight per Nison
    if (p.pattern.name.includes('Kicker')) {
      if (p.pattern.type === 'bullish') { bull += 2 } else { bear += 2 }
    }
    if (p.pattern.name.includes('Star') || p.pattern.name.includes('Doji Star')) {
      if (p.pattern.type === 'bullish') { bull++ } else { bear++ }
    }
  }

  // ── PATTERN CONFLUENCE (multi-TF bonus) ──────────────────────────────────
  const patterns1h = detectCandlePatterns(rawK['1h'] ?? [], 10)
  const patterns1d = detectCandlePatterns(rawK['1d'] ?? [], 10)
  const confluence = findPatternConfluence({ '4h': patterns4h, '1h': patterns1h, '1d': patterns1d })
  let confluenceScore = 0
  if (confluence.sharedPatterns.length > 0) {
    confluenceScore = confluence.sharedPatterns.length
    const isAligned = confluence.sharedPatterns.some(p =>
      (bull > bear && p.type === 'bullish') || (bear > bull && p.type === 'bearish')
    )
    if (isAligned) {
      const bonus = Math.min(confluenceScore, 2)
      if (bull > bear) { bull += bonus; b(`Confluencia multi-TF: ${confluence.description}`) }
      else             { bear += bonus; be(`Confluencia multi-TF: ${confluence.description}`) }
    }
  }

  // ── DECISIÓN ─────────────────────────────────────────────────────────────
  const side: 'LONG' | 'SHORT' | null = bull > bear ? 'LONG' : bear > bull ? 'SHORT' : null
  const maxSc = Math.max(bull, bear)

  if (!side || maxSc < 2) return null

  const av       = i4.atr
  const bothLow  = (i4.bb.width ?? 99) < 2 && (i1.bb.width ?? 99) < 2
  const strongTrend = Math.abs(i4.score) >= 6
  const tradeType =
    i15?.bias === i1.bias && i1.bias === i4.bias && bothLow ? 'Scalp' :
    strongTrend && i1d?.bias === i4.bias && i1.bias === i4.bias ? 'Swing' :
    'DayTrade'

  // ── FILTROS DE CALIDAD ───────────────────────────────────────────────────
  // 1. Minimum confluence per type
  if (maxSc < MIN_CONF[tradeType]) return null

  // 2. Extreme BB compression: return consolidation signal instead of null
  const bbExtreme = (i4.bb.width ?? 99) < 1 && (i1.bb.width ?? 99) < 1
  if (bbExtreme && tradeType !== 'Scalp') return {
    side, tradeType, confidence: 'BAJA' as const,
    bull, bear, maxSc, reasons, price, maxLev: 1,
    sl: price, tp1: price, tp2: price, tp3: price,
    ts: new Date(), analysis: 'CONSOLIDACIÓN — Esperar breakout',
    consolidation: true as const,
  }

  // 2b. EMA21 close confirmation for Swing entries
  if (tradeType === 'Swing') {
    const e21 = i4.ema.e21
    if (side === 'LONG'  && price > e21) { bull++; b('Precio > EMA21 4H (Swing LONG confirmado)') }
    if (side === 'SHORT' && price < e21) { bear++; be('Precio < EMA21 4H (Swing SHORT confirmado)') }
  }

  // 3. Self-learning weights + confidence
  const wKey   = `${tradeType}_${side}`
  const wMult  = weights?.[wKey] ?? 1.0
  // Apply learned outcome-based weights (session+type combo stored in sessionWeights)
  const learnedMult = learnedWeights?.sessionWeights[wKey] ?? 1.0
  const adjSc  = maxSc * wMult * learnedMult
  const confidence: 'ALTA' | 'MEDIA' | 'BAJA' = adjSc >= 7 ? 'ALTA' : adjSc >= 5 ? 'MEDIA' : 'BAJA'

  // 3c. Dynamic min-score threshold — tighten when recent WR < 40%, loosen when > 65%
  const minScoreAdj = learnedWeights?.minScoreAdjustment ?? 0
  if (minScoreAdj > 0 && maxSc < MIN_CONF[tradeType] + minScoreAdj) return null

  // 3b. Trading session gate — don't trade during low-liquidity hours
  if (!shouldGenerateSignal(tradeType, confidence)) return null

  // 4. Regime gate — no_signal only; bias is now handled by penalties/bonuses below
  if (regime?.signalBias === 'no_signal') return null

  // 4b. Counter-trend penalty — need 2 extra confluences to go against strong trend
  if (regime?.regime === 'STRONG_TREND_DOWN' && side === 'LONG') {
    if (bull < bear + 2) return null
    reasons.push({ s: 'bull', txt: '⚠️ Long en tendencia bajista — confluencias extra requeridas' })
  }
  if (regime?.regime === 'STRONG_TREND_UP' && side === 'SHORT') {
    if (bear < bull + 2) return null
    reasons.push({ s: 'bear', txt: '⚠️ Short en tendencia alcista — confluencias extra requeridas' })
  }

  // 4c. With-trend bonus — extra confluence credit for trading in regime direction
  if (regime?.regime === 'STRONG_TREND_DOWN' && side === 'SHORT') {
    bear += 1
    reasons.push({ s: 'bear', txt: 'Tendencia bajista fuerte — favor del trade' })
  }
  if (regime?.regime === 'STRONG_TREND_UP' && side === 'LONG') {
    bull += 1
    reasons.push({ s: 'bull', txt: 'Tendencia alcista fuerte — favor del trade' })
  }

  // 4d. Multi-TF alignment block — ONLY block when ALL three TFs unanimously oppose the trade
  const allTFsBearish = i1d?.bias === 'BAJISTA' && i4.bias === 'BAJISTA' && i1.bias === 'BAJISTA'
  const allTFsBullish = i1d?.bias === 'ALCISTA' && i4.bias === 'ALCISTA' && i1.bias === 'ALCISTA'
  if (side === 'LONG'  && allTFsBearish) return null
  if (side === 'SHORT' && allTFsBullish) return null

  // 4e. Triple confirmation bonus — all TFs aligned = high confidence entry
  if (allTFsBullish && side === 'LONG') {
    bull += 3
    b('Triple confirmación alcista 1D+4H+1H — alineación perfecta')
  }
  if (allTFsBearish && side === 'SHORT') {
    bear += 3
    be('Triple confirmación bajista 1D+4H+1H — alineación perfecta')
  }

  // 4f. 1H momentum confirming 4H trend — optimal entry timing
  if (i4.bias === 'ALCISTA' && i1.bias === 'ALCISTA' && i1.rsi > 50 && (i1.macd?.hist ?? 0) > 0) {
    bull += 2
    b('1H momentum alcista confirmando tendencia 4H — entrada óptima')
  }
  if (i4.bias === 'BAJISTA' && i1.bias === 'BAJISTA' && i1.rsi < 50 && (i1.macd?.hist ?? 0) < 0) {
    bear += 2
    be('1H momentum bajista confirmando tendencia 4H — entrada óptima')
  }

  // 5. Candle confirmation on entry TF
  // Scalp confirms on 15m; DayTrade and Swing both confirm on 4h (the primary signal driver)
  const entryKlines = tradeType === 'Scalp' ? rawK['15m'] : rawK['4h']
  if (!confirmCandles(entryKlines, side)) return null

  const isLong = side === 'LONG'
  const avMult = tradeType === 'Scalp' ? 1.0 : tradeType === 'Swing' ? 2.5 : 1.5
  const tpMult = tradeType === 'Scalp' ? [1.5, 2.0, 2.5] : tradeType === 'Swing' ? [2.0, 3.5, 5.0] : [1.5, 2.5, 4.0]
  const maxLev = tradeType === 'Scalp' ? 10 : tradeType === 'Swing' ? 3 : 5

  const sl  = isLong ? price - av * avMult  : price + av * avMult
  const tp1 = isLong ? price + av * tpMult[0] : price - av * tpMult[0]
  const tp2 = isLong ? price + av * tpMult[1] : price - av * tpMult[1]
  const tp3 = isLong ? price + av * tpMult[2] : price - av * tpMult[2]

  // ── PROBABILISTIC MODEL ──────────────────────────────────────────────────
  const avgWinR  = tpMult[0]  // TP1 R multiple as proxy
  const avgLossR = 1.0
  const probScore = calcWinProbability(
    { side, tradeType, score: maxSc, entry: price, sl, tp1, fg: mkt.fg ?? undefined, funding: mkt.funding ?? undefined },
    regime,
    signalHistory,
  )
  // Filter: reject negative EV or very low win probability
  if (probScore.expectedValue < 0)   return null
  if (probScore.winProbability < 45) return null

  // ── MONTE CARLO RISK GATE ─────────────────────────────────────────────────
  const mc = runMonteCarlo(probScore.winProbability / 100, avgWinR, avgLossR, 0.01)
  if (mc.ruinProbability > 15) return null

  const keySignals = reasons.slice(0, 4).map(r => r.txt).join(', ')
  const typeDesc = tradeType === 'Scalp'
    ? 'operación rápida (< 2h) aprovechando compresión de volatilidad'
    : tradeType === 'Swing'
    ? 'operación de varios días con tendencia alineada 4H+1D'
    : 'operación intradía (2-24h) con tendencia en 4H'
  const confDesc = confidence === 'ALTA'
    ? `La confluencia de ${maxSc} señales de múltiples fuentes otorga alta fiabilidad.`
    : confidence === 'MEDIA'
    ? `Con ${maxSc} señales el setup es válido pero requiere gestión activa del riesgo.`
    : `Solo ${maxSc} señales activas; setup especulativo de baja convicción, tamaño reducido.`
  const rrRaw = Math.abs(tp1 - price) / Math.abs(sl - price)

  const learnNote = wMult !== 1.0
    ? ` [Aprendizaje: ${wKey} WR histórico → factor ${wMult.toFixed(2)}x]`
    : ''
  const qualityLabel = expScore(maxSc)

  const patternLines = patterns4h.slice(0, 3)
    .map(p => `  · ${p.pattern.name}${p.pattern.nameJP ? ` (${p.pattern.nameJP})` : ''} ${p.confidence}% — ${p.pattern.tradingAdvice}`)
    .join('\n')
  const patternBlock = patternLines
    ? `\n\n🕯️ PATRONES DE VELAS (4H — Nison):\n${patternLines}`
    : ''

  const analysis =
    `Setup ${side} de tipo ${tradeType} detectado a $${Math.round(price).toLocaleString()}. ` +
    `Es una ${typeDesc}. ` +
    `Señales dominantes (${reasons.length} total): ${keySignals}. ` +
    `${confDesc} ` +
    `Hipótesis: el precio ${isLong ? 'continúe al alza' : 'continúe a la baja'} hacia TP1 ` +
    `$${Math.round(tp1).toLocaleString()} con R:R ${rrRaw.toFixed(1)}:1. ` +
    `Invalidación por cierre ${isLong ? 'bajo' : 'sobre'} $${Math.round(sl).toLocaleString()} ` +
    `(SL ${Math.abs(sl - price).toFixed(0)} pts). Apalancamiento máximo: ${maxLev}x. ` +
    `Calidad del setup: ${qualityLabel}.${learnNote}${patternBlock}`

  return {
    side, tradeType, confidence,
    bull, bear, maxSc, reasons, price, maxLev,
    sl, tp1, tp2, tp3, ts: new Date(), analysis,
    score: maxSc,
    regime:              regime?.regime,
    regimeDescription:   regime?.description,
    winProbability:      probScore.winProbability,
    expectedValue:       probScore.expectedValue,
    kellyCriterion:      probScore.kellyCriterion,
    probabilityCI:       probScore.confidenceInterval,
    probabilityFactors:  probScore.factors,
    suggestedRiskPct:    probScore.kellyCriterion,
    ruinProbability:     mc.ruinProbability,
    confluenceScore,
    isCounterTrend: (regime?.regime === 'STRONG_TREND_DOWN' && side === 'LONG') ||
                    (regime?.regime === 'STRONG_TREND_UP'   && side === 'SHORT'),
  }
}
