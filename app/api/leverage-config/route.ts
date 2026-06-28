import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  try {
    const sb = getSb()
    if (!sb) return NextResponse.json({ error: 'DB not configured' }, { status: 503 })
    const { data, error } = await sb
      .from('apex_leverage_config')
      .select('*')
      .order('trade_type')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSb()
    if (!sb) return NextResponse.json({ error: 'DB not configured' }, { status: 503 })
    const body = await req.json() as {
      trade_type:     string
      leverage_min:   number
      leverage_max:   number
      leverage_ideal: number
      sl_min_pct:     number
      sl_max_pct:     number
    }
    const { error } = await sb.from('apex_leverage_config').upsert({
      ...body,
      updated_at: new Date().toISOString(),
      updated_by: 'dashboard',
    }, { onConflict: 'trade_type' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
