import { NextResponse } from 'next/server'

export const revalidate = 0

interface CoinGeckoGlobal {
  data: {
    total_market_cap: Record<string, number>
    market_cap_percentage: Record<string, number>
    total_volume: Record<string, number>
  }
}

export async function GET() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      next: { revalidate: 120 },
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const json = await res.json() as CoinGeckoGlobal
    const d = json.data
    const totalUSD  = d.total_market_cap?.usd ?? null
    const btcPct    = d.market_cap_percentage?.btc ?? null
    const btcUSD    = totalUSD && btcPct ? totalUSD * btcPct / 100 : null
    const total2USD = totalUSD && btcUSD ? totalUSD - btcUSD : null
    return NextResponse.json({ totalUSD, btcPct, btcUSD, total2USD, ok: true })
  } catch {
    return NextResponse.json({ ok: false, totalUSD: null, btcPct: null, btcUSD: null, total2USD: null })
  }
}
