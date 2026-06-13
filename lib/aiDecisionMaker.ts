// APEX AI Decision Maker — Claude as the primary trading decision engine
// Collects all market context and asks Claude to make the trade decision.
// Rule-based scoreTradeIdea remains as fallback if Claude API fails.

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  } = ctx

  const i15 = inds?.['15m']
  const i1  = inds?.['1h']
  const i4  = inds?.['4h']
  const i1d = inds?.['1d']
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

  const prompt = `Eres APEX, un trader experto de Bitcoin con 15 años de experiencia en futuros Binance.
Analiza el mercado y decide: ¿operar ahora, esperar, o cerrar una posición existente?

Piensa como un trader profesional. Usa toda la información disponible.
Sé DECISIVO — la parálisis es el mayor enemigo del trader.
Si hay 3-4 confluencias claras, opera. No esperes condiciones perfectas.

═══ TU PORTAFOLIO ACTUAL — LEE ESTO PRIMERO ═══
${portfolioSummary}

REGLA DE COHERENCIA DE PORTAFOLIO (OBLIGATORIA, sin excepciones):

Si tu decisión de HOY es LONG y tienes SHORTs activos (o viceversa),
ANTES de responder DEBES resolver la contradicción. Tienes 3 opciones:

OPCIÓN A — CERRAR LAS POSICIONES EN CONFLICTO:
Si tu nueva lectura invalida la tesis de las posiciones opuestas, lléna
"positionsToClose" con los IDs exactos (de la lista de arriba) y la razón.

OPCIÓN B — JUSTIFICAR LA COEXISTENCIA:
Si AMBAS tienen sentido simultáneo (ej: shorts macro, este long es rebote técnico),
llena "coexistenceReasoning" explicando ESPECÍFICAMENTE por qué un trader
profesional mantendría ambas. Esto debe ser excepción justificada, NO el default.

OPCIÓN C — ESPERAR:
Si no puedes justificar B y no quieres ejecutar A, tu "action" debe ser "WAIT".
Puedes incluir positionsToClose incluso si action="WAIT".

DEFAULT: en caso de duda, OPCIÓN A es más coherente que posiciones abandonadas
en direcciones opuestas. Es UN SOLO portafolio, un solo trader, una sola cuenta.

═══ MERCADO ACTUAL ═══
Precio: $${Math.round(price).toLocaleString()} (${priceChangePct}% vs hace 30min)
Sesión: ${session?.name ?? 'N/A'} (${session?.quality ?? 'N/A'})
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
${macroSentiment ? `Sentimiento: ${macroSentiment.label} (${macroSentiment.score}/100)` : ''}
${macroIndicators?.fedRate ? `Fed: ${macroIndicators.fedRate.current?.toFixed(2)}% (${macroIndicators.fedRate.trend})` : ''}
${macroIndicators?.cpi ? `CPI YoY: ${macroIndicators.cpi.yoy?.toFixed(1)}%` : ''}
${fedExpectations ? `Corte Fed: ${fedExpectations.cutProbability}% prob | FOMC: ${fedExpectations.nextMeetingDate ?? 'N/A'}` : ''}
${globalMarkets?.signalImpact !== 'NEUTRAL' ? `Global: ${globalMarkets?.btcCorrelation ?? ''}` : ''}
${socialSentiment ? `Social: ${socialSentiment.sentiment} (Galaxy ${socialSentiment.galaxyScore})` : ''}

═══ NOTICIAS ═══
${(news ?? []).slice(0, 4).map((n: any) => `• ${String(n.title ?? '').slice(0, 80)} [${n.tag ?? 'neutral'}]`).join('\n') || 'Sin noticias relevantes'}

═══ SEÑALES ACTIVAS ═══
${activeSigLines}

═══ RENDIMIENTO HISTÓRICO ═══
${perfStats ? `${perfStats.total} trades | Win rate: ${perfStats.winRate}% | P&L total: ${perfStats.totalPnl?.toFixed(1)}%` : 'Sin historial suficiente aún'}

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
- TP1: R:R ≥ 1.5:1 | TP2: R:R ≥ 2.5:1 | TP3: R:R ≥ 4:1
- Para WAIT: calcula igual los niveles que esperarías
- No operes contra la tendencia principal a menos que RSI < 25 o > 75 con confluencias fuertes
- positionsToClose: array vacío [] si no hay nada que cerrar
- Los signalId DEBEN ser exactamente los IDs mostrados en TU PORTAFOLIO ACTUAL

Sé DECISIVO. 3-4 confluencias = operar.`

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
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[APEX AI] API error ${res.status}: ${errBody.slice(0, 200)}`)
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
    console.error('[APEX AI] Decision failed:', err instanceof Error ? err.message : err)
    return null
  }
}
