import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServerSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  try {
    const sb = getServerSb()
    if (!sb) return NextResponse.json({ data: [] })

    const { data, error } = await sb
      .from('apex_capital_history')
      .select('balance, monthly_pnl_pct, drawdown_stage, recorded_at')
      .order('recorded_at', { ascending: true })
      .limit(500)

    if (error) return NextResponse.json({ data: [], error: error.message })
    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    return NextResponse.json({ data: [], error: err instanceof Error ? err.message : String(err) })
  }
}
