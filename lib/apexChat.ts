// APEX — Free-form Telegram chat with full market context.
// Any non-command message is processed here and answered by Claude.
// History is in-memory per chatId (resets on cold start); also persisted to Supabase.

import { createClient }                           from '@supabase/supabase-js'
import { getCapitalState, DEFAULT_CAPITAL_CONFIG } from '@/lib/capitalManager'
import { getMacroSnapshot }                        from '@/lib/macroData'
import { fetchBTCNews, formatNewsForPrompt }       from '@/lib/newsFetcher'
import { getLiveSignalStates }                     from '@/lib/liveSignal'
import type { RawSignalRow }                       from '@/lib/liveSignal'

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

export type ChatActionType = 'PAUSE' | 'RESUME' | 'CLOSE_ALL' | 'MOVE_SL' | 'NONE'

interface ActionPayload {
  type:      ChatActionType
  newSL?:    number
  signalId?: string
}

export interface ChatResponse {
  text:        string
  action:      ChatActionType
  actionData?: ActionPayload
}

interface ClosedRow {
  side:         string
  trade_type:   string
  pnl:          number | null
  status:       string
  close_reason: string | null
}

interface MemoryRow {
  current_bias:   string | null
  current_thesis: string | null
}

interface ClaudeContent  { text?: string }
interface ClaudeResponse { content?: ClaudeContent[] }

// In-memory history — persists across warm Vercel instances, resets on cold start
const chatHistory = new Map<string, HistoryMessage[]>()
const MAX_TURNS   = 10

export async function chatWithAPEX(
  userMessage: string,
  chatId:      string,
): Promise<ChatResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey) return { text: 'Error: ANTHROPIC_API_KEY no configurada.', action: 'NONE' }

  const sb = getSb()

  // ── 1. Gather full market context in parallel ────────────────────────────────
  const [capRes, macroRes, newsRes, activeRes, closedRes, memRes, priceRes] =
    await Promise.allSettled([
      getCapitalState(DEFAULT_CAPITAL_CONFIG),
      getMacroSnapshot(),
      fetchBTCNews(),
      sb
        ? Promise.resolve(
            sb.from('apex_signals')
              .select('id, side, trade_type, entry, sl, tp1, tp2, tp3, status, created_at, tp1_banked_pnl, total_banked_pnl')
              .in('status', ['active', 'tp1_hit', 'tp2_hit'])
              .order('created_at', { ascending: false }),
          ).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      sb
        ? Promise.resolve(
            sb.from('apex_signals')
              .select('side, trade_type, pnl, status, close_reason')
              .in('status', ['sl_hit', 'tp3_hit', 'closed_manual', 'breakeven'])
              .order('created_at', { ascending: false })
              .limit(5),
          ).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      sb
        ? Promise.resolve(
            sb.from('apex_agent_memory')
              .select('current_bias, current_thesis')
              .eq('id', 'current')
              .single(),
          ).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
        signal: AbortSignal.timeout(4000),
      })
        .then(r => r.json() as Promise<{ price?: string }>)
        .catch(() => ({ price: undefined as string | undefined })),
    ])

  const capital    = capRes.status    === 'fulfilled' ? capRes.value    : null
  const macro      = macroRes.status  === 'fulfilled' ? macroRes.value  : null
  const news       = newsRes.status   === 'fulfilled' ? newsRes.value   : null
  const priceData  = priceRes.status  === 'fulfilled' ? priceRes.value  : { price: undefined as string | undefined }
  const btcPrice   = parseFloat(priceData?.price ?? '') || 0

  const rawActive = (
    activeRes.status === 'fulfilled'
      ? (activeRes.value as { data: unknown[] | null }).data ?? []
      : []
  ) as RawSignalRow[]

  const closedData = (
    closedRes.status === 'fulfilled'
      ? (closedRes.value as { data: unknown[] | null }).data ?? []
      : []
  ) as ClosedRow[]

  const memData = (
    memRes.status === 'fulfilled'
      ? (memRes.value as { data: unknown }).data
      : null
  ) as MemoryRow | null

  // ── 2. Live P&L for active signals ──────────────────────────────────────────
  const liveSignals = await getLiveSignalStates(rawActive)

  // ── 3. Build system prompt ───────────────────────────────────────────────────
  const P = (n: number) => `$${Math.round(n).toLocaleString()}`

  const signalsSummary = liveSignals.length === 0
    ? 'Ninguna — capital libre'
    : liveSignals.map(live => {
        const pnlStr = `${live.pnlPct >= 0 ? '+' : ''}${live.pnlPct.toFixed(2)}%`
        const warn   = live.isNearSL  ? ' ⚠️CERCA SL'
                     : live.isNearTP1 ? ' 🎯CERCA TP1'
                     : ''
        return (
          `${live.side} ${live.tradeType} @ ${P(live.entry)} | ` +
          `Precio: ${P(live.currentPrice)} | P&L LIVE: ${pnlStr}${warn} | ` +
          `SL: ${P(live.sl)} (${live.slDistancePct.toFixed(2)}% lejos) | ` +
          `Abierto: ${live.openSince}`
        )
      }).join('\n')

  const closedSummary = closedData.length === 0
    ? 'Ninguna reciente'
    : closedData.map(s => {
        const pnl = s.pnl ?? 0
        return `${s.side} ${s.trade_type}: ${s.status} | P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | ${s.close_reason ?? '—'}`
      }).join('\n')

  const stageLabels = { 1: 'NORMAL (5%)', 2: 'SURVIVAL (2%)', 3: 'HARD STOP' } as const
  const stageLabel  = capital ? stageLabels[capital.drawdownStage] : 'desconocido'

  const systemPrompt = [
    `Eres APEX, agente de trading Bitcoin profesional. Personalidad directa, opinión propia. El usuario es tu trader.`,
    ``,
    `MERCADO ACTUAL:`,
    `BTC: ${btcPrice > 0 ? P(btcPrice) : 'no disponible'}`,
    macro
      ? `CPI: ${macro.cpi_yoy}% | Fed: ${macro.fed_rate}% | DXY: ${macro.dxy} | F&G: ${macro.fear_greed}/100`
      : '',
    ``,
    `SEÑALES ACTIVAS:`,
    signalsSummary,
    ``,
    `ÚLTIMAS CERRADAS:`,
    closedSummary,
    ``,
    capital
      ? `CAPITAL: Balance ${P(capital.availableBalance)} | Desplegado ${P(capital.deployedCapital)} | Stage: ${stageLabel} | P&L mes: ${capital.monthlyPnlPct >= 0 ? '+' : ''}${capital.monthlyPnlPct.toFixed(2)}%`
      : '',
    ``,
    (memData?.current_bias)
      ? `SESGO ACTUAL: ${memData.current_bias} — ${(memData.current_thesis ?? '').slice(0, 150)}`
      : '',
    ``,
    news ? `NOTICIAS: ${formatNewsForPrompt(news).slice(0, 350)}` : '',
    ``,
    `INSTRUCCIONES DE RESPUESTA:`,
    `- Español, primera persona, directo y con criterio propio.`,
    `- Si te preguntan por análisis → da tu opinión real del mercado.`,
    `- Si te piden pausar → responde y añade al final: ACTION: {"type":"PAUSE"}`,
    `- Si te piden reanudar → ACTION: {"type":"RESUME"}`,
    `- Si te piden cerrar todo → ACTION: {"type":"CLOSE_ALL"}`,
    `- Si te piden mover el SL → ACTION: {"type":"MOVE_SL","signalId":"ID_AQUI","newSL":62500}`,
    `- Si no hay acción ejecutable → no incluyas ACTION.`,
    `- Máximo 200 palabras.`,
  ].filter(Boolean).join('\n')

  // ── 4. Conversation history ──────────────────────────────────────────────────
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, [])
  const history = chatHistory.get(chatId)!
  history.push({ role: 'user', content: userMessage })

  const messages = history.slice(-(MAX_TURNS * 2))

  // ── 5. Call Claude ───────────────────────────────────────────────────────────
  let rawText = 'Sin respuesta del agente.'
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
        max_tokens: 600,
        system:     systemPrompt,
        messages,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) {
      const data = (await res.json()) as ClaudeResponse
      rawText = data.content?.[0]?.text ?? rawText
    } else {
      console.error('[APEX Chat] Claude error:', res.status)
    }
  } catch (err: unknown) {
    console.error('[APEX Chat]', err instanceof Error ? err.message : String(err))
  }

  // ── 6. Parse optional ACTION from response ───────────────────────────────────
  let action: ChatActionType = 'NONE'
  let actionData: ActionPayload | undefined
  let cleanText = rawText

  const actionMatch = rawText.match(/ACTION:\s*(\{[\s\S]*?\})/)
  if (actionMatch?.[1]) {
    try {
      const parsed = JSON.parse(actionMatch[1]) as ActionPayload
      action       = parsed.type ?? 'NONE'
      actionData   = parsed
      cleanText    = rawText.replace(/ACTION:\s*\{[\s\S]*?\}/, '').trim()
    } catch { /* malformed JSON — ignore */ }
  }

  // ── 7. Save assistant turn to history ────────────────────────────────────────
  history.push({ role: 'assistant', content: cleanText })
  if (history.length > MAX_TURNS * 2) history.splice(0, history.length - MAX_TURNS * 2)

  // ── 8. Persist to Supabase (non-blocking) ────────────────────────────────────
  if (sb) {
    void Promise.resolve(
      sb.from('apex_chat_history').insert({
        chat_id:       chatId,
        user_msg:      userMessage,
        apex_reply:    cleanText,
        action:        action !== 'NONE' ? action : null,
        context_price: btcPrice || null,
        created_at:    new Date().toISOString(),
      }),
    ).catch(() => {})
  }

  return { text: cleanText, action, actionData }
}
