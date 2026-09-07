// Shared on-chain data fetcher used by both:
//   app/api/onchain/route.ts  (HTTP proxy for the browser's OnChainPanel)
//   app/api/agent/decide/route.ts  (background agent — direct import, no HTTP hop)
import type { OnChainData, RecentBlock } from './types'

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

export async function fetchOnChainData(): Promise<OnChainData> {
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

  return {
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
}
