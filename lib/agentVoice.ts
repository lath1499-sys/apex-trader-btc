// APEX — Agent Voice / Personality
// Generates conversational market updates that sound like an experienced trader,
// not a data dump. Spanish, direct, opinionated, uses market slang.

/* eslint-disable @typescript-eslint/no-explicit-any */

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

// ── Claude API call for rich, intelligent voice ────────────────────────────
async function callClaudeForUpdate(p: AgentUpdateParams): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const { price, prevPrice, inds, regime, session, activeSignals, opinionChanges,
          mkt, whaleAlert, macroSentiment, macroIndicators, fedExpectations,
          globalMarkets, elliottWaves, fvgs, liquidity, optionsData, news,
          socialSentiment, abcdAnalysis, memory } = p

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
${macroSentiment ? `Sentimiento: ${macroSentiment.label} (${macroSentiment.score}/100)` : ''}
${macroIndicators?.fedRate ? `Fed: ${macroIndicators.fedRate.current?.toFixed(2)}% (${macroIndicators.fedRate.trend})` : ''}
${fedExpectations ? `Fed recorte: ${fedExpectations.cutProbability}% prob` : ''}
${globalMarkets?.signalImpact !== 'NEUTRAL' ? `Global: ${globalMarkets?.btcCorrelation ?? ''}` : ''}
${socialSentiment ? `Social Galaxy Score: ${socialSentiment.galaxyScore} | ${socialSentiment.sentiment}` : ''}

NOTICIAS:
${(news ?? []).slice(0, 3).map((n: any) => `• ${String(n.title ?? '').slice(0, 90)} [${n.tag ?? 'neutral'}]`).join('\n') || '(Sin noticias recientes)'}

SEÑALES ACTIVAS (${activeSignals.length}):
${activeSignals.length > 0
  ? activeSignals.map((s: any) => {
      const isLong  = s.side === 'LONG'
      const pnl     = isLong ? (price - s.entry) / s.entry * 100 : (s.entry - price) / s.entry * 100
      const slDist  = Math.abs(price - s.sl) / s.entry * 100
      const tp1Dist = isLong ? (s.tp1 - price) / price * 100 : (price - s.tp1) / price * 100
      const hrs     = Math.round((Date.now() - new Date(s.createdAt).getTime()) / 3_600_000)
      return `${s.side} ${s.tradeType} @$${Math.round(s.entry).toLocaleString()} | P&L:${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | SL:${slDist.toFixed(1)}% lejos | TP1:${tp1Dist.toFixed(1)}% lejos | TP1hit:${s.tp1Hit ? 'SI' : 'NO'} | ${hrs}h`
    }).join('\n')
  : 'Ninguna'}

${memory?.lastAnalysisAt ? `SESGO ANTERIOR (hace ${Math.round((Date.now() - new Date(memory.lastAnalysisAt).getTime()) / 60_000)} min): ${memory.lastBias}${memory.changeReason ? ` — "${memory.changeReason.slice(0, 150)}"` : ''}
Precio entonces: $${Math.round(memory.lastPrice).toLocaleString()} → ahora $${Math.round(price).toLocaleString()} (${((price - memory.lastPrice) / (memory.lastPrice || price) * 100).toFixed(2)}%)` : ''}
${opinionChanges.length > 0 ? `\nCAMBIOS DETECTADOS:\n${opinionChanges.map((c: string) => `• ${c}`).join('\n')}` : ''}
`

  const prompt = `Eres APEX, un trader senior de Bitcoin con 15 años de experiencia.
Le estás reportando a tu jefe cada 30 minutos. Tu jefe es un trader experimentado
también — no necesita que le expliques qué es el RSI, necesita saber QUÉ PIENSAS
que va a pasar y POR QUÉ.

DATOS CRUDOS (para tu análisis, NO los repitas tal cual):
${rawData}

═══ CÓMO ESCRIBIR TU REPORTE ═══

ESTRUCTURA (4-6 párrafos cortos, máximo 18 líneas total):

1. ACCIÓN DE PRECIO — ¿Qué hizo el precio en los últimos 30 min y qué significa?
   No digas "BTC subió 0.5%". Di algo como "BTC intentó romper $63k pero
   fue rechazado en el FVG bajista — vendedores defendiendo ese nivel otra vez."

2. TU LECTURA DEL MOMENTO — Conecta 2-3 señales en una narrativa.
   No listes RSI+MACD+Stoch por separado. Di algo como:
   "El RSI en sobreventa junto con la liquidez debajo me dice que los bears
   están perdiendo fuerza — esto huele a rebote técnico, no a reversión real."

3. NOTICIAS Y SOCIAL — Solo si hay algo que cambie el panorama. Si no, sáltalo.

4. TUS POSICIONES — Habla de las señales activas como SI FUERAN TUS TRADES.
   Da tu opinión sobre cómo van, no solo el P&L.
   Si algo te preocupa, dilo directamente.

5. TU SESGO Y QUÉ ESPERAS — Sé específico y comprométete con una visión.
   Menciona el nivel clave que cambia todo.

6. LO MÁS IMPORTANTE PARA LAS PRÓXIMAS HORAS — Una frase final, concreta.

═══ REGLAS DE ESTILO ═══

- Habla en PRIMERA PERSONA con skin in the game. USA "creo que", "me preocupa", "me gusta".
- CONECTA datos entre sí — nunca los listes por separado.
- Si algo CONTRADICE tu sesgo anterior, dilo: "Pensaba X pero ahora veo Y, así que..."
- Si NO hay nada importante, dilo brevemente y para: "Sin cambios relevantes. Mismo sesgo."
- EVITA oraciones sueltas de indicadores. Solo menciona los 2-3 MÁS relevantes ahora.
- Máximo 18 líneas. Sé denso, no repetitivo.

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
      console.log(`[APEX Voice] Claude responded — ${text.length} chars`)
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

export function generateDeepAnalysis(
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
  optionsData?:    any,   // IV Rank + Max Pain + PCR
  wfResult?:       any,   // WalkForwardResult
): string {
  const i4  = inds?.['4h']
  const i1d = inds?.['1d']
  const ew4h = elliottWaves?.['4h']
  const ew1d = elliottWaves?.['1d']

  const lines: string[] = [
    '═══ ANÁLISIS PROFUNDO 4H ═══',
    '',
    `BTC $${Math.round(price).toLocaleString()}`,
    `Régimen: ${(regime?.regime ?? 'UNKNOWN').replace(/_/g, ' ')}`,
    `ADX: ${regime?.adx?.toFixed(1) ?? '?'} (${regime?.adxTrend ?? '?'}) | Volatilidad: ${regime?.volatilityPct?.toFixed(2) ?? '?'}%`,
    '',
    'MULTI-TIMEFRAME:',
    i1d ? `1D: ${i1d.bias} | RSI ${i1d.rsi?.toFixed(0)} | Score ${i1d.score}/9` : '1D: sin datos',
    i4  ? `4H: ${i4.bias}  | RSI ${i4.rsi?.toFixed(0)} | MACD ${i4.macd?.hist > 0 ? '+' : ''}${i4.macd?.hist?.toFixed(0)}` : '4H: sin datos',
    '',
  ]

  // Elliott waves
  if (ew4h?.currentWave !== 'unclear') {
    lines.push('ESTRUCTURA ELLIOTT:')
    lines.push(`1D: Onda ${ew1d?.currentWave ?? '?'} ${ew1d?.direction ?? ''}`)
    lines.push(`4H: Onda ${ew4h?.currentWave} ${ew4h?.direction} | Confianza: ${ew4h?.confidence}`)
    if (ew4h?.nextTarget)   lines.push(`Target: $${Math.round(ew4h.nextTarget).toLocaleString()}`)
    if (ew4h?.invalidation) lines.push(`Invalidación: $${Math.round(ew4h.invalidation).toLocaleString()}`)
    lines.push('')
  }

  // Top candle patterns
  const strongPatterns = (patterns ?? [])
    .filter((p: any) => p.pattern?.strength === 3)
    .slice(0, 3)
  if (strongPatterns.length > 0) {
    lines.push('PATRONES VELAS (4H):')
    strongPatterns.forEach((p: any) => {
      lines.push(`• ${p.pattern.name} (${p.confidence}%) — ${p.pattern.tradingAdvice}`)
    })
    lines.push('')
  }

  // Macro
  if (macroIndicators) {
    lines.push('MACRO:')
    lines.push(`Fed: ${macroIndicators.fedRate?.current?.toFixed(2)}% (${macroIndicators.fedRate?.trend})`)
    lines.push(`CPI: ${macroIndicators.cpi?.yoy?.toFixed(1)}% YoY`)
    lines.push(`M2:  ${macroIndicators.m2?.yoyChange?.toFixed(1)}% YoY (${macroIndicators.m2?.trend})`)
    if (fedExpectations) {
      lines.push(`Expectativas Fed: ${fedExpectations.cutProbability}% recorte | ${fedExpectations.holdProbability}% pausa`)
    }
    if (globalLiquidity) {
      lines.push(`Liquidez global: ${globalLiquidity.trend} (${globalLiquidity.liquidityIndex}/100)`)
    }
    lines.push(`Señal macro: ${(macroIndicators.overallSignal ?? '').replace(/_/g, ' ')}`)
    lines.push('')
  }

  // Agent performance
  if (perfStats?.total > 0) {
    lines.push('RENDIMIENTO AGENTE:')
    const pnlSign = (perfStats.totalPnl ?? 0) >= 0 ? '+' : ''
    lines.push(`${perfStats.total} señales | WR ${perfStats.winRate}% | P&L total ${pnlSign}${perfStats.totalPnl?.toFixed(1)}%`)
    if ((weights?.currentStreak ?? 0) > 1) {
      const streakType = weights.streakType === 'win' ? 'wins' : 'losses'
      lines.push(`Racha: ${weights.currentStreak} ${streakType} seguidos`)
    }
    lines.push('')
  }

  // Active signals
  if (activeSignals.length > 0) {
    lines.push(`SEÑALES ACTIVAS (${activeSignals.length}):`)
    activeSignals.forEach(s => {
      const pnl = s.side === 'LONG'
        ? (price - s.entry) / s.entry * 100
        : (s.entry - price) / s.entry * 100
      const pnlStr = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
      lines.push(`${s.side} desde $${Math.round(s.entry).toLocaleString()} — ${pnlStr}`)
    })
  } else {
    lines.push('Sin señales activas.')
  }

  // ── Options + IV Rank ─────────────────────────────────────────────────────
  if (optionsData?.iv) {
    const iv = optionsData.iv
    lines.push('')
    lines.push('VOLATILIDAD IMPLÍCITA (DERIBIT):')
    lines.push(`DVOL: ${iv.currentIV.toFixed(1)}% | IVR: ${iv.ivRank}/100 | IVP: ${iv.ivPercentile}%`)
    lines.push(`Rango 30D: ${iv.min30d.toFixed(0)}–${iv.max30d.toFixed(0)}% | Régimen: ${iv.regime.toUpperCase()}`)
    lines.push(`Señal: ${iv.signal === 'buy_vol' ? 'opciones baratas — favorece comprar volatilidad' : iv.signal === 'sell_vol' ? 'opciones caras — favorece vender volatilidad' : 'IV en rango normal'}`)
    if (optionsData.maxPain) {
      lines.push(`Max Pain: $${Math.round(optionsData.maxPain).toLocaleString()} (${optionsData.maxPainDistance}%) | PCR: ${optionsData.putCallRatio?.toFixed(2)} — ${optionsData.sentiment}`)
    }
  }

  // ── Walk-Forward validation ───────────────────────────────────────────────
  if (wfResult?.isReliable) {
    lines.push('')
    lines.push('WALK-FORWARD (validación señales reales):')
    lines.push(`Grado: ${wfResult.grade} | WR OOS: ${(wfResult.avgTestWR * 100).toFixed(1)}% | PF: ${wfResult.totalTestPF.toFixed(2)}x`)
    lines.push(`Sobreajuste: ${(wfResult.overfitScore * 100).toFixed(1)}% | Consistencia: ${(wfResult.consistency * 100).toFixed(0)}%`)
    if (wfResult.recommendation) lines.push(wfResult.recommendation.split('\n')[0])
  }

  return lines.join('\n')
}
