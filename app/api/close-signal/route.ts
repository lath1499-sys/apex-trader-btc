import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { id, exitPrice, closeReason, pnl, pnlR, closedAt } = (await req.json()) as {
      id:          string
      exitPrice:   number
      closeReason: string
      pnl:         number
      pnlR:        number
      closedAt:    string
    }

    if (!id || exitPrice == null) {
      return NextResponse.json({ error: 'Missing id or exitPrice' }, { status: 400 })
    }

    const sb = getSupabaseServer()
    if (!sb) return NextResponse.json({ error: 'No DB client — SUPABASE_SERVICE_KEY missing' }, { status: 500 })

    const { error } = await (sb.from('apex_signals') as any).update({
      status:       'closed_manual',
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
