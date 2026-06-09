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
import { saveSignalToCloud, loadSignalsFromCloud, getSupabaseServer, getSupabase, transformSignal } from '@/lib/supabase'
import { calcLearnedWeights }                             from '@/lib/selfLearning'
import { fetchMarketData }                               from '@/lib/marketFetch'
import { writeTradeAnalysis }                            from '@/lib/analysisWriter'
import { analyzeMacroSentiment }                         from '@/lib/macroSentiment'
import { fetchGlobalMarkets }                            from '@/lib/marketCorrelation'
import { ntfyBBSqueeze }                                 from '@/lib/ntfy'
import { loadAgentState, saveAgentState, detectOpinionChange } from '@/lib/agentMemory'
import { fetchSocialSentiment }       from '@/lib/socialSentiment'
import { generateAgentUpdate, generateDeepAnalysis, type AgentUpdateParams } from '@/lib/agentVoice'
import { detectElliottWaves }          from '@/lib/elliottWaves'
import { fetchWhaleAlert }             from '@/lib/whaleDetector'
import { checkCircuitBreaker }         from '@/lib/circuitBreaker'
import { loadCapitalConfig, DEFAULT_CONFIG } from '@/lib/capitalManagement'
import { fetchOptionsData }             from '@/lib/deribitFetch'
import { runWalkForward }               from '@/lib/walkForwardBacktest'
import { analyzeAllABCD, getABCDScoreImpact } from '@/lib/harmonicPatterns'
import type { MultiTFABCD } from '@/lib/harmonicPatterns'
import type { Kline, MarketData, IndicatorMap, SignalRecord } from '@/lib/types'

export const runtime    = 'nodejs'
export const maxDuration = 60   // Vercel Hobby max; agent needs ~20-40s for all API calls

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

// ── Central signal event handler — sends NTFY for EVERY event ────────────────

type SignalEvent = 'new' | 'tp1' | 'tp2' | 'tp3' | 'sl' | 'breakeven' | 'breakeven_sl' | 'trailing' | 'manual_close'

function getSignalDuration(createdAt: string): string {
  const ms   = Date.now() - new Date(createdAt).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}min`
}

async function handleSignalEvent(
  sig: SignalRecord,
  event: SignalEvent,
  eventPrice: number,
  ntfyTopic: string,
  extra?: { reason?: string; newSL?: number },
): Promise<SignalRecord> {
  const idea    = sig.idea
  const isLong  = idea.side === 'LONG'
  const entry   = idea.price
  const rawPnl  = isLong
    ? (eventPrice - entry) / entry * 100
    : (entry - eventPrice) / entry * 100

  const TERMINAL: SignalEvent[] = ['tp3', 'sl', 'breakeven', 'breakeven_sl', 'manual_close']
  const isClosed = TERMINAL.includes(event)

  const newStatus: SignalRecord['status'] = (
    event === 'tp3'          ? 'tp3_hit'      :
    event === 'tp2'          ? 'tp2_hit'      :
    event === 'tp1'          ? 'tp1_hit'      :
    event === 'sl'           ? 'sl_hit'       :
    event === 'breakeven'    ? 'active'       :  // trailing BE — stays active
    event === 'breakeven_sl' ? 'breakeven'    :
    event === 'manual_close' ? 'closed_manual':
    'active'
  )

  const updated: SignalRecord = {
    ...sig,
    status:  newStatus,
    ...(isClosed ? {
      pnl:        parseFloat(rawPnl.toFixed(2)),
      closedAt:   new Date().toISOString(),
      exitPrice:  eventPrice,
      exitTs:     new Date().toISOString(),
      closeReason: extra?.reason ?? event,
    } : {}),
    ...(event === 'trailing' ? {
      idea: { ...idea, sl: extra?.newSL ?? eventPrice },
    } : {}),
    ...(event === 'breakeven' ? {
      idea: { ...idea, sl: entry },
    } : {}),
    ...(event === 'tp1' ? {
      tp1Hit: true,
      idea:   { ...idea, sl: entry },  // move SL to entry
    } : {}),
    ...(event === 'tp2' ? {
      tp2Hit: true,
      idea:   { ...idea, sl: idea.tp1 },  // move SL to TP1
    } : {}),
  }

  if (!ntfyTopic) return updated

  const side = idea.side
  const P    = (n: number) => `$${Math.round(n).toLocaleString()}`
  const pnlStr = `${rawPnl >= 0 ? '+' : ''}${rawPnl.toFixed(2)}%`
  const dur  = getSignalDuration(sig.createdAt)

  const titles: Record<SignalEvent, string> = {
    new:          sanitizeHdr(`APEX ${side} BTC -- ${idea.confidence}`),
    tp1:          sanitizeHdr(`TP1 ALCANZADO -- ${side} BTC ${pnlStr}`),
    tp2:          sanitizeHdr(`TP2 ALCANZADO -- ${side} BTC ${pnlStr}`),
    tp3:          sanitizeHdr(`TP3 OBJETIVO MAXIMO -- ${side} BTC ${pnlStr}`),
    sl:           sanitizeHdr(`STOP LOSS -- ${side} BTC ${pnlStr}`),
    breakeven:    sanitizeHdr(`BREAKEVEN ACTIVADO -- ${side} BTC capital protegido`),
    breakeven_sl: sanitizeHdr(`SL BREAKEVEN TOCADO -- ${side} BTC sin perdida`),
    trailing:     sanitizeHdr(`TRAILING SL -- ${side} BTC`),
    manual_close: sanitizeHdr(`CERRADO MANUAL -- ${side} BTC ${pnlStr}`),
  }

  const bodies: Record<SignalEvent, string> = {
    new: [
      `${side === 'LONG' ? '▲ LONG' : '▼ SHORT'} BTC/USDT | ${idea.tradeType} | ${idea.confidence}`,
      ``,
      `Entrada: ${P(entry)}`,
      `SL:  ${P(idea.sl)}`,
      `TP1: ${P(idea.tp1)}`,
      `TP2: ${P(idea.tp2)}`,
      `TP3: ${P(idea.tp3)}`,
      ``,
      ...idea.reasons.slice(0, 3).map(r => r.txt),
      `Score: ${idea.bull + idea.bear}/12 | Leverage: ${idea.maxLev}x`,
    ].join('\n'),

    tp1: [
      `✅ TP1 ALCANZADO`,
      `${side} BTC desde ${P(entry)}`,
      ``,
      `TP1: ${P(idea.tp1)} ✓`,
      `P&L parcial: ${pnlStr}`,
      ``,
      `SL movido a breakeven (${P(entry)}).`,
      `Esperando TP2: ${P(idea.tp2)}`,
    ].join('\n'),

    tp2: [
      `✅✅ TP2 ALCANZADO`,
      `${side} BTC desde ${P(entry)}`,
      ``,
      `TP2: ${P(idea.tp2)} ✓`,
      `P&L parcial: ${pnlStr}`,
      ``,
      `SL en TP1 (${P(idea.tp1)}). Esperando TP3: ${P(idea.tp3)}`,
    ].join('\n'),

    tp3: [
      `🏆 OBJETIVO MAXIMO ALCANZADO`,
      `${side} BTC -- Trade completado`,
      ``,
      `Entrada: ${P(entry)}`,
      `TP3: ${P(idea.tp3)} ✓`,
      `P&L final: ${pnlStr}`,
      `Duracion: ${dur}`,
    ].join('\n'),

    sl: [
      `❌ STOP LOSS TOCADO`,
      `${side} BTC cerrado`,
      ``,
      `Entrada: ${P(entry)}`,
      `SL: ${P(idea.sl)}`,
      `P&L: ${pnlStr}`,
      `Duracion: ${dur}`,
    ].join('\n'),

    breakeven: [
      `🛡️ SL MOVIDO A BREAKEVEN`,
      `${side} BTC -- capital protegido`,
      ``,
      `TP1 alcanzado -- SL en ${P(entry)}`,
      `Trade sin perdida garantizado.`,
      `Esperando TP2: ${P(idea.tp2)}`,
    ].join('\n'),

    breakeven_sl: [
      `🛡️ SL BREAKEVEN TOCADO`,
      `${side} BTC cerrado sin perdida`,
      ``,
      `Entrada: ${P(entry)}`,
      `Cierre: ${P(eventPrice)}`,
      `P&L: ${pnlStr} (breakeven)`,
      ``,
      `TP1 fue alcanzado. Capital devuelto integro.`,
    ].join('\n'),

    trailing: [
      `📐 TRAILING SL ACTUALIZADO`,
      `${side} BTC en curso`,
      ``,
      `Nuevo SL: ${P(extra?.newSL ?? eventPrice)}`,
      `P&L flotante: ${pnlStr}`,
      `Razon: ${extra?.reason ?? 'Trailing automatico'}`,
    ].join('\n'),

    manual_close: [
      `🔒 SEÑAL CERRADA MANUALMENTE`,
      `${side} BTC`,
      ``,
      `Entrada: ${P(entry)}`,
      `Cierre: ${P(eventPrice)}`,
      `P&L: ${pnlStr}`,
      `Razon: ${extra?.reason ?? 'Decision manual'}`,
      `Duracion: ${dur}`,
    ].join('\n'),
  }

  const priorities: Record<SignalEvent, 1|2|3|4|5> = {
    new: 5, tp1: 4, tp2: 4, tp3: 5, sl: 5,
    breakeven: 3, breakeven_sl: 4, trailing: 2, manual_close: 4,
  }

  const tags: Record<SignalEvent, string> = {
    new:          side === 'LONG' ? 'green_circle,chart_with_upwards_trend' : 'red_circle,chart_with_downwards_trend',
    tp1:          'white_check_mark',
    tp2:          'white_check_mark,white_check_mark',
    tp3:          'trophy',
    sl:           'rotating_light',
    breakeven:    'shield',
    breakeven_sl: 'shield',
    trailing:     'straight_ruler',
    manual_close: 'lock',
  }

  await ntfy(ntfyTopic, titles[event], bodies[event], priorities[event], tags[event])
  return updated
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
  if (!ntfyTopic) console.warn('[APEX NTFY] NTFY_TOPIC env var not set — push notifications disabled')
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
    update30minSent?: boolean
    update30minSkipped?: string
    signalsLoaded?: number
    signalsActive?: number
    abcd?: { inPRZ: boolean; signal: string; strength: number; tf?: string; direction?: string; dTarget?: number; completion?: number }
  } = { time, session: '', regime: '', signals: [], updates: [], errors: [], globalMarkets: null, macro: null }

  try {
    // ── 1. Fetch market data (direct import — no HTTP hop, no geo-block risk) ──
    const md    = await fetchMarketData()
    // Price: Binance → Bybit → Kraken
    const price = md.price ?? md.bybitPrice ?? md.krakenPrice ?? 0
    if (!price) return NextResponse.json({ error: 'Failed to fetch price' }, { status: 503 })

    const klines = {
      '3d':  toKlines(md.klines['3d']  as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
      '1d':  toKlines(md.klines['1d']  as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
      '12h': toKlines(md.klines['12h'] as { t:number;o:number;h:number;l:number;c:number;v:number }[] | undefined),
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

    // ── 1c. All external API calls in one parallel batch ─────────────────────────
    // fetchFedExpectations needs fedRate, so we run macroIndicators first in a
    // sub-parallel group, then merge — still all non-blocking relative to each other.
    const [globalMarkets, macroIndicators, globalLiquidity, upcomingEvents, socialSentiment, whaleAlert, optionsData] = await Promise.all([
      fetchGlobalMarkets().catch(() => null),
      fetchMacroIndicators().catch(() => null),
      fetchGlobalLiquidity().catch(() => null),
      fetchUpcomingEvents().catch(() => []),
      fetchSocialSentiment().catch(() => null),
      fetchWhaleAlert().catch(() => null),
      fetchOptionsData().catch(() => null),
    ])

    // Fed expectations — depends on fedRate from macroIndicators (already resolved above)
    const fedExpectations = macroIndicators?.fedRate?.current
      ? await fetchFedExpectations(macroIndicators.fedRate.current).catch(() => null)
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

    // ── ABCD Harmonic Pattern Analysis (all timeframes) ───────────────────────
    const abcdAnalysis: MultiTFABCD = analyzeAllABCD({
      '15m': klines['15m'],
      '1h':  klines['1h'],
      '4h':  klines['4h'],
      '12h': klines['12h'],
      '1d':  klines['1d'],
      '2d':  klines['3d'],   // 3d as proxy for 2d
    }, price)
    results.abcd = {
      inPRZ:     abcdAnalysis.inPRZ,
      signal:    abcdAnalysis.tradingSignal,
      strength:  abcdAnalysis.signalStrength,
      tf:        abcdAnalysis.mostRelevant?.timeframe,
      direction: abcdAnalysis.mostRelevant?.direction,
      dTarget:   abcdAnalysis.mostRelevant?.D_target,
      completion:abcdAnalysis.mostRelevant?.completion,
    }

    // Pre-declare time components used in multiple blocks below
    const nowUtc = new Date()
    const mins   = nowUtc.getUTCMinutes()
    const hours  = nowUtc.getUTCHours()

    // ── 3. Load existing signals + compute learned weights ────────────────────
    // Try service key first (bypasses RLS), fall back to anon key on network failure.
    // Both use NEXT_PUBLIC_SUPABASE_URL so DNS is identical; service key has better perms.
    const signalsSb  = getDbClient()
    const signalsSb2 = getSupabase()   // anon key fallback — same DNS path as browser client
    let rawSignals: Record<string, unknown>[] | null = null
    for (const [label, sb] of [['service', signalsSb], ['anon', signalsSb2]] as const) {
      if (!sb) continue
      const result = await Promise.resolve(
        sb
          .from('apex_signals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500)
      ).catch((e: Error) => ({ data: null, error: { message: `[${label}] ${e.message}: ${(e as NodeJS.ErrnoException).cause ?? ''}` } }))
      const { data, error: sbErr } = result as { data: unknown[] | null; error: { message: string } | null }
      if (data && Array.isArray(data)) { rawSignals = data as Record<string, unknown>[]; break }
      if (sbErr) results.errors.push(`[Signals/${label}] ${sbErr.message}`)
    }
    if (!rawSignals) results.errors.push('[Signals] Both clients failed — check Supabase project status/URL')
    const allSignals: SignalRecord[] = Array.isArray(rawSignals) ? rawSignals.map((s) => transformSignal(s)) : []
    const active     = allSignals.filter(s => s.status === 'active')
    results.signalsLoaded = allSignals.length
    results.signalsActive = active.length
    console.log(`[APEX] Signals loaded: ${allSignals.length} total, ${active.length} active`)
    // Supabase reads in parallel — each is independent
    const [learnedWeights, capitalConfig, prevStateForVoice] = await Promise.all([
      calcLearnedWeights(getDbClient()),
      loadCapitalConfig(getDbClient() as any).catch(() => DEFAULT_CONFIG),
      loadAgentState(getDbClient()),
    ])
    // optionsData already fetched in the parallel API batch above (line ~345)

    // ── 3c. Walk-Forward validation on real closed signals ───────────────────
    const wfResult = runWalkForward(allSignals)

    // ── 3d. Performance stats from closed signals ────────────────────────────
    const resolved   = allSignals.filter(s => s.pnl != null)
    const perfWins   = resolved.filter(s => (s.pnl ?? 0) > 0.1)
    const perfLosses = resolved.filter(s => (s.pnl ?? 0) < -0.1 && s.status !== 'breakeven')
    const perfStats  = resolved.length >= 5 ? {
      total:    resolved.length,
      winRate:  Math.round(perfWins.length / Math.max(perfWins.length + perfLosses.length, 1) * 100),
      totalPnl: parseFloat(resolved.reduce((acc, r) => acc + (r.pnl ?? 0), 0).toFixed(2)),
    } : null

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
    // prevStateForVoice already loaded in parallel Supabase batch above

    const TERMINAL_STATUSES = new Set(['closed_manual', 'sl_hit', 'breakeven', 'tp3_hit'])
    for (const sig of active) {
      if (TERMINAL_STATUSES.has(sig.status)) continue

      const isLong   = sig.idea.side === 'LONG'
      let   updated: SignalRecord = sig
      let   changed  = false

      // ── Retroactive kline scan: catch TPs hit while agent was asleep ──────────
      // If agent had a gap (GitHub Actions unreliable), price could have touched TP1
      // and recovered to SL without the agent seeing it. Scan 1H candles first.
      const signalMs   = new Date(sig.createdAt).getTime()
      const k1hHistory = (klines['1h'] ?? []).filter(k => k.t > signalMs)
      if (!sig.tp1Hit && !changed) {
        const tp1InHistory = k1hHistory.some(k => isLong ? k.h >= sig.idea.tp1 : k.l <= sig.idea.tp1)
        if (tp1InHistory) {
          updated = await handleSignalEvent(sig, 'tp1', sig.idea.tp1, ntfyTopic, { reason: 'TP1 alcanzado (histórico — agente inactivo)' })
          ;(updated as { breakevenSet?: boolean }).breakevenSet = true
          await saveSignalToCloud(updated)
          changed = true
          results.updates.push({ id: sig.id, action: 'tp1_retroactive', newSL: sig.idea.price })
        }
      }
      if (!sig.tp2Hit && !changed) {
        const tp2InHistory = k1hHistory.some(k => isLong ? k.h >= sig.idea.tp2 : k.l <= sig.idea.tp2)
        if (tp2InHistory && sig.tp1Hit) {
          updated = await handleSignalEvent(updated, 'tp2', sig.idea.tp2, ntfyTopic, { reason: 'TP2 alcanzado (histórico — agente inactivo)' })
          await saveSignalToCloud(updated)
          changed = true
          results.updates.push({ id: sig.id, action: 'tp2_retroactive', newSL: sig.idea.tp1 })
        }
      }

      // ── TP3 ───────────────────────────────────────────────────────────────────
      // ALWAYS check TPs before SL — a signal that hit TP and retraced is a WIN
      if (!changed && (isLong ? price >= sig.idea.tp3 : price <= sig.idea.tp3)) {
        updated = await handleSignalEvent(updated, 'tp3', sig.idea.tp3, ntfyTopic, { reason: 'TP3 alcanzado' })
        changed = true
      }
      // ── TP2 ───────────────────────────────────────────────────────────────────
      else if (!changed && !sig.tp2Hit && (isLong ? price >= sig.idea.tp2 : price <= sig.idea.tp2)) {
        updated = await handleSignalEvent(updated, 'tp2', sig.idea.tp2, ntfyTopic, { reason: 'TP2 alcanzado' })
        await saveSignalToCloud(updated)   // persist BEFORE next check to prevent re-fire
        changed = true
      }
      // ── TP1 ───────────────────────────────────────────────────────────────────
      else if (!changed && !sig.tp1Hit && (isLong ? price >= sig.idea.tp1 : price <= sig.idea.tp1)) {
        updated = await handleSignalEvent(updated, 'tp1', sig.idea.tp1, ntfyTopic, { reason: 'TP1 alcanzado' })
        ;(updated as { breakevenSet?: boolean }).breakevenSet = true
        await saveSignalToCloud(updated)   // persist BEFORE next check to prevent re-fire
        changed = true
      }
      // ── SL hit — checked LAST so a TP always wins over SL on same tick ────────
      else if (!changed && (isLong ? price <= updated.idea.sl : price >= updated.idea.sl)) {
        const wasBreakeven = (updated as { breakevenSet?: boolean }).breakevenSet === true
          || Math.abs((updated.idea.sl - updated.idea.price) / updated.idea.price * 100) < 0.15
        updated = await handleSignalEvent(updated, wasBreakeven ? 'breakeven_sl' : 'sl', updated.idea.sl, ntfyTopic, {
          reason: wasBreakeven
            ? `SL en breakeven tocado a $${Math.round(updated.idea.sl).toLocaleString()}`
            : `SL tocado a $${Math.round(updated.idea.sl).toLocaleString()}`,
        })
        changed = true
      }

      // ── Trailing stop (only if still active, only fire NTFY once per action) ──
      if (updated.status === 'active') {
        const tf = sig.idea.tradeType === 'Scalp' ? klines['15m'] : klines['4h']
        const stopUpdate = evaluateStopManagement(updated, price, tf)
        if (stopUpdate) {
          const isBreakeven   = stopUpdate.action === 'move_to_breakeven'
          const isTrail2      = stopUpdate.action === 'trail_to_tp1'
          const alreadyBE     = (sig as { breakevenSet?: boolean }).breakevenSet  ?? false
          const alreadyTrail2 = (sig as { trailing2Set?: boolean }).trailing2Set  ?? false
          const shouldNotify  = (isBreakeven && !alreadyBE) || (isTrail2 && !alreadyTrail2) || (!isBreakeven && !isTrail2)
          const trailEvent: SignalEvent = isBreakeven ? 'breakeven' : 'trailing'
          if (shouldNotify) {
            updated = await handleSignalEvent(updated, trailEvent, stopUpdate.newSL, ntfyTopic, {
              reason: stopUpdate.reason, newSL: stopUpdate.newSL,
            })
          } else {
            updated = { ...updated, idea: { ...updated.idea, sl: stopUpdate.newSL } } as SignalRecord
          }
          ;(updated as { breakevenSet?: boolean }).breakevenSet    = isBreakeven ? true : alreadyBE
          ;(updated as { trailing2Set?: boolean }).trailing2Set    = isTrail2    ? true : alreadyTrail2
          ;(updated as { trailingActive?: boolean }).trailingActive = stopUpdate.pnlProtected > 0
          results.updates.push({ id: sig.id, action: stopUpdate.action, newSL: stopUpdate.newSL })
          changed = true
        }
      }

      if (changed) {
        await saveSignalToCloud(updated)
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
      const newSignal = scoreTradeIdea(mkt, inds, obVal, rawK, undefined, allSignals, learnedWeights, macroSentiment, macroIndicators ?? undefined, globalLiquidity ?? undefined, fedExpectations ?? undefined, socialSentiment ?? undefined, whaleAlert ?? undefined, abcdAnalysis)

      // ── Agent memory: detect & record opinion changes ────────────────────────
      const memorySb    = getDbClient()
      const newBias     = newSignal ? newSignal.side : 'NEUTRAL'
      const opinionNote = detectOpinionChange(prevStateForVoice, newBias, newSignal ?? null, inds, regime ?? null)
      if (opinionNote) agentOpinionChange = opinionNote
      // Save new state (fire-and-forget — deliberately excludes last_analysis_at /
      // last_deep_analysis_at so it cannot race-overwrite the 30-min / 4H targeted updates)
      if (memorySb) {
        void Promise.resolve(memorySb.from('apex_agent_state').upsert({
          id:              'current',
          last_bias:       newBias,
          last_trade_type: newSignal?.tradeType  ?? null,
          last_confidence: newSignal?.confidence ?? null,
          last_price:      mkt.price             ?? 0,
          last_score:      newSignal?.maxSc      ?? 0,
          change_reason:   opinionNote,
          updated_at:      new Date().toISOString(),
          // NOTE: last_analysis_at / last_deep_analysis_at intentionally omitted —
          // those columns are owned exclusively by the 30-min and 4H targeted updates.
        })).catch(() => {})
      }

      // ── Block longs in global risk-off environment ───────────────────────────
      const blockedByCorrelation =
        globalMarkets?.signalImpact === 'BLOCK_LONGS' && newSignal?.side === 'LONG'
      if (blockedByCorrelation) {
        results.errors.push(`[APEX Correlation] Long bloqueado: ${globalMarkets!.btcCorrelation}`)
      }

      // ── Circuit breaker: block new signals if loss limits breached ──────────
      const cb = checkCircuitBreaker(allSignals, capitalConfig)
      if (cb.blocked) {
        results.errors.push(`[Circuit Breaker] ${cb.reason}`)
        console.log(`[Circuit Breaker] BLOCKED — ${cb.reason}`)
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
          skip_reason:   blockedByCorrelation ? 'correlation_risk_off' : cb.blocked ? 'circuit_breaker' : newSignal ? null : 'score_or_filter',
          signal_id:     null,   // updated after saveSignalToCloud
        }).then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error('[APEX Decisions] insert error:', error.message)
        })
      }

      if (newSignal && !newSignal.consolidation && !blockedByCorrelation && !cb.blocked) {
        // Dedup: don't add same-side signal if one already active OR already notified in last 2h
        const sameActive = active.some(s => s.idea.side === newSignal.side && s.status === 'active')
        const alreadyNotified = allSignals.some(s =>
          s.status === 'active' &&
          s.ntfySent === true &&
          s.idea.side === newSignal.side &&
          Math.abs(s.idea.price - newSignal.price) / newSignal.price < 0.003 &&
          new Date(s.createdAt).getTime() > Date.now() - 2 * 3_600_000,
        )
        if (!sameActive && !alreadyNotified && shouldGenerateSignal(newSignal.tradeType, newSignal.confidence)) {
          const recId = Date.now().toString()
          const rec: SignalRecord = {
            id:        recId,
            createdAt: time,
            status:    'active',
            ntfySent:  true,   // mark true BEFORE save — prevents re-fire if read before NTFY completes
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
                              ew:               ewMap as Record<string, { currentWave?: string; direction?: string; confidence?: string; nextTarget?: number; invalidation?: number }>,
                              optionsData:      optionsData ?? null,
                              macroIndicators:  macroIndicators ?? null,
                              globalLiquidity:  globalLiquidity ?? null,
                              fedExpectations:  fedExpectations ?? null,
                              upcomingEvents:   upcomingEvents ?? [],
                              socialSentiment:  socialSentiment ?? null,
                              whaleAlert:       whaleAlert ?? null,
                              abcdAnalysis,
                            }),
                          ].filter(Boolean).join('\n\n'),
              ts:         new Date(time),
            },
          }
          // Save FIRST via direct service-key client — NTFY only fires if save succeeds
          const recSaveSb = getDbClient()
          const { error: recSaveErr } = await Promise.resolve(
            recSaveSb.from('apex_signals').upsert({
              id: rec.id, side: rec.idea.side, trade_type: rec.idea.tradeType,
              entry: rec.idea.price, sl: rec.idea.sl, tp1: rec.idea.tp1,
              tp2: rec.idea.tp2, tp3: rec.idea.tp3, confidence: rec.idea.confidence,
              status: rec.status, reasons: rec.idea.reasons, created_at: rec.createdAt,
              updated_at: new Date().toISOString(), ntfy_sent: true,
              pnl: null, pnl_r: null, closed_at: null, exit_price: null, close_reason: null,
              tp1_hit: false, tp2_hit: false, sl_warning_fired: false,
              expiry_warning_fired: false, max_lev: rec.idea.maxLev ?? 5,
            }, { onConflict: 'id' })
          ).catch((e: Error) => ({ error: e }))
          if (recSaveErr) {
            results.errors.push(`[SignalSave] ${(recSaveErr as {message?:string}).message ?? recSaveErr}`)
          } else {
            // DB save confirmed — now send NTFY
            await handleSignalEvent(rec, 'new', rec.idea.price, ntfyTopic)
            results.signals.push({ type: newSignal.tradeType, side: newSignal.side, confidence: newSignal.confidence })
          }
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

        // Secondary dedup: same-side scalp already notified in last 1h (side-aware — allows LONG after SHORT)
        const oneHourAgo = Date.now() - 60 * 60_000
        const recentlyNotified = allSignals.find(s =>
          s.idea.tradeType === 'Scalp' &&
          s.idea.side === scalpSig.side &&
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
          // Save via direct service-key client (bypasses RLS + avoids anon-key singleton issues)
          const saveSb = getDbClient()
          const { error: saveErr } = await Promise.resolve(
            saveSb.from('apex_signals').upsert({
              id: rec.id, side: rec.idea.side, trade_type: rec.idea.tradeType,
              entry: rec.idea.price, sl: rec.idea.sl, tp1: rec.idea.tp1,
              tp2: rec.idea.tp2, tp3: rec.idea.tp3, confidence: rec.idea.confidence,
              status: rec.status, reasons: rec.idea.reasons, created_at: rec.createdAt,
              updated_at: new Date().toISOString(), ntfy_sent: true,
              pnl: null, pnl_r: null, closed_at: null, exit_price: null, close_reason: null,
              tp1_hit: false, tp2_hit: false, sl_warning_fired: false,
              expiry_warning_fired: false, max_lev: rec.idea.maxLev ?? 5,
            }, { onConflict: 'id' })
          ).catch((e: Error) => ({ error: e }))
          if (saveErr) {
            results.errors.push(`[ScalpSave] ${(saveErr as {message?:string}).message ?? saveErr}`)
          } else {
            await handleSignalEvent(rec, 'new', rec.idea.price, ntfyTopic)
            results.signals.push({ type: 'Scalp', side: scalpSig.side, confidence: scalpSig.confidence })
          }
        }
      }
    }

    // ── 5b. ABCD PRZ alert — fires when price enters a Potential Reversal Zone ──
    if (abcdAnalysis.inPRZ && ntfyTopic) {
      const p = abcdAnalysis.mostRelevant!
      const action = p.direction === 'BULLISH' ? 'LONG' : 'SHORT'
      const emoji  = p.direction === 'BULLISH' ? '▲' : '▼'
      // Spam guard: max one PRZ alert per 2 hours (tracked via agent state)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastPRZAlert    = (prevStateForVoice as any)?.lastPrzAlertAt
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? new Date(String((prevStateForVoice as any).lastPrzAlertAt)).getTime() : 0
      const hoursSincePRZAlert = (Date.now() - lastPRZAlert) / 3_600_000
      if (hoursSincePRZAlert > 2) {
        await ntfy(
          ntfyTopic,
          sanitizeHdr(`APEX ABCD ${emoji} ${action} — Precio en PRZ`),
          [
            `${emoji} PATRÓN ABCD HARMÓNICO COMPLETADO`,
            ``,
            `TF: ${p.timeframe.toUpperCase()} | Calidad: ${p.quality}`,
            `Dirección: ${action} — reversión esperada`,
            ``,
            `PRZ: $${Math.round(p.prz_low).toLocaleString()}–$${Math.round(p.prz_high).toLocaleString()}`,
            `Punto D: $${Math.round(p.D_target).toLocaleString()}`,
            `BC retroceso: ${(p.BC_retrace * 100).toFixed(0)}% | CD: ${p.CD_extension}x`,
            ``,
            `TP1: $${Math.round(p.target1).toLocaleString()}`,
            `TP2: $${Math.round(p.target2).toLocaleString()}`,
            `TP3: $${Math.round(p.target3).toLocaleString()} (vuelta a C)`,
            `Invalidación: $${Math.round(p.invalidation).toLocaleString()}`,
          ].join('\n'),
          5,
          'rotating_light',
        )
        // Mark PRZ alert time
        const przSb = getDbClient()
        if (przSb) {
          await Promise.resolve(
            przSb.from('apex_agent_state').update({ last_prz_alert_at: new Date().toISOString() }).eq('id', 'current')
          ).catch(() => {})
        }
      }
    }

    // ── 6. Periodic market analysis NTFY — time-since-last (not exact minute) ──
    // GitHub Actions runs at irregular times — exact :00/:30 checks NEVER fire.
    // Instead: track last send time in apex_agent_state and use elapsed time.

    const now            = Date.now()
    const lastAnalysis   = prevStateForVoice?.lastAnalysisAt   ? new Date(prevStateForVoice.lastAnalysisAt).getTime()   : 0
    const lastDeep       = prevStateForVoice?.lastDeepAnalysisAt ? new Date(prevStateForVoice.lastDeepAnalysisAt).getTime() : 0
    const minsSinceUpdate = (now - lastAnalysis)   / 60_000
    const hrsSinceDeep    = (now - lastDeep)       / 3_600_000

    // 30-min market update — fire if 25+ minutes since last send
    if (minsSinceUpdate >= 25 && ntfyTopic) {
      const upcoming     = getUpcomingEvent(Date.now(), 4 * 60 * 60_000)
      const opinionLines = agentOpinionChange ? [agentOpinionChange] : []
      const updateParams: AgentUpdateParams = {
        price,
        prevPrice:       prevStateForVoice?.lastPrice ?? price,
        inds,
        regime,
        session,
        macroSentiment,
        macroIndicators,
        fedExpectations,
        news:            [],   // not fetched server-side
        whaleAlert,
        realDelta:       null,
        elliottWaves:    ewMap,
        fvgs:            fvgsMap,
        liquidity,
        activeSignals:   activeSigData,
        opinionChanges:  opinionLines,
        patternMatch:    null,
        globalMarkets,
        optionsData,
        wfGrade:         wfResult.isReliable ? wfResult.grade : null,
        mkt,             // MarketData — fg, funding, lsr for Claude context
      }
      const update = await generateAgentUpdate(updateParams)
      console.log('[APEX Update Preview]', update?.slice(0, 200))
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
      results.update30minSent = true
      // Persist send time — targeted .update() (not upsert) so it can't be
      // overwritten by the fire-and-forget upsert that runs earlier in this request.
      const memorySb30 = getDbClient()
      if (memorySb30) {
        await Promise.resolve(
          memorySb30
            .from('apex_agent_state')
            .update({ last_analysis_at: new Date().toISOString() })
            .eq('id', 'current')
        ).catch(() => {})
      }
    } else if (!results.update30minSent) {
      results.update30minSkipped = `minsSince: ${minsSinceUpdate.toFixed(1)}, ntfyTopic: ${ntfyTopic ? 'set' : 'MISSING'}, session: ${session.quality}`
    }

    // 4H deep analysis — fire if 4+ hours since last deep send
    if (hrsSinceDeep >= 4 && ntfyTopic) {
      const deepAnalysis = generateDeepAnalysis(
        price,
        inds,
        regime,
        macroIndicators,
        fedExpectations,
        globalLiquidity,
        ewMap,
        [],                  // patterns — candlePatterns used in scoring, not stored here
        activeSigData,
        perfStats,           // computed from real closed signals
        learnedWeights,
        optionsData,         // IV Rank + Max Pain + PCR
        wfResult.isReliable ? wfResult : null,  // Walk-Forward results
      )
      await ntfy(
        ntfyTopic,
        sanitizeHdr(`APEX Analisis 4H — $${Math.round(price).toLocaleString()}`),
        deepAnalysis,
        3,
        'bar_chart,clock4',
      )
      // Targeted .update() — only touch last_deep_analysis_at to avoid race with fire-and-forget save
      const memorySb4h = getDbClient()
      if (memorySb4h) {
        await Promise.resolve(
          memorySb4h
            .from('apex_agent_state')
            .update({ last_deep_analysis_at: new Date().toISOString() })
            .eq('id', 'current')
        ).catch(() => {})
      }
    }

    // ── 7. BB Squeeze alert — max once per 4 hours ────────────────────────────
    // Fires when BB Width 4H drops below 0.8% (extreme compression — breakout imminent)
    // Spam guard: piggyback on 4H deep analysis cadence
    if (regime && regime.bbWidthPct < 0.8 && hrsSinceDeep >= 4 && ntfyTopic) {
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
