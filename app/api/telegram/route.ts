import { NextRequest, NextResponse } from 'next/server'
import { sendTelegram, tgStatus, authorizedChatId, sendTyping } from '@/lib/telegram'
import { getCapitalState, DEFAULT_CAPITAL_CONFIG } from '@/lib/capitalManager'
import { getMacroSnapshot, updateMacroOverride } from '@/lib/macroData'
import { getSupabaseServer } from '@/lib/supabase'
import { fetchBTCNews, formatNewsForTelegram } from '@/lib/newsFetcher'
import { sendNtfy } from '@/lib/ntfy'
import { getLiveSignalStates, formatLiveSignal } from '@/lib/liveSignal'
import type { RawSignalRow } from '@/lib/liveSignal'
import { chatWithAPEX } from '@/lib/apexChat'
import type { ChatActionType } from '@/lib/apexChat'

function getSb() { return getSupabaseServer() }

async function dbUpdate(table: string, data: Record<string, unknown>, id = 'current'): Promise<void> {
  const sb = getSb()
  if (!sb) return
  await Promise.resolve(sb.from(table).update(data).eq('id', id)).catch(() => {})
}

async function executeChatAction(
  action:     ChatActionType,
  actionData: { newSL?: number; signalId?: string } | undefined,
  chatId:     string,
): Promise<void> {
  switch (action) {
    case 'PAUSE':
      await dbUpdate('apex_agent_state', {
        is_paused:    true,
        paused_at:    new Date().toISOString(),
        pause_reason: 'Pausado por chat Telegram',
      })
      await sendTelegram('⏸ <b>Agente pausado.</b> No se abrirán nuevos trades.\nUsa /resume para reanudar.', chatId)
      break

    case 'RESUME':
      await dbUpdate('apex_agent_state', { is_paused: false, paused_at: null, pause_reason: null })
      await sendTelegram('▶️ <b>Agente reanudado.</b> Buscando setups...', chatId)
      break

    case 'CLOSE_ALL':
      await sendTelegram(
        `⚠️ <b>Confirmar cierre de emergencia</b>\n\n` +
        `Para cerrar TODAS las señales activas en Supabase, usa el comando:\n` +
        `<code>/close_all</code>`,
        chatId,
      )
      break

    case 'MOVE_SL': {
      const sb    = getSb()
      const newSL = actionData?.newSL
      const sigId = actionData?.signalId
      if (sb && newSL && sigId) {
        await Promise.resolve(
          sb.from('apex_signals').update({ sl: newSL }).eq('id', sigId),
        ).catch(() => {})
        await sendTelegram(
          `📐 SL actualizado a <code>$${Math.round(newSL).toLocaleString()}</code>`,
          chatId,
        )
      }
      break
    }

    default:
      break
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { message?: { chat?: { id: number }; text?: string } }
    const msg  = body.message
    if (!msg) return NextResponse.json({ ok: true })

    const chatId  = String(msg.chat?.id ?? '')
    const rawText = (msg.text ?? '').trim()
    const text    = rawText.toLowerCase()

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
          .select('id, side, trade_type, entry, sl, tp1, tp2, tp3, status, created_at, tp1_banked_pnl, total_banked_pnl')
          .in('status', ['active', 'tp1_hit', 'tp2_hit'])
          .order('created_at', { ascending: false })
      ).catch(() => ({ data: null })) as { data: RawSignalRow[] | null }
      const sigs = data ?? []
      if (sigs.length === 0) { await sendTelegram('📋 Sin señales activas.', chatId); return NextResponse.json({ ok: true }) }
      const liveStates = await getLiveSignalStates(sigs)
      if (liveStates.length === 0) {
        // Price unavailable — show static info without live P&L
        for (const s of sigs) {
          const emoji = s.side === 'LONG' ? '🟢' : '🔴'
          const statusLabel =
            s.status === 'tp1_hit' ? '✅ TP1 tocado' :
            s.status === 'tp2_hit' ? '✅✅ TP2 tocado' : 'Activa'
          await sendTelegram(
            `${emoji} <b>${s.side} ${s.trade_type}</b> — ${statusLabel}\n` +
            `Entry: <code>$${Math.round(s.entry).toLocaleString()}</code>  SL: <code>$${Math.round(s.sl).toLocaleString()}</code>\n` +
            `TP1: <code>$${Math.round(s.tp1).toLocaleString()}</code>  TP2: <code>$${Math.round(s.tp2).toLocaleString()}</code>\n` +
            `<i>P&amp;L: precio de mercado no disponible</i>`,
            chatId,
          )
        }
        return NextResponse.json({ ok: true })
      }
      for (const live of liveStates) {
        await sendTelegram(formatLiveSignal(live), chatId)
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

    else if (text.startsWith('/macro')) {
      const parts = text.split(' ')
      if (parts.length === 1) {
        // /macro — show current snapshot
        const m = await getMacroSnapshot().catch(() => null)
        if (!m) { await sendTelegram('❌ Error obteniendo datos macro.', chatId); return NextResponse.json({ ok: true }) }
        const etfTxt = m.etf_flow_7d >= 0 ? `+$${m.etf_flow_7d}M` : `-$${Math.abs(m.etf_flow_7d)}M`
        await sendTelegram(
          `📊 <b>Macro Snapshot</b>\n\n` +
          `🏦 CPI YoY: <b>${m.cpi_yoy}%</b> | Core: ${m.core_cpi_yoy}%\n` +
          `🏦 Fed Rate: <b>${m.fed_rate}%</b> | Próxima: ${m.fed_next_meeting}\n` +
          `💵 DXY: <b>${m.dxy}</b> | S&amp;P 500: <b>${m.sp500_change >= 0 ? '+' : ''}${m.sp500_change}%</b>\n` +
          `🥇 Gold: <b>$${m.gold_price.toLocaleString()}</b> | US 10Y: <b>${m.us10y_yield}%</b>\n` +
          `₿ BTC Dom: <b>${m.btc_dominance}%</b> | Total MCap: <b>$${m.total_crypto_mcap}B</b>\n` +
          `😱 Fear&amp;Greed: <b>${m.fear_greed}/100</b>\n` +
          `🏦 ETF 7D: <b>${etfTxt}</b>\n\n` +
          `<i>${m.source_note}</i>\n` +
          `<i>Para actualizar: /macro update cpi 4.2</i>`,
          chatId,
        )
      } else if (parts[1] === 'update' && parts[2] && parts[3]) {
        // /macro update cpi 4.2
        const key   = parts[2].toLowerCase()
        const value = parseFloat(parts[3])
        const source = parts.slice(4).join(' ') || 'manual_telegram'
        if (isNaN(value)) {
          await sendTelegram('❌ Valor inválido. Ejemplo: /macro update cpi 4.2', chatId)
        } else {
          await updateMacroOverride(key, value, source)
          await sendTelegram(`✅ Macro actualizado:\n<code>${key} = ${value}</code>\nFuente: ${source}`, chatId)
        }
      } else {
        await sendTelegram('❓ Uso:\n/macro — ver snapshot\n/macro update cpi 4.2 — actualizar valor', chatId)
      }
    }

    else if (text === '/leverage' || text === '/lev') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data } = await Promise.resolve(
        sb.from('apex_leverage_config').select('*').order('trade_type')
      ).catch(() => ({ data: null })) as { data: Array<{
        trade_type: string; leverage_min: number; leverage_max: number
        sl_min_pct: number; sl_max_pct: number
      }> | null }
      if (!data || data.length === 0) {
        await sendTelegram('❌ Tabla apex_leverage_config no encontrada. Ejecuta el SQL en Supabase.', chatId)
        return NextResponse.json({ ok: true })
      }
      const emoji: Record<string, string> = { Scalp: '⚡', DayTrade: '📊', Swing: '🌊' }
      const lines = data.map(cfg => {
        const sl1 = Math.max(cfg.leverage_min, Math.min(cfg.leverage_max, Math.round(0.05 / 0.01)))
        const sl2 = Math.max(cfg.leverage_min, Math.min(cfg.leverage_max, Math.round(0.05 / 0.02)))
        return (
          `${emoji[cfg.trade_type] ?? '•'} <b>${cfg.trade_type}</b>\n` +
          `   Leverage: ${cfg.leverage_min}x – ${cfg.leverage_max}x\n` +
          `   SL rango: ${(cfg.sl_min_pct * 100).toFixed(1)}% – ${(cfg.sl_max_pct * 100).toFixed(1)}%\n` +
          `   SL 1% → ${sl1}x | SL 2% → ${sl2}x`
        )
      })
      await sendTelegram(
        `⚙️ <b>Configuración de Leverage</b>\n\n${lines.join('\n\n')}\n\n` +
        `<i>Ajusta en Dashboard → ⚡ Leverage</i>`,
        chatId,
      )
    }

    else if (text === '/locks' || text === '/lock') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data } = await Promise.resolve(
        sb.from('apex_run_locks').select('*').order('job_type')
      ).catch(() => ({ data: null })) as { data: Array<{
        job_type: string; locked: boolean; locked_at: string | null
        lock_expires_at: string | null; last_run_at: string | null; last_run_ms: number | null
      }> | null }
      if (!data || data.length === 0) {
        await sendTelegram('❌ Tabla apex_run_locks no encontrada. Ejecuta el SQL en Supabase primero.', chatId)
        return NextResponse.json({ ok: true })
      }
      const tz  = 'America/Santo_Domingo'
      const fmt = (ts: string | null) => ts
        ? new Date(ts).toLocaleTimeString('es-DO', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'nunca'
      const lines = data.map(l => {
        const status = l.locked ? '🔴 RUNNING' : '🟢 libre'
        const ms     = l.last_run_ms != null ? `${l.last_run_ms}ms` : '?'
        return `${status} <b>${l.job_type}</b> — último: ${fmt(l.last_run_at)} (${ms})`
      })
      await sendTelegram(
        `🔐 <b>Run Locks</b>\n\n${lines.join('\n')}\n\n<i>🔴 por más de 3min = problema</i>`,
        chatId,
      )
    }

    else if (text === '/test' || text === '/ping') {
      const start      = Date.now()
      const ntfyTopic  = process.env.NTFY_TOPIC ?? ''
      let ntfyStatus = '⚠️ NTFY_TOPIC no configurado'
      if (ntfyTopic) {
        const ok = await sendNtfy(ntfyTopic, 'APEX /test desde Telegram', 'Si ves esto, NTFY funciona ✅', 3, ['white_check_mark'])
          .catch(() => false)
        ntfyStatus = ok ? '✅ OK' : '❌ Falló al enviar'
      }
      await sendTelegram(
        `✅ <b>APEX Bot — Test OK</b>\n\n` +
        `Telegram: ✅ OK\n` +
        `NTFY: ${ntfyStatus}\n` +
        `Latencia: ${Date.now() - start}ms\n` +
        `<i>${new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}</i>`,
        chatId,
      )
    }

    else if (text === '/news' || text === '/n') {
      try {
        const snap = await fetchBTCNews()
        await sendTelegram(formatNewsForTelegram(snap), chatId)
      } catch {
        await sendTelegram('❌ Error obteniendo noticias.', chatId)
      }
    }

    else if (text === '/newsraw') {
      try {
        const snap = await fetchBTCNews()
        const hitList  = snap.sourcesHit.map(s => `✅ ${s}`).join('\n')
        const failList = snap.sourcesFailed.map(s => `❌ ${s}`).join('\n')
        const time = new Date(snap.fetchedAt).toLocaleTimeString('es-DO', {
          timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit',
        })
        await sendTelegram(
          `🔧 <b>News Debug — ${time}</b>\n\n` +
          `Items totales: <b>${snap.items.length}</b>\n` +
          `Sentimiento: ${snap.sentimentScore}/100\n` +
          `Bull: ${snap.sentiment.bullish} | Bear: ${snap.sentiment.bearish} | Neutral: ${snap.sentiment.neutral}\n` +
          `Críticas: ${snap.criticalAlerts.length}\n\n` +
          `<b>Fuentes OK (${snap.sourcesHit.length}):</b>\n${hitList || '—'}\n\n` +
          (failList ? `<b>Fallos (${snap.sourcesFailed.length}):</b>\n${failList}` : ''),
          chatId,
        )
      } catch {
        await sendTelegram('❌ Error obteniendo debug de noticias.', chatId)
      }
    }

    else if (text === '/verify' || text === '/v') {
      const [macro, cs] = await Promise.all([
        getMacroSnapshot().catch(() => null),
        getCapitalState(DEFAULT_CAPITAL_CONFIG).catch(() => null),
      ])
      const sb = getSb()
      const { data: winData } = await (sb
        ? Promise.resolve(sb.from('apex_signals').select('pnl, status').eq('status', 'closed'))
            .catch(() => ({ data: null }))
        : Promise.resolve({ data: null })) as { data: Array<{ pnl: number | null }> | null }
      const closed  = winData ?? []
      const wins    = closed.filter(s => (s.pnl ?? 0) > 0).length
      const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '?'
      await sendTelegram(
        `🔍 <b>Datos exactos del agente ahora:</b>\n\n` +
        `📊 <b>Macro:</b>\n` +
        `  CPI: <b>${macro?.cpi_yoy ?? '?'}%</b> | Core: ${macro?.core_cpi_yoy ?? '?'}%\n` +
        `  Fed: <b>${macro?.fed_rate ?? '?'}%</b> (${macro?.fed_next_meeting ?? 'HOLD'})\n` +
        `  DXY: ${macro?.dxy ?? '?'} | S&P: ${macro?.sp500_change ?? '?'}%\n` +
        `  ETF 7D: $${macro?.etf_flow_7d ?? '?'}M | F&G: ${macro?.fear_greed ?? '?'}/100\n\n` +
        `💰 <b>Capital:</b>\n` +
        `  Balance: $${cs?.availableBalance?.toFixed(2) ?? '?'}\n` +
        `  Riesgo/trade: ${cs ? (cs.effectiveRiskPct * 100).toFixed(0) : '?'}%\n` +
        `  Stage: ${cs?.drawdownStage ?? '?'}\n\n` +
        `📈 <b>Performance:</b>\n` +
        `  Trades cerrados: ${closed.length}\n` +
        `  Win Rate: ${winRate}%\n` +
        `  Ganadores: ${wins} | Perdedores: ${closed.length - wins}\n\n` +
        `<i>Fuente macro: ${macro?.source_note ?? 'desconocida'}</i>`,
        chatId,
      )
    }

    else if (text === '/stats') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data: closed } = await Promise.resolve(
        sb.from('apex_signals').select('pnl, trade_type, status, closed_at').eq('status', 'closed')
          .order('closed_at', { ascending: false }).limit(100)
      ).catch(() => ({ data: null })) as {
        data: Array<{ pnl: number | null; trade_type: string; closed_at: string | null }> | null
      }
      if (!closed || closed.length === 0) { await sendTelegram('📋 Sin trades cerrados aún.', chatId); return NextResponse.json({ ok: true }) }

      const byType: Record<string, { wins: number; losses: number; totalPnl: number; count: number }> = {}
      for (const t of closed) {
        const tt = t.trade_type ?? 'Unknown'
        if (!byType[tt]) byType[tt] = { wins: 0, losses: 0, totalPnl: 0, count: 0 }
        const pnl = t.pnl ?? 0
        byType[tt].count++
        byType[tt].totalPnl += pnl
        if (pnl > 0) byType[tt].wins++; else byType[tt].losses++
      }
      const typeEmoji: Record<string, string> = { Scalp: '⚡', DayTrade: '📊', Swing: '🌊' }
      const lines = Object.entries(byType).map(([tt, s]) => {
        const wr    = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(0) : '0'
        const avgPnl = s.count > 0 ? (s.totalPnl / s.count).toFixed(2) : '0'
        const emoji  = typeEmoji[tt] ?? '•'
        return `${emoji} <b>${tt}</b>: ${s.count} trades | WR ${wr}% | Avg P&amp;L ${avgPnl >= '0' ? '+' : ''}${avgPnl}%`
      })
      const totalPnl = closed.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
      const totalWins = closed.filter(t => (t.pnl ?? 0) > 0).length
      await sendTelegram(
        `📈 <b>Performance por Tipo</b>\n\n${lines.join('\n\n')}\n\n` +
        `📊 <b>Total:</b> ${closed.length} trades | WR ${((totalWins / closed.length) * 100).toFixed(0)}%\n` +
        `💰 P&amp;L acumulado: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`,
        chatId,
      )
    }

    else if (text === '/lastbrief' || text === '/lb') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data: briefs } = await Promise.resolve(
        sb.from('apex_brief_history')
          .select('brief_type, analysis, price_at_brief, created_at')
          .order('created_at', { ascending: false })
          .limit(5)
      ).catch(() => ({ data: null })) as {
        data: Array<{ brief_type: string | null; analysis: string; price_at_brief: number | null; created_at: string }> | null
      }
      if (!briefs || briefs.length === 0) {
        await sendTelegram('📋 Sin briefs guardados. La tabla apex_brief_history puede estar vacía.', chatId)
        return NextResponse.json({ ok: true })
      }
      const tz = 'America/Santo_Domingo'
      for (const brief of briefs.slice(0, 5)) {
        const timeStr = new Date(brief.created_at).toLocaleTimeString('es-DO', {
          timeZone: tz, hour: '2-digit', minute: '2-digit',
        })
        const priceStr = brief.price_at_brief ? `$${Math.round(brief.price_at_brief).toLocaleString()}` : '?'
        const snippet  = (brief.analysis ?? '').slice(0, 300)
        await sendTelegram(
          `📊 <b>${brief.brief_type ?? 'Brief'} — ${timeStr}</b>\n` +
          `BTC: <code>${priceStr}</code>\n\n` +
          `${snippet}${snippet.length >= 300 ? '…' : ''}`,
          chatId,
        )
      }
    }

    else if (text === '/history' || text === '/chat') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const { data } = await Promise.resolve(
        sb.from('apex_chat_history')
          .select('user_msg, apex_reply, created_at')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(5)
      ).catch(() => ({ data: null })) as {
        data: Array<{ user_msg: string; apex_reply: string; created_at: string }> | null
      }
      if (!data?.length) {
        await sendTelegram('📋 Sin conversaciones previas.\nEscribe cualquier mensaje (sin /) para chatear con APEX.', chatId)
      } else {
        const tz    = 'America/Santo_Domingo'
        const lines = data.reverse().map(m => {
          const time = new Date(m.created_at).toLocaleTimeString('es-DO', {
            timeZone: tz, hour: '2-digit', minute: '2-digit',
          })
          return `[${time}] 👤 ${m.user_msg.slice(0, 60)}\n🤖 ${m.apex_reply.slice(0, 100)}`
        })
        await sendTelegram(
          `💬 <b>Últimas conversaciones</b>\n\n${lines.join('\n\n')}`,
          chatId,
        )
      }
    }

    else if (text === '/help' || text === '/h' || text === '/start') {
      await sendTelegram(
        `💬 <b>Chat directo con APEX</b>\n` +
        `Escribe cualquier mensaje (sin /) para hablar con APEX.\n` +
        `Ejemplos:\n` +
        `  "qué piensas del precio ahora?"\n` +
        `  "cómo va el short?"\n` +
        `  "cuánto capital tengo libre?"\n` +
        `  "pausa los trades"\n\n` +
        `🤖 <b>APEX Trader — Comandos</b>\n\n` +
        `📊 <b>Info</b>\n` +
        `/status — Estado completo del agente\n` +
        `/balance — Balance y capital\n` +
        `/signals — Señales activas\n` +
        `/capital — Gestión de capital\n` +
        `/risk — Estado de riesgo y drawdown\n` +
        `/macro — Snapshot macro real (CPI, DXY, Gold...)\n` +
        `/leverage — Configuración de leverage por tipo\n` +
        `/locks — Estado de los run locks\n\n` +
        `📰 <b>Análisis</b>\n` +
        `/news — Noticias BTC recientes (15+ fuentes)\n` +
        `/newsraw — Debug de fuentes y sentimiento\n` +
        `/verify — Datos exactos que usa el agente\n` +
        `/stats — Performance por tipo de trade\n` +
        `/lastbrief — Últimos 5 análisis del agente\n\n` +
        `⚙️ <b>Control</b>\n` +
        `/pause — Pausar apertura de nuevos trades\n` +
        `/resume — Reanudar el agente\n` +
        `/close_all — ⚠️ Cerrar señales en Supabase\n\n` +
        `🔧 <b>Diagnóstico</b>\n` +
        `/test — Verificar que Telegram y NTFY funcionan\n` +
        `/history — Últimas 5 conversaciones con APEX\n\n` +
        `💡 Atajos: /s /b /sig /p /r /ca /cap /lev /n /v /lb`,
        chatId,
      )
    }

    else if (!rawText.startsWith('/')) {
      // Free-form message → APEX chat with full context
      void sendTyping(chatId)
      const resp = await chatWithAPEX(rawText, chatId)
      await sendTelegram(resp.text, chatId)
      if (resp.action !== 'NONE') await executeChatAction(resp.action, resp.actionData, chatId)
    }

    else {
      // Unknown command — forward intent to APEX
      void sendTyping(chatId)
      const resp = await chatWithAPEX(
        `El usuario intentó el comando "${rawText}" que no existe. Responde brevemente.`,
        chatId,
      )
      await sendTelegram(resp.text, chatId)
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[TG Webhook]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: true })
  }
}

