// APEX Decide — new signal generation via Claude.
// Called every 5 minutes by GitHub Actions decide job.
// Decoupled from monitor (SL/TP) and evaluate (trade management).

import { NextRequest, NextResponse }                                     from 'next/server'
import { withLock }                                                       from '@/lib/runLock'
import { sendTelegram, tgSignal }                                        from '@/lib/telegram'
import { askClaudeForDecision }                                          from '@/lib/aiDecisionMaker'
import { saveSignalToCloud, loadSignalsFromCloud, getSupabaseServer }    from '@/lib/supabase'
import { fetchBTCNews }                                                   from '@/lib/newsFetcher'
import type { SignalRecord }                                              from '@/lib/types'

export const runtime     = 'nodejs'
export const maxDuration = 60

async function getBtcPrice(): Promise<number | null> {
  try {
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', {
      signal: AbortSignal.timeout(6000),
    })
    const d = r.ok
      ? (await r.json() as { result?: Record<string, { c: [string] }> })
      : null
    const v = Object.values(d?.result ?? {})[0]
    const p = v?.c?.[0] ? parseFloat(v.c[0]) : NaN
    return !isNaN(p) && p > 1000 ? p : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[DECIDE] ===== Triggered', new Date().toISOString(), '=====')

  const result = await withLock('decide', async () => {
    // ── Price fetch ──────────────────────────────────────────────────────────
    const price = await getBtcPrice()
    if (!price) {
      console.error('[DECIDE] Price fetch failed')
      return { status: 'error', error: 'price_fetch_failed' }
    }
    console.log('[DECIDE] Price:', price)

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
        return { status: 'paused', reason: state.pause_reason }
      }
    }

    // ── Load signals ─────────────────────────────────────────────────────────
    const allSignals = await loadSignalsFromCloud()
    const active = (allSignals ?? []).filter(s =>
      ['active', 'tp1_hit', 'tp2_hit'].includes(s.status),
    )

    if (active.length >= 5) {
      console.log('[DECIDE] Max active signals (5) — skipping')
      return { status: 'blocked', reason: 'max_active_signals' }
    }

    // Days since last signal (force-scalp threshold)
    const lastSignalTs = (allSignals ?? [])[0]?.createdAt
    const daysSinceLastSignal = lastSignalTs
      ? Math.floor((Date.now() - new Date(lastSignalTs).getTime()) / 86_400_000)
      : 0

    console.log('[DECIDE] Active:', active.length, '| Days since last signal:', daysSinceLastSignal)

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

    // ── News fetch (optional) ────────────────────────────────────────────────
    const newsSnap  = await fetchBTCNews().catch(() => null)
    const newsItems = (newsSnap?.items ?? []).slice(0, 8)
      .map(n => ({ title: n.title, tag: n.sentiment }))

    const ctx = {
      price,
      activeSignals:      activeSigData,
      daysSinceLastSignal,
      news:               newsItems,
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
      return { status: 'wait', reason: decision?.waitingFor ?? 'no setup' }
    }

    if (!decision.entry || !decision.sl || !decision.tp1) {
      console.warn('[DECIDE] Missing levels in Claude response')
      return { status: 'error', error: 'missing_levels' }
    }

    // ── Build and save SignalRecord ──────────────────────────────────────────
    const sigId = `apex_${Date.now()}`
    const maxLev = decision.tradeType === 'Scalp'
      ? 10 : decision.tradeType === 'DayTrade' ? 5 : 3

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
      tp1RR:            0,
      tp2RR:            0,
      tp3RR:            0,
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
        bull:       0,
        bear:       0,
        maxSc:      12,
        reasons:    (decision.keyFactors ?? []).map(txt => ({ s: 'bull' as const, txt })),
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

  console.log('[DECIDE] ===== Done =====', result)
  return NextResponse.json(result ?? { status: 'skipped', reason: 'lock_held' })
}
