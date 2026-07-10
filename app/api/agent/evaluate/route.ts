// APEX Evaluate — open trade management (time-based expiry + stop movement).
// Called every 10 minutes by GitHub Actions evaluate job.
// Distinct from monitor (price-triggered SL/TP) — evaluate handles time & trailing.

import { NextRequest, NextResponse }               from 'next/server'
import { withLock }                                 from '@/lib/runLock'
import { sendTelegram, tgBreakeven, tgClose }       from '@/lib/telegram'
import { saveSignalToCloud, loadSignalsFromCloud }  from '@/lib/supabase'
import { evaluateStopManagement }                   from '@/lib/stopManagement'
import type { SignalRecord, SignalStatus }           from '@/lib/types'

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

// Expiry rules per trade type
const EXPIRY_MS: Record<string, number> = {
  Scalp:    3  * 3_600_000,        // 3 hours
  DayTrade: 26 * 3_600_000,        // 26 hours
  Swing:    7  * 24 * 3_600_000,   // 7 days
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[EVALUATE] ===== Triggered', new Date().toISOString(), '=====')

  const result = await withLock('evaluate', async () => {
    const [allSignals, price] = await Promise.all([
      loadSignalsFromCloud(),
      getBtcPrice(),
    ])

    if (!price) {
      console.error('[EVALUATE] Price fetch failed')
      return { status: 'error', error: 'price_fetch_failed' }
    }

    const active = (allSignals ?? []).filter(s =>
      (['active', 'tp1_hit', 'tp2_hit'] as SignalStatus[]).includes(s.status),
    )

    console.log('[EVALUATE] Active:', active.length, '| Price:', price)
    if (!active.length) return { status: 'no_signals' }

    const actions: string[] = []

    for (const sig of active) {
      try {
        const openMs    = Date.now() - new Date(sig.createdAt).getTime()
        const expiryMs  = EXPIRY_MS[sig.idea.tradeType]

        // ── Time-based expiry ────────────────────────────────────────────────
        if (expiryMs && openMs > expiryMs && sig.status === 'active') {
          const isLong  = sig.idea.side === 'LONG'
          const pnl     = isLong
            ? (price - sig.idea.price) / sig.idea.price * 100
            : (sig.idea.price - price)  / sig.idea.price * 100
          const openHrs = Math.round(openMs / 3_600_000)
          const reason  = `Expirado: ${sig.idea.tradeType} abierto ${openHrs}h sin alcanzar TP1`

          const expired: SignalRecord = {
            ...sig,
            status:      'closed_manual',
            exitPrice:   price,
            exitTs:      new Date().toISOString(),
            closedAt:    new Date().toISOString(),
            closeReason: reason,
            pnl:         parseFloat(pnl.toFixed(3)),
          }
          await saveSignalToCloud(expired)
          await sendTelegram(tgClose(expired, pnl, reason)).catch(() => {})
          console.log('[EVALUATE] Expired:', sig.id, `${openHrs}h open, P&L ${pnl.toFixed(2)}%`)
          actions.push(`expired:${sig.id}`)
          continue
        }

        // ── Stop management (breakeven / trailing) — active signals only ─────
        if (sig.status === 'active') {
          const update = evaluateStopManagement(sig, price, [])
          if (update) {
            const updated: SignalRecord = {
              ...sig,
              idea:           { ...sig.idea, sl: update.newSL },
              breakevenSet:   update.action === 'move_to_breakeven' ? true : (sig.breakevenSet ?? false),
              trailing2Set:   update.action === 'trail_to_tp1'      ? true : (sig.trailing2Set ?? false),
              trailingActive: ['trail_tighter', 'trail_behind_structure'].includes(update.action)
                ? true : (sig.trailingActive ?? false),
            }
            await saveSignalToCloud(updated)

            if (update.action === 'move_to_breakeven') {
              await sendTelegram(tgBreakeven(updated, sig.totalBankedPnl ?? 0)).catch(() => {})
            } else {
              await sendTelegram(
                `📐 <b>SL AJUSTADO — ${sig.idea.side} ${sig.idea.tradeType}</b>\n` +
                `$${Math.round(update.oldSL).toLocaleString()} → $${Math.round(update.newSL).toLocaleString()}\n` +
                `<i>${update.reason}</i>`,
              ).catch(() => {})
            }
            console.log('[EVALUATE] Stop update:', sig.id, update.action, '→', update.newSL)
            actions.push(`${update.action}:${sig.id}`)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[EVALUATE] Error on signal', sig.id, ':', msg)
      }
    }

    return { status: 'ok', evaluated: active.length, actions }
  })

  console.log('[EVALUATE] ===== Done =====', result)
  return NextResponse.json(result ?? { status: 'skipped', reason: 'lock_held' })
}
