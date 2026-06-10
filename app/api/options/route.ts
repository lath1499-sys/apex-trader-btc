// APEX — Deribit Options Data Proxy
// Thin wrapper around lib/deribitFetch.ts — all logic lives there.
// Cache TTL: 15 min (shared with agent route).

import { NextResponse }     from 'next/server'
import { fetchOptionsData } from '@/lib/deribitFetch'

export async function GET(): Promise<NextResponse> {
  const data = await fetchOptionsData()
  if (!data) return NextResponse.json({ error: 'Deribit data unavailable' }, { status: 502 })
  return NextResponse.json(data)
}
