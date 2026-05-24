import { useEffect, useRef } from 'react'
import { useApexStore } from '@/store/apexStore'
import { runInds, detectDivergences } from '@/lib/indicators'
import { getBTCCycle, getSession } from '@/lib/cycle'
import { getAutoAlerts } from '@/lib/buildContext'
import { scoreTradeIdea } from '@/lib/tradeScoring'
import { getLearnedWeights } from '@/lib/scoreWeights'
import { detectElliottWaves } from '@/lib/elliottWaves'
import { detectFVGs } from '@/lib/fvg'
import { detectLiquidity } from '@/lib/liquidity'
import type { IndicatorMap, IndicatorResult } from '@/lib/types'
import { ntfyNewSignal } from '@/lib/ntfy'

const TFS = ['1d', '4h', '1h', '15m'] as const

// A new signal is emitted when:
//   1. Direction (side) changes — always immediate
//   2. Same direction: ≥3 min elapsed AND price moved ≥1%
const MIN_MS   = 3 * 60 * 1000   // min 3 min between same-direction signals
const MIN_MOVE = 0.01             // min 1% price move for same-direction re-emit

type LastPush = { side: string; price: number; ts: number }

export function useIndicators() {
  const rawK         = useApexStore(s => s.rawK)
  const mkt          = useApexStore(s => s.mkt)
  const orderBook    = useApexStore(s => s.orderBook)
  const notifPerm    = useApexStore(s => s.notifPerm)
  const setInds      = useApexStore(s => s.setInds)
  const setCycle     = useApexStore(s => s.setCycle)
  const setAlerts    = useApexStore(s => s.setAlerts)
  const setTradeIdea    = useApexStore(s => s.setTradeIdea)
  const pushTradeIdea   = useApexStore(s => s.pushTradeIdea)
  const setDivergences  = useApexStore(s => s.setDivergences)
  const setElliottWaves = useApexStore(s => s.setElliottWaves)
  const setFvgs         = useApexStore(s => s.setFvgs)
  const setLiquidity    = useApexStore(s => s.setLiquidity)
  const setBiasMeta     = useApexStore(s => s.setBiasMeta)
  const signalHistory   = useApexStore(s => s.signalHistory)

  const lastPush   = useRef<LastPush | null>(null)
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

    const weights = getLearnedWeights(signalHistory)
    const idea = scoreTradeIdea(mkt, newInds, orderBook, rawK, weights, signalHistory)
    const hasActiveSignal = signalHistory.some(r => r.status === 'active')
    if (!idea) {
      // Don't clear display if an active signal is being tracked
      if (!hasActiveSignal) setTradeIdea(null)
      // Don't reset lastPush — keep history stable, just mark no active idea
      return
    }

    // Don't overwrite display if a different active signal is already being managed
    if (!hasActiveSignal) setTradeIdea(idea)

    // Consolidation signals are display-only — never push to history
    if (idea.consolidation) return

    const now    = Date.now()
    const last   = lastPush.current

    // ── Signal lock: one active signal at a time ─────────────────────────────
    const activeRec = signalHistory.find(r => r.status === 'active')
    if (activeRec) {
      if (activeRec.idea.side === idea.side) {
        // Same direction: let existing signal live, just update live display
        setTradeIdea(idea)
        return
      }
      // Opposite direction: push as pending_confirmation via pushTradeIdea
      // then patch it in signalHistory immediately after
    }

    const sideChanged = !last || idea.side !== last.side
    const timeOk      = !last || (now - last.ts) >= MIN_MS
    const priceOk     = !last || Math.abs(idea.price - last.price) / last.price >= MIN_MOVE

    // Asia session: only push ALTA confidence signals
    if (getSession().n === 'ASIA' && idea.confidence !== 'ALTA') {
      setTradeIdea(idea)  // still display, just don't push
      return
    }

    if (sideChanged || (timeOk && priceOk)) {
      pushTradeIdea(idea)
      lastPush.current = { side: idea.side, price: idea.price, ts: now }

      // NTFY push (fire-and-forget — works even when browser tab is in background)
      if (idea.confidence !== 'BAJA') {
        ntfyNewSignal({
          side:       idea.side,
          confidence: idea.confidence,
          tradeType:  idea.tradeType,
          entry:      idea.price,
          sl:         idea.sl,
          tp1:        idea.tp1,
          tp2:        idea.tp2,
          tp3:        idea.tp3,
          reasons:    idea.reasons,
          score:      idea.bull + idea.bear,
          maxLev:     idea.maxLev,
        })
      }

      if (idea.confidence === 'ALTA' && notifPerm === 'granted') {
        try {
          new Notification(`🚨 APEX: ${idea.side} BTC`, {
            body: `$${Math.round(idea.price)} | ${idea.tradeType} | Confianza ALTA`,
          })
        } catch { /* notification may be blocked */ }
      }
    }
  }, [rawK, mkt, orderBook, notifPerm, signalHistory, setInds, setCycle, setAlerts, setTradeIdea, pushTradeIdea, setDivergences, setElliottWaves, setFvgs, setLiquidity, setBiasMeta])
}
