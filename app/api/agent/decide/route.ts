// APEX Decide — new signal generation via Claude.
// Called every 5 minutes by GitHub Actions decide job.
// Decoupled from monitor (SL/TP) and evaluate (trade management).
//
// Full context pipeline: klines (1D/4H/1H/15M) → indicators → regime →
// FVG/liquidity → Elliott Waves → ABCD harmonics → macro (FRED) → Fed
// expectations → global markets → social sentiment → whale alerts →
// options/IV → news → performance history. Every field aiDecisionMaker's
// prompt template expects is populated here — none of it should reach
// Claude as "?" / "N/A" for lack of being wired in.

import { NextRequest, NextResponse }                                     from 'next/server'
import { withLock }                                                       from '@/lib/runLock'
import { sendTelegram, tgSignal, tgClose }                               from '@/lib/telegram'
import { askClaudeForDecision }                                          from '@/lib/aiDecisionMaker'
import { saveSignalToCloud, loadSignalsFromCloud, getSupabaseServer }    from '@/lib/supabase'
import { fetchBTCNews }                                                   from '@/lib/newsFetcher'
import { fetchMarketData }                                                from '@/lib/marketFetch'
import { runInds }                                                        from '@/lib/indicators'
import { detectMarketRegime }                                             from '@/lib/marketRegime'
import { detectFVGs }                                                     from '@/lib/fvg'
import { detectLiquidity }                                                from '@/lib/liquidity'
import { detectElliottWaves }                                             from '@/lib/elliottWaves'
import { getCurrentTradingSession }                                       from '@/lib/tradingHours'
import { analyzeAllABCD }                                                 from '@/lib/harmonicPatterns'
import { analyzeMacroSentiment }                                          from '@/lib/macroSentiment'
import { fetchMacroIndicators, fetchFedExpectations }                     from '@/lib/macroEconomics'
import { fetchGlobalMarkets }                                             from '@/lib/marketCorrelation'
import { fetchSocialSentiment }                                           from '@/lib/socialSentiment'
import { fetchWhaleAlert }                                                from '@/lib/whaleDetector'
import { fetchOptionsData }                                               from '@/lib/deribitFetch'
import type { SignalRecord, Kline, IndicatorMap, MarketData }             from '@/lib/types'

export const runtime     = 'nodejs'
export const maxDuration = 60

function toKlines(arr: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> | undefined): Kline[] {
  return (arr ?? []).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }))
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // notify=true — used by /forcecheck so a manual trigger always gets a reply,
  // even on WAIT/paused/blocked. The routine 5-min cron omits it to avoid spam.
  const notify = req.nextUrl.searchParams.get('notify') === 'true'

  console.log('[DECIDE] ===== Triggered', new Date().toISOString(), '=====')

  const startedAt = Date.now()
  try {
    const result = await withLock('decide', async () => {
      // ── 1. Full market data — price, klines (all TFs), funding/OI/L-S/F&G ──
      // Binance → Bybit → Kraken fallback per timeframe (Binance IPs blocked on Vercel).
      const md    = await fetchMarketData()
      const price = md.price ?? md.bybitPrice ?? md.krakenPrice ?? null
      if (!price) {
        console.error('[DECIDE] Price fetch failed')
        if (notify) await sendTelegram('⚠️ Forcecheck: no pude obtener el precio de BTC (Binance/Bybit/Kraken no respondieron). Intenta de nuevo.').catch(() => {})
        return { status: 'error', error: 'price_fetch_failed' }
      }
      console.log('[DECIDE] Price:', price)

      const klines = {
        '1d':  toKlines(md.klines['1d']),
        '4h':  toKlines(md.klines['4h']),
        '1h':  toKlines(md.klines['1h']),
        '15m': toKlines(md.klines['15m']),
      }
      if (!klines['4h'].length) {
        console.error('[DECIDE] No 4H klines from any source')
        if (notify) await sendTelegram('⚠️ Forcecheck: no pude obtener velas 4H (Binance/Bybit/Kraken). Intenta de nuevo.').catch(() => {})
        return { status: 'error', error: 'no_klines' }
      }

      const mkt: MarketData = {
        loading: false,
        price,
        change:  md.change  ?? 0,
        funding: md.funding ?? undefined,
        lsr:     md.lsr     ?? 1,
        fg:      md.fg      ?? undefined,
        fgLabel: md.fgLabel ?? undefined,
      }

      // ── Pause check ──────────────────────────────────────────────────────────
      const sb = getSupabaseServer()
      if (sb) {
        const { data: state } = await Promise.resolve(
          sb.from('apex_agent_state')
            .select('is_paused, pause_reason')
            .eq('id', 'current')
            .maybeSingle(),
        ).catch(() => ({ data: null })) as { data: { is_paused?: boolean; pause_reason?: string } | null }
        if (state?.is_paused) {
          console.log('[DECIDE] Agent paused:', state.pause_reason)
          if (notify) await sendTelegram(`⏸ Forcecheck: agente pausado — ${state.pause_reason ?? 'sin razón'}.\n\nUsa /unpause para reanudar.`).catch(() => {})
          return { status: 'paused', reason: state.pause_reason }
        }
      }

      // ── 2. Technical analysis — indicators, regime, FVG, liquidity, Elliott,
      //      session, ABCD harmonics. All deterministic, computed from real klines. ──
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
      const ew4h      = klines['4h'].length >= 20 ? detectElliottWaves(klines['4h']) : null
      const ew1d      = klines['1d'].length >= 20 ? detectElliottWaves(klines['1d']) : null
      const abcdAnalysis = analyzeAllABCD(
        { '15m': klines['15m'], '1h': klines['1h'], '4h': klines['4h'], '1d': klines['1d'] },
        price,
      )
      console.log(`[DECIDE] TA — regime:${regime?.regime ?? '?'} FVG4h:${fvg4h.all?.length ?? 0} EW4h:${ew4h?.currentWave ?? '?'} ABCD:${abcdAnalysis.tradingSignal}`)

      const macroSentiment = analyzeMacroSentiment(
        [], mkt.fg ?? 50, mkt.funding ?? 0, mkt.lsr ?? 1, mkt.change ?? 0, {},
      )

      // ── 3. External context — macro (FRED), Fed expectations, global markets,
      //      social sentiment, whale alerts, options/IV, news. All parallel. ──
      const [macroIndicators, globalMarkets, socialSentiment, whaleAlert, optionsData, newsSnap] = await Promise.all([
        fetchMacroIndicators().catch(() => null),
        fetchGlobalMarkets().catch(() => null),
        fetchSocialSentiment().catch(() => null),
        fetchWhaleAlert().catch(() => null),
        fetchOptionsData().catch(() => null),
        fetchBTCNews().catch(() => null),
      ])
      const fedExpectations = macroIndicators?.fedRate?.current
        ? await fetchFedExpectations(macroIndicators.fedRate.current).catch(() => null)
        : null
      console.log(`[DECIDE] Context — macroIndicators:${!!macroIndicators} globalMarkets:${!!globalMarkets} social:${!!socialSentiment} whale:${!!whaleAlert} options:${!!optionsData}`)

      const newsItems = (newsSnap?.items ?? []).slice(0, 8).map(n => ({ title: n.title, tag: n.sentiment }))

      // ── Load signals — targeted queries, not a full 500-row dump ────────────
      const [activeSignalsRaw, recentSigRaw, closedSignalsRaw] = await Promise.all([
        loadSignalsFromCloud({ statuses: ['active', 'tp1_hit', 'tp2_hit'], limit: 10 }),
        loadSignalsFromCloud({ limit: 10 }),
        loadSignalsFromCloud({
          statuses: ['sl_hit', 'tp3_hit', 'breakeven', 'closed_manual'],
          limit: 50,
        }),
      ])

      const active = activeSignalsRaw ?? []

      if (active.length >= 5) {
        console.log('[DECIDE] Max active signals (5) — skipping')
        if (notify) await sendTelegram('🚫 Forcecheck: ya hay 5 señales activas (máximo). No se genera una nueva hasta que se cierre alguna.').catch(() => {})
        return { status: 'blocked', reason: 'max_active_signals' }
      }

      // Days since last signal + recent type distribution (any status, most recent 10)
      const recentSignals       = recentSigRaw ?? []
      const lastSignalTs        = recentSignals[0]?.createdAt
      const daysSinceLastSignal = lastSignalTs
        ? Math.floor((Date.now() - new Date(lastSignalTs).getTime()) / 86_400_000)
        : 0
      const recentSignalTypes = recentSignals.map(s => s.idea.tradeType)
      const activeScalps      = active.filter(s => s.idea.tradeType === 'Scalp').length

      // ── C: Daily drawdown guard — auto-pause if 3+ SL hits or PnL < -5% ────
      if (sb) {
        const todayStart = new Date()
        todayStart.setUTCHours(0, 0, 0, 0)
        const { data: todayClosed } = await Promise.resolve(
          sb.from('apex_signals')
            .select('status, pnl')
            .gte('closed_at', todayStart.toISOString())
            .not('closed_at', 'is', null),
        ).catch(() => ({ data: null })) as { data: Array<{ status: string; pnl: number | null }> | null }

        const slHitsToday = (todayClosed ?? []).filter(r => r.status === 'sl_hit').length
        const dailyPnl    = (todayClosed ?? []).reduce((s, r) => s + (r.pnl ?? 0), 0)

        if (slHitsToday >= 3 || dailyPnl < -5) {
          const reason = slHitsToday >= 3
            ? `Auto-pausa: ${slHitsToday} SL hoy — límite diario alcanzado`
            : `Auto-pausa: P&L diario ${dailyPnl.toFixed(2)}% < -5%`
          console.warn('[DECIDE] Auto-pausing agent:', reason)
          await Promise.resolve(
            sb.from('apex_agent_state').upsert({
              id: 'current', is_paused: true, pause_reason: reason,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' }),
          ).catch(() => {})
          await sendTelegram(
            `🛑 <b>APEX AUTO-PAUSA</b>\n\n${reason}\n\n` +
            `SL hoy: ${slHitsToday} | P&L: ${dailyPnl.toFixed(2)}%\n` +
            `Usa /unpause para reanudar.`,
          ).catch(() => {})
          return { status: 'auto_paused', reason }
        }
        console.log(`[DECIDE] Daily check OK — SL hoy: ${slHitsToday}, P&L: ${dailyPnl.toFixed(2)}%`)
      }

      console.log('[DECIDE] Active:', active.length, '| Days since last signal:', daysSinceLastSignal)

      // ── A: perfStats — feedback from closed trades for Claude context ────────
      const closed = (closedSignalsRaw ?? []).filter(s => s.pnl != null)
      const wins    = closed.filter(s => (s.pnl ?? 0) > 0)
      const totalR  = closed.reduce((sum, s) => sum + (s.pnlR ?? 0), 0)
      const byType  = (['Scalp','DayTrade','Swing'] as const).reduce<Record<string, { n: number; wr: number; avgR: number }>>((acc, tp) => {
        const g = closed.filter(s => s.idea.tradeType === tp)
        const w = g.filter(s => (s.pnl ?? 0) > 0)
        return { ...acc, [tp]: { n: g.length, wr: g.length ? Math.round(w.length/g.length*100) : 0, avgR: g.length ? parseFloat((g.reduce((s2, s3) => s2 + (s3.pnlR ?? 0), 0)/g.length).toFixed(2)) : 0 } }
      }, {})
      const bySide  = (['LONG','SHORT'] as const).reduce<Record<string, { n: number; wr: number; avgR: number }>>((acc, sd) => {
        const g = closed.filter(s => s.idea.side === sd)
        const w = g.filter(s => (s.pnl ?? 0) > 0)
        return { ...acc, [sd]: { n: g.length, wr: g.length ? Math.round(w.length/g.length*100) : 0, avgR: g.length ? parseFloat((g.reduce((s2, s3) => s2 + (s3.pnlR ?? 0), 0)/g.length).toFixed(2)) : 0 } }
      }, {})
      const recent5 = closed.slice(0, 5).map(s => ({ side: s.idea.side, type: s.idea.tradeType, pnlR: parseFloat((s.pnlR ?? 0).toFixed(2)) }))
      const perfStats = closed.length >= 5 ? {
        total: closed.length, winRate: Math.round(wins.length/closed.length*100),
        totalR: parseFloat(totalR.toFixed(2)), byType, bySide, recent5,
      } : null
      if (perfStats) console.log(`[DECIDE] perfStats: ${perfStats.total} trades, WR ${perfStats.winRate}%, R ${perfStats.totalR}`)

      // ── Format active signals for Claude context ─────────────────────────────
      const activeSigData = active.map(s => ({
        id:        s.id,
        side:      s.idea.side,
        entry:     s.idea.price,
        sl:        s.idea.sl,
        tp1:       s.idea.tp1,
        tradeType: s.idea.tradeType,
        tp1Hit:    s.tp1Hit ?? false,
        createdAt: s.createdAt,
      }))

      // prevPrice — from persisted agent state (30-min-ish old snapshot from last
      // successful decide run), falls back to current price if never set.
      let prevPrice = price
      if (sb) {
        const { data: prevState } = await Promise.resolve(
          sb.from('apex_agent_state').select('last_price').eq('id', 'current').maybeSingle(),
        ).catch(() => ({ data: null })) as { data: { last_price?: number } | null }
        if (prevState?.last_price) prevPrice = prevState.last_price
      }

      const ctx = {
        price,
        prevPrice,
        inds,
        regime,
        session,
        mkt,
        elliottWaves: { '4h': ew4h, '1d': ew1d },
        fvgs:         { '4h': fvg4h, '15m': fvg15m },
        liquidity,
        whaleAlert,
        macroSentiment,
        macroIndicators,
        fedExpectations,
        globalMarkets,
        socialSentiment,
        abcdAnalysis,
        optionsData,
        klines4h:           klines['4h'],
        activeSignals:      activeSigData,
        daysSinceLastSignal,
        recentSignalTypes,
        activeScalps,
        news:               newsItems,
        perfStats,
      }

      // ── Claude decision ──────────────────────────────────────────────────────
      let decision = await askClaudeForDecision(ctx)
      console.log('[DECIDE] Claude →', decision?.action, '| waiting:', decision?.waitingFor ?? '—')

      // Force-scalp if 2+ days without a signal
      if (decision?.action === 'WAIT' && daysSinceLastSignal >= 2) {
        console.log('[DECIDE] Force-scalp mode:', daysSinceLastSignal, 'd without signal')
        const forced = await askClaudeForDecision({ ...ctx, forceScalpEvaluation: true })
        if (forced && forced.action !== 'WAIT') {
          decision = forced
          console.log('[DECIDE] Force-scalp succeeded:', forced.action, forced.tradeType)
        }
      }

      // ── Portfolio coherence — actually close positions Claude flagged, instead
      //      of just logging positionsToClose and discarding it. Applies regardless
      //      of the primary action (WAIT/CLOSE_EXISTING/LONG/SHORT can all carry closes).
      if (decision?.positionsToClose?.length) {
        for (const { signalId, reason } of decision.positionsToClose) {
          const target = active.find(s => s.id === signalId)
          if (!target) {
            console.warn('[DECIDE] positionsToClose referenced unknown/already-closed signal:', signalId)
            continue
          }
          const isLong = target.idea.side === 'LONG'
          const pnl    = parseFloat((isLong
            ? (price - target.idea.price) / target.idea.price * 100
            : (target.idea.price - price) / target.idea.price * 100
          ).toFixed(3))
          const slDist = Math.abs(target.idea.price - target.idea.sl)
          const pnlR   = slDist > 0 ? parseFloat(((pnl / 100 * target.idea.price) / slDist).toFixed(2)) : null
          const updated: SignalRecord = {
            ...target,
            status:      'closed_manual',
            pnl,
            pnlR,
            closedAt:    new Date().toISOString(),
            exitPrice:   price,
            closeReason: `Claude: ${reason}`,
          }
          await saveSignalToCloud(updated)
          await sendTelegram(tgClose(updated, pnl, reason)).catch(() => {})
          console.log(`[DECIDE] Closed by Claude: ${signalId} P&L ${pnl.toFixed(2)}% — ${reason}`)
        }
      }

      // ── B: Decision log — save to apex_brief_history for observability ──────
      if (sb && decision) {
        const logEntry = decision.action === 'WAIT'
          ? `WAIT: ${decision.waitingFor ?? decision.reasoning?.slice(0, 300) ?? '—'}`
          : `${decision.action} ${decision.tradeType} (${decision.confidence}) — ${decision.reasoning?.slice(0, 250) ?? '—'}`
        const priceTag = `$${Math.round(price).toLocaleString()} — `
        await Promise.resolve(
          sb.from('apex_brief_history').insert({
            focus:       'DECIDE_LOG',
            summary:     `${priceTag}${logEntry}`.slice(0, 500),
            success:     decision.action !== 'WAIT',
            duration_ms: Date.now() - startedAt,
            created_at:  new Date().toISOString(),
          }),
        ).catch(() => {})
      }

      // ── Persist agent state — sesgo + confianza for /sh command ────────────────
      if (sb && decision) {
        await Promise.resolve(
          sb.from('apex_agent_state').upsert({
            id:              'current',
            last_bias:       decision.action,
            last_trade_type: decision.tradeType ?? null,
            last_confidence: decision.confidence ?? null,
            last_price:      price,
            updated_at:      new Date().toISOString(),
          }, { onConflict: 'id' }),
        ).catch(() => {})
      }

      if (!decision || decision.action === 'WAIT' || decision.action === 'CLOSE_EXISTING') {
        const reason = decision?.waitingFor ?? decision?.reasoning?.slice(0, 300) ?? 'sin setup válido ahora mismo'
        if (notify) await sendTelegram(`⏳ <b>WAIT</b> — ${reason}`).catch(() => {})
        return { status: 'wait', reason: decision?.waitingFor ?? 'no setup' }
      }

      if (!decision.entry || !decision.sl || !decision.tp1) {
        console.warn('[DECIDE] Missing levels in Claude response')
        if (notify) await sendTelegram('⚠️ Forcecheck: Claude devolvió una señal sin niveles completos (entry/SL/TP1). Descartada — intenta de nuevo.').catch(() => {})
        return { status: 'error', error: 'missing_levels' }
      }

      // ── Build and save SignalRecord ──────────────────────────────────────────
      const sigId = `apex_${Date.now()}`
      const maxLev = decision.tradeType === 'Scalp'
        ? 10 : decision.tradeType === 'DayTrade' ? 5 : 3

      const risk   = Math.abs(decision.entry - decision.sl)
      const tp1RR  = risk > 0 ? parseFloat((Math.abs(decision.entry - decision.tp1) / risk).toFixed(2)) : 0
      const tp2RR  = risk > 0 && decision.tp2 ? parseFloat((Math.abs(decision.entry - decision.tp2) / risk).toFixed(2)) : 0
      const tp3RR  = risk > 0 && decision.tp3 ? parseFloat((Math.abs(decision.entry - decision.tp3) / risk).toFixed(2)) : 0
      console.log(`[DECIDE] R:R — TP1 ${tp1RR}:1 | TP2 ${tp2RR}:1 | TP3 ${tp3RR}:1 (risk $${risk.toFixed(0)})`)

      const sig: SignalRecord = {
        id:               sigId,
        createdAt:        new Date().toISOString(),
        status:           'active',
        exitPrice:        null,
        exitTs:           null,
        pnl:              null,
        pnlR:             null,
        closedAt:         null,
        closeReason:      null,
        tp1Hit:           false,
        tp2Hit:           false,
        ntfySent:         false,
        slWarningFired:   false,
        expiryWarningFired: false,
        breakevenSet:     false,
        trailing2Set:     false,
        trailingActive:   false,
        tp1ClosePct:      40,
        tp2ClosePct:      35,
        tp3ClosePct:      25,
        tp1BankedPnl:     0,
        tp2BankedPnl:     0,
        totalBankedPnl:   0,
        remainingSizePct: 100,
        tp1RR,
        tp2RR,
        tp3RR,
        idea: {
          side:       decision.action as 'LONG' | 'SHORT',
          tradeType:  decision.tradeType,
          confidence: decision.confidence,
          price:      decision.entry,
          sl:         decision.sl,
          tp1:        decision.tp1,
          tp2:        decision.tp2,
          tp3:        decision.tp3,
          maxLev,
          bull:       decision.action === 'SHORT' ? 0 : (decision.keyFactors ?? []).length,
          bear:       decision.action === 'SHORT' ? (decision.keyFactors ?? []).length : 0,
          maxSc:      12,
          reasons:    (decision.keyFactors ?? []).map(txt => ({
            s: (decision.action === 'SHORT' ? 'bear' : 'bull') as 'bull' | 'bear', txt,
          })),
          analysis:   decision.reasoning,
          ts:         new Date(),
        },
      }

      await saveSignalToCloud(sig)
      console.log('[DECIDE] Signal saved:', sigId, decision.action, decision.tradeType)

      await sendTelegram(tgSignal(sig)).catch(e =>
        console.error('[DECIDE] Telegram error:', e instanceof Error ? e.message : e),
      )

      return { status: 'signal', id: sigId, action: decision.action, type: decision.tradeType }
    })

    if (!result && notify) {
      await sendTelegram('⚠️ Forcecheck: ya hay un análisis corriendo (lock activo). Espera ~1min y reintenta.').catch(() => {})
    }

    console.log('[DECIDE] ===== Done =====', result)
    return NextResponse.json(result ?? { status: 'skipped', reason: 'lock_held' })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[DECIDE] Uncaught error:', msg)
    if (notify) {
      await sendTelegram(`❌ <b>Error en forcecheck</b>\n<code>${msg.slice(0, 300)}</code>`).catch(() => {})
    }
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 })
  }
}
