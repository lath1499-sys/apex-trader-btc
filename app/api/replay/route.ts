// Temporary endpoint — sends last signal via NTFY from server (has NTFY_TOPIC env var)
import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'

export const runtime    = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ntfyTopic = process.env.NTFY_TOPIC ?? ''
  if (!ntfyTopic) return NextResponse.json({ error: 'NTFY_TOPIC not set' }, { status: 500 })

  const sb = getSupabaseServer()
  if (!sb) return NextResponse.json({ error: 'Supabase not available' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('apex_signals') as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return NextResponse.json({ error: 'No signals found' }, { status: 404 })

  const s        = data
  const isActive = s.status === 'active'
  const pnlStr   = s.pnl != null ? `${s.pnl >= 0 ? '+' : ''}${Number(s.pnl).toFixed(2)}%` : 'N/A'
  const dateStr  = new Date(s.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  const statusLabel: Record<string, string> = {
    active:       '🟢 ACTIVA',
    closed_manual:'⚪ Cerrada (manual)',
    tp1_hit:      '✅ TP1 alcanzado',
    tp2_hit:      '✅ TP2 alcanzado',
    tp3_hit:      '✅ TP3 alcanzado',
    sl_hit:       '🔴 SL alcanzado',
    breakeven:    '⚪ Breakeven',
  }

  const reasons: Array<{ txt: string; s: string }> = Array.isArray(s.reasons) ? s.reasons : []
  const bearReasons = reasons.filter((r) => r.s === 'bear').map((r) => `• ${r.txt}`).slice(0, 4)
  const bullReasons = reasons.filter((r) => r.s === 'bull').map((r) => `• ${r.txt}`).slice(0, 2)

  const msg = [
    `${statusLabel[s.status] ?? s.status} — ${s.confidence} CONFIANZA`,
    '',
    `${s.side === 'SHORT' ? '🔴' : '🟢'} ${s.side} ${s.trade_type} | ${dateStr}`,
    `Entrada: $${Math.round(s.entry).toLocaleString()}`,
    `SL: $${Math.round(s.sl).toLocaleString()} | TP1: $${Math.round(s.tp1).toLocaleString()}`,
    `TP2: $${Math.round(s.tp2).toLocaleString()} | TP3: $${Math.round(s.tp3).toLocaleString()}`,
    isActive ? '' : `Resultado: ${pnlStr} ${s.exit_price ? `(salida $${Math.round(s.exit_price).toLocaleString()})` : ''}`,
    isActive ? '' : `Razón cierre: ${s.close_reason ?? 'N/A'}`,
    '',
    'Confluencias bajistas:',
    ...bearReasons,
    ...(bullReasons.length ? ['Confluencias alcistas:', ...bullReasons] : []),
  ].filter(l => l !== undefined).join('\n')

  const title = isActive
    ? `APEX ${s.side} ${s.trade_type} ACTIVA — $${Math.round(s.entry).toLocaleString()}`
    : `APEX Última señal: ${s.side} ${s.trade_type} ${pnlStr}`

  await fetch(`https://ntfy.sh/${ntfyTopic}`, {
    method:  'POST',
    headers: {
      'Title':        title,
      'Priority':     '4',
      'Tags':         s.side === 'SHORT' ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend',
      'Content-Type': 'text/plain',
    },
    body: msg,
  })

  return NextResponse.json({ sent: true, signal: { side: s.side, type: s.trade_type, status: s.status, pnl: s.pnl } })
}
