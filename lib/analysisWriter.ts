// APEX — Intelligent Analysis Writer
// Generates rich, analyst-quality text from market data — no Claude API needed.
// Produces consistent, structured analysis from the combined signal context.

import type { TradeIdea, IndicatorMap, MarketData, NewsItem } from './types'
import type { RegimeAnalysis }     from './marketRegime'
import type { ProbabilityScore }   from './probabilisticModel'
import type { MonteCarloResult }   from './monteCarlo'
import type { PatternConfluence }  from './patternConfluence'
import type { BTCCycle }           from './types'
import { getSession }              from './cycle'

interface ElliottContext {
  currentWave?: string
  direction?:   string
  confidence?:  string
  nextTarget?:  number
  invalidation?: number
}

interface OptionsData {
  maxPain:          number
  maxPainDistance:  string
  putCallRatio:     number
  sentiment:        string
  daysToExpiry:     number
}

import type { MacroIndicators, FedExpectations } from './macroEconomics'
import type { GlobalLiquidity }                  from './globalLiquidity'
import type { EconomicEvent }                    from './macroCalendar'

export function writeTradeAnalysis(opts: {
  idea:             TradeIdea
  inds:             IndicatorMap
  regime?:          RegimeAnalysis | null
  ew?:              Record<string, ElliottContext> | null
  confluence?:      PatternConfluence | null
  probScore?:       ProbabilityScore | null
  mc?:              MonteCarloResult | null
  mkt:              MarketData
  cycle?:           BTCCycle | null
  news?:            NewsItem[]
  optionsData?:     OptionsData | null
  macroIndicators?: MacroIndicators | null
  globalLiquidity?: GlobalLiquidity | null
  fedExpectations?: FedExpectations | null
  upcomingEvents?:  EconomicEvent[]
}): string {
  const { idea, inds, regime, ew, confluence, probScore, mc, mkt, cycle, news, optionsData,
          macroIndicators, globalLiquidity, fedExpectations, upcomingEvents } = opts
  const sess  = getSession()
  const now   = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const i4    = inds['4h']
  const i1    = inds['1h']
  const i1d   = inds['1d']
  const isLong = idea.side === 'LONG'

  const bullNews = (news ?? []).filter(n => n.tag === 'bullish').length
  const bearNews = (news ?? []).filter(n => n.tag === 'bearish').length

  const rr1 = i4 ? (Math.abs(idea.tp1 - idea.price) / Math.abs(idea.price - idea.sl)).toFixed(1) : '?'
  const rr2 = i4 ? (Math.abs(idea.tp2 - idea.price) / Math.abs(idea.price - idea.sl)).toFixed(1) : '?'
  const rr3 = i4 ? (Math.abs(idea.tp3 - idea.price) / Math.abs(idea.price - idea.sl)).toFixed(1) : '?'

  const lines: (string | null)[] = [
    `━━━ APEX ANÁLISIS ${idea.tradeType.toUpperCase()} — ${now} ━━━`,
    ``,
    `📊 SETUP: ${isLong ? '▲ LONG' : '▼ SHORT'} BTC/USDT | Confianza: ${idea.confidence}${probScore ? ` | Win Prob: ${probScore.winProbability}%` : ''}`,
    ``,
    `🌍 CONTEXTO DE MERCADO`,
    regime ? `Régimen: ${regime.description}` : null,
    regime ? `ADX ${regime.adx} (${regime.adxTrend}) — ${regime.adx > 25 ? 'Tendencia activa' : 'Mercado sin dirección clara'}` : null,
    `Sesión: ${sess.n} | Ciclo BTC: ${cycle?.phase ?? 'N/A'}${cycle ? ` (${cycle.pct?.toFixed(0) ?? '?'}%)` : ''}`,
    ``,
    `📈 ANÁLISIS MULTI-TIMEFRAME`,
    i1d ? `1D: ${i1d.bias} (${i1d.score}/9) — RSI ${i1d.rsi?.toFixed(0) ?? '?'}, precio ${(mkt.price ?? 0) > i1d.ema.e200 ? 'sobre' : 'bajo'} EMA200` : null,
    i4  ? `4H: ${i4.bias} (${i4.score}/9) — RSI ${i4.rsi?.toFixed(0) ?? '?'}, MACD hist ${i4.macd.hist > 0 ? 'alcista' : 'bajista'}${Math.abs(i4.macd.hist) > Math.abs(i4.macd.prev) ? ' (acelerando)' : ' (desacelerando)'}` : null,
    i1  ? `1H: ${i1.bias} (${i1.score}/9) — RSI ${i1.rsi?.toFixed(0) ?? '?'}, Stoch K${i1.stoch.k?.toFixed(0) ?? '?'} ${(i1.stoch.k ?? 50) > 80 ? 'sobrecompra' : (i1.stoch.k ?? 50) < 20 ? 'sobreventa' : 'neutro'}` : null,
    ``,
    ew?.['4h'] ? `🌊 ESTRUCTURA ELLIOTT` : null,
    ew?.['4h'] ? `4H: Onda ${ew['4h'].currentWave ?? '?'} — ${ew['4h'].direction ?? ''} | Conf: ${ew['4h'].confidence ?? '?'}${ew['4h'].nextTarget ? ` | Target: $${Math.round(ew['4h'].nextTarget).toLocaleString()}` : ''}` : null,
    ew?.['4h']?.invalidation ? `   Invalidación si precio cruza: $${Math.round(ew['4h'].invalidation!).toLocaleString()}` : null,
    ew?.['4h'] ? `` : null,
    confluence && confluence.sharedPatterns.length > 0 ? `🕯️ CONFLUENCIA DE PATRONES` : null,
    confluence && confluence.sharedPatterns.length > 0 ? `✨ ${confluence.description}` : null,
    confluence && confluence.sharedPatterns.length > 0 ? `` : null,
    `💧 ZONAS CLAVE`,
    optionsData ? `Max Pain semanal: $${optionsData.maxPain.toLocaleString()} (${Math.abs(parseFloat(optionsData.maxPainDistance))}% ${parseFloat(optionsData.maxPainDistance) > 0 ? 'arriba' : 'abajo'} · ${optionsData.daysToExpiry}d)` : null,
    optionsData ? `Put/Call: ${optionsData.putCallRatio.toFixed(2)} — ${optionsData.sentiment}` : null,
    ``,
    `🎯 PLAN DE TRADING`,
    `${isLong ? '▲ LONG' : '▼ SHORT'} BTC | Tipo: ${idea.tradeType} | Leverage: ${idea.maxLev}x max`,
    `Entrada:   $${Math.round(idea.price).toLocaleString()}`,
    `Stop Loss: $${Math.round(idea.sl).toLocaleString()} (${(Math.abs(idea.sl - idea.price) / idea.price * 100).toFixed(2)}%)`,
    `TP1:       $${Math.round(idea.tp1).toLocaleString()} (R:R ${rr1}:1)`,
    `TP2:       $${Math.round(idea.tp2).toLocaleString()} (R:R ${rr2}:1)`,
    `TP3:       $${Math.round(idea.tp3).toLocaleString()} (R:R ${rr3}:1)`,
    probScore ? `` : null,
    probScore ? `📊 MODELO PROBABILÍSTICO` : null,
    probScore ? `Win probability: ${probScore.winProbability}% [IC90: ${probScore.confidenceInterval[0]}-${probScore.confidenceInterval[1]}%]` : null,
    probScore ? `Expected Value: ${probScore.expectedValue > 0 ? '+' : ''}${probScore.expectedValue}R | Kelly: ${probScore.kellyCriterion}%` : null,
    mc ? `🎲 Monte Carlo (20 trades): mediana ${mc.median >= 0 ? '+' : ''}${mc.median}% | DD típico ${mc.maxDrawdownP50}%` : null,
    ``,
    `🔑 CONFLUENCIAS PRINCIPALES`,
    ...idea.reasons.slice(0, 6).map(r => `✔ ${r.txt}`),
    ``,
    `⚠️ HIPÓTESIS E INVALIDACIÓN`,
    buildHypothesis(idea, i4, ew?.['4h'] ?? null),
    buildInvalidation(idea),
    ``,
    `📰 NOTICIAS: ${bullNews} alcistas | ${bearNews} bajistas`,
    macroIndicators ? `` : null,
    macroIndicators ? `🏛️ ENTORNO MACRO` : null,
    macroIndicators ? macroIndicators.summary : null,
    macroIndicators ? `Fed: ${macroIndicators.fedRate.note}` : null,
    macroIndicators ? `CPI: ${macroIndicators.cpi.note}` : null,
    macroIndicators ? `M2: ${macroIndicators.m2.note}` : null,
    macroIndicators ? `Treasury 10Y: ${macroIndicators.treasury10y.note}` : null,
    fedExpectations ? `Expectativas Fed: ${fedExpectations.btcImplication}` : null,
    globalLiquidity ? `Liquidez global: ${globalLiquidity.btcCorrelation}` : null,
    upcomingEvents && upcomingEvents.filter(e => e.impact === 'HIGH').length > 0 ? `📅 PRÓXIMOS EVENTOS ALTO IMPACTO:` : null,
    ...((upcomingEvents ?? []).filter(e => e.impact === 'HIGH').slice(0, 3).map(e =>
      `• ${e.date} ${e.time}: ${e.name} — ${e.btcReaction}`
    )),
    regime?.regime === 'RANGING' ? `⚠️ ATENCIÓN: Mercado en lateral — mayor ruido, señales menos fiables` : null,
    `Score: ${idea.bull + idea.bear}/${idea.maxSc} | Sesión: ${sess.n}`,
  ]

  return lines.filter(l => l !== null).join('\n')
}

function buildHypothesis(idea: TradeIdea, i4: IndicatorMap['4h'] | undefined, ew: ElliottContext | null): string {
  const dir    = idea.side === 'LONG' ? 'alcanza' : 'continúa hacia'
  const reason = ew?.currentWave?.includes('3') ? 'impulsado por Onda 3'
    : i4?.bias === (idea.side === 'LONG' ? 'ALCISTA' : 'BAJISTA') ? 'alineado con tendencia 4H'
    : 'por confluencia de indicadores'
  return `Hipótesis: precio ${dir} TP1 $${Math.round(idea.tp1).toLocaleString()} ${reason}`
}

function buildInvalidation(idea: TradeIdea): string {
  const close = idea.side === 'LONG' ? 'cierre por debajo' : 'cierre por encima'
  return `Invalidación: ${close} de $${Math.round(idea.sl).toLocaleString()} invalida el setup`
}
