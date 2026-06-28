import { NextRequest, NextResponse } from 'next/server'
import { sendTelegram, tgStatus, authorizedChatId } from '@/lib/telegram'
import { getCapitalState, DEFAULT_CAPITAL_CONFIG } from '@/lib/capitalManager'
import { getSupabaseServer } from '@/lib/supabase'

type RawSignal = { side: string; trade_type: string; entry: number; sl: number; tp1: number; tp2: number; tp3: number; pnl: number | null; status: string }
function getSb() { return getSupabaseServer() }

async function dbUpdate(table: string, data: Record<string, unknown>, id = 'current'): Promise<void> {
  const sb = getSb()
  if (!sb) return
  await Promise.resolve(sb.from(table).update(data).eq('id', id)).catch(() => {})
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { message?: { chat?: { id: number }; text?: string } }
    const msg  = body.message
    if (!msg) return NextResponse.json({ ok: true })

    const chatId = String(msg.chat?.id ?? '')
    const text   = (msg.text ?? '').trim().toLowerCase()

    if (chatId !== authorizedChatId()) {
      await sendTelegram('⛔ No autorizado.', chatId)
      return NextResponse.json({ ok: true })
    }

    console.log(`[TG] Command: "${text}"`)

    if (text === '/status' || text === '/s') {
      const sb = getSb()
      const [capitalState, signalRes] = await Promise.all([
        getCapitalState(DEFAULT_CAPITAL_CONFIG).catch(() => null),
        sb
          ? Promise.resolve(sb.from('apex_signals')
              .select('side, trade_type, entry, pnl, status')
              .in('status', ['active', 'tp1_hit', 'tp2_hit'])
              .order('created_at', { ascending: false })
            ).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ])
      if (!capitalState) { await sendTelegram('❌ Error obteniendo estado.', chatId); return NextResponse.json({ ok: true }) }
      const target = capitalState.monthlyStartBalance * 0.15
      const sigs   = ((signalRes as { data: unknown[] | null }).data ?? []) as Array<{ side: string; trade_type: string; entry: number; pnl: number | null }>
      await sendTelegram(tgStatus(capitalState, sigs, target), chatId)
    }

    else if (text === '/balance' || text === '/b') {
      const cs = await getCapitalState(DEFAULT_CAPITAL_CONFIG).catch(() => null)
      if (!cs) { await sendTelegram('❌ Error.', chatId); return NextResponse.json({ ok: true }) }
      await sendTelegram(
        `💰 <b>Balance:</b> <code>$${cs.availableBalance.toFixed(2)}</code>\n` +
        `📈 P&amp;L mes: ${cs.monthlyPnlPct >= 0 ? '+' : ''}${cs.monthlyPnlPct.toFixed(2)}%\n` +
        `💼 Desplegado: $${cs.deployedCapital.toFixed(2)}\n` +
        `🆓 Libre: $${cs.freeCapital.toFixed(2)}`,
        chatId,
      )
    }

    else if (text === '/signals' || text === '/sig') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data } = await Promise.resolve(
        sb.from('apex_signals')
          .select('side, trade_type, entry, sl, tp1, tp2, tp3, pnl, status')
          .in('status', ['active', 'tp1_hit', 'tp2_hit'])
          .order('created_at', { ascending: false })
      ).catch(() => ({ data: null })) as { data: RawSignal[] | null }
      const sigs = data ?? []
      if (sigs.length === 0) { await sendTelegram('📋 Sin señales activas.', chatId); return NextResponse.json({ ok: true }) }
      for (const s of sigs) {
        const emoji = s.side === 'LONG' ? '🟢' : '🔴'
        const pnl   = s.pnl ?? 0
        await sendTelegram(
          `${emoji} <b>${s.side} ${s.trade_type}</b>\n` +
          `Entry: <code>$${Math.round(s.entry).toLocaleString()}</code>  SL: <code>$${Math.round(s.sl).toLocaleString()}</code>\n` +
          `TP1: <code>$${Math.round(s.tp1).toLocaleString()}</code>  P&amp;L: <b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</b>\n` +
          `Estado: ${s.status}`,
          chatId,
        )
      }
    }

    else if (text === '/pause' || text === '/p') {
      await dbUpdate('apex_agent_state', { is_paused: true, paused_at: new Date().toISOString(), pause_reason: 'Pausa manual via Telegram' })
      await sendTelegram('⏸ <b>Agente pausado.</b>\nNo se abrirán nuevos trades.\nUsa /resume para reanudar.', chatId)
    }

    else if (text === '/resume' || text === '/r') {
      await dbUpdate('apex_agent_state', { is_paused: false, paused_at: null, pause_reason: null })
      await sendTelegram('▶️ <b>Agente reanudado.</b>\nBuscando setups...', chatId)
    }

    else if (text === '/close_all' || text === '/ca') {
      await sendTelegram('⚠️ Marcando señales como cerradas en Supabase...', chatId)
      const sb = getSb()
      if (sb) {
        await Promise.resolve(sb.from('apex_signals').update({
          status: 'closed_manual', close_reason: 'Emergency close via Telegram', closed_at: new Date().toISOString(),
        }).in('status', ['active', 'tp1_hit', 'tp2_hit'])).catch(() => {})
      }
      await sendTelegram('🛑 <b>Señales cerradas en Supabase.</b>\n⚠️ Posiciones en Binance deben cerrarse manualmente desde la app.', chatId)
    }

    else if (text === '/capital' || text === '/cap') {
      const cs = await getCapitalState(DEFAULT_CAPITAL_CONFIG).catch(() => null)
      if (!cs) { await sendTelegram('❌ Error.', chatId); return NextResponse.json({ ok: true }) }
      const target = cs.monthlyStartBalance * 0.15
      const prog   = target > 0 ? Math.min(100, (cs.monthlyPnl / target) * 100) : 0
      await sendTelegram(
        `💼 <b>Capital Management</b>\n\n` +
        `Balance: <code>$${cs.availableBalance.toFixed(2)}</code>\n` +
        `Desplegado: <code>$${cs.deployedCapital.toFixed(2)}</code>\n` +
        `Libre: <code>$${cs.freeCapital.toFixed(2)}</code>\n\n` +
        `📅 Este mes:\n` +
        `  Inicio: $${cs.monthlyStartBalance.toFixed(2)}\n` +
        `  P&amp;L: ${cs.monthlyPnlPct >= 0 ? '+' : ''}${cs.monthlyPnlPct.toFixed(2)}%\n` +
        `  Target: $${target.toFixed(0)} (15%) | Progreso: ${prog.toFixed(0)}%\n\n` +
        `Estado: ${cs.canOpenNewTrade ? '✅ Puede operar' : '🛑 ' + cs.reason}`,
        chatId,
      )
    }

    else if (text === '/risk') {
      const cs = await getCapitalState(DEFAULT_CAPITAL_CONFIG).catch(() => null)
      if (!cs) { await sendTelegram('❌ Error.', chatId); return NextResponse.json({ ok: true }) }
      const stageLabel = { 1: '🟢 NORMAL', 2: '🟡 SURVIVAL', 3: '🔴 HARD STOP' } as const
      await sendTelegram(
        `📊 <b>Estado de Riesgo</b>\n\n` +
        `Stage: ${stageLabel[cs.drawdownStage]}\n` +
        `Riesgo activo: <b>${(cs.effectiveRiskPct * 100).toFixed(0)}%</b> por trade\n` +
        `Drawdown: <b>${cs.drawdownPct.toFixed(2)}%</b>\n\n` +
        `Thresholds:\n  -15% → Survival (2%)\n  -20% → Hard Stop\n  0% → Normal (5%)`,
        chatId,
      )
    }

    else if (text === '/help' || text === '/h' || text === '/start') {
      await sendTelegram(
        `🤖 <b>APEX Trader — Comandos</b>\n\n` +
        `📊 <b>Info</b>\n` +
        `/status — Estado completo del agente\n` +
        `/balance — Balance y capital\n` +
        `/signals — Señales activas\n` +
        `/capital — Gestión de capital\n` +
        `/risk — Estado de riesgo y drawdown\n\n` +
        `⚙️ <b>Control</b>\n` +
        `/pause — Pausar apertura de nuevos trades\n` +
        `/resume — Reanudar el agente\n` +
        `/close_all — ⚠️ Cerrar señales en Supabase\n\n` +
        `💡 Atajos: /s /b /sig /p /r /ca /cap`,
        chatId,
      )
    }

    else if (text.startsWith('/')) {
      await sendTelegram(`❓ Comando no reconocido: <code>${text}</code>\nUsa /help para ver todos los comandos.`, chatId)
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[TG Webhook]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: true })
  }
}

