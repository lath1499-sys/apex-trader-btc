import { NextResponse } from 'next/server'
import {
  isBinanceConfigured, binanceEnvLabel,
  getFuturesBalance, getFuturesPositions,
} from '@/lib/binanceClient'

export const runtime = 'nodejs'

export async function GET() {
  const env = binanceEnvLabel()

  if (!isBinanceConfigured()) {
    return NextResponse.json({ configured: false, env })
  }

  const [balancesRes, positionsRes] = await Promise.allSettled([
    getFuturesBalance(),
    getFuturesPositions(),
  ])

  const errors: string[] = []
  if (balancesRes.status === 'rejected')  errors.push(balancesRes.reason instanceof Error ? balancesRes.reason.message : String(balancesRes.reason))
  if (positionsRes.status === 'rejected') errors.push(positionsRes.reason instanceof Error ? positionsRes.reason.message : String(positionsRes.reason))

  return NextResponse.json({
    configured: true,
    env,
    balances:  balancesRes.status  === 'fulfilled' ? balancesRes.value  : [],
    positions: positionsRes.status === 'fulfilled' ? positionsRes.value : [],
    errors,
  })
}
