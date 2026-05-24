import { NextResponse } from 'next/server'

export const revalidate = 0

interface ForceOrder {
  side: string
  origQty: string
  price: string
  time: number
}

export async function GET() {
  try {
    const res = await fetch(
      'https://fapi.binance.com/fapi/v1/forceOrders?symbol=BTCUSDT&limit=50',
      { next: { revalidate: 30 }, cache: 'no-store' }
    )
    if (!res.ok) throw new Error(`Binance ${res.status}`)
    const orders = await res.json() as ForceOrder[]

    let longLiq = 0, shortLiq = 0
    let biggestVal = 0, biggestSide = '', biggestTime = 0

    for (const o of orders) {
      const val = +o.origQty * +o.price
      if (o.side === 'SELL') { longLiq  += val } // long liquidation = forced SELL
      else                   { shortLiq += val } // short liquidation = forced BUY
      if (val > biggestVal) { biggestVal = val; biggestSide = o.side === 'SELL' ? 'LONG' : 'SHORT'; biggestTime = o.time }
    }

    return NextResponse.json({ longLiq, shortLiq, biggestVal, biggestSide, biggestTime, ok: true })
  } catch {
    return NextResponse.json({ ok: false, longLiq: 0, shortLiq: 0, biggestVal: 0, biggestSide: '', biggestTime: 0 })
  }
}
