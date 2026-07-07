import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { id, exitPrice, closeReason, pnl, pnlR, closedAt, status: statusOverride } = (await req.json()) as {
      id:           string
      exitPrice:    number
      closeReason:  string
      pnl:          number
      pnlR:         number
      closedAt:     string
      status?:      string
    }

    if (!id || exitPrice == null) {
      return NextResponse.json({ error: 'Missing id or exitPrice' }, { status: 400 })
    }

    const VALID_STATUSES = ['closed_manual', 'sl_hit', 'breakeven', 'tp1_hit', 'tp2_hit', 'tp3_hit']
    const finalStatus = statusOverride && VALID_STATUSES.includes(statusOverride) ? statusOverride : 'closed_manual'

    const sb = getSupabaseServer()
    if (!sb) return NextResponse.json({ error: 'No DB client — SUPABASE_SERVICE_KEY missing' }, { status: 500 })

    const { error } = await (sb.from('apex_signals') as any).update({
      status:       finalStatus,
      exit_price:   exitPrice,
      close_reason: closeReason ?? 'manual_close',
      pnl:          pnl ?? null,
      pnl_r:        pnlR ?? null,
      closed_at:    closedAt ?? new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }).eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
