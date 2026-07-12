// APEX Agent Health — read-only endpoint for the Status panel UI.
// Returns brief stats, last decisions, daily drawdown, and run-lock health.
// No auth required — all data is operational telemetry, no secrets.

import { NextResponse }        from 'next/server'
import { getSupabaseServer }   from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET() {
  const sb = getSupabaseServer()
  if (!sb) return NextResponse.json({ error: 'DB not configured' }, { status: 500 })

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const since24h = new Date(Date.now() - 86_400_000).toISOString()

  const [briefsRes, decideLogRes, stateRes, locksRes, dailyRes] = await Promise.allSettled([
    // Brief health — last 24h
    Promise.resolve(
      sb.from('apex_brief_history')
        .select('success, error_msg, duration_ms, created_at, summary, focus')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(50),
    ),

    // Decision log — last 10 decide runs
    Promise.resolve(
      sb.from('apex_brief_history')
        .select('summary, created_at, success, duration_ms')
        .eq('focus', 'DECIDE_LOG')
        .order('created_at', { ascending: false })
        .limit(10),
    ),

    // Agent state — bias, confidence, pause status
    Promise.resolve(
      sb.from('apex_agent_state')
        .select('last_bias, last_confidence, last_trade_type, last_price, updated_at, is_paused, pause_reason')
        .eq('id', 'current')
        .maybeSingle(),
    ),

    // Run locks — last activity per job
    Promise.resolve(
      sb.from('apex_run_locks')
        .select('job_type, locked, last_run_at, last_run_ms, run_count')
        .order('job_type'),
    ),

    // Daily signals — today's closed trades
    Promise.resolve(
      sb.from('apex_signals')
        .select('status, pnl, created_at, closed_at, side, trade_type')
        .gte('closed_at', todayStart.toISOString())
        .not('closed_at', 'is', null),
    ),
  ])

  // ── Brief health stats ────────────────────────────────────────────────────
  type BriefRow = { success: boolean | null; error_msg: string | null; duration_ms: number | null; created_at: string; summary: string | null; focus: string | null }
  const briefRows: BriefRow[] = briefsRes.status === 'fulfilled' ? (briefsRes.value.data as BriefRow[] ?? []) : []
  const autoBriefs   = briefRows.filter(r => r.focus !== 'DECIDE_LOG')
  const briefSuccess = autoBriefs.filter(r => r.success).length
  const briefErrors  = autoBriefs.filter(r => !r.success).length
  const lastBrief    = autoBriefs[0] ?? null
  const avgDuration  = autoBriefs.length
    ? Math.round(autoBriefs.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / autoBriefs.length)
    : null

  // ── Decision log ─────────────────────────────────────────────────────────
  type DecideRow = { summary: string | null; created_at: string; success: boolean | null; duration_ms: number | null }
  const decides: DecideRow[] = decideLogRes.status === 'fulfilled' ? (decideLogRes.value.data as DecideRow[] ?? []) : []

  // ── Agent state ───────────────────────────────────────────────────────────
  type StateRow = { last_bias: string | null; last_confidence: string | null; last_trade_type: string | null; last_price: number | null; updated_at: string | null; is_paused: boolean | null; pause_reason: string | null }
  const agentState: StateRow | null = stateRes.status === 'fulfilled' ? (stateRes.value.data as StateRow | null) : null

  // ── Run locks ─────────────────────────────────────────────────────────────
  type LockRow = { job_type: string; locked: boolean; last_run_at: string | null; last_run_ms: number | null; run_count: number }
  const locks: LockRow[] = locksRes.status === 'fulfilled' ? (locksRes.value.data as LockRow[] ?? []) : []

  // ── Daily stats ───────────────────────────────────────────────────────────
  type SigRow = { status: string; pnl: number | null; side: string; trade_type: string }
  const dailyRows: SigRow[] = dailyRes.status === 'fulfilled' ? (dailyRes.value.data as SigRow[] ?? []) : []
  const slHitsToday   = dailyRows.filter(r => r.status === 'sl_hit').length
  const winsToday     = dailyRows.filter(r => ['tp1_hit','tp2_hit','tp3_hit'].includes(r.status)).length
  const dailyPnl      = dailyRows.reduce((s, r) => s + (r.pnl ?? 0), 0)

  return NextResponse.json({
    briefs: {
      last24h:     autoBriefs.length,
      success:     briefSuccess,
      errors:      briefErrors,
      successRate: autoBriefs.length ? Math.round(briefSuccess / autoBriefs.length * 100) : null,
      avgDurationMs: avgDuration,
      last: lastBrief ? {
        ts:       lastBrief.created_at,
        ok:       lastBrief.success,
        errMsg:   lastBrief.error_msg,
        price:    null,
        preview:  lastBrief.summary?.slice(0, 120) ?? null,
      } : null,
    },
    decides: decides.map(d => ({
      ts:       d.created_at,
      summary:  d.summary?.slice(0, 200) ?? null,
      price:    null,
      ok:       d.success,
      ms:       d.duration_ms,
    })),
    agentState,
    locks,
    daily: {
      slHits:   slHitsToday,
      wins:     winsToday,
      totalPnl: parseFloat(dailyPnl.toFixed(2)),
      trades:   dailyRows.length,
    },
  })
}
