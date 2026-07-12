import { NextRequest, NextResponse } from 'next/server'
import { sendTelegram, tgStatus, authorizedChatId, sendTyping } from '@/lib/telegram'
import { getCapitalState, DEFAULT_CAPITAL_CONFIG } from '@/lib/capitalManager'
import { getMacroSnapshot, updateMacroOverride } from '@/lib/macroData'
import { getSupabaseServer } from '@/lib/supabase'
import { fetchBTCNews, formatNewsForTelegram } from '@/lib/newsFetcher'
import { sendNtfy } from '@/lib/ntfy'
import { getLiveSignalStates, formatLiveSignal, fetchBtcPriceAllSources } from '@/lib/liveSignal'
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

    else if (text === '/resume' || text === '/r' || text === '/unpause' || text === '/up') {
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
        ? Promise.resolve(sb.from('apex_signals').select('pnl, status')
            .in('status', ['sl_hit', 'tp3_hit', 'breakeven', 'closed_manual']))
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
        sb.from('apex_signals').select('pnl, trade_type, status, closed_at')
          .in('status', ['sl_hit', 'tp3_hit', 'breakeven', 'closed_manual'])
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

    else if (text === '/briefstatus' || text === '/bs') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }
      const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      const { data: allRows } = await Promise.resolve(
        sb.from('apex_brief_history')
          .select('focus, success, error_msg, duration_ms, created_at')
          .gte('created_at', since24h)
          .order('created_at', { ascending: false })
          .limit(50)
      ).catch(() => ({ data: null })) as {
        data: Array<{ focus: string | null; success: boolean | null; error_msg: string | null; duration_ms: number | null; created_at: string }> | null
      }
      const rows = (allRows ?? []).filter(r => r.focus !== 'DECIDE_LOG')
      if (rows.length === 0) {
        const { data: anyBrief } = await Promise.resolve(
          sb.from('apex_brief_history')
            .select('created_at')
            .neq('focus', 'DECIDE_LOG')
            .order('created_at', { ascending: false })
            .limit(1)
        ).catch(() => ({ data: null })) as { data: Array<{ created_at: string }> | null }
        const lastEver = anyBrief?.[0]?.created_at
          ? new Date(anyBrief[0].created_at).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })
          : null
        await sendTelegram(
          `📋 Sin briefs en las últimas 24h.\n\n` +
          (lastEver
            ? `Último brief registrado (cualquier fecha): ${lastEver}`
            : `No hay ningún brief registrado en la tabla — nunca se ha guardado uno.`),
          chatId,
        )
        return NextResponse.json({ ok: true })
      }
      const tz        = 'America/Santo_Domingo'
      const total     = rows.length
      const successes = rows.filter(r => r.success !== false).length
      const errors    = rows.filter(r => r.success === false)
      const lastRow   = rows[0]
      const lastTime  = new Date(lastRow.created_at).toLocaleTimeString('es-DO', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
      const avgMs     = rows.filter(r => r.duration_ms).reduce((a, r) => a + (r.duration_ms ?? 0), 0) / (rows.filter(r => r.duration_ms).length || 1)

      let msg = `📊 <b>Brief Health — últimas 24h</b>\n\n`
      msg += `✅ Exitosos: <b>${successes}/${total}</b>\n`
      msg += `❌ Errores: <b>${errors.length}</b>\n`
      msg += `⏱ Tiempo promedio: <b>${avgMs > 0 ? (avgMs / 1000).toFixed(1) + 's' : 'N/A'}</b>\n`
      msg += `🕐 Último: <b>${lastTime}</b>`
      if (errors.length > 0) {
        msg += `\n\n⚠️ <b>Errores recientes:</b>`
        for (const e of errors.slice(0, 3)) {
          const t = new Date(e.created_at).toLocaleTimeString('es-DO', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
          msg += `\n[${t}] <code>${(e.error_msg ?? 'error desconocido').slice(0, 150)}</code>`
        }
      }
      await sendTelegram(msg, chatId)
    }

    else if (text === '/signalhealth' || text === '/health' || text === '/sh') {
      const sb = getSb()
      if (!sb) { await sendTelegram('❌ DB no configurada.', chatId); return NextResponse.json({ ok: true }) }

      const [stateRes, capitalRes, locksRes, lastSigRes] = await Promise.allSettled([
        Promise.resolve(sb.from('apex_agent_state').select('is_paused, pause_reason, last_bias, last_confidence, updated_at').eq('id', 'current').maybeSingle()),
        Promise.resolve(sb.from('apex_capital_config').select('drawdown_stage, risk_per_trade_pct, monthly_start_balance').eq('id', 'default').maybeSingle()),
        Promise.resolve(sb.from('apex_run_locks').select('job_type, locked, last_run_at, run_count, error_count').order('job_type')),
        Promise.resolve(sb.from('apex_signals').select('id, side, trade_type, status, created_at').order('created_at', { ascending: false }).limit(1)),
      ])

      const state   = stateRes.status   === 'fulfilled' ? (stateRes.value.data   as { is_paused: boolean | null; pause_reason: string | null; last_bias: string | null; last_confidence: number | null; updated_at: string | null } | null) : null
      const capital = capitalRes.status === 'fulfilled' ? (capitalRes.value.data as { drawdown_stage: number | null; risk_per_trade_pct: number | null; monthly_start_balance: number | null } | null) : null
      const locks   = locksRes.status   === 'fulfilled' ? (locksRes.value.data   as Array<{ job_type: string; locked: boolean; last_run_at: string | null; run_count: number; error_count: number }> | null) : null
      const lastSig = lastSigRes.status === 'fulfilled' ? (lastSigRes.value.data as Array<{ created_at: string; side: string; trade_type: string }> | null) : null

      const daysSinceSig = lastSig?.[0]?.created_at
        ? Math.floor((Date.now() - new Date(lastSig[0].created_at).getTime()) / 86_400_000)
        : 999

      const issues: string[] = []
      const ok: string[]     = []

      if (state?.is_paused) {
        issues.push(`⏸ Agente PAUSADO: ${state.pause_reason ?? 'sin razón'}`)
      } else {
        ok.push('✅ Agente activo')
      }

      const stage = capital?.drawdown_stage ?? 1
      if (stage >= 3) {
        issues.push('🔴 HARD STOP (drawdown stage 3) — sin nuevos trades')
      } else {
        ok.push(`✅ Risk stage: ${stage === 1 ? 'NORMAL 5%' : 'SURVIVAL 2%'}`)
      }

      const decideLock = locks?.find(l => l.job_type === 'decide')
      if (decideLock?.locked) {
        issues.push(`🔒 Lock decide ATASCADO desde ${decideLock.last_run_at ?? '?'}`)
      } else {
        const lastRun = decideLock?.last_run_at
          ? new Date(decideLock.last_run_at).toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit' })
          : 'nunca'
        ok.push(`✅ Decide libre | último: ${lastRun} | runs: ${decideLock?.run_count ?? 0}`)
      }

      if (daysSinceSig >= 2) {
        issues.push(`📉 ${daysSinceSig} días sin señal — modo búsqueda activa activo`)
      } else if (daysSinceSig === 999) {
        issues.push('📉 Sin señales en DB — tabla puede estar vacía')
      } else {
        ok.push(`✅ Última señal: hace ${daysSinceSig}d`)
      }

      let msg = `🏥 <b>Signal Health</b>\n\n`
      if (issues.length) {
        msg += `🚨 <b>Problemas (${issues.length}):</b>\n${issues.join('\n')}\n\n`
      }
      msg += `<b>OK:</b>\n${ok.join('\n')}\n\n`
      msg += `Sesgo actual: ${state?.last_bias ?? '?'} | Confianza: ${state?.last_confidence ?? '?'}\n`
      msg += `Días sin señal: <b>${daysSinceSig === 999 ? 'sin datos' : daysSinceSig}</b>\n\n`
      if (issues.length === 0) {
        msg += `Todo parece correcto. Usa /forcecheck para forzar análisis ahora.`
      } else {
        msg += `Usa /resume si el agente está pausado, o revisa logs de Vercel.`
      }
      await sendTelegram(msg, chatId)
    }

    else if (text === '/forcecheck' || text === '/scan' || text === '/fc') {
      // Fire-and-forget /api/agent/decide — signal will arrive in Telegram if found
      void fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://apex-trader-btc.vercel.app'}/api/agent/decide`,
        { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` } },
      ).catch(() => {})
      await sendTelegram(
        '🔍 <b>Forzando análisis de señal...</b>\n\nSi hay un setup válido, la señal llegará en ~30 segundos.\nSi Claude devuelve WAIT, no llegará nada — usa /signalhealth para ver por qué.',
        chatId,
      )
    }

    else if (text === '/briefnow' || text === '/bn') {
      // Quick cooldown check first
      const sb = getSb()
      let minsSince = Infinity
      if (sb) {
        const { data: st } = await Promise.resolve(
          sb.from('apex_agent_state')
            .select('last_analysis_at')
            .eq('id', 'current')
            .maybeSingle()
        ).catch(() => ({ data: null })) as { data: { last_analysis_at: string | null } | null }
        if (st?.last_analysis_at) {
          minsSince = (Date.now() - new Date(st.last_analysis_at).getTime()) / 60_000
        }
      }
      if (minsSince < 26) {
        await sendTelegram(
          `⏸ Último brief hace ${minsSince.toFixed(0)}min. Próximo en ~${Math.ceil(30 - minsSince)}min.\n\nUsa /briefnow cuando falten menos de 4 min.`,
          chatId,
        )
      } else {
        // Fire-and-forget — brief sends itself to Telegram when done
        void fetch(
          `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://apex-trader-btc.vercel.app'}/api/agent/brief`,
          { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` } },
        ).catch(() => {})
        await sendTelegram('⏳ Brief generándose... llegará en ~20 segundos.', chatId)
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

    else if (text === '/price' || text === '/px') {
      const sources = await fetchBtcPriceAllSources()
      const lines   = sources.map(s => {
        const priceStr = s.price ? `<code>$${Math.round(s.price).toLocaleString()}</code>` : '<i>no disponible</i>'
        const statusEmoji = s.ok ? '✅' : '❌'
        return `${statusEmoji} <b>${s.source}</b>: ${priceStr} (${s.ms}ms)`
      })
      const best = sources.find(s => s.ok)
      const summary = best?.price ? `\nMejor precio: <code>$${Math.round(best.price).toLocaleString()}</code> (${best.source})` : '\n⚠️ Ninguna fuente disponible'
      await sendTelegram(`💰 <b>BTC — Estado de fuentes de precio</b>\n\n${lines.join('\n')}${summary}`, chatId)
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
        `/lastbrief — Últimos 5 análisis del agente\n` +
        `/briefstatus — Health check: briefs enviados/errores últimas 24h\n` +
        `/briefnow — Generar análisis de mercado ahora mismo\n` +
        `/signalhealth — Diagnóstico completo del generador de señales\n` +
        `/forcecheck — Forzar análisis de señal ahora mismo\n` +
        `/price — Estado de las 5 fuentes de precio BTC\n\n` +
        `⚙️ <b>Control</b>\n` +
        `/pause — Pausar apertura de nuevos trades\n` +
        `/resume — Reanudar el agente\n` +
        `/close_all — ⚠️ Cerrar señales en Supabase\n` +
        `/fix sl — Corregir último trade → SL (P&amp;L automático)\n` +
        `/fix be — Corregir último trade → Breakeven\n` +
        `/fix sl [id] — Corregir trade específico por ID\n\n` +
        `🔧 <b>Diagnóstico</b>\n` +
        `/test — Verificar que Telegram y NTFY funcionan\n` +
        `/history — Últimas 5 conversaciones con APEX\n\n` +
        `💡 Atajos: /s /b /sig /p /r /ca /cap /lev /n /v /lb /bs /bn /sh /fc /px`,
        chatId,
      )
    }

    else if (text.startsWith('/fix')) {
      // /fix sl | /fix be | /fix tp1 | /fix tp2 | /fix tp3 [optional: signal_id]
      const parts   = text.split(/\s+/)
      const subCmd  = (parts[1] ?? '').toLowerCase()
      const fixId   = parts[2] ?? null
      const VALID   = ['sl', 'be', 'breakeven', 'tp1', 'tp2', 'tp3']
      if (!VALID.includes(subCmd)) {
        await sendTelegram(
          `⚠️ <b>Uso:</b> /fix [sl|be|tp1|tp2|tp3] [id_opcional]\n\nEjemplos:\n` +
          `/fix sl — marca el último trade como SL con P&amp;L calculado automáticamente\n` +
          `/fix be — marca como breakeven (P&amp;L: 0%)\n` +
          `/fix sl abc123 — corrige el trade con id abc123`,
          chatId,
        )
      } else {
        const sb = getSb()
        if (!sb) { await sendTelegram('❌ DB no disponible', chatId); }
        else {
          // Fetch target signal: by id or most recent non-pending
          const query = fixId
            ? sb.from('apex_signals').select('*').eq('id', fixId).single()
            : sb.from('apex_signals').select('*').not('status', 'in', '("pending_confirmation")')
                .order('updated_at', { ascending: false }).limit(1).single()
          const { data: raw, error: fetchErr } = await Promise.resolve(query).catch(() => ({ data: null, error: { message: 'fetch failed' } })) as { data: Record<string, unknown> | null; error: { message: string } | null }
          if (fetchErr || !raw) {
            await sendTelegram(`❌ No se encontró la señal${fixId ? ` con id ${fixId}` : ''}`, chatId)
          } else {
            const idea    = raw.idea as { side: string; price: number; sl: number; tp1: number; tp2: number; tp3: number }
            const isLong  = idea.side === 'LONG'
            const entry   = idea.price
            const riskPct = Math.abs(idea.sl - entry) / entry * 100
            let newStatus: string
            let pnl: number
            let pnlR: number
            let exitPrice: number
            if (subCmd === 'sl') {
              newStatus = 'sl_hit'
              pnl       = isLong ? (idea.sl - entry) / entry * 100 : (entry - idea.sl) / entry * 100
              pnlR      = -1.0
              exitPrice = idea.sl
            } else if (subCmd === 'be' || subCmd === 'breakeven') {
              newStatus = 'breakeven'
              pnl       = 0
              pnlR      = 0
              exitPrice = entry
            } else {
              // tp1/tp2 → closed_manual (tp1/tp2 are intermediate; /fix means "closed here")
              // tp3 → tp3_hit (naturally terminal)
              const tpN  = subCmd === 'tp1' ? idea.tp1 : subCmd === 'tp2' ? idea.tp2 : idea.tp3
              newStatus  = subCmd === 'tp3' ? 'tp3_hit' : 'closed_manual'
              pnl        = isLong ? (tpN - entry) / entry * 100 : (entry - tpN) / entry * 100
              pnlR       = riskPct > 0 ? parseFloat((pnl / riskPct).toFixed(2)) : 0
              exitPrice  = tpN
            }
            const { error: updErr } = await Promise.resolve(
              sb.from('apex_signals').update({
                status:       newStatus,
                pnl:          parseFloat(pnl.toFixed(3)),
                pnl_r:        pnlR,
                exit_price:   exitPrice,
                close_reason: `Corregido por agente/operador → ${newStatus}`,
                closed_at:    raw.closed_at ?? new Date().toISOString(),
                updated_at:   new Date().toISOString(),
              }).eq('id', raw.id as string)
            ).catch(() => ({ error: { message: 'update failed' } })) as { error: { message: string } | null }
            if (updErr) {
              await sendTelegram(`❌ Error al corregir: ${updErr.message}`, chatId)
            } else {
              const pnlStr  = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
              const pnlRStr = `${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(2)}R`
              await sendTelegram(
                `✅ <b>ESTADO CORREGIDO</b>\n\n` +
                `Señal: <code>${raw.id}</code>\n` +
                `${idea.side} ${(raw.trade_type as string) ?? ''} @ <code>$${Math.round(entry).toLocaleString()}</code>\n\n` +
                `Nuevo estado: <b>${newStatus.replace('_', ' ').toUpperCase()}</b>\n` +
                `P&amp;L real: <b>${pnlStr}</b> (${pnlRStr})\n\n` +
                `<i>Registro actualizado en base de datos.</i>`,
                chatId,
              )
            }
          }
        }
      }
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

