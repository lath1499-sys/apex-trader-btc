// APEX Background Agent — runs 24/7 via Vercel Cron Jobs
// Handles both Normal and Scalp signals, SL/TP monitoring,
// trailing stop management, and session-aware signal generation.

import { NextResponse }            from 'next/server'
import { runInds }                 from '@/lib/indicators'
import { scoreTradeIdea }          from '@/lib/tradeScoring'
import { detectFVGs }              from '@/lib/fvg'
import { detectLiquidity }         from '@/lib/liquidity'
import { detectMarketRegime }      from '@/lib/marketRegime'
import { detectScalpSignals, detectBOSCHoCH, getICTKillzones, calcVWAP } from '@/lib/scalpSignals'
import { evaluateStopManagement }  from '@/lib/stopManagement'
import { getCurrentTradingSession, shouldGenerateSignal } from '@/lib/tradingHours'
import { getActiveBlockingEvent, getUpcomingEvent, minutesUntilEvent } from '@/lib/macroCalendar'
import { saveSignalToCloud, loadSignalsFromCloud }        from '@/lib/supabase'
import { fetchMarketData }                               from '@/lib/marketFetch'
import { writeTradeAnalysis }                            from '@/lib/analysisWriter'
import { ntfyBBSqueeze }                                 from '@/lib/ntfy'
import type { Kline, MarketData, IndicatorMap, SignalRecord } from '@/lib/types'

export const runtime    = 'nodejs'
export const maxDuration = 30

// ── Server-side NTFY (no localStorage — uses env var directly) ───────────────

function sanitizeHdr(s: string): string {
  return s.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim() || 'APEX'
}

async function ntfy(topic: string, title: string, body: string, priority = 3, tags = 'chart_with_upwards_trend'): Promise<void> {
  if (!topic) return
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title':        sanitizeHdr(title),
        'Priority':     String(priority),
        'Tags':         tags,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body,
    })
  } catch (e) {
    console.error('[APEX Agent] NTFY error:', e)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toKlines(arr: { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined): Kline[] {
  return (arr ?? []).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }))
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ntfyTopic = process.env.NTFY_TOPIC ?? ''
  const time      = new Date().toISOString()
  const results: {
    time: string; session: string; regime: string
    signals: Array<{ type: string; side: string; confidence: string }>
    updates: Array<{ id: string; action: string; newSL: number }>
    errors:  string[]
  } = { time, session: '', regime: '', signals: [], updates: [], errors: [] }

  try {
    // ── 1. Fetch market data (direct import — no HTTP hop, no geo-block risk) ──
    const md    = await fetchMarketData()
    // Price: Binance → Bybit → Kraken
    const price = md.price ?? md.bybitPrice ?? md.krakenPrice ?? 0
    if (!price) return NextResponse.json({ error: 'Failed to fetch price' }, { status: 503 })

    const klines = {
      '1d':  toKlines(md.klines['1d']  as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
      '4h':  toKlines(md.klines['4h']  as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
      '1h':  toKlines(md.klines['1h']  as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
      '15m': toKlines(md.klines['15m'] as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
    }

    if (!klines['4h'].length) return NextResponse.json({ error: 'No 4H klines' }, { status: 503 })

    const obVal = md.orderBook

    const mkt: MarketData = {
      loading:  false,
      price,
      change:   md.change   ?? 0,
      funding:  md.funding  ?? undefined,
      lsr:      md.lsr      ?? 1,
      fg:       md.fg       ?? undefined,
      fgLabel:  md.fgLabel  ?? undefined,
    }

    // ── 2. Indicators, regime, FVGs, liquidity ────────────────────────────────
    const inds: IndicatorMap = {
      '1d':  klines['1d'].length  ? runInds(klines['1d'])  ?? undefined : undefined,
      '4h':  runInds(klines['4h']) ?? undefined,
      '1h':  klines['1h'].length  ? runInds(klines['1h'])  ?? undefined : undefined,
      '15m': klines['15m'].length ? runInds(klines['15m']) ?? undefined : undefined,
    }

    const regime    = klines['4h'].length >= 20 ? detectMarketRegime(klines['4h']) : null
    const fvg4h     = detectFVGs(klines['4h'])
    const fvg15m    = detectFVGs(klines['15m'])
    const liquidity = detectLiquidity(klines['4h'])
    const session   = getCurrentTradingSession()
    results.session = session.name
    results.regime  = regime?.regime ?? 'UNKNOWN'

    // Pre-declare time components used in multiple blocks below
    const nowUtc = new Date()
    const mins   = nowUtc.getUTCMinutes()
    const hours  = nowUtc.getUTCHours()

    // ── 3. Load existing signals, monitor SL/TP + stop management ────────────
    const allSignals  = await loadSignalsFromCloud() ?? []
    const active      = allSignals.filter(s => s.status === 'active')

    for (const sig of active) {
      const isLong = sig.idea.side === 'LONG'
      let updated: SignalRecord = sig
      let changed = false

      // SL hit
      if ((isLong && price <= sig.idea.sl) || (!isLong && price >= sig.idea.sl)) {
        const pnl = isLong
          ? (sig.idea.sl - sig.idea.price) / sig.idea.price * 100
          : (sig.idea.price - sig.idea.sl) / sig.idea.price * 100
        updated = { ...sig, status: 'sl_hit', pnl, closedAt: time, exitPrice: sig.idea.sl, closeReason: 'SL tocado', exitTs: time }
        if (ntfyTopic) await ntfy(
          ntfyTopic,
          sanitizeHdr(`STOP LOSS TOCADO - ${sig.idea.side} BTC`),
          `SL alcanzado en $${Math.round(sig.idea.sl).toLocaleString()}\nP&L: ${pnl.toFixed(2)}%`,
          4, 'rotating_light',
        )
        changed = true
      }
      // TP3
      else if ((isLong && price >= sig.idea.tp3) || (!isLong && price <= sig.idea.tp3)) {
        const pnl = Math.abs(sig.idea.tp3 - sig.idea.price) / sig.idea.price * 100
        updated = { ...sig, status: 'tp3_hit', pnl, closedAt: time, exitPrice: sig.idea.tp3, exitTs: time }
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`TP3 ALCANZADO - ${sig.idea.side} BTC`), `TP3 $${Math.round(sig.idea.tp3).toLocaleString()} | +${pnl.toFixed(2)}%`, 5, 'trophy')
        changed = true
      }
      // TP2
      else if (((isLong && price >= sig.idea.tp2) || (!isLong && price <= sig.idea.tp2)) && !(sig as { tp2Hit?: boolean }).tp2Hit) {
        const pnl = Math.abs(sig.idea.tp2 - sig.idea.price) / sig.idea.price * 100
        updated = { ...sig, pnl } as SignalRecord
        ;(updated as { tp2Hit?: boolean }).tp2Hit = true
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`TP2 ALCANZADO - ${sig.idea.side} BTC`), `TP2 $${Math.round(sig.idea.tp2).toLocaleString()} | +${pnl.toFixed(2)}%`, 4, 'green_circle')
        changed = true
      }
      // TP1
      else if (((isLong && price >= sig.idea.tp1) || (!isLong && price <= sig.idea.tp1)) && !(sig as { tp1Hit?: boolean }).tp1Hit) {
        ;(updated as { tp1Hit?: boolean }).tp1Hit = true
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`TP1 ALCANZADO - ${sig.idea.side} BTC`), `TP1 $${Math.round(sig.idea.tp1).toLocaleString()} — mover SL a breakeven`, 3, 'green_circle')
        changed = true
      }

      // Trailing stop / breakeven (only if still active)
      if (updated.status === 'active') {
        const tf = sig.idea.tradeType === 'Scalp' ? klines['15m'] : klines['4h']
        const stopUpdate = evaluateStopManagement(updated, price, tf)
        if (stopUpdate) {
          updated = {
            ...updated,
            idea: { ...updated.idea, sl: stopUpdate.newSL },
          } as SignalRecord
          ;(updated as { breakevenSet?: boolean }).breakevenSet  = stopUpdate.action === 'move_to_breakeven' ? true : (sig as { breakevenSet?: boolean }).breakevenSet
          ;(updated as { trailing2Set?: boolean }).trailing2Set  = stopUpdate.action === 'trail_to_tp1'      ? true : (sig as { trailing2Set?: boolean }).trailing2Set
          ;(updated as { trailingActive?: boolean }).trailingActive = stopUpdate.pnlProtected > 0            ? true : (sig as { trailingActive?: boolean }).trailingActive
          if (ntfyTopic) await ntfy(
            ntfyTopic,
            sanitizeHdr(`${stopUpdate.action === 'move_to_breakeven' ? 'BREAKEVEN ACTIVADO' : 'TRAILING SL'} - ${sig.idea.side} BTC`),
            `${stopUpdate.reason}\nSL: $${Math.round(stopUpdate.oldSL).toLocaleString()} -> $${Math.round(stopUpdate.newSL).toLocaleString()}`,
            3, 'shield',
          )
          results.updates.push({ id: sig.id, action: stopUpdate.action, newSL: stopUpdate.newSL })
          changed = true
        }
      }

      if (changed) await saveSignalToCloud(updated)
    }

    // ── 3b. Macro event blocker — alert once when a block window starts ────────
    const macroBlock = getActiveBlockingEvent()
    if (macroBlock && ntfyTopic && mins === 0) {
      // Only notify at the top of each hour to avoid spam
      const minsToEvent = minutesUntilEvent(macroBlock)
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`MACRO EVENT: ${macroBlock.name} — SENAL PAUSADA`),
        [
          `⚠️ ${macroBlock.label}`,
          `Impacto: ${macroBlock.impact}`,
          minsToEvent > 0
            ? `En ${minsToEvent} minutos`
            : `Hace ${Math.abs(minsToEvent)} minutos (ventana post-evento activa)`,
          ``,
          `Scalps y DayTrades bloqueados temporalmente.`,
          `Swings con confluencias altas pueden continuar.`,
          `Precio actual: $${Math.round(price).toLocaleString()}`,
        ].join('\n'),
        4,
        'warning,no_entry',
      )
    }

    // ── 4. Generate new Normal signal ─────────────────────────────────────────
    const activeCount  = active.filter(s => s.status === 'active').length
    const rawK = { '1d': klines['1d'], '4h': klines['4h'], '1h': klines['1h'], '15m': klines['15m'] }

    if (activeCount < 3) {
      const newSignal = scoreTradeIdea(mkt, inds, obVal, rawK, undefined, allSignals)

      if (newSignal && !newSignal.consolidation) {
        // Dedup: don't add same-side signal if one already active
        const sameActive = active.some(s => s.idea.side === newSignal.side && s.status === 'active')
        if (!sameActive && shouldGenerateSignal(newSignal.tradeType, newSignal.confidence)) {
          const rec: SignalRecord = {
            id:        Date.now().toString(),
            createdAt: time,
            status:    'active',
            exitPrice: null,
            exitTs:    null,
            pnl:       null,
            pnlR:      null,
            closedAt:  null,
            closeReason: null,
            idea:      {
              side:       newSignal.side,
              tradeType:  newSignal.tradeType,
              confidence: newSignal.confidence,
              price:      newSignal.price,
              sl:         newSignal.sl,
              tp1:        newSignal.tp1,
              tp2:        newSignal.tp2,
              tp3:        newSignal.tp3,
              maxLev:     newSignal.maxLev,
              bull:       newSignal.bull,
              bear:       newSignal.bear,
              maxSc:      newSignal.maxSc,
              reasons:    newSignal.reasons,
              analysis:   writeTradeAnalysis({ idea: newSignal, inds, mkt, regime: regime ?? null }),
              ts:         new Date(time),
            },
          }
          await saveSignalToCloud(rec)
          if (ntfyTopic && newSignal.confidence !== 'BAJA') {
            const reasons = newSignal.reasons.slice(0, 3).map(r => r.txt).join('\n')
            await ntfy(
              ntfyTopic,
              sanitizeHdr(`APEX SIGNAL: ${newSignal.side} BTC - ${newSignal.confidence}`),
              [
                `${newSignal.side === 'LONG' ? '▲ LONG' : '▼ SHORT'} BTC/USDT | ${newSignal.tradeType}`,
                `Entrada: $${Math.round(newSignal.price).toLocaleString()}`,
                `SL:  $${Math.round(newSignal.sl).toLocaleString()}`,
                `TP1: $${Math.round(newSignal.tp1).toLocaleString()}`,
                `TP2: $${Math.round(newSignal.tp2).toLocaleString()}`,
                ``,
                reasons,
                `Leverage: ${newSignal.maxLev}x | Score: ${newSignal.maxSc}`,
              ].join('\n'),
              newSignal.confidence === 'ALTA' ? 5 : 3,
              newSignal.side === 'LONG' ? 'green_circle,chart_with_upwards_trend' : 'red_circle,chart_with_downwards_trend',
            )
          }
          results.signals.push({ type: newSignal.tradeType, side: newSignal.side, confidence: newSignal.confidence })
        }
      }
    }

    // ── 5. Generate Scalp signal (only during valid sessions + killzone) ───────
    const hasActiveScalp = active.some(s => s.idea.tradeType === 'Scalp' && s.status === 'active')

    if (!hasActiveScalp && shouldGenerateSignal('Scalp', 'MEDIA') && klines['15m'].length >= 14) {
      // Compute VWAP from today's 15m candles
      const todayMs    = new Date().setUTCHours(0, 0, 0, 0)
      const intraday   = klines['15m'].filter(k => k.t >= todayMs)
      const vwapResult = calcVWAP(intraday.length >= 5 ? intraday : klines['15m'])

      const kz         = getICTKillzones()
      const bosChoch   = detectBOSCHoCH(klines['15m'])
      const cvd        = { cvd: [] as number[], delta: [] as number[] }  // not available server-side

      const scalpSig = detectScalpSignals(
        price, klines['15m'], klines['1h'],
        vwapResult, cvd, bosChoch, kz,
        fvg15m, liquidity, obVal,
        mkt.funding ?? undefined,
      )

      if (scalpSig && scalpSig.confidence !== 'BAJA') {
        const rec: SignalRecord = {
          id:        `scalp_${Date.now()}`,
          createdAt: time,
          status:    'active',
          exitPrice: null,
          exitTs:    null,
          pnl:       null,
          pnlR:      null,
          closedAt:  null,
          closeReason: null,
          idea: {
            side:       scalpSig.side,
            tradeType:  'Scalp',
            confidence: scalpSig.confidence,
            price:      scalpSig.entry,
            sl:         scalpSig.sl,
            tp1:        scalpSig.tp1,
            tp2:        scalpSig.tp2,
            tp3:        scalpSig.tp3,
            maxLev:     scalpSig.maxLeverage,
            bull:       0, bear: 0, maxSc: scalpSig.score,
            reasons:    scalpSig.reasons.map(r => ({ s: 'bull' as const, txt: r })),
            analysis:   `Scalp ${scalpSig.side} | ${scalpSig.killzone ?? ''} | ${scalpSig.qualityLabel}`,
            ts:         new Date(time),
          },
        }
        await saveSignalToCloud(rec)
        if (ntfyTopic) {
          await ntfy(
            ntfyTopic,
            sanitizeHdr(`APEX SCALP: ${scalpSig.side} BTC - ${scalpSig.confidence}`),
            [
              `⚡ SCALP ${scalpSig.side} | ${scalpSig.killzone ?? session.name}`,
              `Entrada: $${Math.round(scalpSig.entry).toLocaleString()}`,
              `SL:  $${Math.round(scalpSig.sl).toLocaleString()}`,
              `TP1: $${Math.round(scalpSig.tp1).toLocaleString()}`,
              `Duración estimada: ${scalpSig.duration}`,
              ``,
              scalpSig.reasons.slice(0, 3).join('\n'),
            ].join('\n'),
            4,
            'zap,chart_with_upwards_trend',
          )
        }
        results.signals.push({ type: 'Scalp', side: scalpSig.side, confidence: scalpSig.confidence })
      }
    }

    // ── 6. Periodic market analysis NTFY ─────────────────────────────────────

    if ((mins === 0 || mins === 30) && session.quality !== 'avoid' && ntfyTopic) {
      const regimeDesc  = regime?.description ?? 'N/A'
      const i4          = inds['4h']
      const upcoming    = getUpcomingEvent(Date.now(), 4 * 60 * 60_000) // next 4h
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`APEX Analisis 30min - ${session.name}`),
        [
          `Precio: $${Math.round(price).toLocaleString()} | ${session.name}`,
          `Regimen: ${regimeDesc}`,
          i4 ? `4H: ${i4.bias} | RSI ${i4.rsi?.toFixed(0)} | MACD ${i4.macd.hist > 0 ? 'alcista' : 'bajista'}` : '',
          `Señales activas: ${activeCount}`,
          `Funding: ${mkt.funding != null ? mkt.funding.toFixed(4) + '%' : 'N/A'} | F&G: ${mkt.fg ?? 'N/A'}`,
          upcoming ? `⚠️ ${upcoming.name} en ${minutesUntilEvent(upcoming)}min — precaución` : '',
        ].filter(Boolean).join('\n'),
        1,
        'bar_chart',
      )
    }

    if (mins === 0 && hours % 4 === 0 && ntfyTopic) {
      const i4 = inds['4h']
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`APEX Analisis 4H - hora ${hours}:00 UTC`),
        [
          `Precio: $${Math.round(price).toLocaleString()}`,
          `Regimen: ${regime?.description ?? 'N/A'}`,
          i4 ? `4H bias: ${i4.bias} (${i4.score}/9) | RSI ${i4.rsi?.toFixed(0)}` : '',
          `Sesion: ${session.name} (${session.quality.toUpperCase()})`,
          `Señales activas: ${activeCount}`,
        ].filter(Boolean).join('\n'),
        2,
        'bar_chart,clock4',
      )
    }

    // ── 7. BB Squeeze alert — max once per 4 hours ────────────────────────────
    // Fires when BB Width 4H drops below 0.8% (extreme compression — breakout imminent)
    // Spam guard: only when mins === 0 && hours % 4 === 0 (coincides with 4H analysis block)
    if (regime && regime.bbWidthPct < 0.8 && mins === 0 && hours % 4 === 0 && ntfyTopic) {
      await ntfyBBSqueeze(price, regime.bbWidthPct, ntfyTopic)
    }

    return NextResponse.json({ status: 'ok', ...results })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[APEX Agent] Error:', msg)
    results.errors.push(msg)
    return NextResponse.json({ error: msg, ...results }, { status: 500 })
  }
}
