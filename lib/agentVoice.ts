// APEX — Agent Voice / Personality
// Generates conversational market updates that sound like an experienced trader,
// not a data dump. Spanish, direct, opinionated, uses market slang.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { getMacroSnapshot, formatMacroForPrompt } from './macroData'
import { calcAutoSR } from './indicators'

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

  // A: Price — Kraken (Binance IPs blocked on Vercel)
  let price = 0, change24h = 0
  try {
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', {
      signal: AbortSignal.timeout(6000),
    })
    const d = r.ok
      ? (await r.json() as { result?: Record<string, { c: [string]; o: string }> })
      : null
    const v = Object.values(d?.result ?? {})[0]
    if (v?.c?.[0]) {
      price = parseFloat(v.c[0])
      const open = v.o ? parseFloat(v.o) : 0
      change24h = open > 0 ? ((price - open) / open) * 100 : 0
    }
    console.log('[BRIEF:voice] Price:', price)
  } catch (e: unknown) {
    console.warn('[BRIEF:voice] Price fetch failed:', e instanceof Error ? e.message : String(e))
  }

  // A2: Support/Resistance — real swing-high/low clustering from 4H candles,
  // not left for Claude to improvise. Kraken OHLC (Binance blocked on Vercel).
  let srTxt = ''
  try {
    const r = await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=240', {
      signal: AbortSignal.timeout(8000),
    })
    const d = r.ok ? (await r.json() as { result?: Record<string, unknown[][]> }) : null
    const key = d?.result ? Object.keys(d.result).find(k => k !== 'last') : null
    const candles = key ? (d!.result![key] as Array<[number, string, string, string, string]>) : []
    if (candles.length >= 20) {
      const h = candles.map(k => parseFloat(k[2]))
      const l = candles.map(k => parseFloat(k[3]))
      const c = candles.map(k => parseFloat(k[4]))
      const { res, sup } = calcAutoSR(h, l, c)
      srTxt = `Resistencias (4H, swing highs reales): ${res.map(p => `$${Math.round(p).toLocaleString()}`).join(', ') || 'ninguna cercana'}\n` +
              `Soportes (4H, swing lows reales): ${sup.map(p => `$${Math.round(p).toLocaleString()}`).join(', ') || 'ninguno cercano'}`
      console.log('[BRIEF:voice] S/R:', srTxt.replace(/\n/g, ' | '))
    }
  } catch (e: unknown) {
    console.warn('[BRIEF:voice] S/R fetch failed:', e instanceof Error ? e.message : String(e))
  }

  // B: Macro snapshot
  let macroTxt = ''
  try {
    const macro = await getMacroSnapshot()
    macroTxt    = formatMacroForPrompt(macro)
    console.log('[BRIEF:voice] Macro loaded')
  } catch (e: unknown) {
    console.warn('[BRIEF:voice] Macro failed:', e instanceof Error ? e.message : String(e))
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

  // D: Focus rotation — avoid repeating the same angle as recent briefs
  const hourOfDay    = new Date().getUTCHours()
  const defaultFocus = BRIEF_FOCUSES[Math.floor(hourOfDay / 4) % BRIEF_FOCUSES.length]
  let   focus: typeof BRIEF_FOCUSES[number] = defaultFocus
  if (sb) {
    const { data: recentRows } = await Promise.resolve(
      sb.from('apex_brief_history')
        .select('focus')
        .not('focus', 'is', null)
        .order('created_at', { ascending: false })
        .limit(3),
    ).catch(() => ({ data: null })) as { data: Array<{ focus: string }> | null }
    const recentFocuses = (recentRows ?? []).map(r => r.focus)
    if (recentFocuses.includes(defaultFocus)) {
      const available = BRIEF_FOCUSES.filter(f => !recentFocuses.includes(f))
      if (available.length > 0) focus = available[0]
    }
  }
  console.log('[BRIEF:voice] Focus:', focus)

  // E: Call Claude, then run through the coherence/style validator
  console.log('[BRIEF:voice] Calling Claude...')
  let text = await callClaudeStandalone({ price, change24h, macroTxt, srTxt, activeSignals, focus })
  console.log('[BRIEF:voice] Claude responded:', text.length, 'chars')
  text = await correctBriefIfNeeded(text, activeSignals, price)

  void recordBriefHealth(true, null, Date.now() - startedAt, text, price, focus)
  return { text, price, change24h, activeSignals }
}

async function callClaudeStandalone(ctx: {
  price:         number
  change24h:     number
  macroTxt:      string
  srTxt:         string
  activeSignals: Array<{ side: string; trade_type: string; entry: number; pnl: number }>
  focus:         BriefFocus
}): Promise<string> {
  const { price, change24h, macroTxt, srTxt, activeSignals, focus } = ctx
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
- Mencionar Max Pain o IV Rank sin datos reales
- Decir "Fed bajó" (está en HOLD)
- Contradecir el sesgo de señales activas
- Inventar niveles de soporte/resistencia — usa EXCLUSIVAMENTE los niveles reales que te doy en NIVELES TÉCNICOS abajo, nunca números que no aparezcan ahí
ESTRUCTURA: qué hace el mercado → factor principal → sesgo + niveles exactos, todo en párrafos fluidos`

  const userPrompt = `HORA: ${hourLocal}
BTC PERP: ${priceStr} (${changeStr} 24h)
NIVELES TÉCNICOS (reales, 4H — no inventes otros):\n${srTxt || 'No disponibles esta vez'}
MACRO:\n${macroTxt || 'No disponible'}
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
