// Dedicated brief endpoint — runs independently from /api/agent
// Called by GitHub Actions brief job at :00 and :30 every hour.
// Decoupled from signal generation so a long Claude call never blocks the brief.

import { NextRequest, NextResponse }        from 'next/server'
import { sendTelegram, tgBrief }            from '@/lib/telegram'
import { withLock }                         from '@/lib/runLock'
import { generateBriefStandalone }          from '@/lib/agentVoice'
import { getSupabaseServer, getSupabase }   from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 60

function getDb() { return getSupabaseServer() ?? getSupabase() }

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[BRIEF] ===== Triggered', new Date().toISOString(), '=====')

  // ── Env var check ────────────────────────────────────────────────────────
  const required = [
    'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'CRON_SECRET',
  ]
  const missing = required.filter(v => !process.env[v])
  if (missing.length) {
    console.error('[BRIEF] Missing env vars:', missing.join(', '))
    return NextResponse.json({ error: 'Missing env vars', missing }, { status: 500 })
  }
  console.log('[BRIEF] Env vars OK ✅')

  // ── 28-min cooldown — shared with embedded brief via last_analysis_at ────
  const db = getDb()
  let minsSinceLast = Infinity
  if (db) {
    try {
      const { data: state } = await Promise.resolve(
        db.from('apex_agent_state')
          .select('last_analysis_at')
          .eq('id', 'current')
          .maybeSingle()
      ) as { data: { last_analysis_at: string | null } | null }
      if (state?.last_analysis_at) {
        minsSinceLast = (Date.now() - new Date(state.last_analysis_at).getTime()) / 60_000
        console.log(`[BRIEF] ${minsSinceLast.toFixed(1)}min since last brief`)
      }
    } catch {}
  }
  if (minsSinceLast < 26) {
    console.log('[BRIEF] Cooldown active — skipping')
    return NextResponse.json({ status: 'skipped', reason: `cooldown: ${minsSinceLast.toFixed(1)}min` })
  }

  // ── Run with distributed lock ─────────────────────────────────────────────
  const result = await withLock('brief', async () => {
    try {
      console.log('[BRIEF] Generating standalone brief...')
      const { text, price, change24h, activeSignals } = await generateBriefStandalone()

      console.log('[BRIEF] Sending to Telegram...')
      await sendTelegram(tgBrief(
        text, price, change24h,
        activeSignals.map(s => ({ side: s.side, trade_type: s.trade_type, entry: s.entry })),
      ))
      console.log('[BRIEF] Telegram sent ✅')

      // Update cooldown timestamp so embedded brief in /api/agent doesn't double-fire
      if (db) {
        await Promise.resolve(
          db.from('apex_agent_state')
            .update({ last_analysis_at: new Date().toISOString() })
            .eq('id', 'current')
        ).catch(() => {})
      }

      const duration = Date.now() - startedAt
      console.log(`[BRIEF] Done in ${duration}ms`)
      return { success: true, duration, length: text.length }

    } catch (err: unknown) {
      const msg      = err instanceof Error ? err.message : String(err)
      const duration = Date.now() - startedAt
      console.error('[BRIEF] FAILED:', msg)
      await sendTelegram(
        `🚨 <b>APEX Brief Error</b>\n\n<code>${msg.slice(0, 300)}</code>\n\n<i>Revisar Vercel logs.</i>`
      ).catch(() => {})
      return { success: false, error: msg, duration }
    }
  })

  if (!result) {
    console.log('[BRIEF] Skipped — lock contention')
    return NextResponse.json({ status: 'skipped', reason: 'lock_held' })
  }
  console.log('[BRIEF] ===== Done =====')
  return NextResponse.json(result)
}
