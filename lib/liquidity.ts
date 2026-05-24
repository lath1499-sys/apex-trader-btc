import type { Kline } from './types'

export interface LiqLevel {
  price:    number
  strength: number   // number of touches / confluences
  type:     'equal_highs' | 'equal_lows' | 'prev_day_high' | 'prev_day_low' | 'prev_week_high' | 'prev_week_low'
}

export interface LiquidityResult {
  buySideLiquidity:  LiqLevel[]   // above price — equal highs, PDH, PWH
  sellSideLiquidity: LiqLevel[]   // below price — equal lows, PDL, PWL
  nearestBSL: number | null       // closest BSL above current price
  nearestSSL: number | null       // closest SSL below current price
}

// ── Swing finder (compact, local to this module) ─────────────────────────────

function swingHighs(klines: Kline[], lookback = 3): number[] {
  const out: number[] = []
  const n = klines.length
  for (let i = lookback; i < n - lookback; i++) {
    let ok = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && klines[j].h >= klines[i].h) { ok = false; break }
    }
    if (ok) out.push(klines[i].h)
  }
  return out
}

function swingLows(klines: Kline[], lookback = 3): number[] {
  const out: number[] = []
  const n = klines.length
  for (let i = lookback; i < n - lookback; i++) {
    let ok = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && klines[j].l <= klines[i].l) { ok = false; break }
    }
    if (ok) out.push(klines[i].l)
  }
  return out
}

// ── Cluster prices within tolerance% of each other ───────────────────────────

function clusterPrices(prices: number[], tolerancePct = 0.003): { price: number; count: number }[] {
  if (!prices.length) return []
  const sorted = [...prices].sort((a, b) => a - b)
  const clusters: { price: number; count: number }[] = []

  let group = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const ref = group[group.length - 1]
    if (Math.abs(sorted[i] - ref) / ref <= tolerancePct) {
      group.push(sorted[i])
    } else {
      clusters.push({ price: group.reduce((a, b) => a + b, 0) / group.length, count: group.length })
      group = [sorted[i]]
    }
  }
  clusters.push({ price: group.reduce((a, b) => a + b, 0) / group.length, count: group.length })

  // Only return clusters with 2+ touches (equal highs / equal lows)
  return clusters.filter(c => c.count >= 2)
}

// ── Previous day / week H/L from 4H klines ───────────────────────────────────

function prevDayHL(klines: Kline[]): { high: number | null; low: number | null } {
  const MS_DAY  = 86_400_000
  const todayDay = Math.floor(klines[klines.length - 1].t / MS_DAY)
  const prevDay  = todayDay - 1

  const dayCandles = klines.filter(k => Math.floor(k.t / MS_DAY) === prevDay)
  if (!dayCandles.length) return { high: null, low: null }
  return {
    high: Math.max(...dayCandles.map(k => k.h)),
    low:  Math.min(...dayCandles.map(k => k.l)),
  }
}

function prevWeekHL(klines: Kline[]): { high: number | null; low: number | null } {
  // ISO week: week starts Monday. Approximate via 7-day buckets from epoch.
  const MS_WEEK  = 7 * 86_400_000
  const nowWeek  = Math.floor(klines[klines.length - 1].t / MS_WEEK)
  const prevWeek = nowWeek - 1

  const weekCandles = klines.filter(k => Math.floor(k.t / MS_WEEK) === prevWeek)
  if (!weekCandles.length) return { high: null, low: null }
  return {
    high: Math.max(...weekCandles.map(k => k.h)),
    low:  Math.min(...weekCandles.map(k => k.l)),
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function detectLiquidity(klines: Kline[]): LiquidityResult {
  const empty: LiquidityResult = {
    buySideLiquidity: [], sellSideLiquidity: [],
    nearestBSL: null, nearestSSL: null,
  }
  if (!klines || klines.length < 10) return empty

  const slice        = klines.slice(-100)
  const currentPrice = klines[klines.length - 1].c

  const bsl: LiqLevel[] = []   // buy-side  (above price)
  const ssl: LiqLevel[] = []   // sell-side (below price)

  // ── Equal highs → buy-side liquidity ─────────────────────────────────────
  const highs    = swingHighs(slice)
  const hClusters = clusterPrices(highs)
  for (const c of hClusters) {
    if (c.price > currentPrice) {
      bsl.push({ price: c.price, strength: c.count, type: 'equal_highs' })
    }
  }

  // ── Equal lows → sell-side liquidity ─────────────────────────────────────
  const lows     = swingLows(slice)
  const lClusters = clusterPrices(lows)
  for (const c of lClusters) {
    if (c.price < currentPrice) {
      ssl.push({ price: c.price, strength: c.count, type: 'equal_lows' })
    }
  }

  // ── Previous day H/L ─────────────────────────────────────────────────────
  const { high: pdh, low: pdl } = prevDayHL(slice)
  if (pdh != null && pdh > currentPrice) bsl.push({ price: pdh, strength: 2, type: 'prev_day_high' })
  if (pdl != null && pdl < currentPrice) ssl.push({ price: pdl, strength: 2, type: 'prev_day_low'  })

  // ── Previous week H/L ────────────────────────────────────────────────────
  const { high: pwh, low: pwl } = prevWeekHL(slice)
  if (pwh != null && pwh > currentPrice) bsl.push({ price: pwh, strength: 3, type: 'prev_week_high' })
  if (pwl != null && pwl < currentPrice) ssl.push({ price: pwl, strength: 3, type: 'prev_week_low'  })

  // ── Sort: BSL ascending (nearest above first), SSL descending (nearest below first)
  bsl.sort((a, b) => a.price - b.price)
  ssl.sort((a, b) => b.price - a.price)

  return {
    buySideLiquidity:  bsl,
    sellSideLiquidity: ssl,
    nearestBSL: bsl.length ? bsl[0].price  : null,
    nearestSSL: ssl.length ? ssl[0].price  : null,
  }
}
