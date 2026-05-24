import { NextResponse } from 'next/server'
import type { OnChainData, RecentBlock } from '@/lib/types'

const MEMPOOL = 'https://mempool.space/api'

async function safeFetch(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

interface DifficultyAdjustment {
  currentDifficultyAdjustment?: number
  difficultyChange?: number
}

interface MempoolInfo {
  count?: number
}

interface FeeRecommendation {
  fastestFee?: number
  halfHourFee?: number
  hourFee?: number
}

export async function GET() {
  try {
    const [diff, height, mem, fees, blocks] = await Promise.all([
      safeFetch(`${MEMPOOL}/v1/difficulty-adjustment`),
      safeFetch(`${MEMPOOL}/blocks/tip/height`),
      safeFetch(`${MEMPOOL}/mempool`),
      safeFetch(`${MEMPOOL}/v1/fees/recommended`),
      safeFetch(`${MEMPOOL}/v1/blocks`),
    ])

    const d = diff as DifficultyAdjustment | null
    const m = mem  as MempoolInfo | null
    const f = fees as FeeRecommendation | null

    const hr = d?.currentDifficultyAdjustment != null
      ? (d.currentDifficultyAdjustment / 7.158e18) * 1000
      : null

    const data: OnChainData = {
      hr,
      diffAdj:     d?.difficultyChange ?? null,
      height:      typeof height === 'number' ? height : null,
      mempool:     m?.count,
      fee:         f?.fastestFee,
      feeMid:      f?.halfHourFee,
      feeHour:     f?.hourFee,
      recentBlocks: Array.isArray(blocks)
        ? (blocks as RecentBlock[]).slice(0, 10)
        : [],
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
