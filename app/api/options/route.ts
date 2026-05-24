// APEX — Deribit Options Data Proxy
// Provides Max Pain + Put/Call Ratio from Deribit (free, no API key required).
// Cached for 15 minutes to avoid rate limiting.

import { NextResponse } from 'next/server'

interface DeribitInstrument {
  instrument_name:      string
  expiration_timestamp: number
  strike:               number
  option_type:          'call' | 'put'
  open_interest?:       number
}

interface DeribitSummary {
  open_interest: number
}

let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 15 * 60 * 1000  // 15 minutes

export async function GET(): Promise<NextResponse> {
  // Serve from cache if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  try {
    const [instrumentsRes, tickerRes] = await Promise.all([
      fetch(
        'https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false',
        { next: { revalidate: 900 } },
      ).then(r => r.json()),
      fetch(
        'https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL',
        { next: { revalidate: 60 } },
      ).then(r => r.json()),
    ])

    const btcPrice: number   = tickerRes?.result?.last_price ?? 0
    const allInstruments: DeribitInstrument[] = instrumentsRes?.result ?? []

    if (!btcPrice || !allInstruments.length) {
      return NextResponse.json({ error: 'Deribit data unavailable' }, { status: 502 })
    }

    // Get nearest weekly expiry
    const now      = Date.now()
    const expiries = [...new Set(allInstruments.map(i => i.expiration_timestamp))].sort()
    const nearestExpiry = expiries.find(e => e > now) ?? expiries[0]
    if (!nearestExpiry) return NextResponse.json({ error: 'No options expiry found' }, { status: 502 })

    // Filter to options near current price (±20%) expiring soonest
    const nearOptions = allInstruments.filter(i =>
      i.expiration_timestamp === nearestExpiry &&
      i.strike > btcPrice * 0.8 &&
      i.strike < btcPrice * 1.2,
    )

    // Group by strike
    const strikeMap = new Map<number, { callOI: number; putOI: number }>()
    nearOptions.forEach(inst => {
      const s = inst.strike
      if (!strikeMap.has(s)) strikeMap.set(s, { callOI: 0, putOI: 0 })
      const entry = strikeMap.get(s)!
      if (inst.option_type === 'call') entry.callOI += inst.open_interest ?? 0
      else                              entry.putOI  += inst.open_interest ?? 0
    })

    const strikes = [...strikeMap.entries()].sort(([a], [b]) => a - b)

    // Max Pain: strike where total option seller pain is minimised
    let maxPainStrike = btcPrice
    let minPain       = Infinity

    strikes.forEach(([testStrike]) => {
      let totalPain = 0
      strikes.forEach(([s, oi]) => {
        totalPain += Math.max(0, testStrike - s) * oi.callOI
        totalPain += Math.max(0, s - testStrike) * oi.putOI
      })
      if (totalPain < minPain) { minPain = totalPain; maxPainStrike = testStrike }
    })

    // Aggregate OI
    let totalCallOI = 0
    let totalPutOI  = 0
    strikes.forEach(([, oi]) => { totalCallOI += oi.callOI; totalPutOI += oi.putOI })
    const putCallRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 1

    const daysToExpiry = Math.ceil((nearestExpiry - now) / 86_400_000)
    const expiryDate   = new Date(nearestExpiry).toISOString().split('T')[0]
    const mpDistance   = ((maxPainStrike - btcPrice) / btcPrice * 100).toFixed(2)

    const result = {
      maxPain:          maxPainStrike,
      maxPainDistance:  mpDistance,
      putCallRatio:     parseFloat(putCallRatio.toFixed(3)),
      sentiment:        putCallRatio > 1.2 ? 'bearish' : putCallRatio < 0.8 ? 'bullish' : 'neutral',
      totalCallOI:      Math.round(totalCallOI),
      totalPutOI:       Math.round(totalPutOI),
      expiryDate,
      daysToExpiry,
      btcPrice,
    }

    cache = { data: result, ts: Date.now() }
    return NextResponse.json(result)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
