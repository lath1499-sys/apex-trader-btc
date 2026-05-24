import { NextResponse } from 'next/server'

const B_SPOT = 'https://api.binance.com'
const B_FUT  = 'https://fapi.binance.com'
const FG_API = 'https://api.alternative.me/fng/'
const BYBIT  = 'https://api.bybit.com'
const KRAKEN = 'https://api.kraken.com/0/public'

const TF_LIMITS: Record<string, number> = { '1d': 300, '4h': 300, '1h': 150, '15m': 150, '5m': 100, '3m': 100, '1m': 100 }
const TFS      = ['1d', '4h', '1h', '15m', '5m', '3m', '1m'] as const
// Bybit interval mapping (fallback when Binance is geo-blocked)
const BYBIT_TF: Record<string, string> = { '1d': 'D', '4h': '240', '1h': '60', '15m': '15', '5m': '5', '3m': '3', '1m': '1' }

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

// Bybit klines: result.list is [[ts, open, high, low, close, volume, turnover], ...]
// ts is milliseconds string; list is newest-first — reverse to oldest-first
type BybitKlineResp = { result: { list: Array<[string, string, string, string, string, string, string]> } }
function parseBybitKlines(raw: unknown): { t:number;o:number;h:number;l:number;c:number;v:number }[] | null {
  const resp = raw as BybitKlineResp | null
  const list = resp?.result?.list
  if (!Array.isArray(list) || !list.length) return null
  return [...list].reverse().map(k => ({
    t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
  }))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const fast = searchParams.get('fast') === '1'

  // ── FAST MODE: price + orderbook + 1m klines only (used by 10s scalp refresh) ──
  if (fast) {
    try {
      const [tick, ob, k1m] = await Promise.all([
        safeFetch(`${B_SPOT}/api/v3/ticker/price?symbol=BTCUSDT`),
        safeFetch(`${B_SPOT}/api/v3/depth?symbol=BTCUSDT&limit=20`),
        safeFetch(`${B_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=30`),
      ])
      const price = (tick as { price: string } | null)?.price
      return NextResponse.json({
        price: price ? +price : null,
        orderBook: ob ?? null,
        klines1m:  parseKlines(k1m) ?? [],
      })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  try {
    const [tick, prem, oi, lsr, fng, ob, byT, kraT] = await Promise.all([
      safeFetch(`${B_SPOT}/api/v3/ticker/24hr?symbol=BTCUSDT`),
      safeFetch(`${B_FUT}/fapi/v1/premiumIndex?symbol=BTCUSDT`),
      safeFetch(`${B_FUT}/fapi/v1/openInterest?symbol=BTCUSDT`),
      safeFetch(`${B_FUT}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`),
      safeFetch(FG_API),
      safeFetch(`${B_SPOT}/api/v3/depth?symbol=BTCUSDT&limit=20`),
      safeFetch(`${BYBIT}/v5/market/tickers?category=spot&symbol=BTCUSDT`),
      safeFetch(`${KRAKEN}/Ticker?pair=XBTUSD`),
    ])

    type TickerData = { lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }
    type PremData = { lastFundingRate: string; markPrice: string; indexPrice: string }
    type OIData = { openInterest: string }
    type LSRData = Array<{ longShortRatio: string; longAccount: string; shortAccount: string }>
    type FGData = { data: Array<{ value: string; value_classification: string }> }
    type OBData = { bids: [string, string][]; asks: [string, string][] }
    type BybitData = { result: { list: Array<{ lastPrice: string }> } }
    type KrakenData = { result: Record<string, { c: [string] }> }

    const market: Record<string, number | string | boolean | null> = {}

    if (tick) {
      const t = tick as TickerData
      market.price  = +t.lastPrice
      market.change = +t.priceChangePercent
      market.high   = +t.highPrice
      market.low    = +t.lowPrice
      market.vol    = +t.quoteVolume
    }
    if (prem) {
      const p = prem as PremData
      market.funding = +p.lastFundingRate * 100
      market.mark    = +p.markPrice
      market.index   = +p.indexPrice
    }
    if (oi)  market.oi = +((oi as OIData).openInterest)
    if (lsr) {
      const row = (lsr as LSRData)[0]
      if (row) {
        market.lsr      = +row.longShortRatio
        market.longPct  = +row.longAccount * 100
        market.shortPct = +row.shortAccount * 100
      }
    }
    if (fng) {
      const fg = ((fng as FGData).data ?? [])[0]
      if (fg) { market.fg = +fg.value; market.fgLabel = fg.value_classification }
    }
    if (byT) {
      const row = ((byT as BybitData).result?.list ?? [])[0]
      if (row) market.bybitPrice = +row.lastPrice
    }
    if (kraT) {
      const kraResult = (kraT as KrakenData).result
      if (kraResult) {
        const row = Object.values(kraResult)[0]
        if (row) market.krakenPrice = +row.c[0]
      }
    }

    // klines — parallel across all timeframes; fall back to Bybit if Binance is blocked
    const klinesEntries = await Promise.all(
      TFS.map(async (tf) => {
        const limit = TF_LIMITS[tf] ?? 150
        const raw = await safeFetch(`${B_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${limit}`)
        let parsed = parseKlines(raw)
        if (!parsed && BYBIT_TF[tf]) {
          const bybitRaw = await safeFetch(`${BYBIT}/v5/market/kline?category=spot&symbol=BTCUSDT&interval=${BYBIT_TF[tf]}&limit=${limit}`)
          parsed = parseBybitKlines(bybitRaw)
        }
        return [tf, parsed] as const
      })
    )
    const klines = Object.fromEntries(klinesEntries.filter(([, v]) => v !== null))

    return NextResponse.json({
      market,
      orderBook: ob as OBData | null,
      klines,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
