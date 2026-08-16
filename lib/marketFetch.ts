// Shared market-data fetcher used by both:
//   app/api/binance/route.ts  (HTTP proxy for the browser)
//   app/api/agent/route.ts    (background agent — direct import, no HTTP hop)
//
// Sources:
//   Price/ticker  — median of every source that responds: Binance, Bybit,
//                   Kraken, Coinbase, CoinGecko. Binance AND Bybit both
//                   routinely fail to respond from Vercel's IPs (geo/rate
//                   restrictions), which used to leave Kraken as the de
//                   facto sole source despite being named "last fallback" —
//                   and Kraken alone can run 0.1%+ off Binance, a real bite
//                   out of a tight Scalp stop. Median resists any single
//                   exchange's spread or an outright failure dictating price.
//   Funding/OI    — Binance Futures (nullable)
//   Klines        — Binance Spot → Bybit Spot (per TF, if Binance blocked)

const B_SPOT    = 'https://api.binance.com'
const B_FUT     = 'https://fapi.binance.com'
const FG_API    = 'https://api.alternative.me/fng/'
const BYBIT     = 'https://api.bybit.com'
const KRAKEN    = 'https://api.kraken.com/0/public'
const COINBASE  = 'https://api.coinbase.com'
const GECKO     = 'https://api.coingecko.com'

export const TF_LIMITS: Record<string, number> = {
  '3d': 100, '1d': 300, '12h': 150, '4h': 300, '1h': 150, '15m': 150, '5m': 100, '3m': 100, '1m': 100,
}
export const TFS = ['3d', '1d', '12h', '4h', '1h', '15m', '5m', '3m', '1m'] as const
const BYBIT_TF: Record<string, string> = {
  '3d': 'D', '1d': 'D', '12h': '720', '4h': '240', '1h': '60', '15m': '15', '5m': '5', '3m': '3', '1m': '1',
}
// Kraken OHLC intervals in minutes (fallback #3 when Binance + Bybit blocked)
const KRAKEN_TF: Record<string, number> = {
  '3d': 4320, '1d': 1440, '12h': 720, '4h': 240, '1h': 60, '15m': 15, '5m': 5, '1m': 1,
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
  fg:           number | null
  fgLabel:      string | null
  bybitPrice:   number | null
  krakenPrice:  number | null
  coinbasePrice: number | null
  geckoPrice:   number | null
  orderBook:    { bids: [string, string][]; asks: [string, string][] } | null
  klines:       Record<string, MarketKline[]>
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function safeFetch(url: string, timeoutMs = 8_000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { next: { revalidate: 0 }, signal: ctrl.signal })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
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
  type BybitTick    = { result: { list: Array<{ lastPrice: string; price24hPcnt: string }> } }
  type KrakenData   = { result: Record<string, { c: [string]; o: string }> }
  type CoinbaseResp = { data?: { amount: string } }
  type GeckoResp    = { bitcoin?: { usd: number; usd_24h_change?: number } }

  const [tick, prem, oi, lsr, fng, ob, byT, kraT, cbT, ggT] = await Promise.all([
    safeFetch(`${B_SPOT}/api/v3/ticker/24hr?symbol=BTCUSDT`),
    safeFetch(`${B_FUT}/fapi/v1/premiumIndex?symbol=BTCUSDT`),
    safeFetch(`${B_FUT}/fapi/v1/openInterest?symbol=BTCUSDT`),
    safeFetch(`${B_FUT}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`),
    safeFetch(FG_API),
    safeFetch(`${B_SPOT}/api/v3/depth?symbol=BTCUSDT&limit=20`),
    safeFetch(`${BYBIT}/v5/market/tickers?category=spot&symbol=BTCUSDT`),
    safeFetch(`${KRAKEN}/Ticker?pair=XBTUSD`),
    safeFetch(`${COINBASE}/v2/prices/BTC-USD/spot`),
    safeFetch(`${GECKO}/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`),
  ])

  const result: FetchedMarket = {
    price: null, change: null, high: null, low: null, vol: null,
    funding: null, mark: null, oi: null, lsr: null, longPct: null, shortPct: null,
    fg: null, fgLabel: null, bybitPrice: null, krakenPrice: null,
    coinbasePrice: null, geckoPrice: null,
    orderBook: null, klines: {},
  }

  // Binance still supplies high/low/vol (no cross-exchange equivalent fetched
  // here) but its price/change now feed the median below, not a direct assign.
  let binancePrice: number | null = null, binanceChange: number | null = null
  if (tick) {
    const t = tick as TickerData
    binancePrice  = +t.lastPrice
    binanceChange = +t.priceChangePercent
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
  let bybitChange: number | null = null, krakenChange: number | null = null
  if (byT) {
    const row = ((byT as BybitTick).result?.list ?? [])[0]
    if (row) {
      result.bybitPrice = +row.lastPrice
      if (row.price24hPcnt) bybitChange = +row.price24hPcnt * 100
    }
  }
  if (kraT) {
    const kraResult = (kraT as KrakenData).result
    if (kraResult) {
      const row = Object.values(kraResult)[0]
      if (row) {
        result.krakenPrice = +row.c[0]
        const open = +row.o
        if (open > 0) krakenChange = (result.krakenPrice - open) / open * 100
      }
    }
  }
  if (cbT) {
    const amt = +((cbT as CoinbaseResp).data?.amount ?? NaN)
    if (amt > 0) result.coinbasePrice = amt
  }
  let geckoChange: number | null = null
  if (ggT) {
    const btc = (ggT as GeckoResp).bitcoin
    if (btc?.usd) {
      result.geckoPrice = btc.usd
      if (typeof btc.usd_24h_change === 'number') geckoChange = btc.usd_24h_change
    }
  }
  if (ob) result.orderBook = ob as OBData

  // Price: median of every source that actually responded, not a first-
  // available cascade. Binance and Bybit both routinely fail to respond from
  // Vercel's IPs, which used to leave Kraken alone setting the price despite
  // being the nominal last resort — and a single exchange can run 0.1%+ off
  // the rest, a real bite out of a tight Scalp stop.
  const priceSources = [binancePrice, result.bybitPrice, result.krakenPrice, result.coinbasePrice, result.geckoPrice]
    .filter((p): p is number => p != null && p > 0)
  result.price = median(priceSources)

  // Change%: same median approach, across whichever sources provide it.
  const changeSources = [binanceChange, bybitChange, krakenChange, geckoChange]
    .filter((c): c is number => c != null)
  result.change = median(changeSources)

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
