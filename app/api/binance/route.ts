import { NextResponse }                            from 'next/server'
import { fetchMarketData, TF_LIMITS, TFS }         from '@/lib/marketFetch'

// ── Constants (kept for fast-mode only) ──────────────────────────────────────
const B_SPOT = 'https://api.binance.com'

async function safeFetch(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function parseKlines(raw: unknown): { t:number;o:number;h:number;l:number;c:number;v:number }[] | null {
  if (!Array.isArray(raw)) return null
  return (raw as unknown[][]).map(k => ({
    t: k[0] as number, o: +(k[1] as string), h: +(k[2] as string),
    l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string),
  }))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const fast = searchParams.get('fast') === '1'

  // ── FAST MODE: price + orderbook + 1m klines (10 s scalp refresh) ──────────
  if (fast) {
    try {
      const [tick, ob, k1m] = await Promise.all([
        safeFetch(`${B_SPOT}/api/v3/ticker/price?symbol=BTCUSDT`),
        safeFetch(`${B_SPOT}/api/v3/depth?symbol=BTCUSDT&limit=20`),
        safeFetch(`${B_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=30`),
      ])
      const price = (tick as { price: string } | null)?.price
      return NextResponse.json({
        price:    price ? +price : null,
        orderBook: ob ?? null,
        klines1m:  parseKlines(k1m) ?? [],
      })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── NORMAL MODE: delegate to shared lib ──────────────────────────────────────
  try {
    const data = await fetchMarketData()

    // Re-shape into the legacy response format the browser expects
    const market: Record<string, number | string | null> = {
      price:       data.price,
      change:      data.change,
      high:        data.high,
      low:         data.low,
      vol:         data.vol,
      funding:     data.funding,
      mark:        data.mark,
      oi:          data.oi,
      lsr:         data.lsr,
      longPct:     data.longPct,
      shortPct:    data.shortPct,
      fg:          data.fg,
      fgLabel:     data.fgLabel,
      bybitPrice:  data.bybitPrice,
      krakenPrice: data.krakenPrice,
    }
    // Strip nulls so the browser gets the same shape as before
    for (const k of Object.keys(market)) {
      if (market[k] === null) delete market[k]
    }

    // Only return the TFs the browser actually needs (excludes nothing — TFS covers all)
    const klines: Record<string, unknown[]> = {}
    for (const tf of TFS) {
      if (data.klines[tf]?.length) klines[tf] = data.klines[tf]
    }

    return NextResponse.json({ market, orderBook: data.orderBook, klines })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Re-export for direct use in other server modules
export { TF_LIMITS, TFS }
