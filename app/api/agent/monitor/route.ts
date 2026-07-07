// APEX Monitor — SL/TP price checks ONLY.
// Runs every 1 min. No Claude. Completes in <15s.
// Prevents double-close by being the fast, authoritative SL/TP handler.

import { NextResponse }                              from 'next/server'
import { withLock }                                  from '@/lib/runLock'
import { getSupabaseServer, transformSignal }         from '@/lib/supabase'
import { saveSignalToCloud }                          from '@/lib/supabase'
import { sendTelegram, tgTP, tgBreakeven, tgSLFloor, tgSLCorrection } from '@/lib/telegram'
import { sendNtfy }                                   from '@/lib/ntfy'
import type { SignalRecord }                          from '@/lib/types'

// Fire Telegram + NTFY in parallel — neither blocks the other
async function notify(
  tgMsg:  string,
  topic:  string,
  title:  string,
  body:   string,
  prio:   1|2|3|4|5 = 3,
  tags:   string[] = [],
): Promise<void> {
  await Promise.all([
    sendTelegram(tgMsg),
    topic ? sendNtfy(topic, title, body, prio, tags) : Promise.resolve(),
  ])
}

// ── Minimal price fetch (Binance → Bybit → Kraken) ───────────────────────────
async function getBtcPrice(): Promise<number | null> {
  const safe = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
      return r.ok ? r.json() : null
    } catch { return null }
  }

  const [bin, bybit, kraken] = await Promise.all([
    safe('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
    safe('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'),
    safe('https://api.kraken.com/0/public/Ticker?pair=XBTUSD'),
  ])

  if (bin?.price)  return +bin.price
  const bybitRow = bybit?.result?.list?.[0]
  if (bybitRow)    return +bybitRow.lastPrice
  const krakenVal = Object.values((kraken?.result ?? {}) as Record<string, { c: [string] }>)[0]
  if (krakenVal)   return +krakenVal.c[0]
  return null
}

// ── TP sequential validator — called before any TP event fires ────────────────
function validateTPEvent(
  sig:     SignalRecord,
  tp:      1 | 2 | 3,
  price:   number,
): { valid: boolean; reason: string } {
  const isLong   = sig.idea.side === 'LONG'
  const tpPrice  = tp === 1 ? sig.idea.tp1 : tp === 2 ? sig.idea.tp2 : sig.idea.tp3
  const entry    = sig.idea.price

  if (tp === 2 && !sig.tp1Hit)
    return { valid: false, reason: `TP2 disparado sin TP1 previo (status: ${sig.status})` }
  if (tp === 3 && !sig.tp1Hit)
    return { valid: false, reason: `TP3 disparado sin TP1 previo (status: ${sig.status})` }
  if (tp === 3 && !sig.tp2Hit)
    return { valid: false, reason: `TP3 disparado sin TP2 previo (status: ${sig.status})` }

  const priceReached = isLong ? price >= tpPrice : price <= tpPrice
  if (!priceReached)
    return { valid: false, reason: `TP${tp} price $${Math.round(tpPrice).toLocaleString()} not yet reached at $${Math.round(price).toLocaleString()}` }

  const pnlAtTP = isLong ? (tpPrice - entry) / entry * 100 : (entry - tpPrice) / entry * 100
  if (pnlAtTP <= 0)
    return { valid: false, reason: `TP${tp} P&L would be ${pnlAtTP.toFixed(2)}% — TPs must be positive` }

  const expectedStatus = tp === 1 ? 'active' : tp === 2 ? 'tp1_hit' : 'tp2_hit'
  if (sig.status !== expectedStatus)
    return { valid: false, reason: `TP${tp} requires status '${expectedStatus}', got '${sig.status}'` }

  return { valid: true, reason: 'OK' }
}

// ── Core: process one signal's price events ───────────────────────────────────
async function processSignal(sig: SignalRecord, price: number, ntfyTopic: string): Promise<string | null> {
  if (!['active', 'tp1_hit', 'tp2_hit'].includes(sig.status)) return null

  const isLong  = sig.idea.side === 'LONG'
  const entry   = sig.idea.price
  const tp1Pnl  = isLong ? (sig.idea.tp1 - entry) / entry * 100 : (entry - sig.idea.tp1) / entry * 100
  const tp2Pnl  = isLong ? (sig.idea.tp2 - entry) / entry * 100 : (entry - sig.idea.tp2) / entry * 100
  const tp3Pnl  = isLong ? (sig.idea.tp3 - entry) / entry * 100 : (entry - sig.idea.tp3) / entry * 100

  // ── 0. SL check — highest priority, always runs first ────────────────────
  const slHit = isLong ? price <= sig.idea.sl : price >= sig.idea.sl

  if (slHit) {
    if (sig.tp2Hit) {
      // SL now at TP1 floor after TP2 — profitable close
      const remainPct  = (sig.remainingSizePct ?? 25) / 100
      const slRawPnl   = isLong ? (sig.idea.sl - entry) / entry * 100 : (entry - sig.idea.sl) / entry * 100
      const finalPnl   = parseFloat(((sig.totalBankedPnl ?? 0) + remainPct * slRawPnl).toFixed(3))
      const updated: SignalRecord = {
        ...sig, status: 'closed_manual', pnl: finalPnl,
        closedAt: new Date().toISOString(), exitPrice: sig.idea.sl,
        closeReason: `SL piso en TP1 tocado tras TP2. TP1+TP2 banqueados.`,
      }
      await saveSignalToCloud(updated)
      await notify(
        tgSLFloor(updated, finalPnl),
        ntfyTopic,
        `SL PISO TOCADO -- ${sig.idea.side} BTC ganancia asegurada`,
        `TP1+TP2 banqueados. SL piso en TP1 tocado.\nP&L total: +${finalPnl.toFixed(2)}%\nTipo: ${sig.idea.tradeType}`,
        4, ['white_check_mark', 'moneybag'],
      )
      console.log(`[MONITOR] TP1-floor SL hit: ${sig.id} P&L ${finalPnl.toFixed(2)}%`)
      return `SL_FLOOR:${sig.id}`
    }

    if (sig.tp1Hit) {
      // Breakeven SL — TP1 was banked, remaining closed at entry
      const banked     = sig.tp1BankedPnl ?? 0
      const remainPct  = (sig.remainingSizePct ?? 60) / 100
      const slRawPnl   = isLong ? (sig.idea.sl - entry) / entry * 100 : (entry - sig.idea.sl) / entry * 100
      const finalPnl   = parseFloat((banked + remainPct * slRawPnl).toFixed(3))
      const updated: SignalRecord = {
        ...sig, status: 'breakeven', pnl: finalPnl,
        closedAt: new Date().toISOString(), exitPrice: sig.idea.sl,
        closeReason: `SL breakeven tocado. TP1 banqueado: +${banked.toFixed(2)}%`,
      }
      await saveSignalToCloud(updated)
      await notify(
        tgBreakeven(updated, banked),
        ntfyTopic,
        `BREAKEVEN TOCADO -- ${sig.idea.side} BTC sin perdida`,
        `TP1 banqueado: +${banked.toFixed(2)}%\nResto cerrado en breakeven.\nP&L total: +${finalPnl.toFixed(2)}%`,
        3, ['shield'],
      )
      console.log(`[MONITOR] Breakeven SL hit: ${sig.id} P&L ${finalPnl.toFixed(2)}%`)
      return `BREAKEVEN:${sig.id}`
    }

    // Pure stop loss
    const slRawPnl = isLong ? (sig.idea.sl - entry) / entry * 100 : (entry - sig.idea.sl) / entry * 100
    const updated: SignalRecord = {
      ...sig, status: 'sl_hit', pnl: parseFloat(slRawPnl.toFixed(3)),
      closedAt: new Date().toISOString(), exitPrice: sig.idea.sl,
      closeReason: `Stop loss ejecutado en $${Math.round(sig.idea.sl).toLocaleString()}`,
    }
    await saveSignalToCloud(updated)
    await notify(
      tgSLCorrection(updated, slRawPnl),
      ntfyTopic,
      `STOP LOSS -- ${sig.idea.side} BTC ${slRawPnl.toFixed(2)}%`,
      `${sig.idea.side} ${sig.idea.tradeType} cerrado\nEntry: $${Math.round(entry).toLocaleString()}\nSL: $${Math.round(sig.idea.sl).toLocaleString()}\nP&L: ${slRawPnl.toFixed(2)}%`,
      5, ['x', 'red_circle'],
    )
    console.log(`[MONITOR] SL hit: ${sig.id} P&L ${slRawPnl.toFixed(2)}%`)
    return `SL_HIT:${sig.id}`
  }

  // ── 1. TP3 — ONLY if both TP1 and TP2 were already hit ──────────────────
  if (sig.tp1Hit && sig.tp2Hit) {
    const v3 = validateTPEvent(sig, 3, price)
    if (!v3.valid) {
      console.error(`[MONITOR] TP3 BLOCKED: ${v3.reason} | ${sig.id}`)
      await sendTelegram(
        `🚨 <b>TP3 bloqueado — validación secuencial</b>\n` +
        `Razón: <i>${v3.reason}</i>\n` +
        `Signal: <code>${sig.id}</code>`,
      ).catch(() => {})
      return null
    }
    const tp3Hit = isLong ? price >= sig.idea.tp3 : price <= sig.idea.tp3
    if (tp3Hit) {
      const tp3ClosePct = sig.tp3ClosePct ?? 25
      const tp3Banked   = parseFloat(((tp3ClosePct / 100) * tp3Pnl).toFixed(3))
      const finalPnl    = parseFloat(((sig.totalBankedPnl ?? 0) + tp3Banked).toFixed(3))
      const updated: SignalRecord = {
        ...sig, status: 'tp3_hit', pnl: finalPnl,
        closedAt: new Date().toISOString(), exitPrice: sig.idea.tp3,
        closeReason: 'TP3 objetivo máximo alcanzado',
      }
      const tp3TgMsg = (
        `🏆 <b>TP3 ALCANZADO — ${sig.idea.side} ${sig.idea.tradeType}</b>\n` +
        `P&L total: <b>+${finalPnl.toFixed(2)}%</b>`
      )
      await saveSignalToCloud(updated)
      await notify(
        tp3TgMsg,
        ntfyTopic,
        `TP3 MAXIMO -- ${sig.idea.side} BTC +${finalPnl.toFixed(2)}%`,
        `Objetivo maximo alcanzado.\n${sig.idea.side} ${sig.idea.tradeType}\nP&L total: +${finalPnl.toFixed(2)}%`,
        5, ['trophy'],
      )
      console.log(`[MONITOR] TP3 hit: ${sig.id}`)
      return `TP3_HIT:${sig.id}`
    }
  }

  // ── 2. TP2 (only if TP1 hit and TP2 not yet hit) ─────────────────────────
  if (sig.tp1Hit && !sig.tp2Hit) {
    const v2 = validateTPEvent(sig, 2, price)
    if (!v2.valid) {
      console.error(`[MONITOR] TP2 BLOCKED: ${v2.reason} | ${sig.id}`)
      return null
    }
    const tp2Hit = isLong ? price >= sig.idea.tp2 : price <= sig.idea.tp2
    if (tp2Hit) {
      const tp2ClosePct    = sig.tp2ClosePct ?? 35
      const tp2Banked      = parseFloat(((tp2ClosePct / 100) * tp2Pnl).toFixed(3))
      const newTotalBanked = parseFloat(((sig.tp1BankedPnl ?? 0) + tp2Banked).toFixed(3))
      const newRemaining   = (sig.remainingSizePct ?? 60) - tp2ClosePct
      const newSL          = sig.idea.tp1  // SL moves to TP1 floor
      const updated: SignalRecord = {
        ...sig, status: 'tp2_hit', tp2Hit: true,
        tp2BankedPnl: tp2Banked, totalBankedPnl: newTotalBanked,
        remainingSizePct: newRemaining,
        idea: { ...sig.idea, sl: newSL },
        tp1BankedPnl: sig.tp1BankedPnl ?? 0,
      }
      await saveSignalToCloud(updated)
      await notify(
        tgTP(updated, 2, tp2Banked),
        ntfyTopic,
        `TP2 ALCANZADO -- ${sig.idea.side} BTC`,
        `Banqueado: +${tp2Banked.toFixed(2)}%\nSL movido a TP1 (profit garantizado)\nRestante: ${newRemaining}%`,
        4, ['white_check_mark', 'white_check_mark'],
      )
      console.log(`[MONITOR] TP2 hit: ${sig.id} banked ${tp2Banked.toFixed(2)}%`)
      return `TP2_HIT:${sig.id}`
    }
  }

  // ── 3. TP1 (only if not yet hit) ─────────────────────────────────────────
  if (!sig.tp1Hit) {
    const v1 = validateTPEvent(sig, 1, price)
    if (!v1.valid) {
      console.error(`[MONITOR] TP1 BLOCKED: ${v1.reason} | ${sig.id}`)
      return null
    }
    const tp1Hit = isLong ? price >= sig.idea.tp1 : price <= sig.idea.tp1
    if (tp1Hit) {
      const tp1ClosePct = sig.tp1ClosePct ?? 40
      const tp1Banked   = parseFloat(((tp1ClosePct / 100) * tp1Pnl).toFixed(3))
      const newRemaining = 100 - tp1ClosePct
      const beBuf        = entry * 0.0015
      const newSL        = parseFloat((isLong ? entry - beBuf : entry + beBuf).toFixed(2))
      const updated: SignalRecord = {
        ...sig, status: 'tp1_hit', tp1Hit: true, breakevenSet: true,
        tp1BankedPnl: tp1Banked, totalBankedPnl: tp1Banked,
        remainingSizePct: newRemaining,
        idea: { ...sig.idea, sl: newSL },
      }
      await saveSignalToCloud(updated)
      await notify(
        tgTP(updated, 1, tp1Banked),
        ntfyTopic,
        `TP1 ALCANZADO -- ${sig.idea.side} BTC`,
        `Banqueado: +${tp1Banked.toFixed(2)}%\nSL movido a breakeven (trade gratuito)\nRestante: ${newRemaining}%`,
        4, ['white_check_mark'],
      )
      console.log(`[MONITOR] TP1 hit: ${sig.id} banked ${tp1Banked.toFixed(2)}%, new SL $${Math.round(newSL).toLocaleString()}`)
      return `TP1_HIT:${sig.id}`
    }
  }

  // ── 4. Expiry — force-close signals past their max trade duration ────────────
  const maxHours = sig.idea.tradeType === 'Scalp'    ? 3
                 : sig.idea.tradeType === 'DayTrade'  ? 26
                 : 0  // Swing: no auto-expiry
  if (maxHours > 0) {
    const openedHrs = (Date.now() - new Date(sig.createdAt).getTime()) / 3_600_000
    if (openedHrs >= maxHours) {
      const rawPnl   = isLong ? (price - entry) / entry * 100 : (entry - price) / entry * 100
      const banked   = sig.totalBankedPnl ?? 0
      const remain   = (sig.remainingSizePct ?? 100) / 100
      const finalPnl = parseFloat((banked + remain * rawPnl).toFixed(3))
      const updated: SignalRecord = {
        ...sig, status: 'closed_manual', pnl: finalPnl,
        closedAt: new Date().toISOString(), exitPrice: price,
        closeReason: `Expirado: ${openedHrs.toFixed(1)}h (máx ${maxHours}h para ${sig.idea.tradeType})`,
      }
      await saveSignalToCloud(updated)
      const expiryMsg = (
        `⏰ <b>SEÑAL EXPIRADA — ${sig.idea.side} ${sig.idea.tradeType}</b>\n\n` +
        `Duración: ${openedHrs.toFixed(1)}h (máx ${maxHours}h)\n` +
        `Cerrada en: <code>$${Math.round(price).toLocaleString()}</code>\n` +
        `P&L: <b>${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(2)}%</b>`
      )
      await notify(
        expiryMsg,
        ntfyTopic,
        `SEÑAL EXPIRADA -- ${sig.idea.side} BTC ${finalPnl.toFixed(2)}%`,
        `${sig.idea.tradeType} expirado tras ${openedHrs.toFixed(1)}h. P&L: ${finalPnl.toFixed(2)}%`,
        3, ['alarm_clock'],
      )
      console.log(`[MONITOR] Expired: ${sig.id} after ${openedHrs.toFixed(1)}h P&L ${finalPnl.toFixed(2)}%`)
      return `EXPIRED:${sig.id}`
    }
  }

  return null
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ntfyTopic = process.env.NTFY_TOPIC ?? ''

  const result = await withLock('monitor', async () => {
    const price = await getBtcPrice()
    if (!price) return { error: 'Price unavailable', processed: [] }
    console.log(`[MONITOR] BTC $${Math.round(price).toLocaleString()}`)

    const sb = getSupabaseServer()
    if (!sb) return { error: 'DB unavailable', processed: [] }

    const { data, error } = await Promise.resolve(
      sb.from('apex_signals')
        .select('*')
        .in('status', ['active', 'tp1_hit', 'tp2_hit'])
        .order('created_at', { ascending: false }),
    ).catch(() => ({ data: null, error: { message: 'fetch failed' } })) as
      { data: Record<string, unknown>[] | null; error: { message: string } | null }

    if (error) console.error('[MONITOR] DB error:', error.message)
    const signals = (data ?? []).map(transformSignal)
    const processed: string[] = []

    for (const sig of signals) {
      try {
        const r = await processSignal(sig, price, ntfyTopic)
        if (r) processed.push(r)
      } catch (e) {
        console.error(`[MONITOR] Error on signal ${sig.id}:`, e instanceof Error ? e.message : e)
      }
    }

    return { price: Math.round(price), signalCount: signals.length, processed }
  })

  if (!result) {
    return NextResponse.json({ status: 'skipped', reason: 'already running' })
  }
  return NextResponse.json({ status: 'ok', ...result })
}
