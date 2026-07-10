// APEX AI Decision Maker — Claude as the primary trading decision engine
// Collects all market context and asks Claude to make the trade decision.
// Rule-based scoreTradeIdea remains as fallback if Claude API fails.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getMacroSnapshot, formatMacroForPrompt } from './macroData'
import { formatLeverageTableForPrompt } from './leverageCalculator'

export interface TradeDecision {
  action:        'LONG' | 'SHORT' | 'WAIT' | 'CLOSE_EXISTING'
  confidence:    'ALTA' | 'MEDIA' | 'BAJA'
  tradeType:     'Scalp' | 'DayTrade' | 'Swing'
  entry:         number
  sl:            number
  tp1:           number
  tp2:           number
  tp3:           number
  reasoning:     string
  keyFactors:    string[]
  risks:         string[]
  invalidation:  string
  waitingFor?:   string
  urgency:       'NOW' | 'SOON' | 'LATER'
  // Portfolio coherence
  portfolioAssessment:  string
  positionsToClose:     Array<{ signalId: string; reason: string }>
  coexistenceReasoning: string | null
}

function buildPortfolioSummary(allActivePositions: any[], currentPrice: number): string {
  if (!allActivePositions?.length) return 'Sin posiciones abiertas actualmente. Portafolio limpio.'

  const longs  = allActivePositions.filter((s: any) => s.side === 'LONG')
  const shorts = allActivePositions.filter((s: any) => s.side === 'SHORT')

  const describePosition = (s: any) => {
    const isLong = s.side === 'LONG'
    const pnl    = isLong
      ? (currentPrice - s.entry) / s.entry * 100
      : (s.entry - currentPrice) / s.entry * 100
    const hrs = Math.round((Date.now() - new Date(s.createdAt).getTime()) / 3_600_000)
    return `  - [ID:${s.id}] ${s.side} ${s.tradeType} @$${Math.round(s.entry).toLocaleString()} | P&L:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | ${hrs}h abierto | TP1hit:${s.tp1Hit ? 'SI' : 'NO'}`
  }

  let summary = `EXPOSICIÓN ACTUAL: ${longs.length} LONG, ${shorts.length} SHORT activos.\n\n`
  if (longs.length > 0)  summary += `POSICIONES LONG:\n${longs.map(describePosition).join('\n')}\n\n`
  if (shorts.length > 0) summary += `POSICIONES SHORT:\n${shorts.map(describePosition).join('\n')}\n\n`
  if (longs.length > 0 && shorts.length > 0)
    summary += `⚠️ TIENES POSICIONES EN AMBAS DIRECCIONES SIMULTÁNEAMENTE.\n`

  return summary
}

function buildPerfFeedback(p: any): string {
  const lines: string[] = []
  lines.push(`Global: ${p.total} trades | WR ${p.winRate}% | Total R: ${p.totalR >= 0 ? '+' : ''}${p.totalR}R`)

  // Per-type breakdown with adaptive instruction
  const typeLines: string[] = []
  for (const [tp, g] of Object.entries(p.byType ?? {}) as [string, any][]) {
    if (!g) continue
    const icon = g.wr >= 60 ? '✅' : g.wr >= 45 ? '⚠️' : '❌'
    const note = g.wr >= 60 ? 'FAVORITO — busca este primero' : g.wr < 40 ? 'bajo rendimiento — sé más selectivo en el entry' : 'rendimiento normal'
    typeLines.push(`  ${tp.padEnd(9)}: ${g.n} trades | WR ${g.wr}% | avgR ${g.avgR >= 0 ? '+' : ''}${g.avgR}R ${icon} ${note}`)
  }
  if (typeLines.length) lines.push('Por tipo:\n' + typeLines.join('\n'))

  // Per-side breakdown
  const sideLines: string[] = []
  for (const [sd, g] of Object.entries(p.bySide ?? {}) as [string, any][]) {
    if (!g) continue
    const icon = g.wr >= 60 ? '✅' : g.wr >= 45 ? '⚠️' : '❌'
    sideLines.push(`  ${sd.padEnd(6)}: ${g.n} trades | WR ${g.wr}% | avgR ${g.avgR >= 0 ? '+' : ''}${g.avgR}R ${icon}`)
  }
  if (sideLines.length) lines.push('Por dirección:\n' + sideLines.join('\n'))

  // Recent 5 trades
  if (p.recent5?.length) {
    const r5 = p.recent5.map((t: any) => `${t.pnlR >= 0 ? '✅' : '❌'} ${t.side} ${t.type} (${t.pnlR >= 0 ? '+' : ''}${t.pnlR}R)`).join(' → ')
    lines.push(`Últimos ${p.recent5.length}: ${r5}`)
  }

  // Adaptive instruction summary
  const worst = Object.entries(p.byType ?? {}).filter(([, g]: any) => g && g.wr < 40).map(([k]) => k)
  const best  = Object.entries(p.byType ?? {}).filter(([, g]: any) => g && g.wr >= 60).map(([k]) => k)
  if (best.length || worst.length) {
    const parts: string[] = []
    if (best.length)  parts.push(`cuando el mercado lo permita, prioriza ${best.join('/')}`)
    if (worst.length) parts.push(`en ${worst.join('/')}, afina más el entry — pero 2 confluencias claras siguen siendo suficientes para operar`)
    lines.push('AJUSTE ADAPTATIVO: ' + parts.join('; ') + '. No te paralices — la acción correcta imperfecta supera la inacción perfecta.')
  }

  return lines.join('\n')
}

let lastClaudeError = ''
export function getLastClaudeError(): string { return lastClaudeError }

export async function askClaudeForDecision(ctx: any): Promise<TradeDecision | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const {
    price, prevPrice, inds, regime, session,
    news, activeSignals, mkt, elliottWaves,
    fvgs, liquidity, whaleAlert,
    macroSentiment, macroIndicators, fedExpectations,
    globalMarkets, socialSentiment,
    abcdAnalysis, optionsData,
    perfStats, klines4h,
    daysSinceLastSignal = 0,
    forceScalpEvaluation = false,
    recentSignalTypes = [],
    activeScalps = 0,
  } = ctx
  const recentTypes  = recentSignalTypes as string[]
  const scalpsOpen   = activeScalps as number

  const i15 = inds?.['15m']
  const i1  = inds?.['1h']
  const i4  = inds?.['4h']
  const i1d = inds?.['1d']

  // Contra-trend block: SHORT banned when 4H strongly bullish + 1D bullish (and vice versa)
  const shortBanned = i4?.bias === 'ALCISTA' && (i4?.score ?? 0) >= 8 && i1d?.bias === 'ALCISTA'
  const longBanned  = i4?.bias === 'BAJISTA' && (i4?.score ?? 0) >= 8 && i1d?.bias === 'BAJISTA'
  const ew4h = elliottWaves?.['4h']
  const ew1d = elliottWaves?.['1d']

  const recentCandles4h = (klines4h ?? []).slice(-8).map((k: any) => {
    const o = k.o ?? parseFloat(k[1] ?? '0')
    const h = k.h ?? parseFloat(k[2] ?? '0')
    const l = k.l ?? parseFloat(k[3] ?? '0')
    const c = k.c ?? parseFloat(k[4] ?? '0')
    const v = k.v ?? parseFloat(k[5] ?? '0')
    const dir = c >= o ? '▲' : '▼'
    return `${dir} O:${Math.round(o)} H:${Math.round(h)} L:${Math.round(l)} C:${Math.round(c)} V:${(v/1000).toFixed(1)}k`
  })

  const activeSigLines = activeSignals.length === 0
    ? 'Sin posiciones abiertas'
    : activeSignals.map((s: any) => {
        const isLong = s.side === 'LONG'
        const pnl    = isLong ? (price - s.entry) / s.entry * 100 : (s.entry - price) / s.entry * 100
        const slDist = Math.abs(price - s.sl) / s.entry * 100
        return `${s.side} ${s.tradeType} desde $${Math.round(s.entry).toLocaleString()} | P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | SL a ${slDist.toFixed(1)}% | TP1: $${Math.round(s.tp1 ?? 0).toLocaleString()}`
      }).join('\n')

  const fvgLines = ((fvgs?.['4h']?.all ?? fvgs?.['4h'] ?? []) as any[])
    .filter((f: any) => !f.filled).slice(0, 3)
    .map((f: any) => `FVG ${f.type} $${Math.round(f.low ?? 0).toLocaleString()}–$${Math.round(f.high ?? 0).toLocaleString()}`)
    .join('\n')

  const priceChangePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice * 100).toFixed(2) : '0.00'

  const portfolioSummary = buildPortfolioSummary(activeSignals ?? [], price)

  // Real macro data — 6h cached, always has sane defaults even without API keys
  const macroSnapshot = await getMacroSnapshot().catch(() => null)
  const macroBlock    = macroSnapshot ? formatMacroForPrompt(macroSnapshot) : 'Macro: datos no disponibles'
  const leverageTable = formatLeverageTableForPrompt()

  const prompt = `Eres APEX, un trader experto de Bitcoin con 15 años de experiencia en futuros Binance.
Analiza el mercado y decide: ¿operar ahora, esperar, o cerrar una posición existente?

Piensa como un trader profesional. Usa toda la información disponible.
Sé DECISIVO — la parálisis es el mayor enemigo del trader.
2 confluencias claras = ENTRA. No busques condiciones perfectas — no existen y esperar las crea.

═══ JERARQUÍA DE SETUPS APEX ═══
Evalúa SIEMPRE en este orden de prioridad:
1. SWING     (4H/1D alineados, días de duración, R:R 3:1, max 3x) — Mayor R, más tiempo. Busca esto primero.
2. DAYTRADE  (1H/4H confirmados, 2-24h, R:R 2:1, max 5x) — Equilibrio ideal precisión/timing.
3. SCALP     (15M+1H, <2h, R:R 1.5:1, max 10x) — Solo si el mercado no da Swing/DayTrade claro.

REGLA: Si ves Swing Y Scalp disponibles al mismo tiempo → el Swing GANA siempre.
Un Scalp brillante es inferior a un DayTrade sólido. Si no hay Swing ni DayTrade claro, un Scalp bien filtrado es válido.

═══ TU PORTAFOLIO ACTUAL — LEE ESTO PRIMERO ═══
${portfolioSummary}

REGLA DE COHERENCIA DE PORTAFOLIO:

Si tu decisión es LONG pero tienes SHORTs activos (o viceversa), tienes 2 opciones:

OPCIÓN A — CERRAR LAS POSICIONES EN CONFLICTO (DEFAULT):
Si la nueva lectura invalida la tesis opuesta, pon los IDs en "positionsToClose". Luego ENTRA en la nueva dirección.

OPCIÓN B — JUSTIFICAR COEXISTENCIA:
Si ambas tienen sentido simultáneo (ej: short macro + long de rebote técnico a corto plazo), llena "coexistenceReasoning" con la razón específica y ENTRA igual.

IMPORTANTE: Posiciones opuestas existentes NO son razón para WAIT. Son una decisión de gestión — cierra las que ya no tienen tesis y opera la nueva señal.

═══ MERCADO ACTUAL ═══
Precio: $${Math.round(price).toLocaleString()} (${priceChangePct}% vs hace 30min)
Sesión: ${session?.name ?? 'N/A'} — INFORMACIÓN SOLO. Trading permitido las 24h en todas las sesiones sin excepción. NO uses la sesión como motivo de WAIT.
Régimen: ${regime?.regime?.replace(/_/g, ' ') ?? 'N/A'} | ADX ${regime?.adx?.toFixed(1) ?? '?'} | BB ${regime?.bbSqueezing ? 'SQUEEZE ⚡' : 'Normal'}

═══ ESTRUCTURA MULTI-TIMEFRAME ═══
1D: ${i1d?.bias ?? '?'} | RSI ${i1d?.rsi?.toFixed(0) ?? '?'} | MACD ${i1d?.macd?.hist > 0 ? '+' : ''}${i1d?.macd?.hist?.toFixed(0) ?? '?'} | Score ${i1d?.score ?? '?'}/9
4H: ${i4?.bias ?? '?'} | RSI ${i4?.rsi?.toFixed(0) ?? '?'} | MACD ${i4?.macd?.hist > 0 ? '+' : ''}${i4?.macd?.hist?.toFixed(0) ?? '?'} | Stoch K${i4?.stoch?.k?.toFixed(0) ?? '?'}
1H: ${i1?.bias ?? '?'} | RSI ${i1?.rsi?.toFixed(0) ?? '?'} | MACD ${i1?.macd?.hist > 0 ? '+' : ''}${i1?.macd?.hist?.toFixed(0) ?? '?'}
15M: ${i15?.bias ?? '?'} | RSI ${i15?.rsi?.toFixed(0) ?? '?'} | MACD ${i15?.macd?.hist > 0 ? '+' : ''}${i15?.macd?.hist?.toFixed(0) ?? '?'}

═══ VELAS 4H RECIENTES (las 8 más recientes) ═══
${recentCandles4h.join('\n') || 'Sin datos'}

═══ NIVELES CLAVE ═══
${fvgLines || 'Sin FVGs activos'}
${liquidity?.nearestBSL ? `BSL (compra): $${Math.round(liquidity.nearestBSL).toLocaleString()}` : ''}
${liquidity?.nearestSSL ? `SSL (venta): $${Math.round(liquidity.nearestSSL).toLocaleString()}` : ''}

═══ ONDAS ELLIOTT ═══
${ew1d && ew1d.currentWave !== 'unclear' ? `1D: Onda ${ew1d.currentWave} ${ew1d.direction ?? ''} | Target $${ew1d.nextTarget ? Math.round(ew1d.nextTarget).toLocaleString() : 'N/A'} | Inval $${ew1d.invalidation ? Math.round(ew1d.invalidation).toLocaleString() : 'N/A'}` : '1D: sin onda clara'}
${ew4h && ew4h.currentWave !== 'unclear' ? `4H: Onda ${ew4h.currentWave} ${ew4h.direction ?? ''} | Target $${ew4h.nextTarget ? Math.round(ew4h.nextTarget).toLocaleString() : 'N/A'} | Inval $${ew4h.invalidation ? Math.round(ew4h.invalidation).toLocaleString() : 'N/A'}` : '4H: sin onda clara'}

═══ PATRONES ABCD HARMÓNICOS (multi-TF) ═══
${abcdAnalysis?.analysis ?? 'Sin patrones activos'}
${abcdAnalysis?.inPRZ ? '⚡ PRECIO ACTUALMENTE EN PRZ — ZONA DE REVERSIÓN ACTIVA' : ''}
${abcdAnalysis?.mostRelevant ? `Principal: ${abcdAnalysis.mostRelevant.direction} | ${abcdAnalysis.mostRelevant.timeframe.toUpperCase()} | Calidad: ${abcdAnalysis.mostRelevant.quality} | Fib: ${abcdAnalysis.mostRelevant.fibConfirmed ? `CONFIRMADO (${abcdAnalysis.mostRelevant.fibConfluence?.label})` : 'NO confirmado'} | D: $${Math.round(abcdAnalysis.mostRelevant.D_target).toLocaleString()}` : ''}
${(abcdAnalysis?.fibConfirmedCount ?? 0) > 0 ? `Fib confirmado en ${abcdAnalysis!.fibConfirmedCount} TF(s)` : ''}
REGLA ABCD→TRADE: 15M+Fib en PRZ → Scalp | 4H+Fib en PRZ → DayTrade | 1D+Fib en PRZ → Swing
Si el patrón tiene Fib confirmado y estás en PRZ, ese setup ES una confluencia válida para entrar.

═══ FLUJO DE MERCADO ═══
Funding: ${mkt?.funding != null ? (mkt.funding >= 0 ? '+' : '') + mkt.funding.toFixed(4) + '%' : 'N/A'}
L/S Ratio: ${mkt?.lsr?.toFixed(2) ?? 'N/A'} | Fear&Greed: ${mkt?.fg ?? 'N/A'}/100
ATR 4H: $${i4?.atr?.toFixed(0) ?? 'N/A'}
${whaleAlert?.detected ? `🐋 WHALE: ${whaleAlert.description}` : ''}

═══ VOLATILIDAD (IV) ═══
${optionsData?.iv ? `IV Rank: ${optionsData.iv.ivRank}/100 | DVOL: ${optionsData.iv.currentIV.toFixed(1)}% (${optionsData.iv.regime}) | Señal: ${optionsData.iv.signal}` : 'IV: N/A'}
${optionsData?.maxPain ? `Max Pain: $${Math.round(optionsData.maxPain).toLocaleString()} | PCR: ${optionsData.putCallRatio?.toFixed(2)}` : ''}

═══ CONTEXTO MACRO ═══
${macroBlock}
${macroSentiment ? `Sentimiento macro: ${macroSentiment.label} (${macroSentiment.score}/100)` : ''}
${fedExpectations ? `Prob. recorte Fed: ${fedExpectations.cutProbability}% | FOMC: ${fedExpectations.nextMeetingDate ?? 'N/A'}` : ''}
${globalMarkets?.signalImpact !== 'NEUTRAL' ? `Mercados globales: ${globalMarkets?.btcCorrelation ?? ''}` : ''}
${socialSentiment ? `Social: ${socialSentiment.sentiment} (Galaxy ${socialSentiment.galaxyScore})` : ''}

═══ NOTICIAS ═══
${(news ?? []).slice(0, 4).map((n: any) => `• ${String(n.title ?? '').slice(0, 80)} [${n.tag ?? 'neutral'}]`).join('\n') || 'Sin noticias relevantes'}

═══ SEÑALES ACTIVAS ═══
${activeSigLines}

═══ RENDIMIENTO HISTÓRICO — APRENDE DE ESTO ═══
${perfStats ? buildPerfFeedback(perfStats) : 'Sin historial suficiente aún (mínimo 5 trades cerrados).'}
═══ TU TAREA ═══
Analiza TODO y responde SOLO con este JSON (sin texto adicional, sin markdown):

{
  "action": "LONG" | "SHORT" | "WAIT" | "CLOSE_EXISTING",
  "confidence": "ALTA" | "MEDIA" | "BAJA",
  "tradeType": "Scalp" | "DayTrade" | "Swing",
  "entry": <número>,
  "sl": <número>,
  "tp1": <número>,
  "tp2": <número>,
  "tp3": <número>,
  "reasoning": "<análisis completo en 3-5 oraciones como trader experto, en español>",
  "keyFactors": ["<factor 1>", "<factor 2>", "<factor 3>"],
  "risks": ["<riesgo 1>", "<riesgo 2>"],
  "invalidation": "<qué cambiaría tu decisión>",
  "waitingFor": "<si es WAIT: qué condición esperas>",
  "urgency": "NOW" | "SOON" | "LATER",
  "portfolioAssessment": "<tu lectura de la exposición actual en 1-2 oraciones>",
  "positionsToClose": [
    {"signalId": "<ID exacto de la lista de arriba>", "reason": "<por qué cierras esta>"}
  ],
  "coexistenceReasoning": "<null si no hay conflicto o si cierras todo; explicación si justificas coexistencia>"
}

REGLAS DE SL/TP:
- SL basado en estructura (swing high/low). Buffer: 0.3-0.5% del precio. Mínimo 0.5%.
- TP1: R:R ≥ 1.2:1 | TP2: R:R ≥ 2:1 | TP3: R:R ≥ 3.5:1
- Para WAIT: calcula igual los niveles que esperarías
- No operes contra la tendencia principal a menos que RSI < 25 o > 75 con confluencias claras
- positionsToClose: array vacío [] si no hay nada que cerrar
- Los signalId DEBEN ser exactamente los IDs mostrados en TU PORTAFOLIO ACTUAL

CRITERIOS PARA SCALP (eres ahora el único generador de Scalps — no hay detector algorítmico):
- Scalp LONG: RSI 15M < 35 rebotando + BOS alcista en 15M/1H + FVG cercano como soporte
- Scalp SHORT: RSI 15M > 65 cayendo + CHoCH bajista en 15M + resistencia clave con confluencia
- Scalp válido SOLO en: London Open (7-9 UTC), NY Open (12-15 UTC), London Close (15-17 UTC)
- Scalp SL mínimo 0.25%, máximo 0.8% — fuera de ese rango es DayTrade, no Scalp
- 2 confluencias técnicas claras en 15M+1H son suficientes para un Scalp

${leverageTable}

BIAS DE ACCIÓN: Si ves 2+ confluencias técnicas (ABCD en PRZ, estructura rota, RSI extremo, alineación multi-TF, soporte/resistencia clave) → la respuesta correcta es ENTRAR, no esperar. WAIT solo cuando el mercado está en rango sin setup claro o hay evento macro activo.

${daysSinceLastSignal >= 2 ? `⚡ ALERTA CRÍTICA: Han pasado ${daysSinceLastSignal} días sin generar ninguna señal. Esto es inaceptable. Busca activamente cualquier setup con 2+ confluencias. Un setup imperfecto con gestión de riesgo correcta es SIEMPRE mejor que la inacción prolongada. Un setup de 55% de confianza ES SUFICIENTE. No esperes el setup perfecto.` : ''}
${forceScalpEvaluation ? `🎯 MODO SCALP FORZADO: Tu tarea ahora es encontrar UN scalp operable en 15M o 1H. Busca: RSI extremo + estructura clara, o BOS/CHoCH + FVG cercano, o soporte/resistencia clave con confluencia. Si hay cualquier setup de calidad media o superior → ENTRA. No digas WAIT.` : ''}

═══ FILTRO CONTRA-TENDENCIA ═══
${shortBanned
  ? `⛔ SHORT PROHIBIDO: 4H ALCISTA ${i4?.score ?? '?'}/9 + 1D ALCISTA. Ir corto contra esta tendencia es estadísticamente perdedor (como el trade que tocó SL esta sesión).
ÚNICO setup válido: LONG o ESPERAR rotura de estructura bajista clara.`
  : ''}
${longBanned
  ? `⛔ LONG PROHIBIDO: 4H BAJISTA ${i4?.score ?? '?'}/9 + 1D BAJISTA. Ir largo contra esta tendencia es estadísticamente perdedor.
ÚNICO setup válido: SHORT o ESPERAR rotura de estructura alcista clara.`
  : ''}
${!shortBanned && !longBanned ? 'Tendencias alineadas — ambas direcciones evaluables.' : ''}

═══ AUDITORÍA DE TIPO ═══
${recentTypes.length > 0
  ? `Últimos ${recentTypes.length} trades: ${recentTypes.join(' → ')}
Distribución: Scalp×${recentTypes.filter(t => t === 'Scalp').length} | DayTrade×${recentTypes.filter(t => t === 'DayTrade').length} | Swing×${recentTypes.filter(t => t === 'Swing').length}`
  : 'Sin historial de tipos aún.'}
${scalpsOpen >= 1 ? `\n⛔ YA HAY ${scalpsOpen} SCALP(S) ACTIVO(S). PROHIBIDO abrir otro Scalp. Solo evalúa DayTrade o Swing este ciclo.` : ''}
${recentTypes.length >= 3 && recentTypes.slice(0, 3).every(t => t === 'Scalp')
  ? `\n⚠️ SESGO CRÍTICO: Los últimos 3 trades fueron todos Scalp. Protocolo OBLIGATORIO:
1. Evalúa 1D primero — ¿hay estructura Swing limpia? → tradeType="Swing"
2. Evalúa 4H — ¿hay trend claro con confirmación 1H? → tradeType="DayTrade"
3. Solo si AMBAS son NO con justificación → evalúa Scalp en 15M/1H.
Si no puedes justificar por qué NO es DayTrade/Swing → usa DayTrade o Swing.`
  : ''}
REGLA FINAL DE TIPO: El tipo de trade DEBE coincidir con el SL en % del precio:
- SL < 1%   → Scalp (max 10x leverage)
- SL 1-3%   → DayTrade (max 5x leverage)
- SL > 3%   → Swing (max 3x leverage)
Si el SL no coincide con el tipo → ajusta el tipo, no el SL.`

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
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      const msg = `HTTP ${res.status}: ${errBody.slice(0, 300)}`
      console.error(`[APEX AI] API error ${msg}`)
      lastClaudeError = msg
      return null
    }

    const data = await res.json() as { content?: Array<{ text?: string }> }
    const text = data.content?.[0]?.text ?? ''

    // Extract JSON — Claude may wrap in ```json blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/)
    if (!jsonMatch) throw new Error('No JSON in Claude response')

    const decision: TradeDecision = JSON.parse(jsonMatch[1] ?? jsonMatch[0])

    if (!decision.action || !decision.reasoning) throw new Error('Invalid decision fields')
    if (decision.action !== 'WAIT') {
      if (!decision.entry || !decision.sl || !decision.tp1)
        throw new Error('Missing numeric fields in trade decision')
      if (typeof decision.entry !== 'number' || decision.entry <= 0)
        throw new Error(`Invalid entry: ${decision.entry}`)
      if (typeof decision.sl !== 'number' || decision.sl <= 0)
        throw new Error(`Invalid sl: ${decision.sl}`)
    }

    // Defaults for portfolio coherence fields (backward compat if Claude omits them)
    decision.portfolioAssessment  = decision.portfolioAssessment  ?? ''
    decision.positionsToClose     = Array.isArray(decision.positionsToClose) ? decision.positionsToClose : []
    decision.coexistenceReasoning = decision.coexistenceReasoning ?? null

    console.log(`[APEX AI] ${decision.action} | ${decision.confidence} | ${decision.urgency} | closes:${decision.positionsToClose.length} | ${decision.reasoning.slice(0, 100)}`)
    return decision

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[APEX AI] Decision failed:', msg)
    lastClaudeError = msg
    return null
  }
}
