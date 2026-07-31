// APEX — Agent Voice / Personality
// Generates conversational market updates that sound like an experienced trader,
// not a data dump. Spanish, direct, opinionated, uses market slang.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { getMacroSnapshot, formatMacroForPrompt } from './macroData'
import { calcAutoSR, runInds } from './indicators'
import { fetchMarketData } from './marketFetch'
import { detectMarketRegime } from './marketRegime'
import { detectFVGs } from './fvg'
import { detectLiquidity } from './liquidity'
import { detectElliottWaves } from './elliottWaves'
import { analyzeAllABCD } from './harmonicPatterns'
import { fetchMacroIndicators, fetchFedExpectations } from './macroEconomics'
import { fetchGlobalMarkets } from './marketCorrelation'
import { fetchSocialSentiment } from './socialSentiment'
import { fetchWhaleAlert } from './whaleDetector'
import { fetchOptionsData } from './deribitFetch'
import type { Kline } from './types'

function toKlines(arr: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> | undefined): Kline[] {
  return (arr ?? []).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }))
}

// Fix 5: cached singleton — same pattern as getSupabaseServer() in supabase.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _voiceSb: any = null
function getVoiceSb() {
  if (_voiceSb) return _voiceSb
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  _voiceSb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return _voiceSb
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

type BriefSignal = { side: string; trade_type: string; entry: number; pnl: number }

// ─────────────────────────────────────────────────────────────────────────────
// Brief coherence + style validator — catches "no trade" when signals exist,
// bias/signal mismatch, and formatting violations (bullets, duplicate header,
// fabricated "next analysis" promises). Regenerates via Claude only if a real
// violation is found — zero extra cost on the normal path.
// ─────────────────────────────────────────────────────────────────────────────

const NO_TRADE_PATTERNS = [
  /no tengo señales activas/i,
  /no voy a forzar/i,
  /no hay trade/i,
  /no voy a operar/i,
  /manos en los bolsillos/i,
  /sin señales? abiertas/i,
  /no hay señal/i,
  /sin señ(a|o)les activas/i,
  /capital libre/i,
  /el sistema guarda silencio/i,
]

async function correctBriefIfNeeded(
  text:          string,
  activeSignals: BriefSignal[],
  price:         number,
): Promise<string> {
  const issues: string[] = []

  if (activeSignals.length > 0) {
    const noTradeHits = NO_TRADE_PATTERNS.filter(re => re.test(text))
    if (noTradeHits.length > 0) {
      const sigSummary = activeSignals.map(s => `${s.side} ${s.trade_type} @$${Math.round(s.entry).toLocaleString()}`).join(', ')
      issues.push(`Dice "no hay trade/señal" pero SÍ hay: ${sigSummary}`)
    }

    const hasBullBias = /sesgo.*alcista|alcista.*sesgo|bias.*alcista|inclinación.*alcista/i.test(text)
    const hasBearBias = /sesgo.*bajista|bajista.*sesgo|bias.*bajista|inclinación.*bajista/i.test(text)
    const hasShort    = activeSignals.some(s => s.side === 'SHORT')
    const hasLong     = activeSignals.some(s => s.side === 'LONG')

    if (hasBullBias && !hasBearBias && hasShort) {
      const sig = activeSignals.find(s => s.side === 'SHORT')
      issues.push(`Sesgo ALCISTA pero hay SHORT activo @$${Math.round(sig?.entry ?? 0).toLocaleString()}. Debe ser bajista o neutral.`)
    }
    if (hasBearBias && !hasBullBias && hasLong) {
      const sig = activeSignals.find(s => s.side === 'LONG')
      issues.push(`Sesgo BAJISTA pero hay LONG activo @$${Math.round(sig?.entry ?? 0).toLocaleString()}. Debe ser alcista o neutral.`)
    }
  }

  if (/próximo análisis|next analysis|próxima actualización/i.test(text)) {
    issues.push('Promete un "próximo análisis" con hora — el sistema no programa seguimientos, esa línea no es real. Eliminarla.')
  }
  if (/^\s*[-•*]\s/m.test(text)) {
    issues.push('Usa bullets/viñetas — el estilo es prosa en párrafos, sin listas.')
  }
  if (/^\s*\*?\*?APEX\s*[—-]/mi.test(text)) {
    issues.push('Repite un header "APEX — ..." que Telegram ya agrega por fuera — no debe estar en el texto del análisis.')
  }

  if (issues.length === 0) return text

  console.warn('[BRIEF VALIDATOR] Issues found — regenerating:', issues)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return text

  const signalContext = activeSignals.length > 0
    ? activeSignals.map(s => {
        const pnl = s.side === 'LONG' ? (price - s.entry) / s.entry * 100 : (s.entry - price) / s.entry * 100
        return `• ${s.side} ${s.trade_type} @$${Math.round(s.entry).toLocaleString()} | P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
      }).join('\n')
    : 'NINGUNA — capital libre'

  const correctionPrompt = `El análisis tiene errores que debes corregir:

ANÁLISIS ORIGINAL:
${text}

PROBLEMAS DETECTADOS:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

SEÑALES REALMENTE ABIERTAS AHORA:
${signalContext}

REESCRIBE el análisis completo corrigiendo exactamente esos puntos.
REGLAS ABSOLUTAS:
- Prosa en párrafos cortos, CERO bullets/listas/viñetas
- NO repitas un header "APEX — ..." — el mensaje ya lo trae por fuera
- NO menciones "próximo análisis" ni ninguna hora de seguimiento
- SHORT activo = sesgo bajista o neutral SOLAMENTE
- LONG activo  = sesgo alcista o neutral SOLAMENTE
- NUNCA "no hay trade" cuando hay señales abiertas
- Mantén el mismo enfoque y longitud del original`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        messages: [{ role: 'user', content: correctionPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const data = await res.json() as { content?: Array<{ text?: string }> }
      const corrected = data.content?.[0]?.text
      if (corrected) {
        console.log('[BRIEF VALIDATOR] Brief corrected successfully')
        return corrected
      }
    }
  } catch (err) {
    console.error('[BRIEF VALIDATOR] Correction failed:', err instanceof Error ? err.message : err)
  }
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief health tracking — persisted to apex_brief_history for /briefstatus
// and the AgentHealthCard dashboard.
// ─────────────────────────────────────────────────────────────────────────────

async function recordBriefHealth(
  success:    boolean,
  errorMsg:   string | null,
  durationMs: number,
  briefText?: string,
  price?:     number,
  focus?:     string,
): Promise<void> {
  const sb = getVoiceSb()
  if (!sb) return
  const priceTag = price ? `$${Math.round(price).toLocaleString()} — ` : ''
  const { error } = await Promise.resolve(sb.from('apex_brief_history').insert({
    focus:       focus ?? 'GENERAL',
    summary:     success ? `${priceTag}${briefText?.slice(0, 280) ?? 'ok'}` : (errorMsg?.slice(0, 200) ?? 'error'),
    success,
    error_msg:   errorMsg?.slice(0, 200) ?? null,
    duration_ms: durationMs,
    created_at:  new Date().toISOString(),
  }))
  if (error) {
    console.error('[BRIEF] Failed to save history:', (error as { message?: string }).message ?? error)
  } else {
    console.log('[BRIEF] History saved to apex_brief_history ✅')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone brief — self-contained, used by /api/agent/brief dedicated endpoint.
// This is the ONLY brief-generation path in the app — both the scheduled cron
// job and Telegram's /briefnow call /api/agent/brief, which calls this function.
// Do not add a second one; route any new brief trigger through this.
// ─────────────────────────────────────────────────────────────────────────────

export interface StandaloneBriefResult {
  text:          string
  price:         number
  change24h:     number
  activeSignals: Array<{ side: string; trade_type: string; entry: number }>
}

export async function generateBriefStandalone(): Promise<StandaloneBriefResult> {
  const startedAt = Date.now()
  console.log('[BRIEF:voice] Starting standalone brief...')

  // A: Full market data — price + klines all TFs (Binance→Bybit→Kraken fallback)
  let price = 0, change24h = 0
  let taTxt = ''
  try {
    const md = await fetchMarketData()
    price     = md.price ?? md.bybitPrice ?? md.krakenPrice ?? 0
    change24h = md.change ?? 0

    const klines = {
      '1d':  toKlines(md.klines['1d']),
      '4h':  toKlines(md.klines['4h']),
      '1h':  toKlines(md.klines['1h']),
      '15m': toKlines(md.klines['15m']),
    }

    if (klines['4h'].length >= 20) {
      const i1d = klines['1d'].length  ? runInds(klines['1d'])  : null
      const i4h = runInds(klines['4h'])
      const i1h = klines['1h'].length  ? runInds(klines['1h'])  : null
      const i15 = klines['15m'].length ? runInds(klines['15m']) : null
      const regime    = detectMarketRegime(klines['4h'])
      const fvg4h     = detectFVGs(klines['4h'])
      const liquidity = detectLiquidity(klines['4h'])
      const ew4h      = detectElliottWaves(klines['4h'])
      const ew1d      = klines['1d'].length >= 20 ? detectElliottWaves(klines['1d']) : null
      const abcd      = analyzeAllABCD(
        { '15m': klines['15m'], '1h': klines['1h'], '4h': klines['4h'], '1d': klines['1d'] },
        price,
      )
      const { res, sup } = calcAutoSR(
        klines['4h'].map(k => k.h), klines['4h'].map(k => k.l), klines['4h'].map(k => k.c),
      )

      const lines: string[] = []
      lines.push(`Régimen 4H: ${regime.regime.replace(/_/g, ' ')} (ADX ${regime.adx.toFixed(1)})`)
      if (i1d) lines.push(`1D: ${i1d.bias} RSI${i1d.rsi.toFixed(0)}`)
      if (i4h) lines.push(`4H: ${i4h.bias} RSI${i4h.rsi.toFixed(0)} MACD${i4h.macd.hist > 0 ? '+' : ''}${i4h.macd.hist.toFixed(0)}`)
      if (i1h) lines.push(`1H: ${i1h.bias} RSI${i1h.rsi.toFixed(0)}`)
      if (i15) lines.push(`15M: ${i15.bias} RSI${i15.rsi.toFixed(0)}`)
      if (ew4h.currentWave !== 'unclear') lines.push(`Elliott 4H: Onda ${ew4h.currentWave} ${ew4h.direction ?? ''} → target $${ew4h.nextTarget ? Math.round(ew4h.nextTarget).toLocaleString() : 'N/A'}`)
      if (ew1d && ew1d.currentWave !== 'unclear') lines.push(`Elliott 1D: Onda ${ew1d.currentWave} ${ew1d.direction ?? ''}`)
      if ((fvg4h.all?.length ?? 0) > 0) lines.push(`FVGs 4H activos: ${fvg4h.all.length}`)
      if (liquidity.nearestBSL) lines.push(`Liquidez compra (BSL): $${Math.round(liquidity.nearestBSL).toLocaleString()}`)
      if (liquidity.nearestSSL) lines.push(`Liquidez venta (SSL): $${Math.round(liquidity.nearestSSL).toLocaleString()}`)
      if (abcd.tradingSignal && abcd.tradingSignal !== 'NONE') lines.push(`Patrón ABCD: ${abcd.tradingSignal} (fuerza ${abcd.signalStrength})`)
      lines.push(`Resistencias (4H, swing highs reales): ${res.map(p => `$${Math.round(p).toLocaleString()}`).join(', ') || 'ninguna cercana'}`)
      lines.push(`Soportes (4H, swing lows reales): ${sup.map(p => `$${Math.round(p).toLocaleString()}`).join(', ') || 'ninguno cercano'}`)
      taTxt = lines.join('\n')
    }
    console.log('[BRIEF:voice] Price:', price, '| TA:', taTxt ? taTxt.replace(/\n/g, ' | ') : '(none)')
  } catch (e: unknown) {
    console.warn('[BRIEF:voice] Market data fetch failed:', e instanceof Error ? e.message : String(e))
  }

  // B: Macro snapshot + extended context — Fed expectations, global markets,
  // social sentiment, whale alerts, options/IV. All parallel, all optional.
  let macroTxt = ''
  let extraTxt = ''
  try {
    const macro = await getMacroSnapshot()
    macroTxt    = formatMacroForPrompt(macro)
    console.log('[BRIEF:voice] Macro loaded')

    const [macroIndicators, globalMarkets, socialSentiment, whaleAlert, optionsData] = await Promise.all([
      fetchMacroIndicators().catch(() => null),
      fetchGlobalMarkets().catch(() => null),
      fetchSocialSentiment().catch(() => null),
      fetchWhaleAlert().catch(() => null),
      fetchOptionsData().catch(() => null),
    ])
    const fedExpectations = macroIndicators?.fedRate?.current
      ? await fetchFedExpectations(macroIndicators.fedRate.current).catch(() => null)
      : null

    const extraLines: string[] = []
    if (fedExpectations) extraLines.push(`Prob. recorte Fed: ${fedExpectations.cutProbability}% | FOMC: ${fedExpectations.nextMeetingDate ?? 'N/A'}`)
    if (globalMarkets && globalMarkets.signalImpact !== 'NEUTRAL') extraLines.push(`Mercados globales: ${globalMarkets.btcCorrelation ?? ''}`)
    if (socialSentiment) extraLines.push(`Social: ${socialSentiment.signal} (Galaxy ${socialSentiment.galaxyScore})`)
    if (whaleAlert?.detected) extraLines.push(`🐋 Whale: ${whaleAlert.description}`)
    if (optionsData?.iv) extraLines.push(`IV Rank: ${optionsData.iv.ivRank}/100 (${optionsData.iv.regime})`)
    extraTxt = extraLines.join('\n')
    console.log('[BRIEF:voice] Extended context lines:', extraLines.length)
  } catch (e: unknown) {
    console.warn('[BRIEF:voice] Macro/extended context failed:', e instanceof Error ? e.message : String(e))
  }

  // C: Active signals
  const sb = getVoiceSb()
  type SigRow = { side: string | null; trade_type: string | null; entry: number | null; pnl: number | null }
  let rawSignals: SigRow[] = []
  if (sb) {
    try {
      const { data, error } = await Promise.resolve(
        sb.from('apex_signals')
          .select('side, trade_type, entry, pnl')
          .in('status', ['active', 'tp1_hit', 'tp2_hit'])
          .order('created_at', { ascending: false })
      ) as { data: SigRow[] | null; error: { message: string } | null }
      if (error) console.error('[BRIEF:voice] Signals query error:', error.message)
      rawSignals = data ?? []
      console.log('[BRIEF:voice] Active signals going into prompt:', JSON.stringify(rawSignals))
    } catch (e: unknown) {
      console.warn('[BRIEF:voice] Signals query failed:', e instanceof Error ? e.message : String(e))
    }
  }

  const activeSignals = rawSignals.map(s => ({
    side:       s.side       ?? 'LONG',
    trade_type: s.trade_type ?? 'Scalp',
    entry:      s.entry      ?? 0,
    pnl:        s.pnl ?? 0,
  }))

  // D: Focus rotation — avoid repeating the same angle as recent briefs.
  // Also grab recent OPENINGS (first ~90 chars of each summary, price prefix
  // stripped) so the model has concrete recent phrasing to not reuse — focus
  // rotation alone only varies the topic, not the opening rhetorical device.
  const hourOfDay    = new Date().getUTCHours()
  const defaultFocus = BRIEF_FOCUSES[Math.floor(hourOfDay / 4) % BRIEF_FOCUSES.length]
  let   focus: typeof BRIEF_FOCUSES[number] = defaultFocus
  let   recentOpenings = ''
  if (sb) {
    const { data: recentRows } = await Promise.resolve(
      sb.from('apex_brief_history')
        .select('focus, summary')
        .not('focus', 'is', null)
        .neq('focus', 'DECIDE_LOG')
        .order('created_at', { ascending: false })
        .limit(3),
    ).catch(() => ({ data: null })) as { data: Array<{ focus: string; summary: string | null }> | null }
    const recentFocuses = (recentRows ?? []).map(r => r.focus)
    if (recentFocuses.includes(defaultFocus)) {
      const available = BRIEF_FOCUSES.filter(f => !recentFocuses.includes(f))
      if (available.length > 0) focus = available[0]
    }
    recentOpenings = (recentRows ?? [])
      .map(r => r.summary?.replace(/^\$[\d,]+\s*—\s*/, '').slice(0, 90))
      .filter(Boolean)
      .map((s, i) => `${i + 1}. "${s}..."`)
      .join('\n')
  }
  console.log('[BRIEF:voice] Focus:', focus, '| recent openings:', recentOpenings ? recentOpenings.split('\n').length : 0)

  // E: Call Claude, then run through the coherence/style validator
  console.log('[BRIEF:voice] Calling Claude...')
  let text = await callClaudeStandalone({ price, change24h, macroTxt, taTxt, extraTxt, recentOpenings, activeSignals, focus })
  console.log('[BRIEF:voice] Claude responded:', text.length, 'chars')
  text = await correctBriefIfNeeded(text, activeSignals, price)

  void recordBriefHealth(true, null, Date.now() - startedAt, text, price, focus)
  return { text, price, change24h, activeSignals }
}

async function callClaudeStandalone(ctx: {
  price:          number
  change24h:      number
  macroTxt:       string
  taTxt:          string
  extraTxt:       string
  recentOpenings: string
  activeSignals:  Array<{ side: string; trade_type: string; entry: number; pnl: number }>
  focus:          BriefFocus
}): Promise<string> {
  const { price, change24h, macroTxt, taTxt, extraTxt, recentOpenings, activeSignals, focus } = ctx
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const priceStr  = `$${Math.round(price).toLocaleString()}`
  const changeStr = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`
  const hourLocal = new Date().toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit',
  })
  const signalTxt = activeSignals.length === 0
    ? 'NINGUNA — capital libre'
    : activeSignals.map(s =>
        `${s.side} ${s.trade_type} @ $${Math.round(s.entry).toLocaleString()} | P&L: ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}%`
      ).join('\n')

  const systemPrompt = `Eres APEX, agente de trading BTC con 15 años de experiencia en futuros Binance.
Mandas análisis de mercado cada 30 minutos en español. Estilo: directo, primera persona, trader profesional.
Máximo 200 palabras. Párrafos cortos en prosa narrativa. Siempre opinionado.
ENFOQUE: ${focus.replace(/_/g, ' ')}
PROHIBIDO:
- Bullets, viñetas o listas con "-" — todo en prosa, nunca en formato de lista
- Repetir un header tipo "APEX — ..." — Telegram ya agrega esa línea por fuera, no la dupliques
- Prometer un "próximo análisis" con hora — no controlas el cron del sistema, esa promesa no es real
- Mencionar Max Pain, IV Rank, ondas Elliott o patrones ABCD si NO aparecen en ANÁLISIS TÉCNICO/CONTEXTO EXTRA abajo — si aparecen ahí, son datos reales y puedes citarlos
- Decir "Fed bajó" (está en HOLD)
- Contradecir el sesgo de señales activas
- Inventar niveles de soporte/resistencia, RSI, MACD, régimen u ondas Elliott — usa EXCLUSIVAMENTE los datos reales en ANÁLISIS TÉCNICO abajo, nunca números que no aparezcan ahí
- Citar cifras específicas que no estén en los datos de abajo (volumen de ETF, comparaciones históricas tipo "mínimo desde X fecha", estadísticas puntuales) — si no está en ANÁLISIS TÉCNICO, MACRO, CONTEXTO EXTRA o SEÑALES ACTIVAS, no lo afirmes como dato concreto
- Reutilizar la apertura o estructura retórica de los últimos briefs (abajo en APERTURAS RECIENTES) — variar SIEMPRE la primera frase y el ángulo de entrada, aunque el precio y los datos técnicos sean parecidos a los del último ciclo
ESTRUCTURA: qué hace el mercado → factor principal → sesgo + niveles exactos, todo en párrafos fluidos`

  const userPrompt = `HORA: ${hourLocal}
BTC PERP: ${priceStr} (${changeStr} 24h)
APERTURAS RECIENTES (NO repitas esta fórmula ni frases parecidas):\n${recentOpenings || 'Sin briefs recientes'}
ANÁLISIS TÉCNICO (real, multi-timeframe — no inventes otros datos):\n${taTxt || 'No disponible esta vez'}
MACRO:\n${macroTxt || 'No disponible'}
CONTEXTO EXTRA (Fed, mercados globales, social, whale, opciones — solo si hay datos):\n${extraTxt || 'Sin datos adicionales'}
SEÑALES ACTIVAS:\n${signalTxt}
Escribe el análisis enfocado en ${focus.replace(/_/g, ' ')}.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json() as { content?: Array<{ text: string }>; error?: { message: string } }
  if (data.error) throw new Error(`Claude: ${data.error.message ?? 'unknown'}`)
  return data.content?.[0]?.text ?? ''
}
