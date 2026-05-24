import type { Kline } from './types'

export interface FVG {
  type:        'bullish' | 'bearish'
  top:         number   // upper price of the gap
  bottom:      number   // lower price of the gap
  midpoint:    number   // (top + bottom) / 2
  bar:         number   // bar index where gap formed (candle[i-1] = the impulse candle)
  filled:      boolean
  distancePct: number   // % distance from current price (positive = above, negative = below)
}

export interface FVGResult {
  bullish: FVG[]   // active bullish FVGs (unfilled gaps acting as support)
  bearish: FVG[]   // active bearish FVGs (unfilled gaps acting as resistance)
  all:     FVG[]   // merged, sorted most-recent first, max 10 active
  nearest: FVG | null  // closest active FVG to current price
}

export function detectFVGs(klines: Kline[]): FVGResult {
  const empty: FVGResult = { bullish: [], bearish: [], all: [], nearest: null }
  if (!klines || klines.length < 3) return empty

  const slice       = klines.slice(-50)   // look back 50 candles
  const currentPrice = klines[klines.length - 1].c
  const active: FVG[] = []

  for (let i = 2; i < slice.length; i++) {
    const prev2 = slice[i - 2]
    const mid   = slice[i - 1]   // the impulse candle
    const curr  = slice[i]

    // ── Bullish FVG: prev2.high < curr.low ──────────────────────────────
    // Gap between top of candle[i-2] and bottom of candle[i]
    if (prev2.h < curr.l) {
      const top    = curr.l
      const bottom = prev2.h
      if (top <= bottom) continue   // sanity check

      // Check if any subsequent candle has traded into the gap zone (filled)
      let filled = false
      for (let j = i + 1; j < slice.length; j++) {
        if (slice[j].l <= top && slice[j].h >= bottom) { filled = true; break }
      }

      const distancePct = ((currentPrice - (top + bottom) / 2) / currentPrice) * 100

      active.push({
        type: 'bullish', top, bottom,
        midpoint: (top + bottom) / 2,
        bar: i - 1,   // the impulse candle bar index
        filled,
        distancePct,
      })
    }

    // ── Bearish FVG: prev2.low > curr.high ──────────────────────────────
    // Gap between bottom of candle[i-2] and top of candle[i]
    if (prev2.l > curr.h) {
      const top    = prev2.l
      const bottom = curr.h
      if (top <= bottom) continue

      let filled = false
      for (let j = i + 1; j < slice.length; j++) {
        if (slice[j].h >= bottom && slice[j].l <= top) { filled = true; break }
      }

      const distancePct = ((currentPrice - (top + bottom) / 2) / currentPrice) * 100

      active.push({
        type: 'bearish', top, bottom,
        midpoint: (top + bottom) / 2,
        bar: i - 1,
        filled,
        distancePct,
      })
    }
  }

  // Sort most recent first, keep only unfilled, cap at 10
  const unfilled = active
    .filter(f => !f.filled)
    .sort((a, b) => b.bar - a.bar)
    .slice(0, 10)

  const bullish = unfilled.filter(f => f.type === 'bullish')
  const bearish = unfilled.filter(f => f.type === 'bearish')

  // Nearest: smallest absolute distancePct
  const nearest = unfilled.length
    ? unfilled.reduce((a, b) => Math.abs(a.distancePct) < Math.abs(b.distancePct) ? a : b)
    : null

  return { bullish, bearish, all: unfilled, nearest }
}
