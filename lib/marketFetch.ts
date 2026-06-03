// Shared market-data fetcher used by both:
//   app/api/binance/route.ts  (HTTP proxy for the browser)
//   app/api/agent/route.ts    (background agent — direct import, no HTTP hop)
//
// Sources, in priority order:
//   Price/ticker  — Binance Spot → Bybit Spot → Kraken
//   Funding/OI    — Binance Futures (nullable)
//   Klines        — Binance Spot → Bybit Spot (per TF, if Binance blocked)

const B_SPOT = 'https://api.binance.com'
const B_FUT  = 'https://fapi.binance.com'
const FG_API = 'https://api.alternative.me/fng/'
const BYBIT  = 'https://api.bybit.com'
const KRAKEN = 'https://api.kraken.com/0/public'

export const TF_LIMITS: Record<string, number> = {
  '1d': 300, '4h': 300, '1h': 150, '15m': 150, '5m': 100, '3m': 100, '1m': 100,
}
export const TFS = ['1d', '4h', '1h', '15m', '5m', '3m', '1m'] as const
const BYBIT_TF: Record<string, string> = {
  '1d': 'D', '4h': '240', '1h': '60', '15m': '15', '5m': '5', '3m': '3', '1m': '1',
}
// Kraken OHLC intervals in minutes (fallback #3 when Binance + Bybit blocked)
const KRAKEN_TF: Record<string, number> = {
  '1d': 1440, '4h': 240, '1h': 60, '15m': 15, '5m': 5, '1m': 1,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarketKline {
  t: number; o: number; h: number; l: number; c: number; v: number
}

export interface FetchedMarket {
  price:       number | null
  change:      number | null
  high:        number | null
  low:         number | null
  vol:         number | null
  funding:     number | null
  mark:        number | null
  oi:          number | null
  lsr:         number | null
  longPct:     number | null
  shortPct:    number | null
  fg:          number | null
  fgLabel:     string | null
  bybitPrice:  number | null
  krakenPrice: number | null
  orderBook:   { bids: [string, string][]; asks: [string, string][] } | null
  klines:      Record<string, MarketKline[]>
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function safeFetch(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function parseKlines(raw: unknown): MarketKline[] | null {
  if (!Array.isArray(raw)) return null
  return (raw as unknown[][]).map(k => ({
    t: k[0] as number,
    o: +(k[1] as string),
    h: +(k[2] as string),
    l: +(k[3] as string),
    c: +(k[4] as string),
    v: +(k[5] as string),
  }))
}

type BybitKlineResp = { result: { list: Array<[string, string, string, string, string, string, string]> } }
function parseBybitKlines(raw: unknown): MarketKline[] | null {
  const resp = raw as BybitKlineResp | null
  const list  = resp?.result?.list
  if (!Array.isArray(list) || !list.length) return null
  // Bybit returns newest-first — reverse to oldest-first
  return [...list].reverse().map(k => ({
    t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
  }))
}

// Kraken OHLC: result[pair] = [[ts_sec, o, h, l, c, vwap, vol, count], ...]
// ts is in seconds — multiply by 1000 for ms
type KrakenOHLCResp = { result: Record<string, Array<[number, string, string, string, string, string, string, number]>> }
function parseKrakenKlines(raw: unknown): MarketKline[] | null {
  const resp  = raw as KrakenOHLCResp | null
  if (!resp?.result) return null
  // Skip the 'last' key (number), find the array value
  const list = Object.values(resp.result).find(v => Array.isArray(v)) as
    Array<[number, string, string, string, string, string, string, number]> | undefined
  if (!list?.length) return null
  return list.map(k => ({
    t: k[0] * 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[6],
  }))
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchMarketData(): Promise<FetchedMarket> {
  type TickerData = { lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }
  type PremData   = { lastFundingRate: string; markPrice: string; indexPrice: string }
  type OIData     = { openInterest: string }
  type LSRData    = Array<{ longShortRatio: string; longAccount: string; shortAccount: string }>
  type FGData     = { data: Array<{ value: string; value_classification: string }> }
  type OBData     = { bids: [string, string][]; asks: [string, string][] }
  type BybitTick  = { result: { list: Array<{ lastPrice: string }> } }
  type KrakenData = { result: Record<string, { c: [string] }> }

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

  const result: FetchedMarket = {
    price: null, change: null, high: null, low: null, vol: null,
    funding: null, mark: null, oi: null, lsr: null, longPct: null, shortPct: null,
    fg: null, fgLabel: null, bybitPrice: null, krakenPrice: null,
    orderBook: null, klines: {},
  }

  if (tick) {
    const t = tick as TickerData
    result.price  = +t.lastPrice
    result.change = +t.priceChangePercent
    result.high   = +t.highPrice
    result.low    = +t.lowPrice
    result.vol    = +t.quoteVolume
  }
  if (prem) {
    const p = prem as PremData
    result.funding = +p.lastFundingRate * 100
    result.mark    = +p.markPrice
  }
  if (oi)  result.oi = +((oi as OIData).openInterest)
  if (lsr) {
    const row = (lsr as LSRData)[0]
    if (row) {
      result.lsr      = +row.longShortRatio
      result.longPct  = +row.longAccount * 100
      result.shortPct = +row.shortAccount * 100
    }
  }
  if (fng) {
    const fg = ((fng as FGData).data ?? [])[0]
    if (fg) { result.fg = +fg.value; result.fgLabel = fg.value_classification }
  }
  if (byT) {
    const row = ((byT as BybitTick).result?.list ?? [])[0]
    if (row) result.bybitPrice = +row.lastPrice
  }
  if (kraT) {
    const kraResult = (kraT as KrakenData).result
    if (kraResult) {
      const row = Object.values(kraResult)[0]
      if (row) result.krakenPrice = +row.c[0]
    }
  }
  if (ob) result.orderBook = ob as OBData

  // Price fallback: Binance → Bybit → Kraken
  // Vercel IPs are often blocked by Binance — Bybit/Kraken serve as reliable fallbacks
  if (result.price === null) {
    result.price = result.bybitPrice ?? result.krakenPrice
  }

  // Klines: Binance → Bybit → Kraken (each fallback only if previous returns null)
  const klinesEntries = await Promise.all(
    TFS.map(async (tf) => {
      const limit  = TF_LIMITS[tf] ?? 150

      // 1. Binance
      const raw    = await safeFetch(`${B_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${limit}`)
      let   parsed = parseKlines(raw)

      // 2. Bybit fallback
      if (!parsed && BYBIT_TF[tf]) {
        const bybitRaw = await safeFetch(
          `${BYBIT}/v5/market/kline?category=spot&symbol=BTCUSDT&interval=${BYBIT_TF[tf]}&limit=${limit}`,
        )
        parsed = parseBybitKlines(bybitRaw)
      }

      // 3. Kraken fallback
      if (!parsed && KRAKEN_TF[tf]) {
        const krakenRaw = await safeFetch(
          `${KRAKEN}/OHLC?pair=XBTUSD&interval=${KRAKEN_TF[tf]}`,
        )
        parsed = parseKrakenKlines(krakenRaw)
      }

      return [tf, parsed ?? []] as const
    }),
  )
  result.klines = Object.fromEntries(klinesEntries)

  return result
}
