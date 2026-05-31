import { NextResponse } from 'next/server'

export const revalidate = 0

interface ForceOrder {
  side:    string
  origQty: string
  price:   string
  time:    number
}

interface BybitTrade {
  side:  string
  size:  string
  price: string
  time:  string
}

function processOrders(orders: ForceOrder[]) {
  let longLiq = 0, shortLiq = 0
  let biggestVal = 0, biggestSide = '', biggestTime = 0
  for (const o of orders) {
    const val = +o.origQty * +o.price
    if (o.side === 'SELL') { longLiq  += val }
    else                   { shortLiq += val }
    if (val > biggestVal) { biggestVal = val; biggestSide = o.side === 'SELL' ? 'LONG' : 'SHORT'; biggestTime = o.time }
  }
  return { longLiq, shortLiq, biggestVal, biggestSide, biggestTime }
}

export async function GET() {
  // ── 1. Binance allForceOrders (public endpoint, no auth needed for symbol queries) ──
  try {
    const res = await fetch(
      'https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=50',
      { headers: { 'Accept': 'application/json' }, cache: 'no-store' }
    )
    if (res.ok) {
      const orders = await res.json() as ForceOrder[]
      if (Array.isArray(orders) && orders.length > 0) {
        return NextResponse.json({ ...processOrders(orders), ok: true, source: 'binance' })
      }
    }
  } catch { /* try next source */ }

  // ── 2. Bybit large trades as liquidation proxy ───────────────────────────────
  try {
    const res = await fetch(
      'https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=200',
      { headers: { 'Accept': 'application/json' }, cache: 'no-store' }
    )
    if (res.ok) {
      const raw = await res.json() as { result?: { list?: BybitTrade[] } }
      const trades = raw?.result?.list ?? []
      // Use trades > 0.5 BTC as liquidation proxy
      const large = trades.filter(t => parseFloat(t.size) > 0.5)
      if (large.length > 0) {
        let longLiq = 0, shortLiq = 0, biggestVal = 0, biggestSide = '', biggestTime = 0
        for (const t of large) {
          const val = parseFloat(t.size) * parseFloat(t.price)
          // Bybit: Buy side = short liquidation, Sell side = long liquidation
          if (t.side === 'Sell') { longLiq  += val }
          else                   { shortLiq += val }
          if (val > biggestVal) {
            biggestVal  = val
            biggestSide = t.side === 'Sell' ? 'LONG' : 'SHORT'
            biggestTime = parseInt(t.time)
          }
        }
        return NextResponse.json({ longLiq, shortLiq, biggestVal, biggestSide, biggestTime, ok: true, source: 'bybit' })
      }
    }
  } catch { /* fall through */ }

  // ── 3. All sources failed — return clean error (not ok) ──────────────────────
  return NextResponse.json({ ok: false, longLiq: 0, shortLiq: 0, biggestVal: 0, biggestSide: '', biggestTime: 0, source: 'unavailable' })
}
