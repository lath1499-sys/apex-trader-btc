import { NextResponse } from 'next/server'
import { fetchOnChainData } from '@/lib/onchainFetch'

export async function GET() {
  try {
    const data = await fetchOnChainData()
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
