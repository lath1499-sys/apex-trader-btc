import { useEffect, useRef } from 'react'
import { useApexStore } from '@/store/apexStore'
import { runInds, detectDivergences } from '@/lib/indicators'
import { getBTCCycle } from '@/lib/cycle'
import { getAutoAlerts } from '@/lib/buildContext'
// scoreTradeIdea removed — server agent (app/api/agent/route.ts) is sole signal source.
import { detectElliottWaves } from '@/lib/elliottWaves'
import { detectFVGs } from '@/lib/fvg'
import { detectLiquidity } from '@/lib/liquidity'
import type { IndicatorMap, IndicatorResult } from '@/lib/types'
// ntfyNewSignal removed — server agent sends all push notifications.

const TFS = ['1d', '4h', '1h', '15m'] as const

export function useIndicators() {
  const rawK         = useApexStore(s => s.rawK)
  const mkt          = useApexStore(s => s.mkt)
  const setInds      = useApexStore(s => s.setInds)
  const setCycle     = useApexStore(s => s.setCycle)
  const setAlerts    = useApexStore(s => s.setAlerts)
  const setDivergences  = useApexStore(s => s.setDivergences)
  const setElliottWaves = useApexStore(s => s.setElliottWaves)
  const setFvgs         = useApexStore(s => s.setFvgs)
  const setLiquidity    = useApexStore(s => s.setLiquidity)
  const setBiasMeta     = useApexStore(s => s.setBiasMeta)
  type BiasEntry = { bias: IndicatorResult['bias']; score: number; changedAt: number | null; prevBias: string | null }
  const stableRef  = useRef<Partial<Record<string, BiasEntry>>>({})

  useEffect(() => {
    if (!rawK || Object.keys(rawK).length === 0) return

    const newInds: IndicatorMap = {}
    for (const tf of TFS) {
      const k = rawK[tf]
      if (k) {
        const result = runInds(k)
        if (result) newInds[tf] = result
      }
    }
    // ── Bias stabilization: only flip if score shifts ≥2 ────────────────────
    const metaUpdate: Partial<Record<string, { changedAt: number | null; prevBias: string | null }>> = {}
    for (const tf of TFS) {
      const ind = newInds[tf]
      if (!ind) continue
      const prev = stableRef.current[tf]
      if (!prev) {
        stableRef.current[tf] = { bias: ind.bias, score: ind.score, changedAt: null, prevBias: null }
        metaUpdate[tf] = { changedAt: null, prevBias: null }
      } else if (ind.bias !== prev.bias && Math.abs(ind.score - prev.score) >= 2) {
        stableRef.current[tf] = { bias: ind.bias, score: ind.score, changedAt: Date.now(), prevBias: prev.bias }
        metaUpdate[tf] = { changedAt: Date.now(), prevBias: prev.bias }
      } else {
        ind.bias  = prev.bias
        ind.score = prev.score
        metaUpdate[tf] = { changedAt: prev.changedAt, prevBias: prev.prevBias }
      }
    }
    setBiasMeta(metaUpdate)
    setInds(newInds)

    const klines4h = rawK['4h']
    if (klines4h) setDivergences(detectDivergences(klines4h))
    if (mkt.price) setCycle(getBTCCycle(mkt.price))
    setAlerts(getAutoAlerts(mkt, newInds))

    // Elliott Waves: run for 1D, 4H, 1H
    const k1d = rawK['1d'], k1h = rawK['1h']
    setElliottWaves({
      '1d': k1d ? detectElliottWaves(k1d) : undefined,
      '4h': klines4h ? detectElliottWaves(klines4h) : undefined,
      '1h': k1h ? detectElliottWaves(k1h) : undefined,
    })

    // Fair Value Gaps: run for 4H and 1H
    setFvgs({
      '4h': klines4h ? detectFVGs(klines4h) : undefined,
      '1h': k1h ? detectFVGs(k1h) : undefined,
    })

    // Liquidity: run on 4H klines
    if (klines4h) setLiquidity(detectLiquidity(klines4h))

    // Signal generation removed — server agent is sole source of signals.
    // Signals come from Supabase via useSignalHistory (synced every 45s).
  }, [rawK, mkt, setInds, setCycle, setAlerts, setDivergences, setElliottWaves, setFvgs, setLiquidity, setBiasMeta])
}
