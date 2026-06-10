// lib/deribitFetch.ts — Shared Deribit fetch (DVOL + Max Pain + PCR)
// Used by /api/options (UI) and /api/agent/route.ts (agent context).
// 15-min server-side cache shared across both callers.

import { calcIV }        from './impliedVolatility'
import type { OptionsData } from './impliedVolatility'

interface DeribitInstrument {
  expiration_timestamp: number
  strike:               number
  option_type:          'call' | 'put'
  open_interest?:       number
}

let _cache: { data: OptionsData; ts: number } | null = null
const TTL = 15 * 60 * 1000

export async function fetchOptionsData(): Promise<OptionsData | null> {
  if (_cache && Date.now() - _cache.ts < TTL) return _cache.data

  const now30dAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  try {
    const [instrRes, tickerRes, dvolRes] = await Promise.allSettled([
      fetch('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false').then(r => r.json()),
      fetch('https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL').then(r => r.json()),
      fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${now30dAgo}&end_timestamp=${Date.now()}&resolution=3600`).then(r => r.json()),
    ])

    const btcPrice: number            = instrRes.status === 'fulfilled' && tickerRes.status === 'fulfilled' ? (tickerRes.value?.result?.last_price ?? 0) : 0
    const allInstr: DeribitInstrument[] = instrRes.status === 'fulfilled' ? (instrRes.value?.result ?? []) : []
    const dvolData                    = dvolRes.status === 'fulfilled' ? dvolRes.value : null

    // ── Max Pain + PCR ──────────────────────────────────────────────────────
    let maxPain = btcPrice, putCallRatio = 1, totalCallOI = 0, totalPutOI = 0
    let sentiment: OptionsData['sentiment'] = 'neutral'
    let expiryDate = '', daysToExpiry = 0

    if (btcPrice && allInstr.length) {
      const now      = Date.now()
      const expiries = [...new Set(allInstr.map(i => i.expiration_timestamp))].sort()
      const nearExp  = expiries.find(e => e > now) ?? expiries[0]

      if (nearExp) {
        const near = allInstr.filter(i =>
          i.expiration_timestamp === nearExp &&
          i.strike > btcPrice * 0.8 &&
          i.strike < btcPrice * 1.2,
        )
        const sm = new Map<number, { callOI: number; putOI: number }>()
        near.forEach(inst => {
          if (!sm.has(inst.strike)) sm.set(inst.strike, { callOI: 0, putOI: 0 })
          const e = sm.get(inst.strike)!
          if (inst.option_type === 'call') e.callOI += inst.open_interest ?? 0
          else                              e.putOI  += inst.open_interest ?? 0
        })
        const strikes = [...sm.entries()].sort(([a], [b]) => a - b)
        let minPain = Infinity
        strikes.forEach(([ts]) => {
          let pain = 0
          strikes.forEach(([s, oi]) => {
            pain += Math.max(0, ts - s) * oi.callOI
            pain += Math.max(0, s - ts) * oi.putOI
          })
          if (pain < minPain) { minPain = pain; maxPain = ts }
        })
        strikes.forEach(([, oi]) => { totalCallOI += oi.callOI; totalPutOI += oi.putOI })
        putCallRatio  = totalCallOI > 0 ? totalPutOI / totalCallOI : 1
        sentiment     = putCallRatio > 1.2 ? 'bearish' : putCallRatio < 0.8 ? 'bullish' : 'neutral'
        daysToExpiry  = Math.ceil((nearExp - now) / 86_400_000)
        expiryDate    = new Date(nearExp).toISOString().split('T')[0]
      }
    }

    // ── IV Rank from DVOL ───────────────────────────────────────────────────
    const dvolCandles: number[][] = dvolData?.result?.data ?? []
    const dvolHistory  = dvolCandles.map((c: number[]) => c[4])
    const dvolCurrent  = dvolHistory[dvolHistory.length - 1] ?? 0
    const iv = dvolCurrent > 0 ? calcIV(dvolCurrent, dvolHistory) : null

    const result: OptionsData = {
      maxPain,
      maxPainDistance: btcPrice > 0 ? ((maxPain - btcPrice) / btcPrice * 100).toFixed(2) : '0',
      putCallRatio:    parseFloat(putCallRatio.toFixed(3)),
      sentiment,
      totalCallOI:     Math.round(totalCallOI),
      totalPutOI:      Math.round(totalPutOI),
      expiryDate,
      daysToExpiry,
      btcPrice,
      iv,
    }

    _cache = { data: result, ts: Date.now() }
    return result

  } catch {
    return null
  }
}
