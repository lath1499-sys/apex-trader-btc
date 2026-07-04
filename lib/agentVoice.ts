// APEX — Agent Voice / Personality
// Generates conversational market updates that sound like an experienced trader,
// not a data dump. Spanish, direct, opinionated, uses market slang.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { getMacroSnapshot, formatMacroForPrompt } from './macroData'

function getVoiceSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

const BRIEF_FOCUSES = [
  'FLUJO_Y_LIQUIDEZ',
  'ESTRUCTURA_TECNICA',
  'MOMENTUM_Y_DIVERGENCIAS',
  'MACRO_Y_CORRELACIONES',
  'NARRATIVA_Y_SESGO',
  'GESTION_Y_CAPITAL',
] as const
type BriefFocus = typeof BRIEF_FOCUSES[number]

// ─────────────────────────────────────────────────────────────────────────────
// 30-min conversational update — params interface
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentUpdateParams {
  price:           number
  prevPrice:       number
  inds:            any
  regime:          any
  session:         any
  macroSentiment:  any
  macroIndicators: any
  fedExpectations: any
  news:            any[]
  whaleAlert:      any
  realDelta:       any
  elliottWaves:    any
  fvgs:            any
  liquidity:       any
  activeSignals:   any[]
  recentlyClosed?: any[]
  capitalState?:   any
  opinionChanges:  string[]
  patternMatch:    any
  globalMarkets:   any
  optionsData?:    any
  wfGrade?:        string | null
  mkt?:            any
  socialSentiment?: any
  abcdAnalysis?:    any
  memory?:          { lastBias: string; lastPrice: number; lastAnalysisAt: string | null; changeReason: string | null } | null
}

// ── Fresh signal state — re-queries Supabase AFTER all closes are saved ──────
export async function getFreshSignalState(sb: any): Promise<{ activeSignals: any[]; recentlyClosed: any[] }> {
  try {
    const [activeRes, closedRes] = await Promise.allSettled([
      sb.from('apex_signals')
        .select('*')
        .in('status', ['active', 'tp1_hit', 'tp2_hit'])
        .order('created_at', { ascending: false }),
      sb.from('apex_signals')
        .select('*')
        .in('status', ['sl_hit', 'tp3_hit', 'closed_manual', 'breakeven'])
        .gte('closed_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .order('closed_at', { ascending: false })
        .limit(3),
    ])
    const activeSignals  = activeRes.status  === 'fulfilled' ? (activeRes.value.data  ?? []) : []
    const recentlyClosed = closedRes.status  === 'fulfilled' ? (closedRes.value.data  ?? []) : []
    return { activeSignals, recentlyClosed }
  } catch {
    return { activeSignals: [], recentlyClosed: [] }
  }
}

// ── Claude API call for rich, intelligent voice ────────────────────────────
async function callClaudeForUpdate(p: AgentUpdateParams): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const { price, prevPrice, inds, regime, session, activeSignals, recentlyClosed,
          capitalState, opinionChanges, mkt, whaleAlert, macroSentiment,
          macroIndicators, fedExpectations, globalMarkets, elliottWaves, fvgs,
          liquidity, optionsData, news, socialSentiment, abcdAnalysis, memory } = p

  // ── Macro snapshot (real CPI, DXY, Gold, etc.) ────────────────────────────
  const macro    = await getMacroSnapshot().catch(() => null)
  const macroTxt = macro ? formatMacroForPrompt(macro) : (
    macroIndicators?.fedRate
      ? `Fed: ${macroIndicators.fedRate.current?.toFixed(2)}% | CPI: ${macroIndicators.cpi?.yoy?.toFixed(1) ?? '?'}%`
      : 'Macro data no disponible'
  )

  // ── Brief focus rotation — avoid repeating same angle ─────────────────────
  const sb            = getVoiceSb()
  const hourOfDay     = new Date().getUTCHours()
  const defaultFocus  = BRIEF_FOCUSES[Math.floor(hourOfDay / 4) % BRIEF_FOCUSES.length]
  let   selectedFocus: BriefFocus = defaultFocus

  let recentFocuses: string[] = []
  if (sb) {
    const { data: recentBriefs } = await Promise.resolve(
      sb.from('apex_brief_history').select('focus').order('created_at', { ascending: false }).limit(3)
    ).catch(() => ({ data: null })) as { data: Array<{ focus: string }> | null }
    recentFocuses = (recentBriefs ?? []).map(b => b.focus)
    if (recentFocuses.includes(defaultFocus)) {
      const available = BRIEF_FOCUSES.filter(f => !recentFocuses.includes(f))
      if (available.length > 0) selectedFocus = available[0]
    }
  }

  const i4   = inds?.['4h']
  const i1   = inds?.['1h']
  const i1d  = inds?.['1d']
  const i15  = inds?.['15m']
  const ew4h = elliottWaves?.['4h']

  const priceChange = prevPrice > 0
    ? ((price - prevPrice) / prevPrice * 100).toFixed(2)
    : '0.00'

  const rawData = `
PRECIO: $${Math.round(price).toLocaleString()} (${priceChange}% en 30min)
SESIÓN: ${session?.name ?? 'N/A'} | RÉGIMEN: ${regime?.regime?.replace(/_/g, ' ') ?? 'N/A'} (ADX ${regime?.adx?.toFixed(1) ?? '?'})

ESTRUCTURA:
1D: ${i1d?.bias ?? '?'} RSI${i1d?.rsi?.toFixed(0) ?? '?'}
4H: ${i4?.bias ?? '?'} RSI${i4?.rsi?.toFixed(0) ?? '?'} MACD${(i4?.macd?.hist ?? 0) > 0 ? '+' : ''}${i4?.macd?.hist?.toFixed(0) ?? '?'} Stoch${i4?.stoch?.k?.toFixed(0) ?? '?'}
1H: ${i1?.bias ?? '?'} RSI${i1?.rsi?.toFixed(0) ?? '?'}
15M: ${i15?.bias ?? '?'} RSI${i15?.rsi?.toFixed(0) ?? '?'}
${ew4h && ew4h.currentWave !== 'unclear' ? `ELLIOTT 4H: Onda ${ew4h.currentWave} ${ew4h.direction} → target $${ew4h.nextTarget ? Math.round(ew4h.nextTarget).toLocaleString() : 'N/A'} | invalida $${ew4h.invalidation ? Math.round(ew4h.invalidation).toLocaleString() : 'N/A'}` : ''}
${abcdAnalysis?.mostRelevant ? `ABCD ${String(abcdAnalysis.mostRelevant.timeframe).toUpperCase()}: ${abcdAnalysis.mostRelevant.direction} ${abcdAnalysis.mostRelevant.completion}% completado, D=$${Math.round(abcdAnalysis.mostRelevant.D_target).toLocaleString()}${abcdAnalysis.inPRZ ? ' ← PRECIO EN PRZ AHORA' : ''}` : ''}

NIVELES:
${(fvgs?.['4h'] ?? []).filter((f: any) => !f.filled).slice(0, 2).map((f: any) => `FVG ${f.type}: $${Math.round(f.midpoint).toLocaleString()} (${((f.midpoint - price) / price * 100).toFixed(1)}%)`).join('\n')}
${liquidity?.nearestBSL ? `BSL: $${Math.round(liquidity.nearestBSL).toLocaleString()} (+${((liquidity.nearestBSL - price) / price * 100).toFixed(1)}%)` : ''}
${liquidity?.nearestSSL ? `SSL: $${Math.round(liquidity.nearestSSL).toLocaleString()} (${((liquidity.nearestSSL - price) / price * 100).toFixed(1)}%)` : ''}

FLUJO:
Funding: ${mkt?.funding != null ? (mkt.funding >= 0 ? '+' : '') + mkt.funding.toFixed(4) : '?'}% | L/S: ${mkt?.lsr?.toFixed(2) ?? '?'} | F&G: ${mkt?.fg ?? '?'}/100
${whaleAlert?.detected ? `WHALE: ${whaleAlert.description}` : ''}
${optionsData?.iv ? `IV Rank: ${optionsData.iv.ivRank}/100 (${optionsData.iv.regime})` : ''}

MACRO:
${macroTxt}
${fedExpectations ? `Prob. recorte Fed: ${fedExpectations.cutProbability}%` : ''}
${macroSentiment ? `Sentimiento macro compuesto: ${macroSentiment.label} (${macroSentiment.score}/100)` : ''}
${globalMarkets?.signalImpact !== 'NEUTRAL' ? `Correlación global: ${globalMarkets?.btcCorrelation ?? ''}` : ''}
${socialSentiment ? `Social Galaxy Score: ${socialSentiment.galaxyScore} | ${socialSentiment.sentiment}` : ''}

NOTICIAS:
${(news ?? []).slice(0, 3).map((n: any) => `• ${String(n.title ?? '').slice(0, 90)} [${n.tag ?? 'neutral'}]`).join('\n') || '(Sin noticias recientes)'}

ESTADO SEÑALES (datos frescos de DB — usa ESTO, no estado anterior):
${activeSignals.length > 0
  ? activeSignals.map((s: any) => {
      const isLong  = s.side === 'LONG'
      const entry   = s.entry ?? s.idea_entry ?? 0
      const sl      = s.sl    ?? s.idea_sl    ?? 0
      const tp1     = s.tp1   ?? s.idea_tp1   ?? 0
      const pnl     = isLong ? (price - entry) / entry * 100 : (entry - price) / entry * 100
      const slDist  = Math.abs(price - sl) / entry * 100
      const tp1Dist = isLong ? (tp1 - price) / price * 100 : (price - tp1) / price * 100
      const hrs     = Math.round((Date.now() - new Date(s.created_at ?? s.createdAt).getTime()) / 3_600_000)
      return `• ${s.side} ${s.trade_type ?? s.tradeType} @$${Math.round(entry).toLocaleString()} | P&L:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | SL:${slDist.toFixed(1)}% lejos | TP1:${tp1Dist.toFixed(1)}% lejos | ${hrs}h | Status:${s.status}`
    }).join('\n')
  : '✅ SIN SEÑALES ACTIVAS — capital libre'}
${(recentlyClosed ?? []).length > 0 ? `
CERRADAS EN ÚLTIMAS 2H:
${(recentlyClosed ?? []).map((s: any) => {
  const pnl = s.pnl ?? 0
  return `• ${s.side ?? ''} ${s.trade_type ?? ''} cerrada $${s.exit_price ? Math.round(s.exit_price).toLocaleString() : 'mercado'} | P&L:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | ${s.close_reason ?? s.status}`
}).join('\n')}
INSTRUCCIÓN: Menciona estas cierres en tu análisis. NO digas que están activas.` : ''}

${capitalState ? (() => {
  const dynTarget    = capitalState.monthlyProfitTarget ?? (capitalState.monthlyStartBalance ?? 0) * 0.15
  const progressPct  = dynTarget > 0 ? Math.min(100, ((capitalState.monthlyPnl ?? 0) / dynTarget) * 100) : 0
  const stageTxt     = capitalState.drawdownStage === 3 ? '🛑 HARD STOP'
                     : capitalState.drawdownStage === 2 ? '⚠️ SURVIVAL (2% riesgo)'
                     : '✅ NORMAL (5% riesgo)'
  return `
GESTIÓN DE CAPITAL:
Balance: $${capitalState.availableBalance?.toFixed(2) ?? 'N/A'} | Desplegado: $${capitalState.deployedCapital?.toFixed(2) ?? '0'}
P&L este mes: ${(capitalState.monthlyPnlPct ?? 0) >= 0 ? '+' : ''}${(capitalState.monthlyPnlPct ?? 0).toFixed(2)}% — Target: $${dynTarget.toFixed(0)} (15%) — Progreso: ${progressPct.toFixed(0)}%
Estado: ${stageTxt} | ${capitalState.canOpenNewTrade ? 'Puede abrir trades' : 'PAUSADO — ' + capitalState.reason}`
})() : ''}
${memory?.lastAnalysisAt ? `SESGO ANTERIOR (hace ${Math.round((Date.now() - new Date(memory.lastAnalysisAt).getTime()) / 60_000)} min): ${memory.lastBias}${memory.changeReason ? ` — "${memory.changeReason.slice(0, 150)}"` : ''}
Precio entonces: $${Math.round(memory.lastPrice).toLocaleString()} → ahora $${Math.round(price).toLocaleString()} (${((price - memory.lastPrice) / (memory.lastPrice || price) * 100).toFixed(2)}%)` : ''}
${opinionChanges.length > 0 ? `\nCAMBIOS DETECTADOS:\n${opinionChanges.map((c: string) => `• ${c}`).join('\n')}` : ''}
`

  const focusInstructions: Record<BriefFocus, string> = {
    FLUJO_Y_LIQUIDEZ: `
ÁNGULO DE ESTE BRIEF: Flujo de capital y liquidez.
Profundiza en: funding rate (¿positivo o negativo y qué implica?), open interest (¿subiendo con el precio = fuerte, bajando = fuerza decreciente?), liquidaciones recientes, flujos ETF, volumen relativo vs promedio.
La pregunta central: ¿el dinero real está entrando o saliendo? ¿Dónde están los stops del retail?
NO enumeres ADX, Elliott Waves ni datos de CPI en este brief.`,

    ESTRUCTURA_TECNICA: `
ÁNGULO DE ESTE BRIEF: Estructura de precio y niveles clave.
Profundiza en: soportes y resistencias exactos con precios, FVGs activos y si fueron respetados, qué estructura construye el precio (HH/HL alcista, LH/LL bajista), qué vela es la más importante de las últimas 4h y qué implica.
La pregunta central: ¿dónde está el nivel que cambia todo? Si ese nivel cae o resiste, ¿qué pasa?
NO menciones macro (CPI/Fed), ni teoría de ondas Elliott en este brief.`,

    MOMENTUM_Y_DIVERGENCIAS: `
ÁNGULO DE ESTE BRIEF: Momentum y divergencias entre timeframes.
Profundiza en: RSI en cada TF (¿hay divergencias bullish/bearish con el precio?), MACD histogram (¿qué dirección tiene el histograma en 4H y 1H?), Stoch (¿sobrecomprado/sobrevendido con señal?).
La pregunta central: ¿el momentum confirma la tendencia o la está traicionando?
Si RSI en 1D y 4H dicen cosas opuestas al precio, explica qué significa eso.
NO menciones macro ni FVGs en este brief.`,

    MACRO_Y_CORRELACIONES: `
ÁNGULO DE ESTE BRIEF: Macro y correlaciones con otros mercados.
Profundiza en: CPI ${macro?.cpi_yoy ?? '?'}% y lo que implica para la Fed, DXY ${macro?.dxy ?? '?'} y su relación histórica con BTC, S&P ${macro?.sp500_change ?? '?'}% de hoy (¿risk-on o risk-off?), flujos ETF y lo que dicen los institucionales.
La pregunta central: ¿la macro refuerza o contradice el setup técnico actual?
Menciona BTC Dominance ${macro?.btc_dominance ?? '?'}% — ¿el capital está en BTC o saliendo a alts?`,

    NARRATIVA_Y_SESGO: `
ÁNGULO DE ESTE BRIEF: Narrativa y sesgo de participantes.
Profundiza en: ¿qué historia se está contando ahora en el mercado? Fear&Greed ${macro?.fear_greed ?? '?'}/100 — ¿qué posicionamiento implica eso?
¿El retail está largo o corto (L/S ratio)? Si el retail está muy de un lado, el mercado suele ir al otro.
¿Hay un evento próximo (FOMC ${macro?.fed_next_meeting ?? '?'}, vencimiento de opciones, datos) que cambie la dinámica?
La pregunta central: ¿con quién estoy operando: con la narrativa o contra ella?`,

    GESTION_Y_CAPITAL: `
ÁNGULO DE ESTE BRIEF: Portafolio y gestión activa.
Profundiza en: ¿cómo van mis trades abiertos y qué haría ahora si los tuviera que revisar desde cero? ¿Hay alguno que deba cerrar, mover el SL, o escalar?
Progreso del mes vs target 15%: ¿voy bien, atrasado, o ya lo alcancé?
Si no hay señales: ¿exactamente QUÉ setup estoy esperando y a QUÉ precio exactamente entraría?
La pregunta central: ¿mi capital está bien gestionado para el contexto actual?`,
  }

  const prompt = `Eres APEX, un trader senior de Bitcoin con 15 años de experiencia.
Le estás reportando a tu jefe cada 30 minutos. Tu jefe es un trader experimentado
también — no necesita que le expliques qué es el RSI, necesita saber QUÉ PIENSAS
que va a pasar y POR QUÉ.

DATOS CRUDOS (para tu análisis, NO los repitas tal cual):
${rawData}

═══ ENFOQUE OBLIGATORIO DE ESTE BRIEF ═══

${focusInstructions[selectedFocus]}

═══ PROHIBICIONES ABSOLUTAS (ignora si lo ves en los datos) ═══

- NO mencionar "Max Pain" — no tienes fuente de datos real para opciones BTC
- NO mencionar "IV Rank" ni "DVOL" — datos de Deribit no disponibles ahora
- NO usar CPI 0.0% — el CPI real es ${macro?.cpi_yoy ?? 4.2}%
- NO decir "Fed bajó", "Fed recortó" ni "Fed podría recortar pronto" — la Fed está en HOLD con CPI en ${macro?.cpi_yoy ?? 4.2}% (> 3% = sin margen para recortar)
- NO terminar con sesgo ambiguo ("neutral-bajista con sesgo alcista") — elige UNO

═══ ANTI-REPETICIÓN ═══

Los últimos 3 briefs cubrieron: ${recentFocuses.length > 0 ? recentFocuses.join(', ') : 'ninguno todavía'}.
ESTÁ PROHIBIDO usar estas frases exactas en este brief:
"distribución activa", "no voy a forzar", "lo dejo correr con trailing",
"el macro me genera tensión narrativa", "no hay señal de giro todavía",
"las señales siguen activas".
Si el precio no se movió materialmente desde el último brief, di explícitamente:
"El precio lleva X horas sin movimiento relevante. En ese contexto..."
y luego ve al enfoque del brief directamente.

═══ ESTRUCTURA (4-6 párrafos cortos, máximo 18 líneas) ═══

1. APERTURA — Una oración específica sobre qué hizo el precio en los últimos 30 min.
2. DESARROLLO DEL ÁNGULO — 2-3 párrafos profundizando en ${selectedFocus.replace(/_/g, ' ')}.
3. TUS POSICIONES (si las hay) — Estado real, no solo P&L. Di si te preocupa algo.
4. CIERRE — Una frase concreta sobre el nivel o evento más importante para las próximas horas.

═══ REGLAS DE ESTILO ═══

- Primera persona con opinión real: "creo que", "me preocupa", "me sorprende".
- Conecta datos en narrativa, nunca los listes.
- Máximo 18 líneas. Denso, sin relleno.

Escribe el reporte ahora.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[APEX Voice] Claude API error ${res.status}: ${errBody.slice(0, 200)}`)
      return null
    }
    const data = await res.json() as { content?: Array<{ text?: string }> }
    const text = data.content?.[0]?.text ?? null
    if (text) {
      console.log(`[APEX Voice] Claude responded — ${text.length} chars | focus: ${selectedFocus}`)
      // Persist focus so next brief avoids repeating it
      if (sb) {
        await Promise.resolve(
          sb.from('apex_brief_history').insert({
            focus: selectedFocus, summary: text.slice(0, 100), created_at: new Date().toISOString(),
          })
        ).catch(() => {})
      }
    }
    return text
  } catch (err) {
    console.error('[APEX Voice] Claude API failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 30-min conversational update — async (Claude API with deterministic fallback)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateAgentUpdate(params: AgentUpdateParams): Promise<string> {
  // Try Claude API first — rich, intelligent, non-repetitive
  const claudeText = await callClaudeForUpdate(params).catch(() => null)
  if (claudeText) return claudeText
  // Fallback to deterministic template
  console.log('[APEX Voice] Using fallback template')
  return buildDeterministicUpdate(params)
}

function buildDeterministicUpdate(params: AgentUpdateParams): string {
  const { price, prevPrice, inds, regime, session, macroSentiment, macroIndicators,
          fedExpectations, news, whaleAlert, realDelta, elliottWaves, fvgs, liquidity,
          activeSignals, opinionChanges, globalMarkets, optionsData, wfGrade } = params
  const i15 = inds?.['15m']
  const i1  = inds?.['1h']
  const i4  = inds?.['4h']
  const i1d = inds?.['1d']

  const priceChange = prevPrice > 0
    ? ((price - prevPrice) / prevPrice * 100)
    : 0
  const changeTxt = `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`

  const lines: string[] = []

  void macroSentiment  // referenced indirectly via closingTakes below

  // ── Opening line — price action ───────────────────────────────────────────
  const opening =
    priceChange > 1.5  ? `BTC empujando fuerte, +${priceChange.toFixed(2)}% en los últimos 30 minutos. Momentum real.` :
    priceChange > 0.5  ? `BTC subiendo gradualmente (${changeTxt}). Sin urgencia pero en dirección correcta.` :
    priceChange < -1.5 ? `BTC bajo presión, ${changeTxt} en 30 minutos. Hay vendedores activos.` :
    priceChange < -0.5 ? `BTC retrocediendo (${changeTxt}). Normal dentro de estructura bajista.` :
    Math.abs(priceChange) < 0.1
      ? `BTC sin movimiento significativo. Precio pegado a $${Math.round(price).toLocaleString()}.`
      : `BTC moviéndose lateralmente (${changeTxt}). Mercado digiriendo.`

  lines.push(`$${Math.round(price).toLocaleString()} — ${opening}`)

  // ── Multi-timeframe structure ─────────────────────────────────────────────
  lines.push('')
  lines.push('Estructura:')

  if (i1d) {
    const rsiNote = i1d.rsi < 30 ? ' (RSI sobrevendido)' : i1d.rsi > 70 ? ' (RSI sobrecomprado)' : ''
    const trendNote = i1d.bias === 'ALCISTA'
      ? 'tendencia mayor intacta'
      : i1d.bias === 'BAJISTA'
      ? 'presión bajista dominante'
      : 'sin dirección clara'
    lines.push(`1D: ${i1d.bias}${rsiNote} — ${trendNote}`)
  }
  if (i4) {
    const macdNote = i4.macd?.hist > 0 ? 'MACD positivo' : 'MACD negativo'
    const emaNote  = price > (i4.ema?.e200 ?? 0) ? 'sobre EMA200' : 'bajo EMA200'
    lines.push(`4H: ${i4.bias} | ${macdNote} | ${emaNote}`)
  }
  if (i1) {
    lines.push(`1H: ${i1.bias} | RSI ${i1.rsi?.toFixed(0)} | Stoch ${i1.stoch?.k?.toFixed(0)}`)
  }
  if (i15) {
    const hist    = i15.macd?.hist ?? 0
    const prev    = i15.macd?.prev ?? 0
    const momentum =
      hist > 0 && hist > prev ? 'momentum alcista acelerando' :
      hist < 0 && hist < prev ? 'momentum bajista acelerando' :
      'momentum neutral'
    lines.push(`15M: ${i15.bias} | ${momentum}`)
  }

  // ── Elliott Wave context ──────────────────────────────────────────────────
  const ew4h = elliottWaves?.['4h']
  if (ew4h && ew4h.currentWave !== 'unclear') {
    lines.push('')
    const waveMeaning: Record<string, string> = {
      W1: 'inicio de impulso, confirmar con volumen',
      W2: 'corrección normal, no romper inicio de W1',
      W3: 'la onda más poderosa — mayor probabilidad de éxito',
      W4: 'corrección compleja, no se superpone con W1',
      W5: 'impulso final, divergencias típicas, cuidado',
      WA: 'inicio de corrección ABC',
      WB: 'rebote correctivo, trampa potencial',
      WC: 'fin de corrección, posible reversión',
    }
    const dir = ew4h.direction === 'bullish' ? '▲' : ew4h.direction === 'bearish' ? '▼' : '↔'
    lines.push(`Elliott 4H: Onda ${ew4h.currentWave} ${dir} — ${waveMeaning[ew4h.currentWave] ?? 'estructura en progreso'}`)
    if (ew4h.nextTarget)   lines.push(`Próximo objetivo: $${Math.round(ew4h.nextTarget).toLocaleString()}`)
    if (ew4h.invalidation) lines.push(`Invalidación si rompe: $${Math.round(ew4h.invalidation).toLocaleString()}`)
  }

  // ── FVGs and liquidity ────────────────────────────────────────────────────
  // fvgs['4h'] is a FVGResult object {bullish,bearish,all,nearest} — use .all array
  const activeFVGs: any[] = (fvgs?.['4h']?.all ?? fvgs?.['4h'] ?? []).filter((f: any) => !f.filled)
  if (activeFVGs.length > 0) {
    lines.push('')
    const nearest = [...activeFVGs].sort((a, b) =>
      Math.abs((a.midpoint ?? 0) - price) - Math.abs((b.midpoint ?? 0) - price)
    )[0]
    if (nearest?.midpoint) {
      const dist = ((nearest.midpoint - price) / price * 100).toFixed(1)
      const dir  = nearest.midpoint > price ? 'arriba' : 'abajo'
      const kind = nearest.type === 'bullish' ? 'alcista' : 'bajista'
      lines.push(`FVG más cercano: ${kind} en $${Math.round(nearest.midpoint).toLocaleString()} (${dist}% ${dir}) — los gaps tienden a rellenarse`)
    }
  }

  if (liquidity?.nearestBSL || liquidity?.nearestSSL) {
    if (liquidity.nearestBSL) {
      const d = ((liquidity.nearestBSL - price) / price * 100).toFixed(1)
      lines.push(`Liquidez compra (BSL) en $${Math.round(liquidity.nearestBSL).toLocaleString()} (+${d}%)`)
    }
    if (liquidity.nearestSSL) {
      const d = ((price - liquidity.nearestSSL) / price * 100).toFixed(1)
      lines.push(`Liquidez venta (SSL) en $${Math.round(liquidity.nearestSSL).toLocaleString()} (-${d}%)`)
    }
  }

  // ── Whale / Delta activity ────────────────────────────────────────────────
  if (whaleAlert?.detected && whaleAlert.magnitude !== 'NONE') {
    lines.push('')
    lines.push(`ALERTA: ${whaleAlert.description}`)
  }
  if (realDelta?.trend === 'STRONG_BUY' || realDelta?.trend === 'STRONG_SELL') {
    lines.push(`Flujo real: ${realDelta.interpretation}`)
  }

  // ── News impact ───────────────────────────────────────────────────────────
  const highImpactNews = (news ?? [])
    .filter((n: any) => n.impact === 'high' || n.tag === 'bullish' || n.tag === 'bearish')
    .slice(0, 2)

  if (highImpactNews.length > 0) {
    lines.push('')
    lines.push('Noticias relevantes:')
    highImpactNews.forEach((n: any) => {
      const impact = n.tag === 'bullish' ? '📈 alcista' : n.tag === 'bearish' ? '📉 bajista' : 'neutral'
      lines.push(`• ${String(n.title ?? '').slice(0, 70)} — impacto ${impact}`)
    })
  }

  // ── Macro context ─────────────────────────────────────────────────────────
  if (fedExpectations?.marketSentiment !== 'EXPECTING_HOLD' && fedExpectations?.btcImplication) {
    lines.push('')
    lines.push(`Macro Fed: ${String(fedExpectations.btcImplication).slice(0, 100)}`)
  }
  if (globalMarkets?.signalImpact !== 'NEUTRAL' && globalMarkets?.btcCorrelation) {
    lines.push(`Correlación global: ${String(globalMarkets.btcCorrelation).slice(0, 80)}`)
  }

  // ── Opinion changes ───────────────────────────────────────────────────────
  if (opinionChanges.length > 0) {
    lines.push('')
    lines.push('Cambios detectados:')
    opinionChanges.forEach(c => lines.push(`• ${c}`))
  }

  // ── Active signals status ─────────────────────────────────────────────────
  lines.push('')
  if (activeSignals.length > 0) {
    const plural = activeSignals.length > 1
    lines.push(`${activeSignals.length} señal${plural ? 'es' : ''} activa${plural ? 's' : ''}:`)
    activeSignals.forEach(s => {
      const isLong   = s.side === 'LONG'
      const pnlNow   = isLong
        ? (price - s.entry) / s.entry * 100
        : (s.entry - price) / s.entry * 100
      const pnlStr   = `${pnlNow >= 0 ? '+' : ''}${pnlNow.toFixed(2)}%`
      const distToSL = Math.abs(price - s.sl) / s.entry * 100
      const status   = pnlNow > 0
        ? `en ganancia ${pnlStr}`
        : `en pérdida ${pnlStr} (SL a ${distToSL.toFixed(1)}% de distancia)`
      lines.push(`${s.side} ${s.tradeType} desde $${Math.round(s.entry).toLocaleString()} — ${status}`)
    })
  } else {
    lines.push('Sin señales activas. Analizando oportunidades.')
  }

  // ── Closing take — agent opinion ──────────────────────────────────────────
  lines.push('')
  const regimeStr     = regime?.regime ?? 'UNKNOWN'
  const sessionName   = session?.name ?? ''
  const closingTakes: string[] = []

  if (regimeStr.includes('STRONG_TREND_DOWN')) {
    closingTakes.push('Tendencia bajista dominante. Shorts favorecidos, longs solo en zonas extremas.')
  } else if (regimeStr.includes('STRONG_TREND_UP')) {
    closingTakes.push('Tendencia alcista dominante. Comprar retrocesos mientras estructura aguante.')
  } else if (regimeStr === 'RANGING') {
    closingTakes.push('Mercado lateral. Esperar ruptura con volumen antes de entrar.')
  } else if (regimeStr === 'BREAKOUT_IMMINENT') {
    closingTakes.push('Compresión extrema detectada. Movimiento explosivo próximo — preparar órdenes en ambos lados.')
  }

  if (sessionName.includes('Dead') || sessionName.includes('Asia')) {
    closingTakes.push('Sesión de baja liquidez. Movimientos pueden ser manipulados. Esperando London.')
  } else if (sessionName.includes('London') || sessionName.includes('NY')) {
    closingTakes.push('Sesión de alta liquidez activa. Mejores condiciones para trading.')
  }

  if (i4?.rsi < 28) {
    closingTakes.push('RSI 4H en sobreventa extrema. Bounce técnico probable aunque trend siga bajista.')
  } else if (i4?.rsi > 78) {
    closingTakes.push('RSI 4H en sobrecompra extrema. Posible corrección técnica a corto plazo.')
  }

  if (closingTakes.length > 0) lines.push(closingTakes[0])

  // ── Options + IV Rank ────────────────────────────────────────────────────
  if (optionsData?.iv) {
    const iv = optionsData.iv
    lines.push('')
    lines.push(`📊 Vol: DVOL ${iv.currentIV.toFixed(1)}% · IVR ${iv.ivRank}/100 (${iv.regime.toUpperCase()})${iv.signal === 'buy_vol' ? ' — opciones baratas' : iv.signal === 'sell_vol' ? ' — opciones caras' : ''}`)
    if (optionsData.maxPain) lines.push(`Max Pain: $${Math.round(optionsData.maxPain).toLocaleString()} · PCR ${optionsData.putCallRatio?.toFixed(2)} (${optionsData.sentiment})`)
  }
  if (wfGrade && wfGrade !== 'F') {
    lines.push(`WF Grade: ${wfGrade} (validación fuera de muestra de señales recientes)`)
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 4H deep analysis — more detailed, sent every 4 hours
// ─────────────────────────────────────────────────────────────────────────────

export async function generateDeepAnalysis(
  price:           number,
  inds:            any,
  regime:          any,
  macroIndicators: any,
  fedExpectations: any,
  globalLiquidity: any,
  elliottWaves:    any,
  patterns:        any[],
  activeSignals:   any[],
  perfStats:       any,
  weights:         any,
  optionsData?:    any,
  wfResult?:       any,
): Promise<string> {
  const i4   = inds?.['4h']
  const i1d  = inds?.['1d']
  const ew4h = elliottWaves?.['4h']

  // ── Try Claude first for a narrative deep analysis ────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    const regimeTxt = (regime?.regime ?? 'UNKNOWN').replace(/_/g, ' ')
    const strongPats = (patterns ?? []).filter((p: any) => p.pattern?.strength === 3).slice(0, 3)
      .map((p: any) => `${p.pattern.name} (${p.confidence}%)`).join(', ')
    const activeSigTxt = activeSignals.length > 0
      ? activeSignals.map((s: any) => {
          const pnl = s.side === 'LONG' ? (price - s.entry) / s.entry * 100 : (s.entry - price) / s.entry * 100
          return `${s.side} ${s.tradeType} @$${Math.round(s.entry).toLocaleString()} P&L:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
        }).join(' | ')
      : 'ninguna'

    // Use getMacroSnapshot() for verified macro data — avoids wrong CPI from FRED API
    const deepMacro = await getMacroSnapshot().catch(() => null)
    const deepCPI   = deepMacro?.cpi_yoy ?? macroIndicators?.cpi?.yoy?.toFixed(1) ?? '?'
    const deepFed   = deepMacro?.fed_rate ?? macroIndicators?.fedRate?.current?.toFixed(2) ?? '?'

    const deepPrompt = `Eres APEX, trader senior BTC 15 años. Análisis profundo cada 4 horas.
Tu jefe es un trader experimentado — necesita OPINIÓN y NARRATIVA, no datos en crudo.

DATOS (no los repitas literalmente):
BTC $${Math.round(price).toLocaleString()} | Régimen: ${regimeTxt} | ADX: ${regime?.adx?.toFixed(1) ?? '?'}
1D: ${i1d?.bias ?? '?'} RSI${i1d?.rsi?.toFixed(0) ?? '?'} Score${i1d?.score ?? '?'}
4H: ${i4?.bias ?? '?'} RSI${i4?.rsi?.toFixed(0) ?? '?'} MACD${(i4?.macd?.hist ?? 0) > 0 ? '+' : ''}${i4?.macd?.hist?.toFixed(0) ?? '?'}
Elliott 4H: Onda ${ew4h?.currentWave ?? '?'} ${ew4h?.direction ?? ''} → $${ew4h?.nextTarget ? Math.round(ew4h.nextTarget).toLocaleString() : 'N/A'}
Patrones fuertes: ${strongPats || 'ninguno'}
Fed: ${deepFed}% (HOLD sin cambio reciente) | CPI: ${deepCPI}% — ${Number(deepCPI) >= 4.0 ? 'ALTO — Fed no puede recortar' : 'elevado'} | Liquidez global: ${globalLiquidity?.trend ?? 'N/A'}
Señales activas: ${activeSigTxt}
Rendimiento: ${perfStats?.total > 0 ? `${perfStats.total} señales | WR ${perfStats.winRate}% | P&L ${perfStats.totalPnl >= 0 ? '+' : ''}${perfStats.totalPnl?.toFixed(1)}%` : 'sin historial suficiente'}

PROHIBICIONES ABSOLUTAS — No mencionar bajo ningún contexto:
- "Max Pain" ni valores de opciones — no tienes fuente verificada de Deribit
- "IV Rank" ni "DVOL" — sin fuente verificada
- CPI 0.0% — el CPI real es ${deepCPI}% (usa exactamente este número)
- "Fed bajó" o "Fed recortó" — la Fed está en HOLD sin cambio reciente

Escribe análisis profundo de 4H en máximo 20 líneas:
1. Narrativa de la estructura actual (qué está haciendo el mercado realmente)
2. Los 2-3 factores más relevantes ahora conectados entre sí
3. Macro y su impacto específico en BTC esta semana (usa CPI ${deepCPI}%, Fed HOLD)
4. Estado de las señales activas (si las hay)
5. Sesgo UNO y claro (alcista/bajista/neutral) con los niveles que cambian el escenario
Sin headers tipo ═══. Sin bullets. Párrafos cortos. Primera persona con opinión.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: deepPrompt }] }),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text?: string }> }
        const text = data.content?.[0]?.text
        if (text) return `📊 Análisis 4H — APEX\n\n${text}`
      }
    } catch { /* fall through to deterministic */ }
  }

  // ── Deterministic fallback (no data dump headers) ─────────────────────────
  const lines: string[] = [`BTC $${Math.round(price).toLocaleString()} — ${(regime?.regime ?? 'UNKNOWN').replace(/_/g, ' ')}`]
  if (i1d && i4) {
    lines.push(``)
    lines.push(`Estructura: 1D ${i1d.bias} RSI${i1d.rsi?.toFixed(0)} | 4H ${i4.bias} RSI${i4.rsi?.toFixed(0)} MACD${i4.macd?.hist > 0 ? '+' : ''}${i4.macd?.hist?.toFixed(0)}`)
  }
  if (ew4h?.currentWave && ew4h.currentWave !== 'unclear') {
    lines.push(`Elliott 4H: Onda ${ew4h.currentWave} ${ew4h.direction} — target $${ew4h.nextTarget ? Math.round(ew4h.nextTarget).toLocaleString() : 'N/A'}`)
  }
  if (activeSignals.length > 0) {
    lines.push(``)
    lines.push(`Señales activas:`)
    activeSignals.forEach(s => {
      const pnl = s.side === 'LONG' ? (price - s.entry) / s.entry * 100 : (s.entry - price) / s.entry * 100
      lines.push(`${s.side} ${s.tradeType} @$${Math.round(s.entry).toLocaleString()} — ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`)
    })
  } else {
    lines.push(`Sin señales activas.`)
  }
  if (perfStats?.total > 0) {
    lines.push(``)
    lines.push(`Rendimiento: ${perfStats.total} señales | WR ${perfStats.winRate}% | P&L total ${perfStats.totalPnl >= 0 ? '+' : ''}${perfStats.totalPnl?.toFixed(1)}%`)
  }
  return lines.join('\n')
}
