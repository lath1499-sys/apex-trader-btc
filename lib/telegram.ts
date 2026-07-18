import type { SignalRecord } from '@/lib/types'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? ''
const BASE      = `https://api.telegram.org/bot${BOT_TOKEN}`

export async function sendTelegram(text: string, chatId?: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[TG] SKIPPED — BOT_TOKEN or CHAT_ID not set')
    return
  }
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  chatId ?? CHAT_ID,
        text,
        parse_mode:               'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error('[TG] Send failed:', res.status, errBody.slice(0, 200))
    } else {
      console.log('[TG] Sent:', text.slice(0, 80).replace(/\n/g, ' '))
    }
  } catch (err: unknown) {
    console.error('[TG] Exception:', err instanceof Error ? err.message : String(err))
  }
}

export async function sendTyping(chatId: string): Promise<void> {
  if (!BOT_TOKEN) return
  try {
    await fetch(`${BASE}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    })
  } catch { /* non-blocking */ }
}

export async function setWebhook(url: string): Promise<unknown> {
  const res = await fetch(`${BASE}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message'] }),
  })
  return res.json()
}

// Exported so webhook handler can compare chat ID without exposing the env var
export function authorizedChatId(): string { return CHAT_ID }

const P = (n: number) => `$${Math.round(n).toLocaleString()}`

export function tgSignal(sig: SignalRecord): string {
  const { idea } = sig
  const emoji     = idea.side === 'LONG' ? '🟢' : '🔴'
  const confLabel = idea.confidence === 'ALTA' ? 'ALTA 🔥' : idea.confidence === 'MEDIA' ? 'MEDIA' : 'BAJA'
  const reasons   = idea.reasons.slice(0, 3).map(r => `• ${r.txt}`).join('\n')
  const scoreStr  = (idea.bull != null && idea.maxSc != null && idea.maxSc > 0)
    ? `📊 Score: ${idea.bull + idea.bear}/${idea.maxSc}`
    : ''
  return [
    `${emoji} <b>${idea.side} ${idea.tradeType.toUpperCase()}</b> — Confianza: <b>${confLabel}</b>`,
    ``,
    `💰 Entry: <code>${P(idea.price)}</code>`,
    `🛑 SL:    <code>${P(idea.sl)}</code>`,
    ``,
    `<b>PLAN DE SALIDA PARCIAL:</b>`,
    `🎯 TP1: <code>${P(idea.tp1)}</code> → Cerrar ${sig.tp1ClosePct ?? 40}% | R:R ${sig.tp1RR ?? '?'}:1`,
    `🎯 TP2: <code>${P(idea.tp2)}</code> → Cerrar ${sig.tp2ClosePct ?? 35}% | R:R ${sig.tp2RR ?? '?'}:1`,
    `🎯 TP3: <code>${P(idea.tp3)}</code> → Cerrar ${sig.tp3ClosePct ?? 25}% restante | R:R ${sig.tp3RR ?? '?'}:1`,
    ``,
    `Si TP1 tocado → SL a breakeven (trade gratuito)`,
    `Si TP2 tocado → SL a TP1 (profit garantizado)`,
    ``,
    `📐 Leverage máx: <b>${idea.maxLev}x</b>`,
    scoreStr,
    reasons ? `\n📋 ${reasons}` : '',
  ].filter(Boolean).join('\n')
}

export function tgClose(sig: SignalRecord, pnl: number, reason: string): string {
  const emoji = pnl >= 0 ? '✅' : '❌'
  return [
    `${emoji} <b>CERRADO — ${sig.idea.side} ${sig.idea.tradeType}</b>`,
    `Entrada: <code>${P(sig.idea.price)}</code>`,
    `P&L: <b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</b>`,
    `Razón: <i>${reason}</i>`,
  ].join('\n')
}

export function tgTP(sig: SignalRecord, tp: 1 | 2 | 3, bankedPnl: number): string {
  const tpPrice   = tp === 1 ? sig.idea.tp1 : tp === 2 ? sig.idea.tp2 : sig.idea.tp3
  const remaining = tp === 1 ? '60%' : tp === 2 ? '25%' : '0%'
  const slNote    = tp === 1 ? 'breakeven' : `TP${tp - 1}`
  return [
    `🎯 <b>TP${tp} ALCANZADO — ${sig.idea.side}</b>`,
    `TP${tp}: <code>${P(tpPrice)}</code>`,
    `Ganancia banqueada: <b>+${bankedPnl.toFixed(2)}%</b>`,
    `Posición restante: <b>${remaining}</b>`,
    `SL movido a: <code>${slNote}</code>`,
  ].join('\n')
}

export function tgStatus(
  capitalState: {
    availableBalance: number; deployedCapital: number; freeCapital: number
    monthlyPnl: number; monthlyPnlPct: number; drawdownStage: 1 | 2 | 3
    maxPositionSize: number; canOpenNewTrade: boolean; reason: string
  },
  activeSignals: Array<{ side: string; trade_type: string; entry: number; pnl: number | null }>,
  monthlyTarget: number,
): string {
  const stageEmoji = { 1: '🟢', 2: '🟡', 3: '🔴' } as const
  const stageLabel = { 1: 'NORMAL (5%)', 2: 'SURVIVAL (2%)', 3: 'HARD STOP' } as const
  const stage = capitalState.drawdownStage
  const prog  = monthlyTarget > 0 ? Math.min(100, (capitalState.monthlyPnl / monthlyTarget) * 100) : 0
  const lines = activeSignals.length === 0
    ? '  Sin señales activas'
    : activeSignals.map(s => {
        const pnl = s.pnl ?? 0
        return `  ${s.side === 'LONG' ? '🟢' : '🔴'} ${s.side} ${s.trade_type} @ ${P(s.entry)} | P&amp;L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
      }).join('\n')
  return [
    `📊 <b>APEX STATUS</b>`,
    `💰 Balance: <code>$${capitalState.availableBalance.toFixed(2)}</code>`,
    `📈 P&amp;L mes: ${capitalState.monthlyPnlPct >= 0 ? '+' : ''}${capitalState.monthlyPnlPct.toFixed(2)}%`,
    `🎯 Target: $${monthlyTarget.toFixed(0)} | Progreso: ${prog.toFixed(0)}%`,
    `${stageEmoji[stage]} Stage: ${stageLabel[stage]}`,
    `💼 Desplegado: $${capitalState.deployedCapital.toFixed(2)} | Libre: $${capitalState.maxPositionSize.toFixed(2)}`,
    ``,
    `📋 <b>Señales activas (${activeSignals.length}):</b>`,
    lines,
  ].join('\n')
}

export function tgBrief(
  analysis:      string,
  price:         number,
  change:        number,
  activeSignals?: Array<{ side: string; trade_type?: string; entry: number }>,
): string {
  const time = new Date().toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit',
  })
  const sigHeader = activeSignals && activeSignals.length > 0
    ? '\n📋 <b>Posición activa:</b> ' +
      activeSignals.map(s => {
        const emoji = s.side === 'LONG' ? '🟢' : '🔴'
        return `${emoji} ${s.side} ${s.trade_type ?? ''} @${P(s.entry)}`
      }).join(' | ')
    : ''
  return `📊 <b>APEX — ${time}</b>\nBTC: <code>${P(price)}</code> ${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%${sigHeader}\n\n${analysis}`
}

export function tgBreakeven(sig: SignalRecord, bankedPnl: number): string {
  const P = (n: number) => `$${Math.round(n).toLocaleString()}`
  return [
    `🛡️ <b>BREAKEVEN CLOSE — ${sig.idea.side} ${sig.idea.tradeType}</b>`,
    ``,
    `✅ TP1 fue alcanzado → ${sig.tp1ClosePct ?? 40}% cerrado`,
    `↩️ Precio regresó al entry → SL de breakeven tocado`,
    ``,
    `Entry: <code>${P(sig.idea.price)}</code>`,
    `TP1 cerrado en: <code>${P(sig.idea.tp1)}</code>`,
    `Breakeven SL: <code>${P(sig.idea.sl)}</code>`,
    ``,
    `💰 Ganancia banqueada en TP1: <b>+${bankedPnl.toFixed(2)}%</b>`,
    `P&amp;L final: <b>+${bankedPnl.toFixed(2)}%</b>`,
    ``,
    `<i>El trade fue rentable. El sistema de parciales funcionó.</i>`,
  ].join('\n')
}

export function tgSLFloor(sig: SignalRecord, finalPnl: number): string {
  const P = (n: number) => `$${Math.round(n).toLocaleString()}`
  return [
    `✅ <b>TRADE CERRADO CON GANANCIA — ${sig.idea.side} ${sig.idea.tradeType}</b>`,
    ``,
    `🎯 TP1 alcanzado → ${sig.tp1ClosePct ?? 40}% cerrado en ${P(sig.idea.tp1)}`,
    `🎯 TP2 alcanzado → ${sig.tp2ClosePct ?? 35}% cerrado en ${P(sig.idea.tp2)}`,
    `🔒 SL piso (TP1) tocado → ${sig.tp3ClosePct ?? 25}% restante cerrado`,
    ``,
    `Entry: <code>${P(sig.idea.price)}</code>`,
    `SL piso: <code>${P(sig.idea.sl)}</code>`,
    ``,
    `💰 P&amp;L total: <b>+${finalPnl.toFixed(2)}%</b>`,
    `<i>TP1+TP2 banqueados. El sistema de parciales garantizó ganancia.</i>`,
  ].join('\n')
}

export function tgSLCorrection(sig: SignalRecord, pnl: number): string {
  const side      = sig.idea.side
  const type      = sig.idea.tradeType
  const entryFmt  = P(sig.idea.price)
  const slFmt     = P(sig.idea.sl)
  const pnlStr    = `${pnl.toFixed(2)}%`
  const sessionTz = new Date().toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit',
  })
  return [
    `❌ <b>SL EJECUTADO — ${side} ${type} | ${sessionTz}</b>`,
    ``,
    `⚠️ <b>Me corrijo:</b> reporté esta operación como activa con un P&amp;L estimado. El precio alcanzó mi stop loss y fue cerrada automáticamente.`,
    ``,
    `📊 <b>Resultado real:</b>`,
    `Entrada: <code>${entryFmt}</code>`,
    `SL tocado: <code>${slFmt}</code>`,
    `P&amp;L final: <b>${pnlStr}</b>`,
    ``,
    `🔄 <b>Sesgo actualizado:</b> Las confluencias que identifiqué no materializaron como esperaba. Revisaré qué falló antes de generar la próxima señal.`,
    ``,
    `<i>Capital protegido. Sistema de stop automático funcionó correctamente.</i>`,
  ].join('\n')
}

export function tgDrawdownAlert(stage: 1 | 2 | 3, drawdownPct: number, riskPct: number): string {
  const msgs: Record<1 | 2 | 3, string> = {
    1: `✅ <b>Riesgo restaurado al 5%</b>\nDrawdown recuperado. Trading normal reanudado.`,
    2: `⚠️ <b>SURVIVAL MODE</b>\nDrawdown: ${drawdownPct.toFixed(1)}%\nRiesgo reducido a ${riskPct}% por trade.`,
    3: `🛑 <b>HARD STOP</b>\nDrawdown: ${drawdownPct.toFixed(1)}%\nSin trades hasta el próximo mes.`,
  }
  return msgs[stage]
}
