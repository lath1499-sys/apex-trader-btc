// APEX Monitor — SL/TP price checks ONLY.
// Runs every 1 min. No Claude. Completes in <15s.
// Prevents double-close by being the fast, authoritative SL/TP handler.

import { NextResponse }                              from 'next/server'
import { withLock }                                  from '@/lib/runLock'
import { getSupabaseServer, transformSignal }         from '@/lib/supabase'
import { saveSignalToCloud }                          from '@/lib/supabase'
import { sendTelegram, tgTP, tgBreakeven, tgSLFloor } from '@/lib/telegram'
import type { SignalRecord }                          from '@/lib/types'

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

// ── Core: process one signal's price events ───────────────────────────────────
async function processSignal(sig: SignalRecord, price: number): Promise<string | null> {
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
      await sendTelegram(tgSLFloor(updated, finalPnl))
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
      await sendTelegram(tgBreakeven(updated, banked))
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
    await sendTelegram(
      `❌ <b>STOP LOSS — ${sig.idea.side} ${sig.idea.tradeType}</b>\n\n` +
      `⚙️ SL ejecutado automáticamente\n\n` +
      `Entry: <code>$${Math.round(entry).toLocaleString()}</code>\n` +
      `SL: <code>$${Math.round(sig.idea.sl).toLocaleString()}</code>\n` +
      `P&L: <b>${slRawPnl.toFixed(2)}%</b>\n\n` +
      `Capital libre para próxima señal.`,
    )
    console.log(`[MONITOR] SL hit: ${sig.id} P&L ${slRawPnl.toFixed(2)}%`)
    return `SL_HIT:${sig.id}`
  }

  // ── 1. TP3 ────────────────────────────────────────────────────────────────
  const tp3Hit = isLong ? price >= sig.idea.tp3 : price <= sig.idea.tp3
  if (tp3Hit) {
    const tp3ClosePct  = sig.tp3ClosePct ?? 25
    const tp3Banked    = parseFloat(((tp3ClosePct / 100) * tp3Pnl).toFixed(3))
    const finalPnl     = parseFloat(((sig.totalBankedPnl ?? 0) + tp3Banked).toFixed(3))
    const updated: SignalRecord = {
      ...sig, status: 'tp3_hit', pnl: finalPnl,
      closedAt: new Date().toISOString(), exitPrice: sig.idea.tp3,
      closeReason: 'TP3 objetivo máximo alcanzado',
    }
    await saveSignalToCloud(updated)
    await sendTelegram(
      `🏆 <b>TP3 ALCANZADO — ${sig.idea.side} ${sig.idea.tradeType}</b>\n` +
      `P&L total: <b>+${finalPnl.toFixed(2)}%</b>`,
    )
    console.log(`[MONITOR] TP3 hit: ${sig.id}`)
    return `TP3_HIT:${sig.id}`
  }

  // ── 2. TP2 (only if TP1 hit and TP2 not yet hit) ─────────────────────────
  if (sig.tp1Hit && !sig.tp2Hit) {
    const tp2Hit = isLong ? price >= sig.idea.tp2 : price <= sig.idea.tp2
    if (tp2Hit) {
      const tp2ClosePct    = sig.tp2ClosePct ?? 35
      const tp2Banked      = parseFloat(((tp2ClosePct / 100) * tp2Pnl).toFixed(3))
      const newTotalBanked = parseFloat(((sig.tp1BankedPnl ?? 0) + tp2Banked).toFixed(3))
      const newRemaining   = (sig.remainingSizePct ?? 60) - tp2ClosePct
      const buffer         = entry * 0.0015
      const newSL          = sig.idea.tp1  // SL moves to TP1 floor
      const updated: SignalRecord = {
        ...sig, status: 'tp2_hit', tp2Hit: true,
        tp2BankedPnl: tp2Banked, totalBankedPnl: newTotalBanked,
        remainingSizePct: newRemaining,
        idea: { ...sig.idea, sl: newSL },
        tp1BankedPnl: sig.tp1BankedPnl ?? 0,
      }
      // suppress unused-var for buffer (only used in TP1 below)
      void buffer
      await saveSignalToCloud(updated)
      await sendTelegram(tgTP(updated, 2, tp2Banked))
      console.log(`[MONITOR] TP2 hit: ${sig.id} banked ${tp2Banked.toFixed(2)}%`)
      return `TP2_HIT:${sig.id}`
    }
  }

  // ── 3. TP1 (only if not yet hit) ─────────────────────────────────────────
  if (!sig.tp1Hit) {
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
      await sendTelegram(tgTP(updated, 1, tp1Banked))
      console.log(`[MONITOR] TP1 hit: ${sig.id} banked ${tp1Banked.toFixed(2)}%, new SL $${Math.round(newSL).toLocaleString()}`)
      return `TP1_HIT:${sig.id}`
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
        const r = await processSignal(sig, price)
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
