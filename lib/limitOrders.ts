import type { TradeIdea, IndicatorMap, MarketData } from './types'
import type { FVGResult } from './fvg'

// ─────────────────────────────────────────────────────────────────────────────
// Limit Order Generator — suggests entry-at-better-price orders
// Sources: FVG midpoints, active Fibonacci levels, support/resistance
// ─────────────────────────────────────────────────────────────────────────────

export interface LimitOrder {
  id:           string
  source:       'fvg' | 'fib' | 'sr'
  side:         'LONG' | 'SHORT'
  price:        number
  sl:           number
  tp1:          number
  tp2:          number
  rr1:          number
  reason:       string
  validMinutes: number
  triggered:    boolean
}

function rr(entry: number, sl: number, tp: number): number {
  const risk   = Math.abs(entry - sl)
  const reward = Math.abs(tp - entry)
  return risk > 0 ? reward / risk : 0
}

export function generateLimitOrders(
  idea:  TradeIdea,
  inds:  IndicatorMap,
  fvgs:  Partial<Record<string, FVGResult>>,
  mkt:   MarketData,
): LimitOrder[] {
  if (!mkt.price) return []
  const price: number = mkt.price

  const isLong = idea.side === 'LONG'
  const orders: LimitOrder[] = []
  const seen   = new Set<number>()   // deduplicate by price bucket

  function addOrder(
    source: LimitOrder['source'],
    limitPrice: number,
    reason: string,
    validMins: number,
  ) {
    // Only accept limit orders at a better price than current market
    if (isLong  && limitPrice >= price) return   // LONG limit must be below current
    if (!isLong && limitPrice <= price) return   // SHORT limit must be above current

    // Must have positive R:R
    const r1 = rr(limitPrice, idea.sl, idea.tp1)
    if (r1 < 1) return

    // Deduplicate — skip if within 0.3% of an already-added order
    const bucket = Math.round(limitPrice / (price * 0.003))
    if (seen.has(bucket)) return
    seen.add(bucket)

    orders.push({
      id:           `lo_${source}_${Math.round(limitPrice)}`,
      source,
      side:         idea.side,
      price:        limitPrice,
      sl:           idea.sl,
      tp1:          idea.tp1,
      tp2:          idea.tp2,
      rr1:          Math.round(r1 * 10) / 10,
      reason,
      validMinutes: validMins,
      triggered:    false,
    })
  }

  // ── FVG levels (use 4h or 1h fvg) ──────────────────────────────────────────
  const fvg4h = fvgs['4h'] ?? fvgs['1h']
  if (fvg4h) {
    if (isLong) {
      // Bullish FVGs below price = demand zones
      fvg4h.bullish
        .filter(f => !f.filled && f.midpoint < price && f.midpoint > idea.sl)
        .slice(0, 2)
        .forEach(f => addOrder('fvg', f.midpoint, `FVG alcista ${(Math.abs(f.distancePct)).toFixed(1)}% abajo`, 120))
    } else {
      // Bearish FVGs above price = supply zones
      fvg4h.bearish
        .filter(f => !f.filled && f.midpoint > price && f.midpoint < idea.sl)
        .slice(0, 2)
        .forEach(f => addOrder('fvg', f.midpoint, `FVG bajista ${(Math.abs(f.distancePct)).toFixed(1)}% arriba`, 120))
    }
  }

  // ── Fibonacci retracement levels (4h) ──────────────────────────────────────
  const ind4h = inds['4h']
  if (ind4h?.fib) {
    const retraceLevels = [0.382, 0.5, 0.618]
    ind4h.fib
      .filter(f => !f.isExt && retraceLevels.includes(f.level))
      .forEach(f => {
        if (isLong && f.price < price && f.price > idea.sl) {
          addOrder('fib', f.price, `Fib ${f.label} retroceso`, 240)
        } else if (!isLong && f.price > price && f.price < idea.sl) {
          addOrder('fib', f.price, `Fib ${f.label} retroceso`, 240)
        }
      })
  }

  // ── EMA confluence (if EMA50 or EMA21 is between price and SL) ─────────────
  if (ind4h?.ema) {
    const emas = [
      { label: 'EMA50',  val: ind4h.ema.e50  },
      { label: 'EMA21',  val: ind4h.ema.e21  },
      { label: 'EMA200', val: ind4h.ema.e200 },
    ]
    emas.forEach(({ label, val }) => {
      if (!val) return
      if (isLong && val < price && val > idea.sl) {
        addOrder('sr', val, `${label} soporte dinámico`, 180)
      } else if (!isLong && val > price && val < idea.sl) {
        addOrder('sr', val, `${label} resistencia dinámica`, 180)
      }
    })
  }

  // Sort by best R:R, cap at 3
  return orders
    .sort((a, b) => b.rr1 - a.rr1)
    .slice(0, 3)
}
