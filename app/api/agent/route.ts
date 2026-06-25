// APEX Background Agent — runs 24/7 via Vercel Cron Jobs
// Handles both Normal and Scalp signals, SL/TP monitoring,
// trailing stop management, and session-aware signal generation.

import { NextResponse }            from 'next/server'
import { runInds }                 from '@/lib/indicators'
import { scoreTradeIdea, validateAndFixSL } from '@/lib/tradeScoring'
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
import { analyzeAllABCD, getABCDScoreImpact, generateHarmonicSignals } from '@/lib/harmonicPatterns'
import type { MultiTFABCD, HarmonicSignalCandidate } from '@/lib/harmonicPatterns'
import { askClaudeForDecision } from '@/lib/aiDecisionMaker'
import type { TradeDecision }   from '@/lib/aiDecisionMaker'
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

// ── Partial close configuration per trade type ────────────────────────────────

function getPartialCloseConfig(
  tradeType: 'Scalp' | 'DayTrade' | 'Swing',
  tp1RR: number,
  _tp2RR: number,
): { tp1Pct: number; tp2Pct: number; tp3Pct: number } {
  if (tradeType === 'Scalp')     return { tp1Pct: 50, tp2Pct: 30, tp3Pct: 20 }
  if (tradeType === 'DayTrade') {
    if (tp1RR >= 2)              return { tp1Pct: 30, tp2Pct: 40, tp3Pct: 30 }
    return                              { tp1Pct: 40, tp2Pct: 35, tp3Pct: 25 }
  }
  // Swing: let the winner run — biggest chunk at TP3
  return                                { tp1Pct: 25, tp2Pct: 35, tp3Pct: 40 }
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

  const TERMINAL: SignalEvent[] = ['tp3', 'sl', 'breakeven_sl', 'manual_close']
  const isClosed = TERMINAL.includes(event)

  // Final P&L = already-banked partial profits + remaining size at exit price
  const totalBanked = sig.totalBankedPnl ?? 0
  const remainPct   = (sig.remainingSizePct ?? 100) / 100
  const finalPnl    = isClosed ? parseFloat((totalBanked + remainPct * rawPnl).toFixed(2)) : 0

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
      pnl:         finalPnl,
      closedAt:    new Date().toISOString(),
      exitPrice:   eventPrice,
      exitTs:      new Date().toISOString(),
      closeReason: extra?.reason ?? event,
    } : {}),
    ...(event === 'trailing' ? {
      idea: { ...idea, sl: extra?.newSL ?? eventPrice },
    } : {}),
    ...(event === 'breakeven' ? {
      idea: { ...idea, sl: entry },
    } : {}),
    ...(event === 'tp1' ? {
      tp1Hit:          true,
      idea:            { ...idea, sl: parseFloat((isLong ? entry * (1 - 0.0015) : entry * (1 + 0.0015)).toFixed(2)) },
      tp1BankedPnl:    parseFloat(((sig.tp1ClosePct ?? 40) / 100 * rawPnl).toFixed(2)),
      remainingSizePct: 100 - (sig.tp1ClosePct ?? 40),
      totalBankedPnl:  parseFloat(((sig.tp1ClosePct ?? 40) / 100 * rawPnl).toFixed(2)),
    } : {}),
    ...(event === 'tp2' ? {
      tp2Hit:          true,
      idea:            { ...idea, sl: idea.tp1 },
      tp2BankedPnl:    parseFloat(((sig.tp2ClosePct ?? 35) / 100 * rawPnl).toFixed(2)),
      remainingSizePct: 100 - (sig.tp1ClosePct ?? 40) - (sig.tp2ClosePct ?? 35),
      totalBankedPnl:  parseFloat(((sig.tp1BankedPnl ?? 0) + (sig.tp2ClosePct ?? 35) / 100 * rawPnl).toFixed(2)),
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
      ``,
      `PLAN DE SALIDA PARCIAL:`,
      `TP1: ${P(idea.tp1)} → Cerrar ${sig.tp1ClosePct ?? 40}% | R:R ${sig.tp1RR ?? '?'}:1`,
      `TP2: ${P(idea.tp2)} → Cerrar ${sig.tp2ClosePct ?? 35}% | R:R ${sig.tp2RR ?? '?'}:1`,
      `TP3: ${P(idea.tp3)} → Cerrar ${sig.tp3ClosePct ?? 25}% restante`,
      ``,
      `Si TP1 tocado → SL a breakeven (trade gratuito)`,
      `Si TP2 tocado → SL a TP1 (profit garantizado)`,
      ``,
      ...idea.reasons.slice(0, 3).map(r => r.txt),
      `Score: ${idea.bull + idea.bear}/12 | Leverage: ${idea.maxLev}x`,
    ].join('\n'),

    tp1: [
      `✅ TP1 ALCANZADO`,
      `${side} BTC desde ${P(entry)}`,
      ``,
      `TP1: ${P(idea.tp1)} ✓`,
      ``,
      `Cierre parcial: ${sig.tp1ClosePct ?? 40}% de la posicion`,
      `Ganancia banqueada: +${(updated.tp1BankedPnl ?? 0).toFixed(2)}%`,
      `Posicion restante: ${updated.remainingSizePct ?? 60}%`,
      `SL movido a: BREAKEVEN (${P(entry)})`,
      `Trade ya no puede terminar en perdida.`,
      ``,
      `Siguiente: TP2 ${P(idea.tp2)}`,
    ].join('\n'),

    tp2: [
      `✅✅ TP2 ALCANZADO`,
      `${side} BTC desde ${P(entry)}`,
      ``,
      `TP2: ${P(idea.tp2)} ✓`,
      ``,
      `Cierre parcial: ${sig.tp2ClosePct ?? 35}% de la posicion`,
      `Banqueado TP1: +${(sig.tp1BankedPnl ?? 0).toFixed(2)}%`,
      `Banqueado TP2: +${(updated.tp2BankedPnl ?? 0).toFixed(2)}%`,
      `Total asegurado: +${(updated.totalBankedPnl ?? 0).toFixed(2)}%`,
      ``,
      `Posicion restante: ${updated.remainingSizePct ?? 25}%`,
      `SL en TP1 (${P(idea.tp1)}) — profit garantizado`,
      ``,
      `Siguiente: TP3 ${P(idea.tp3)}`,
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
      `${side} BTC cerrado`,
      ``,
      `Entrada: ${P(entry)}`,
      `Cierre: ${P(eventPrice)}`,
      ...(sig.tp1BankedPnl && sig.tp1BankedPnl > 0 ? [
        ``,
        `TP1 banqueado: +${sig.tp1BankedPnl.toFixed(2)}% (${sig.tp1ClosePct ?? 40}% cerrado)`,
        `Restante: cerrado en breakeven`,
        `P&L TOTAL: +${finalPnl.toFixed(2)}%`,
        `El sistema de parciales funciono.`,
      ] : [
        `P&L: ${pnlStr} (breakeven)`,
        ``,
        `TP1 fue alcanzado. Capital devuelto integro.`,
      ]),
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

  // ── Run-lock: one agent at a time, 4-minute stale timeout ──────────────────
  const lockSb = getDbClient()
  let lockAcquired = false
  if (lockSb) {
    const { data: lockState } = await (lockSb
      .from('apex_agent_state')
      .select('is_running, lock_acquired_at')
      .eq('id', 'current')
      .maybeSingle() as Promise<{ data: { is_running?: boolean; lock_acquired_at?: string } | null }>)
    const lockAge = lockState?.lock_acquired_at
      ? Date.now() - new Date(lockState.lock_acquired_at).getTime()
      : Infinity
    if (lockState?.is_running && lockAge < 4 * 60_000) {
      console.log(`[APEX] Another run in progress (${Math.round(lockAge / 1000)}s ago), skipping`)
      return NextResponse.json({ status: 'skipped_overlap', lockAgeSec: Math.round(lockAge / 1000) })
    }
    try {
      await lockSb.from('apex_agent_state')
        .update({ is_running: true, lock_acquired_at: new Date().toISOString() })
        .eq('id', 'current')
    } catch {}
    lockAcquired = true
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
    waitReason?: string
    aiReasoning?: string
    aiDecision?: string
    portfolioCloses?: Array<{ id: string; side: string; pnl: string; reason: string }>
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
    const active     = allSignals.filter(s => s.status === 'active' || s.status === 'tp1_hit' || s.status === 'tp2_hit')
    results.signalsLoaded = allSignals.length
    results.signalsActive = active.length
    console.log(`[APEX] Signals loaded: ${allSignals.length} total, ${active.length} active`)

    // ── NTFY recovery: signals saved with ntfySent=false get a second chance ──
    if (ntfyTopic) {
      for (const sig of active.filter(s => s.ntfySent === false)) {
        await handleSignalEvent(sig, 'new', sig.idea.price, ntfyTopic)
        const rcvSb = getDbClient()
        if (rcvSb) {
          await Promise.resolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (rcvSb.from('apex_signals') as any)
              .update({ ntfy_sent: true, updated_at: new Date().toISOString() })
              .eq('id', sig.id),
          ).catch(() => {})
        }
        console.log(`[APEX] Recovered missed NTFY for ${sig.id}`)
      }
    }
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

    // Per-type / per-side breakdown for adaptive learning
    type PerfGroup = { n: number; wr: number; avgR: number }
    function perfGroup(sigs: typeof resolved, pred: (s: typeof resolved[0]) => boolean): PerfGroup | null {
      const g = sigs.filter(pred)
      if (g.length < 3) return null
      // pnlR can be null even for closed trades — fall back to pnl sign, then status
      const isWin = (s: typeof g[0]) =>
        s.pnlR != null ? s.pnlR > 0 :
        s.pnl  != null ? s.pnl  > 0 :
        (s.status === 'tp1_hit' || s.status === 'tp2_hit' || s.status === 'tp3_hit')
      const w = g.filter(isWin).length
      const avgR = g.reduce((a, s) => a + (s.pnlR ?? (isWin(s) ? 1 : -1)), 0) / g.length
      return { n: g.length, wr: Math.round(w / g.length * 100), avgR: +avgR.toFixed(2) }
    }
    const perfStats = resolved.length >= 5 ? {
      total:    resolved.length,
      winRate:  Math.round(perfWins.length / Math.max(perfWins.length + perfLosses.length, 1) * 100),
      totalPnl: parseFloat(resolved.reduce((acc, r) => acc + (r.pnl ?? 0), 0).toFixed(2)),
      totalR:   +(resolved.reduce((a, r) => a + (r.pnlR ?? 0), 0).toFixed(2)),
      byType: {
        Scalp:     perfGroup(resolved, s => s.idea.tradeType === 'Scalp'),
        DayTrade:  perfGroup(resolved, s => s.idea.tradeType === 'DayTrade'),
        Swing:     perfGroup(resolved, s => s.idea.tradeType === 'Swing'),
      },
      bySide: {
        LONG:  perfGroup(resolved, s => s.idea.side === 'LONG'),
        SHORT: perfGroup(resolved, s => s.idea.side === 'SHORT'),
      },
      recent5: [...resolved]
        .sort((a, b) => new Date(b.closedAt ?? b.createdAt).getTime() - new Date(a.closedAt ?? a.createdAt).getTime())
        .slice(0, 5)
        .map(s => ({ type: s.idea.tradeType, side: s.idea.side, pnlR: +(s.pnlR ?? 0).toFixed(2) })),
    } : null

    // ── Agent voice helpers — computed once, used in 30min + 4H blocks ────────
    const ew4hResult = klines['4h'].length >= 20 ? detectElliottWaves(klines['4h']) : null
    const ew1dResult = klines['1d'].length >= 20 ? detectElliottWaves(klines['1d']) : null
    const ewMap      = { '4h': ew4hResult, '1d': ew1dResult }
    const fvgsMap    = { '4h': fvg4h, '15m': fvg15m }
    const activeSigData = active.map(s => ({
      id:        s.id,
      side:      s.idea.side,
      entry:     s.idea.price,
      sl:        s.idea.sl,
      tp1:       s.idea.tp1,
      tp2:       s.idea.tp2,
      tp3:       s.idea.tp3,
      tradeType: s.idea.tradeType,
      tp1Hit:    s.tp1Hit ?? false,
      createdAt: s.createdAt,
      status:    s.status,
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
      if (!k1hHistory.length) {
        console.warn(`[APEX] No 1H kline history for signal ${sig.id} — skipping retroactive scan`)
      }
      if (!sig.tp1Hit && !changed && k1hHistory.length) {
        const tp1InHistory = k1hHistory.some(k => isLong ? k.h >= sig.idea.tp1 : k.l <= sig.idea.tp1)
        if (tp1InHistory) {
          updated = await handleSignalEvent(sig, 'tp1', sig.idea.tp1, ntfyTopic, { reason: 'TP1 alcanzado (histórico — agente inactivo)' })
          updated = { ...updated, breakevenSet: true }
          await saveSignalToCloud(updated)
          changed = true
          results.updates.push({ id: sig.id, action: 'tp1_retroactive', newSL: sig.idea.price })
        }
      }
      if (!sig.tp2Hit && !changed && k1hHistory.length) {
        const tp2InHistory = k1hHistory.some(k => isLong ? k.h >= sig.idea.tp2 : k.l <= sig.idea.tp2)
        if (tp2InHistory && updated.tp1Hit) {  // C1: use updated (may have tp1Hit set above)
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
        updated = { ...updated, breakevenSet: true }
        await saveSignalToCloud(updated)   // persist BEFORE next check to prevent re-fire
        changed = true
      }
      // ── SL hit — checked LAST so a TP always wins over SL on same tick ────────
      else if (!changed && (isLong ? price <= updated.idea.sl : price >= updated.idea.sl)) {
        const wasBreakeven = (updated.breakevenSet === true)
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
          // A4: read from `updated` (may have breakevenSet=true from TP1 earlier this iteration)
          const alreadyBE     = updated.breakevenSet  ?? false
          const alreadyTrail2 = updated.trailing2Set  ?? false
          const shouldNotify  = (isBreakeven && !alreadyBE) || (isTrail2 && !alreadyTrail2) || (!isBreakeven && !isTrail2)
          const trailEvent: SignalEvent = isBreakeven ? 'breakeven' : 'trailing'
          if (shouldNotify) {
            updated = await handleSignalEvent(updated, trailEvent, stopUpdate.newSL, ntfyTopic, {
              reason: stopUpdate.reason, newSL: stopUpdate.newSL,
            })
          } else {
            updated = { ...updated, idea: { ...updated.idea, sl: stopUpdate.newSL } }
          }
          updated = {
            ...updated,
            breakevenSet:   isBreakeven ? true : alreadyBE,
            trailing2Set:   isTrail2    ? true : alreadyTrail2,
            trailingActive: stopUpdate.pnlProtected > 0,
          }
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

    // ── 3b. Macro event blocker — alert at :00 and :30 of each hour (not only :00)
    const macroBlock = getActiveBlockingEvent()
    if (macroBlock && ntfyTopic && mins % 30 < 5) {
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
    const activeCount  = active.filter(s => s.idea.tradeType !== 'Scalp').length
    const rawK = { '1d': klines['1d'], '4h': klines['4h'], '1h': klines['1h'], '15m': klines['15m'] }

    // Permissive mode: lower thresholds by 1 if no signal generated in 48+ hours
    const lastSignalTime = allSignals[0]?.createdAt
      ? new Date(allSignals[0].createdAt).getTime() : 0
    const hoursSinceLastSignal = (Date.now() - lastSignalTime) / 3_600_000
    const permissiveMode = hoursSinceLastSignal > 48
    if (permissiveMode) {
      console.log(`[APEX] Permissive mode — ${Math.round(hoursSinceLastSignal)}h since last signal, lowering thresholds`)
    }

    // Pass permissiveMode via learnedWeights override
    const effectiveWeights = permissiveMode
      ? { ...learnedWeights, minScoreAdjustment: Math.min(0, (learnedWeights?.minScoreAdjustment ?? 0) - 1) }
      : learnedWeights

    if (activeCount < 5) {
      // ── PRIMARY: Ask Claude AI for trading decision ─────────────────────────
      const aiDecision: TradeDecision | null = await askClaudeForDecision({
        price,
        prevPrice:       prevStateForVoice?.lastPrice ?? price,
        inds, regime, session,
        news:            [],   // not fetched server-side
        activeSignals:   activeSigData,
        mkt,
        elliottWaves:    ewMap,
        fvgs:            fvgsMap,
        liquidity,
        whaleAlert,
        macroSentiment,
        macroIndicators,
        fedExpectations,
        globalMarkets,
        socialSentiment,
        abcdAnalysis,
        optionsData,
        perfStats,
        klines4h:        klines['4h'],
      })

      if (aiDecision) {
        results.aiDecision = aiDecision.action
        if (aiDecision.action === 'WAIT') {
          results.waitReason   = aiDecision.waitingFor ?? 'Claude esperando mejor setup'
          results.aiReasoning  = aiDecision.reasoning
          console.log(`[APEX AI] WAIT — ${aiDecision.waitingFor ?? aiDecision.reasoning.slice(0, 80)}`)
        }
      }

      // ── FALLBACK: rule-based if Claude returned null ─────────────────────────
      const fallbackSignal = !aiDecision
        ? scoreTradeIdea(mkt, inds, obVal, rawK, undefined, allSignals, effectiveWeights,
            macroSentiment, macroIndicators ?? undefined, globalLiquidity ?? undefined,
            fedExpectations ?? undefined, socialSentiment ?? undefined, whaleAlert ?? undefined,
            abcdAnalysis)
        : null

      // ── Determine which signal source to use ────────────────────────────────
      const useAI  = aiDecision && aiDecision.action !== 'WAIT' && aiDecision.action !== 'CLOSE_EXISTING'
                     && aiDecision.entry > 0 && aiDecision.sl > 0
      const useRules = !aiDecision && !!fallbackSignal && !fallbackSignal.consolidation

      // ── Agent memory ─────────────────────────────────────────────────────────
      const memorySb    = getDbClient()
      const newBias     = useAI ? aiDecision!.action : (fallbackSignal?.side ?? 'NEUTRAL')
      const opinionNote = detectOpinionChange(prevStateForVoice, newBias, fallbackSignal ?? null, inds, regime ?? null)
      if (opinionNote) agentOpinionChange = opinionNote
      if (memorySb) {
        void Promise.resolve(memorySb.from('apex_agent_state').upsert({
          id:              'current',
          last_bias:       newBias,
          last_trade_type: useAI ? aiDecision!.tradeType : (fallbackSignal?.tradeType ?? null),
          last_confidence: useAI ? aiDecision!.confidence : (fallbackSignal?.confidence ?? null),
          last_price:      mkt.price             ?? 0,
          last_score:      fallbackSignal?.maxSc ?? 10,
          change_reason:   opinionNote,
          updated_at:      new Date().toISOString(),
        })).catch(() => {})
      }

      // ── Portfolio coherence: process positionsToClose from Claude ───────────
      // Wrapped in try/catch — a failure here must NEVER kill core monitoring
      const closedIds = new Set<string>()
      try {
        if (aiDecision?.positionsToClose?.length) {
          results.portfolioCloses = results.portfolioCloses ?? []
          for (const req of aiDecision.positionsToClose) {
            const sig = active.find(s => s.id === req.signalId)
            if (!sig) continue
            if (!['active', 'tp1_hit', 'tp2_hit'].includes(sig.status)) continue
            const isLong = sig.idea.side === 'LONG'
            const pnlPct = isLong
              ? (price - sig.idea.price) / sig.idea.price * 100
              : (sig.idea.price - price) / sig.idea.price * 100
            const pnlStr = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`
            const closeSb = getDbClient()
            if (closeSb) {
              await Promise.resolve(closeSb.from('apex_signals').update({
                status:      'closed_manual',
                pnl:         parseFloat(pnlPct.toFixed(2)),
                exit_price:  price,
                close_reason: `Coherencia portafolio: ${req.reason}`,
                closed_at:   new Date().toISOString(),
                updated_at:  new Date().toISOString(),
              }).eq('id', req.signalId)).catch(() => {})
            }
            if (ntfyTopic) {
              await ntfy(
                ntfyTopic,
                sanitizeHdr(`APEX CIERRE COHERENCIA — ${sig.idea.side} ${pnlStr}`),
                [
                  `🔄 Cambié de sesgo — cerrando posición que ya no encaja.`,
                  ``,
                  `${sig.idea.side} ${sig.idea.tradeType} desde $${Math.round(sig.idea.price).toLocaleString()}`,
                  `Cierre: $${Math.round(price).toLocaleString()} | P&L: ${pnlStr}`,
                  ``,
                  `Razón: ${req.reason}`,
                ].join('\n'),
                4,
                'arrows_counterclockwise',
              )
            }
            closedIds.add(req.signalId)
            results.portfolioCloses!.push({ id: req.signalId, side: sig.idea.side, pnl: pnlStr, reason: req.reason })
            console.log(`[APEX Portfolio] Closed ${sig.idea.side} ${sig.id} — ${req.reason}`)
          }
        }
      } catch (portfolioErr) {
        console.error('[APEX] Portfolio coherence block failed (non-fatal):', portfolioErr)
        results.errors.push(`[Portfolio] ${portfolioErr instanceof Error ? portfolioErr.message : String(portfolioErr)}`)
      }
      // Refresh active list excluding just-closed signals
      const stillActive = active.filter(s => !closedIds.has(s.id))

      // ── Safety checks (apply to both AI and rule-based) ─────────────────────
      const signalSide = useAI ? aiDecision!.action as 'LONG' | 'SHORT' : fallbackSignal?.side
      const blockedByCorrelation = globalMarkets?.signalImpact === 'BLOCK_LONGS' && signalSide === 'LONG'
      if (blockedByCorrelation) results.errors.push(`[APEX Correlation] Long bloqueado: ${globalMarkets!.btcCorrelation}`)

      const cb = checkCircuitBreaker(allSignals, capitalConfig)
      if (cb.blocked) {
        results.errors.push(`[Circuit Breaker] ${cb.reason}`)
        console.log(`[Circuit Breaker] BLOCKED — ${cb.reason}`)
      }

      const canTrade = (useAI || useRules) && !blockedByCorrelation && !cb.blocked

      if (canTrade) {
        // ── Build signal record from either AI decision or rule-based ───────────
        const recId = Date.now().toString()

        const recSide       = (useAI ? aiDecision!.action   : fallbackSignal!.side)       as 'LONG' | 'SHORT'
        const recType       = (useAI ? aiDecision!.tradeType : fallbackSignal!.tradeType)  as 'Scalp' | 'DayTrade' | 'Swing'
        const recConf       = (useAI ? aiDecision!.confidence: fallbackSignal!.confidence) as 'ALTA' | 'MEDIA' | 'BAJA'
        const recEntry      = useAI ? aiDecision!.entry  : fallbackSignal!.price
        const rawSL         = useAI ? aiDecision!.sl     : fallbackSignal!.sl
        const recSL         = validateAndFixSL(recSide, recEntry, rawSL, useAI ? 'Claude-AI' : 'Fallback')
        const recTP1        = useAI ? aiDecision!.tp1    : fallbackSignal!.tp1
        const recTP2        = useAI ? aiDecision!.tp2    : fallbackSignal!.tp2
        const recTP3        = useAI ? aiDecision!.tp3    : fallbackSignal!.tp3
        const recLev        = fallbackSignal?.maxLev ?? 5
        const recReasons    = useAI
          ? aiDecision!.keyFactors.map(f => ({ s: recSide === 'LONG' ? 'bull' as const : 'bear' as const, txt: f }))
          : (fallbackSignal!.reasons)
        const recAnalysis   = useAI
          ? [
              `🤖 DECISIÓN IA: ${aiDecision!.reasoning}`,
              `\nFactores clave:\n${aiDecision!.keyFactors.map(f => `• ${f}`).join('\n')}`,
              `\nRiesgos:\n${aiDecision!.risks.map(r => `• ${r}`).join('\n')}`,
              `\nInvalidación: ${aiDecision!.invalidation}`,
            ].join('')
          : writeTradeAnalysis({ idea: fallbackSignal!, inds, mkt, regime: regime ?? null,
              ew: ewMap as Record<string, { currentWave?: string; direction?: string; confidence?: string; nextTarget?: number; invalidation?: number }>,
              optionsData: optionsData ?? null, macroIndicators: macroIndicators ?? null,
              globalLiquidity: globalLiquidity ?? null, fedExpectations: fedExpectations ?? null,
              upcomingEvents: upcomingEvents ?? [], socialSentiment: socialSentiment ?? null,
              whaleAlert: whaleAlert ?? null, abcdAnalysis,
            })

        // Dedup: skip if recently notified same-side (45min cooldown)
        const alreadyNotified = allSignals.some(s =>
          (s.status === 'active' || s.status === 'tp1_hit' || s.status === 'tp2_hit') &&
          s.ntfySent === true && s.idea.side === recSide &&
          new Date(s.createdAt).getTime() > Date.now() - 45 * 60_000,
        )
        if (alreadyNotified) {
          console.log(`[APEX] Signal deduped — alreadyNotified same side in last 45min`)
        } else {
          // R:R validation — reject if TP1 R:R below minimum (1.2 for Scalp, 1.3 for DayTrade/Swing)
          const minTP1RR = recType === 'Scalp' ? 1.2 : 1.3
          const slDist  = Math.abs(recEntry - recSL)
          const tp1RR   = slDist > 0 ? +(Math.abs(recTP1 - recEntry) / slDist).toFixed(2) : 0
          const tp2RR   = slDist > 0 ? +(Math.abs(recTP2 - recEntry) / slDist).toFixed(2) : 0
          const tp3RR   = slDist > 0 ? +(Math.abs(recTP3 - recEntry) / slDist).toFixed(2) : 0
          if (tp1RR < minTP1RR) {
            console.log(`[APEX] Signal rejected — TP1 R:R ${tp1RR}:1 below minimum ${minTP1RR}:1`)
            results.errors.push(`[RRCheck] Rejected — TP1 R:R ${tp1RR}:1 < ${minTP1RR}`)
          } else {
          const partialCfg = getPartialCloseConfig(recType, tp1RR, tp2RR)

          const rec: SignalRecord = {
            id: recId, createdAt: time, status: 'active', ntfySent: true,
            exitPrice: null, exitTs: null, pnl: null, pnlR: null, closedAt: null, closeReason: null,
            tp1ClosePct: partialCfg.tp1Pct, tp2ClosePct: partialCfg.tp2Pct, tp3ClosePct: partialCfg.tp3Pct,
            tp1BankedPnl: 0, tp2BankedPnl: 0, totalBankedPnl: 0, remainingSizePct: 100,
            tp1RR, tp2RR, tp3RR,
            idea: {
              side: recSide, tradeType: recType, confidence: recConf,
              price: recEntry, sl: recSL, tp1: recTP1, tp2: recTP2, tp3: recTP3,
              maxLev: recLev, bull: 0, bear: 0, maxSc: 10,
              reasons: recReasons, analysis: [opinionNote, recAnalysis].filter(Boolean).join('\n\n'),
              ts: new Date(time),
            },
          }

          // Save to DB first — NTFY only if save succeeds
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
              expiry_warning_fired: false,
              tp1_close_pct: partialCfg.tp1Pct, tp2_close_pct: partialCfg.tp2Pct, tp3_close_pct: partialCfg.tp3Pct,
              tp1_banked_pnl: 0, tp2_banked_pnl: 0, total_banked_pnl: 0, remaining_size_pct: 100,
              tp1_rr: tp1RR, tp2_rr: tp2RR, tp3_rr: tp3RR,
            }, { onConflict: 'id' })
          ).catch((e: Error) => ({ error: e }))

          if (recSaveErr) {
            results.errors.push(`[SignalSave] ${(recSaveErr as {message?:string}).message ?? recSaveErr}`)
          } else {
            await handleSignalEvent(rec, 'new', rec.idea.price, ntfyTopic)
            results.signals.push({ type: recType, side: recSide, confidence: recConf })
            // Section 7: If Claude justified coexistence with opposite positions, say so
            const coexist = aiDecision?.coexistenceReasoning
            const oppositeStillOpen = stillActive.some(s => s.idea.tradeType !== 'Scalp' && s.idea.side !== recSide)
            if (coexist && oppositeStillOpen && ntfyTopic) {
              const oppSide = recSide === 'LONG' ? 'SHORT' : 'LONG'
              await ntfy(
                ntfyTopic,
                sanitizeHdr(`APEX — Coexistencia ${recSide}+${oppSide} justificada`),
                `⚖️ Mantengo posiciones en AMBAS direcciones.\n\n${coexist}`,
                2,
                'scales',
              )
            }
          }
          } // end tp1RR >= 1.5
        }
      }
    }

    // ── 5. Generate Scalp signal (only during valid sessions + killzone) ───────
    const hasActiveScalp = active.some(s => s.idea.tradeType === 'Scalp')

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

      if (scalpSig) {
        // Dedup: skip if a similar scalp already exists (same side, entry within 0.5%, last 2h)
        const twoHoursAgo = Date.now() - 2 * 3_600_000
        const duplicate = allSignals.find(s =>
          s.idea.tradeType === 'Scalp' &&
          (s.status === 'active' || s.status === 'tp1_hit' || s.status === 'tp2_hit') &&
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
          const sSlDist  = Math.abs(scalpSig.entry - scalpSig.sl)
          const sTP1RR   = sSlDist > 0 ? +(Math.abs(scalpSig.tp1 - scalpSig.entry) / sSlDist).toFixed(2) : 0
          const sTP2RR   = sSlDist > 0 ? +(Math.abs(scalpSig.tp2 - scalpSig.entry) / sSlDist).toFixed(2) : 0
          const sTP3RR   = sSlDist > 0 ? +(Math.abs(scalpSig.tp3 - scalpSig.entry) / sSlDist).toFixed(2) : 0
          const sCfg     = getPartialCloseConfig('Scalp', sTP1RR, sTP2RR)
          const rec: SignalRecord = {
            id:          String(Date.now()),
            createdAt:   time,
            status:      'active',
            exitPrice:   null, exitTs: null, pnl: null, pnlR: null,
            closedAt:    null, closeReason: null,
            ntfySent:    true,
            tp1ClosePct: sCfg.tp1Pct, tp2ClosePct: sCfg.tp2Pct, tp3ClosePct: sCfg.tp3Pct,
            tp1BankedPnl: 0, tp2BankedPnl: 0, totalBankedPnl: 0, remainingSizePct: 100,
            tp1RR: sTP1RR, tp2RR: sTP2RR, tp3RR: sTP3RR,
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
              tp1_close_pct: sCfg.tp1Pct, tp2_close_pct: sCfg.tp2Pct, tp3_close_pct: sCfg.tp3Pct,
              tp1_banked_pnl: 0, tp2_banked_pnl: 0, total_banked_pnl: 0, remaining_size_pct: 100,
              tp1_rr: sTP1RR, tp2_rr: sTP2RR, tp3_rr: sTP3RR,
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

    // ── 5b. ABCD Harmonic Signals — PRZ + Fibonacci confirmed → real trades ─────
    // Bypass activeCount < 3 gate: pattern-driven, not Claude-driven.
    // Requirements: at_prz + fibConfirmed + GOOD/PERFECT quality.
    const przCount          = abcdAnalysis.patterns.flatMap(x => x.patterns).filter(p => p.at_prz).length
    const harmonicCandidates: HarmonicSignalCandidate[] = generateHarmonicSignals(abcdAnalysis, price, przCount)

    for (const cand of harmonicCandidates) {
      // Skip if ANY record with this ID already exists — the pattern's lifecycle is bound
      // to one trade. Re-tests of the same PRZ form at a new D_target and get a new ID.
      const existingH = allSignals.find(s => s.id === cand.id)
      if (existingH) continue

      const hSlDist = Math.abs(cand.entry - cand.sl)
      const hTP1RR  = hSlDist > 0 ? +(Math.abs(cand.tp1 - cand.entry) / hSlDist).toFixed(2) : 0
      const hTP2RR  = hSlDist > 0 ? +(Math.abs(cand.tp2 - cand.entry) / hSlDist).toFixed(2) : 0
      const hTP3RR  = hSlDist > 0 ? +(Math.abs(cand.tp3 - cand.entry) / hSlDist).toFixed(2) : 0
      const hCfg    = getPartialCloseConfig(cand.tradeType, hTP1RR, hTP2RR)

      const rec: SignalRecord = {
        id: cand.id, createdAt: time, status: 'active', ntfySent: true,
        exitPrice: null, exitTs: null, pnl: null, pnlR: null, closedAt: null, closeReason: null,
        tp1ClosePct: hCfg.tp1Pct, tp2ClosePct: hCfg.tp2Pct, tp3ClosePct: hCfg.tp3Pct,
        tp1BankedPnl: 0, tp2BankedPnl: 0, totalBankedPnl: 0, remainingSizePct: 100,
        tp1RR: hTP1RR, tp2RR: hTP2RR, tp3RR: hTP3RR,
        idea: {
          side: cand.side, tradeType: cand.tradeType, confidence: cand.confidence,
          price: cand.entry, sl: cand.sl, tp1: cand.tp1, tp2: cand.tp2, tp3: cand.tp3,
          maxLev: cand.maxLev, bull: 0, bear: 0, maxSc: 10,
          reasons: cand.reasons, analysis: cand.analysis, ts: new Date(time),
        },
      }

      const hSb = getDbClient()
      const { error: hErr } = await Promise.resolve(
        hSb.from('apex_signals').upsert({
          id: rec.id, side: rec.idea.side, trade_type: rec.idea.tradeType,
          entry: rec.idea.price, sl: rec.idea.sl, tp1: rec.idea.tp1,
          tp2: rec.idea.tp2, tp3: rec.idea.tp3, confidence: rec.idea.confidence,
          status: rec.status, reasons: rec.idea.reasons, created_at: rec.createdAt,
          updated_at: new Date().toISOString(), ntfy_sent: true,
          pnl: null, pnl_r: null, closed_at: null, exit_price: null, close_reason: null,
          tp1_hit: false, tp2_hit: false, sl_warning_fired: false,
          expiry_warning_fired: false,
          tp1_close_pct: hCfg.tp1Pct, tp2_close_pct: hCfg.tp2Pct, tp3_close_pct: hCfg.tp3Pct,
          tp1_banked_pnl: 0, tp2_banked_pnl: 0, total_banked_pnl: 0, remaining_size_pct: 100,
          tp1_rr: hTP1RR, tp2_rr: hTP2RR, tp3_rr: hTP3RR,
        }, { onConflict: 'id' })
      ).catch((e: Error) => ({ error: e }))

      if (hErr) {
        results.errors.push(`[HarmonicSave] ${(hErr as { message?: string }).message ?? hErr}`)
      } else {
        await handleSignalEvent(rec, 'new', rec.idea.price, ntfyTopic)
        results.signals.push({ type: cand.tradeType, side: cand.side, confidence: cand.confidence })
      }
    }

    // PRZ alert for non-Fib patterns — lightweight notification only, no signal
    if (abcdAnalysis.inPRZ && harmonicCandidates.length === 0 && ntfyTopic) {
      const p = abcdAnalysis.mostRelevant!
      const action = p.direction === 'BEARISH' ? 'LONG' : 'SHORT'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastPRZAt = (prevStateForVoice as any)?.lastPrzAlertAt
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? new Date(String((prevStateForVoice as any).lastPrzAlertAt)).getTime() : 0
      if ((Date.now() - lastPRZAt) / 3_600_000 > 2) {
        await ntfy(
          ntfyTopic,
          sanitizeHdr(`APEX ABCD ${action} — PRZ sin Fib (${p.timeframe.toUpperCase()})`),
          [
            `⚠️ Precio en PRZ del patrón ABCD ${p.direction} (sin confluencia Fibonacci)`,
            `TF: ${p.timeframe.toUpperCase()} | Calidad: ${p.quality}`,
            `PRZ: $${Math.round(p.prz_low).toLocaleString()}–$${Math.round(p.prz_high).toLocaleString()}`,
            `Punto D: $${Math.round(p.D_target).toLocaleString()}`,
            `Sin señal generada — esperar confirmación Fibonacci.`,
          ].join('\n'),
          3,
          'chart_with_upwards_trend',
        )
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

    // 30-min market update — fire if 28+ minutes since last send
    if (minsSinceUpdate >= 28 && ntfyTopic) {
      // Atomic claim: write last_analysis_at BEFORE generating content.
      // Optimistic lock on last_analysis_at prevents two concurrent runs both firing.
      const claimSb   = getDbClient()
      const prevLastAt = prevStateForVoice?.lastAnalysisAt ?? null
      let slotClaimed  = !claimSb  // if no DB, just proceed
      if (claimSb) {
        const nowIso = new Date().toISOString()
        const q = claimSb.from('apex_agent_state').update({ last_analysis_at: nowIso }).eq('id', 'current')
        const { data: claimResult } = await Promise.resolve(
          prevLastAt !== null
            ? q.eq('last_analysis_at', prevLastAt).select()
            : q.is('last_analysis_at', null).select()
        ).catch(() => ({ data: null }))
        slotClaimed = Array.isArray(claimResult) && claimResult.length > 0
      }

      if (!slotClaimed) {
        console.log('[APEX] Update slot already claimed by concurrent run — skipping')
        results.update30minSkipped = 'slot_claimed_concurrent'
      } else {
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
          news:            [],
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
          mkt,
          socialSentiment: socialSentiment ?? null,
          abcdAnalysis:    abcdAnalysis,
          memory:          prevStateForVoice
            ? { lastBias: prevStateForVoice.lastBias, lastPrice: prevStateForVoice.lastPrice,
                lastAnalysisAt: prevStateForVoice.lastAnalysisAt, changeReason: prevStateForVoice.changeReason }
            : null,
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
    console.error('[APEX Agent] Fatal error:', msg)
    results.errors.push(msg)
    // NTFY on crash — max once per 30min to avoid spam if crash-looping
    if (ntfyTopic) {
      try {
        const errSb = getDbClient()
        const lastErrData = errSb
          ? await Promise.resolve(errSb.from('apex_agent_state')
              .select('last_error_alert_at').eq('id', 'current').maybeSingle()
            ).catch(() => ({ data: null }))
          : { data: null }
        const lastErrAt = (lastErrData as { data: { last_error_alert_at?: string } | null }).data?.last_error_alert_at
        const minsSince = lastErrAt ? (Date.now() - new Date(lastErrAt).getTime()) / 60_000 : Infinity
        if (minsSince >= 30) {
          await ntfy(
            ntfyTopic,
            sanitizeHdr('APEX AGENTE ERROR CRITICO'),
            `El agente falló y no completó este ciclo.\n\nError: ${msg.slice(0, 300)}\n\nRevisa los logs de Vercel.`,
            5,
            'warning,rotating_light',
          )
          if (errSb) {
            await Promise.resolve(errSb.from('apex_agent_state')
              .update({ last_error_alert_at: new Date().toISOString() })
              .eq('id', 'current')).catch(() => {})
          }
        }
      } catch { /* best-effort — don't let error NTFY crash the catch block */ }
    }
    return NextResponse.json({ error: msg, ...results }, { status: 500 })
  } finally {
    if (lockAcquired && lockSb) {
      try {
        await lockSb.from('apex_agent_state')
          .update({ is_running: false })
          .eq('id', 'current')
      } catch {}
    }
  }
}
