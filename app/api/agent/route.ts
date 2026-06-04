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
import { getActiveBlockingEvent, getUpcomingEvent, minutesUntilEvent, fetchUpcomingEvents } from '@/lib/macroCalendar'
import { fetchMacroIndicators, fetchFedExpectations }  from '@/lib/macroEconomics'
import { fetchGlobalLiquidity }                        from '@/lib/globalLiquidity'
import { saveSignalToCloud, loadSignalsFromCloud, getSupabaseServer, getSupabase } from '@/lib/supabase'
import { calcLearnedWeights }                             from '@/lib/selfLearning'
import { fetchMarketData }                               from '@/lib/marketFetch'
import { writeTradeAnalysis }                            from '@/lib/analysisWriter'
import { analyzeMacroSentiment }                         from '@/lib/macroSentiment'
import { fetchGlobalMarkets }                            from '@/lib/marketCorrelation'
import { ntfyBBSqueeze }                                 from '@/lib/ntfy'
import { loadAgentState, saveAgentState, detectOpinionChange } from '@/lib/agentMemory'
import { fetchSocialSentiment }       from '@/lib/socialSentiment'
import { generateAgentUpdate, generateDeepAnalysis } from '@/lib/agentVoice'
import { detectElliottWaves }          from '@/lib/elliottWaves'
import { fetchWhaleAlert }             from '@/lib/whaleDetector'
import type { Kline, MarketData, IndicatorMap, SignalRecord } from '@/lib/types'

export const runtime    = 'nodejs'
export const maxDuration = 30

// ── Supabase client — service key preferred, anon key as fallback ─────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDbClient(): any { return getSupabaseServer() ?? getSupabase() }

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
    globalMarkets: { spxChange: number; dxyStrength: string; riskOff: boolean; impact: string } | null
    macro: {
      overallSignal?: string; overallScore?: number; fedTrend?: string; cpiYoY?: number
      m2Trend?: string; liquidityScore?: number; fedExpectations?: string
      nextFOMC?: string; upcomingHighImpact?: number
      yieldCurveT10y2y?: number | null; yieldSignal?: string; sofr?: number | null; cutProbability?: number
    } | null
    scalpSkipped?: string
  } = { time, session: '', regime: '', signals: [], updates: [], errors: [], globalMarkets: null, macro: null }

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

    // ── 1b. Macro sentiment (uses existing mkt data, no extra API calls) ────────
    const macroSentiment = analyzeMacroSentiment(
      [],                    // news not available server-side; UI uses real news
      mkt.fg       ?? 50,
      mkt.funding  ?? 0,
      mkt.lsr      ?? 1,
      mkt.change   ?? 0,
      {},
    )

    // ── 1c. Global markets + FRED macro (parallel, all graceful fallbacks) ──────
    const [globalMarkets, macroIndicators, globalLiquidity, upcomingEvents, socialSentiment, whaleAlert] = await Promise.all([
      fetchGlobalMarkets(),
      fetchMacroIndicators(),
      fetchGlobalLiquidity(),
      fetchUpcomingEvents(),
      fetchSocialSentiment(),
      fetchWhaleAlert(),
    ])

    // Fed expectations (needs fedRate from macroIndicators)
    const fedExpectations = macroIndicators?.fedRate?.current
      ? await fetchFedExpectations(macroIndicators.fedRate.current)
      : null

    results.macro = {
      overallSignal:       macroIndicators?.overallSignal,
      overallScore:        macroIndicators?.overallScore,
      fedTrend:            macroIndicators?.fedRate?.trend,
      cpiYoY:              macroIndicators?.cpi?.yoy,
      m2Trend:             globalLiquidity?.trend,
      liquidityScore:      globalLiquidity?.liquidityIndex,
      fedExpectations:     fedExpectations?.marketSentiment,
      nextFOMC:            fedExpectations?.nextMeetingDate,
      upcomingHighImpact:  (upcomingEvents ?? []).filter(e => e.impact === 'HIGH').length,
      yieldCurveT10y2y:    fedExpectations?.yieldCurve?.t10y2y,
      yieldSignal:         fedExpectations?.yieldCurve?.signal,
      sofr:                fedExpectations?.sofr,
      cutProbability:      fedExpectations?.cutProbability,
    }

    results.globalMarkets = globalMarkets ? {
      spxChange:   globalMarkets.spx.change1h,
      dxyStrength: globalMarkets.dxy.strength,
      riskOff:     globalMarkets.riskOff,
      impact:      globalMarkets.signalImpact,
    } : null

    // Store macro snapshot (fire-and-forget, non-blocking)
    const snapSb = getDbClient()
    if (snapSb) {
      snapSb.from('apex_macro_snapshots').insert({
        macro_score:      macroSentiment.score,
        macro_label:      macroSentiment.label,
        risk_appetite:    macroSentiment.riskAppetite,
        usd_strength:     macroSentiment.usdStrength,
        fg:               mkt.fg ?? null,
        funding:          mkt.funding ?? null,
        lsr:              mkt.lsr ?? null,
        price_change_24h: mkt.change ?? null,
        top_events:       macroSentiment.topEvents,
        crypto_context:   macroSentiment.cryptoSpecific,
        // FRED macro data (Section 7)
        cpi_yoy:                  macroIndicators?.cpi?.yoy ?? null,
        fed_rate:                 macroIndicators?.fedRate?.current ?? null,
        fed_trend:                macroIndicators?.fedRate?.trend ?? null,
        gdp_growth:               macroIndicators?.gdp?.growthRate ?? null,
        m2_yoy:                   macroIndicators?.m2?.yoyChange ?? null,
        treasury_10y:             macroIndicators?.treasury10y?.yield ?? null,
        global_liquidity_score:   globalLiquidity?.liquidityIndex ?? null,
        macro_overall_signal:     macroIndicators?.overallSignal ?? null,
        fed_expectations:         fedExpectations?.marketSentiment ?? null,
      }).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[APEX Macro] snapshot insert error:', error.message)
      })
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

    // ── 3. Load existing signals + compute learned weights ────────────────────
    const allSignals     = await loadSignalsFromCloud() ?? []
    const active         = allSignals.filter(s => s.status === 'active')
    const learnedWeights = await calcLearnedWeights(getDbClient())

    // ── Agent voice helpers — computed once, used in 30min + 4H blocks ────────
    const ew4hResult = klines['4h'].length >= 20 ? detectElliottWaves(klines['4h']) : null
    const ew1dResult = klines['1d'].length >= 20 ? detectElliottWaves(klines['1d']) : null
    const ewMap      = { '4h': ew4hResult, '1d': ew1dResult }
    const fvgsMap    = { '4h': fvg4h, '15m': fvg15m }
    const activeSigData = active.map(s => ({
      side:      s.idea.side,
      entry:     s.idea.price,
      sl:        s.idea.sl,
      tradeType: s.idea.tradeType,
    }))
    let agentOpinionChange: string | null = null   // set inside generate-signal block if bias flips
    const prevStateForVoice = await loadAgentState(getDbClient())

    const TERMINAL_STATUSES = new Set(['closed_manual', 'sl_hit', 'breakeven', 'tp3_hit', 'expired', 'auto_close'])
    for (const sig of active) {
      // Never overwrite a signal that was manually or fully closed
      if (TERMINAL_STATUSES.has(sig.status)) continue

      const isLong = sig.idea.side === 'LONG'
      let updated: SignalRecord = sig
      let changed = false

      // SL hit (or breakeven SL hit after TP1)
      if ((isLong && price <= sig.idea.sl) || (!isLong && price >= sig.idea.sl)) {
        const rawPnl = isLong
          ? (sig.idea.sl - sig.idea.price) / sig.idea.price * 100
          : (sig.idea.price - sig.idea.sl) / sig.idea.price * 100
        const wasBreakeven = (sig as { breakevenSet?: boolean }).breakevenSet === true
          || Math.abs(rawPnl) < 0.15   // SL within 0.15% of entry = breakeven
        const closeStatus  = wasBreakeven ? 'breakeven' : 'sl_hit'
        const closeReason  = wasBreakeven
          ? 'SL en breakeven tocado — trade sin pérdida'
          : 'SL tocado — stop loss ejecutado'
        updated = {
          ...sig,
          status:     closeStatus as SignalRecord['status'],
          pnl:        parseFloat(rawPnl.toFixed(2)),
          closedAt:   time,
          exitPrice:  sig.idea.sl,
          closeReason,
          exitTs:     time,
        }
        if (ntfyTopic) {
          if (wasBreakeven) {
            await ntfy(
              ntfyTopic,
              sanitizeHdr(`BREAKEVEN - ${sig.idea.side} BTC cerrado sin pérdida`),
              [
                `${sig.idea.side} BTC cerrado en breakeven`,
                ``,
                `Entrada: $${Math.round(sig.idea.price).toLocaleString()}`,
                `SL breakeven: $${Math.round(sig.idea.sl).toLocaleString()}`,
                `P&L: ${rawPnl >= 0 ? '+' : ''}${rawPnl.toFixed(2)}% (sin pérdida)`,
                ``,
                `TP1 fue alcanzado — capital protegido ✅`,
              ].join('\n'),
              3, 'shield',
            )
          } else {
            await ntfy(
              ntfyTopic,
              sanitizeHdr(`STOP LOSS TOCADO - ${sig.idea.side} BTC`),
              `SL alcanzado en $${Math.round(sig.idea.sl).toLocaleString()}\nP&L: ${rawPnl.toFixed(2)}%`,
              4, 'rotating_light',
            )
          }
        }
        changed = true
      }
      // TP3
      else if ((isLong && price >= sig.idea.tp3) || (!isLong && price <= sig.idea.tp3)) {
        const pnl = Math.abs(sig.idea.tp3 - sig.idea.price) / sig.idea.price * 100
        updated = { ...sig, status: 'tp3_hit', pnl, closedAt: time, exitPrice: sig.idea.tp3, exitTs: time }
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`TP3 ALCANZADO - ${sig.idea.side} BTC`), `TP3 $${Math.round(sig.idea.tp3).toLocaleString()} | +${pnl.toFixed(2)}%`, 5, 'trophy')
        changed = true
      }
      // TP2 — partial close: stay active, move SL to TP1
      else if (((isLong && price >= sig.idea.tp2) || (!isLong && price <= sig.idea.tp2)) && !sig.tp2Hit) {
        const pnl = Math.abs(sig.idea.tp2 - sig.idea.price) / sig.idea.price * 100
        updated = {
          ...sig,
          tp2Hit: true,
          status: 'active' as SignalRecord['status'],
          idea: { ...sig.idea, sl: sig.idea.tp1 },  // move SL to TP1
          pnl,
        }
        await saveSignalToCloud(updated)  // persist BEFORE NTFY to prevent re-fire
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`🎯🎯 TP2 TOCADO - ${sig.idea.side} BTC`), `TP2 $${Math.round(sig.idea.tp2).toLocaleString()} | +${pnl.toFixed(2)}% | SL movido a TP1`, 4, 'green_circle')
        changed = true
      }
      // TP1 — partial close: stay active, move SL to breakeven (entry)
      else if (((isLong && price >= sig.idea.tp1) || (!isLong && price <= sig.idea.tp1)) && !sig.tp1Hit) {
        const pnl = isLong
          ? (sig.idea.tp1 - sig.idea.price) / sig.idea.price * 100
          : (sig.idea.price - sig.idea.tp1) / sig.idea.price * 100
        updated = {
          ...sig,
          tp1Hit: true,
          status: 'active' as SignalRecord['status'],
          idea: { ...sig.idea, sl: sig.idea.price },  // move SL to entry (breakeven)
          pnl,
        }
        await saveSignalToCloud(updated)  // persist BEFORE NTFY to prevent re-fire
        if (ntfyTopic) await ntfy(ntfyTopic, sanitizeHdr(`🎯 TP1 TOCADO - ${sig.idea.side} BTC`), `TP1 $${Math.round(sig.idea.tp1).toLocaleString()} | +${pnl.toFixed(2)}% | SL en breakeven`, 3, 'green_circle')
        changed = true
      }

      // Trailing stop / breakeven (only if still active, and only fire NTFY once per action)
      if (updated.status === 'active') {
        const tf = sig.idea.tradeType === 'Scalp' ? klines['15m'] : klines['4h']
        const stopUpdate = evaluateStopManagement(updated, price, tf)
        if (stopUpdate) {
          const isBreakeven   = stopUpdate.action === 'move_to_breakeven'
          const isTrail2      = stopUpdate.action === 'trail_to_tp1'
          const alreadyBE     = (sig as { breakevenSet?: boolean }).breakevenSet  ?? false
          const alreadyTrail2 = (sig as { trailing2Set?: boolean }).trailing2Set  ?? false
          // Only fire NTFY if this action hasn't been fired before
          const shouldNotify  = (isBreakeven && !alreadyBE) || (isTrail2 && !alreadyTrail2) || (!isBreakeven && !isTrail2)
          updated = {
            ...updated,
            idea: { ...updated.idea, sl: stopUpdate.newSL },
          } as SignalRecord
          ;(updated as { breakevenSet?: boolean }).breakevenSet    = isBreakeven ? true : alreadyBE
          ;(updated as { trailing2Set?: boolean }).trailing2Set    = isTrail2    ? true : alreadyTrail2
          ;(updated as { trailingActive?: boolean }).trailingActive = stopUpdate.pnlProtected > 0
          if (shouldNotify && ntfyTopic) await ntfy(
            ntfyTopic,
            sanitizeHdr(`${isBreakeven ? 'BREAKEVEN ACTIVADO' : 'TRAILING SL'} - ${sig.idea.side} BTC`),
            `${stopUpdate.reason}\nSL: $${Math.round(stopUpdate.oldSL).toLocaleString()} → $${Math.round(stopUpdate.newSL).toLocaleString()}`,
            3, 'shield',
          )
          results.updates.push({ id: sig.id, action: stopUpdate.action, newSL: stopUpdate.newSL })
          changed = true
        }
      }

      if (changed) {
        await saveSignalToCloud(updated)
        // Record outcome in apex_decisions for fully closed signals only (tp3 or sl)
        const wasClosed = (['sl_hit', 'breakeven', 'tp3_hit'] as string[]).includes(updated.status)
        const closeSb = getDbClient()
        if (closeSb && wasClosed && updated.pnl != null) {
          const outcome = updated.status === 'breakeven'
            ? 'breakeven'
            : updated.pnl > 0.1 ? 'win' : 'loss'
          await closeSb.from('apex_decisions')
            .update({ outcome, pnl: updated.pnl })
            .eq('signal_id', sig.id)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) console.error('[APEX Decisions] outcome update error:', error.message)
            })
        }
      }
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
      const newSignal = scoreTradeIdea(mkt, inds, obVal, rawK, undefined, allSignals, learnedWeights, macroSentiment, macroIndicators ?? undefined, globalLiquidity ?? undefined, fedExpectations ?? undefined, socialSentiment ?? undefined, whaleAlert ?? undefined)

      // ── Agent memory: detect & record opinion changes ────────────────────────
      const memorySb    = getDbClient()
      const newBias     = newSignal ? newSignal.side : 'NEUTRAL'
      const opinionNote = detectOpinionChange(prevStateForVoice, newBias, newSignal ?? null, inds, regime ?? null)
      if (opinionNote) agentOpinionChange = opinionNote
      // Save new state (fire-and-forget)
      saveAgentState(memorySb, {
        id:             'current',
        lastBias:       newBias,
        lastTradeType:  newSignal?.tradeType ?? null,
        lastConfidence: newSignal?.confidence ?? null,
        lastPrice:      mkt.price ?? 0,
        lastScore:      newSignal?.maxSc ?? 0,
        changeReason:   opinionNote,
        updatedAt:      new Date().toISOString(),
      }).catch(() => {})

      // ── Block longs in global risk-off environment ───────────────────────────
      const blockedByCorrelation =
        globalMarkets?.signalImpact === 'BLOCK_LONGS' && newSignal?.side === 'LONG'
      if (blockedByCorrelation) {
        results.errors.push(`[APEX Correlation] Long bloqueado: ${globalMarkets!.btcCorrelation}`)
      }

      // ── Log decision to apex_decisions (learn from everything, win or skip) ──
      const sb = getDbClient()
      if (sb) {
        const decisionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        await sb.from('apex_decisions').insert({
          id:            decisionId,
          decision_type: newSignal ? 'signal_generated' : 'signal_skipped',
          side:          newSignal?.side ?? null,
          trade_type:    newSignal?.tradeType ?? null,
          score:         newSignal?.maxSc ?? null,
          confidence:    newSignal?.confidence ?? null,
          regime:        regime?.regime ?? null,
          session:       session.name,
          bias_1d:       inds['1d']?.bias ?? null,
          bias_4h:       inds['4h']?.bias ?? null,
          bias_1h:       inds['1h']?.bias ?? null,
          rsi_4h:        inds['4h']?.rsi ?? null,
          macd_4h:       inds['4h']?.macd?.hist ?? null,
          stoch_4h:      inds['4h']?.stoch?.k ?? null,
          fg:            mkt.fg ?? null,
          funding:       mkt.funding ?? null,
          skip_reason:   blockedByCorrelation ? 'correlation_risk_off' : newSignal ? null : 'score_or_filter',
          signal_id:     null,   // updated after saveSignalToCloud
        }).then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error('[APEX Decisions] insert error:', error.message)
        })
      }

      if (newSignal && !newSignal.consolidation && !blockedByCorrelation) {
        // Dedup: don't add same-side signal if one already active
        const sameActive = active.some(s => s.idea.side === newSignal.side && s.status === 'active')
        if (!sameActive && shouldGenerateSignal(newSignal.tradeType, newSignal.confidence)) {
          const recId = Date.now().toString()
          const rec: SignalRecord = {
            id:        recId,
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
              analysis:   [
                            opinionNote,
                            writeTradeAnalysis({ idea: newSignal, inds, mkt, regime: regime ?? null,
                              macroIndicators:  macroIndicators ?? null,
                              globalLiquidity:  globalLiquidity ?? null,
                              fedExpectations:  fedExpectations ?? null,
                              upcomingEvents:   upcomingEvents ?? [],
                              socialSentiment:  socialSentiment ?? null,
                              whaleAlert:       whaleAlert ?? null,
                            }),
                          ].filter(Boolean).join('\n\n'),
              ts:         new Date(time),
            },
          }
          await saveSignalToCloud(rec)
          // Link decision record to the generated signal
          if (sb) {
            await sb.from('apex_decisions')
              .update({ signal_id: recId, decision_type: 'signal_generated' })
              .eq('session', session.name)
              .is('signal_id', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .then(({ error }: { error: { message: string } | null }) => {
                if (error) console.error('[APEX Decisions] link error:', error.message)
              })
          }
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
        // Dedup: skip if a similar scalp already exists (same side, entry within 0.5%, last 2h)
        const twoHoursAgo = Date.now() - 2 * 3_600_000
        const duplicate = allSignals.find(s =>
          s.idea.tradeType === 'Scalp' &&
          s.status === 'active' &&
          s.idea.side === scalpSig.side &&
          Math.abs(s.idea.price - scalpSig.entry) / scalpSig.entry < 0.005 &&
          new Date(s.createdAt).getTime() > twoHoursAgo,
        )

        // Secondary dedup: any scalp already notified in the last 1h (catches save-failure re-fires)
        const oneHourAgo = Date.now() - 60 * 60_000
        const recentlyNotified = allSignals.find(s =>
          s.idea.tradeType === 'Scalp' &&
          s.ntfySent === true &&
          new Date(s.createdAt).getTime() > oneHourAgo,
        )

        if (duplicate || recentlyNotified) {
          results.scalpSkipped = duplicate ? 'duplicate' : 'ntfy_sent_recently'
        } else {
          const rec: SignalRecord = {
            id:          String(Date.now()),   // numeric-only — bigint compatible
            createdAt:   time,
            status:      'active',
            exitPrice:   null,
            exitTs:      null,
            pnl:         null,
            pnlR:        null,
            closedAt:    null,
            closeReason: null,
            ntfySent:    true,                 // mark before saving to prevent re-fire
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
          await saveSignalToCloud(rec)   // persist ntfySent=true BEFORE sending NTFY
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
    }

    // ── 6. Periodic market analysis NTFY ─────────────────────────────────────

    if ((mins === 0 || mins === 30) && session.quality !== 'avoid' && ntfyTopic) {
      const upcoming = getUpcomingEvent(Date.now(), 4 * 60 * 60_000)
      const opinionLines = agentOpinionChange ? [agentOpinionChange] : []
      const update = generateAgentUpdate(
        price,
        prevStateForVoice?.lastPrice ?? price,
        inds,
        regime,
        session,
        macroSentiment,
        macroIndicators,
        fedExpectations,
        [],                  // news not fetched server-side
        whaleAlert,
        null,                // realDelta  — future
        ewMap,
        fvgsMap,
        liquidity,
        activeSigData,
        opinionLines,
        null,                // patternMatch — future
        globalMarkets,
      )
      const upcomingNote = upcoming
        ? `\n\n⚠️ ${upcoming.name} en ${minutesUntilEvent(upcoming)}min — precaución`
        : ''
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`APEX ${session.name} — $${Math.round(price).toLocaleString()}`),
        update + upcomingNote,
        2,
        'bar_chart',
      )
    }

    if (mins === 0 && hours % 4 === 0 && ntfyTopic) {
      const deepAnalysis = generateDeepAnalysis(
        price,
        inds,
        regime,
        macroIndicators,
        fedExpectations,
        globalLiquidity,
        ewMap,
        [],                  // patterns — pass empty; candlePatterns used in scoring, not stored here
        activeSigData,
        null,                // perfStats — future
        learnedWeights,
      )
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`APEX Analisis 4H — $${Math.round(price).toLocaleString()}`),
        deepAnalysis,
        3,
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
