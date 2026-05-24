import type { Kline } from './types'

export interface EWPoint    { bar: number; price: number; label: string }
export interface EWFibLevel { level: number; price: number; label: string }

export interface ElliottWaveResult {
  wave:         'impulse' | 'corrective' | 'unclear'
  direction:    'bullish' | 'bearish' | 'neutral'
  currentWave:  'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'WA' | 'WB' | 'WC' | 'unclear'
  points:       EWPoint[]
  nextTarget:   number | null
  invalidation: number | null
  confidence:   'high' | 'medium' | 'low'
  fibLevels:    EWFibLevel[]
}

type Swing = { bar: number; price: number; type: 'high' | 'low' }

// ── Swing detection ──────────────────────────────────────────────────────────

function findSwings(klines: Kline[], lookback = 5): Swing[] {
  const n = klines.length
  const pts: Swing[] = []

  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true, isLow = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue
      if (klines[j].h >= klines[i].h) isHigh = false
      if (klines[j].l <= klines[i].l) isLow  = false
    }
    if (isHigh) pts.push({ bar: i, price: klines[i].h, type: 'high' })
    if (isLow)  pts.push({ bar: i, price: klines[i].l, type: 'low'  })
  }

  // Sort and deduplicate consecutive same-type swings (keep most extreme)
  pts.sort((a, b) => a.bar - b.bar)
  const merged: Swing[] = []
  for (const pt of pts) {
    const last = merged[merged.length - 1]
    if (!last || last.type !== pt.type) { merged.push(pt); continue }
    if (pt.type === 'high' && pt.price > last.price) merged[merged.length - 1] = pt
    if (pt.type === 'low'  && pt.price < last.price) merged[merged.length - 1] = pt
  }
  return merged
}

// ── Pattern scorers ──────────────────────────────────────────────────────────

function scoreBullImpulse(p: Swing[]): number {
  // Expects: low(0) high(1) low(2) high(3) low(4) high(5)
  if (p.length < 6) return 0
  if (p[0].type !== 'low'  || p[1].type !== 'high' ||
      p[2].type !== 'low'  || p[3].type !== 'high' ||
      p[4].type !== 'low'  || p[5].type !== 'high') return 0

  const w1 = p[1].price - p[0].price
  const w2 = p[1].price - p[2].price   // retrace of w1
  const w3 = p[3].price - p[2].price
  const w4 = p[3].price - p[4].price   // retrace of w3
  const w5 = p[5].price - p[4].price
  if (w1 <= 0 || w3 <= 0 || w5 <= 0 || w2 <= 0 || w4 <= 0) return 0

  // Hard rule: W2 < W1 (can't retrace more than 100%)
  if (w2 >= w1) return 0
  // Hard rule: W4 low > W1 high (no overlap)
  if (p[4].price <= p[1].price) return 0

  let sc = 0
  if (w2 / w1 >= 0.382 && w2 / w1 <= 0.618) sc += 2  // ideal W2 retrace
  if (w3 > w1 && w3 > w5) sc += 2                      // W3 not shortest
  if (w3 >= w1 * 1.618)   sc += 2                      // W3 extends to 161.8%
  if (w4 / w3 >= 0.236 && w4 / w3 <= 0.382) sc += 2   // ideal W4 retrace
  if (w5 / w1 >= 0.618 && w5 / w1 <= 1.0)   sc += 2   // W5 = 61.8–100% of W1
  return sc
}

function scoreBearImpulse(p: Swing[]): number {
  // Expects: high(0) low(1) high(2) low(3) high(4) low(5)
  if (p.length < 6) return 0
  if (p[0].type !== 'high' || p[1].type !== 'low'  ||
      p[2].type !== 'high' || p[3].type !== 'low'  ||
      p[4].type !== 'high' || p[5].type !== 'low') return 0

  const w1 = p[0].price - p[1].price
  const w2 = p[2].price - p[1].price
  const w3 = p[2].price - p[3].price
  const w4 = p[4].price - p[3].price
  const w5 = p[4].price - p[5].price
  if (w1 <= 0 || w3 <= 0 || w5 <= 0 || w2 <= 0 || w4 <= 0) return 0

  if (w2 >= w1) return 0
  if (p[4].price >= p[1].price) return 0  // no W4 overlap

  let sc = 0
  if (w2 / w1 >= 0.382 && w2 / w1 <= 0.618) sc += 2
  if (w3 > w1 && w3 > w5) sc += 2
  if (w3 >= w1 * 1.618)   sc += 2
  if (w4 / w3 >= 0.236 && w4 / w3 <= 0.382) sc += 2
  if (w5 / w1 >= 0.618 && w5 / w1 <= 1.0)   sc += 2
  return sc
}

function scoreBullCorrectiveABC(p: Swing[]): number {
  // Correction in downtrend ending → bull resumption
  // Expects: high(0) low(1) high(2) low(3)  — A down, B up, C down
  if (p.length < 4) return 0
  if (p[0].type !== 'high' || p[1].type !== 'low' ||
      p[2].type !== 'high' || p[3].type !== 'low') return 0

  const wA = p[0].price - p[1].price
  const wB = p[2].price - p[1].price
  const wC = p[2].price - p[3].price
  if (wA <= 0 || wB <= 0 || wC <= 0) return 0
  if (p[2].price >= p[0].price) return 0  // B can't exceed start

  let sc = 0
  if (wB / wA >= 0.382 && wB / wA <= 0.618) sc += 3
  if (wC / wA >= 0.9   && wC / wA <= 1.618) sc += 3
  return sc
}

function scoreBearCorrectiveABC(p: Swing[]): number {
  // Correction in uptrend ending → bear resumption
  // Expects: low(0) high(1) low(2) high(3)  — A up, B down, C up
  if (p.length < 4) return 0
  if (p[0].type !== 'low'  || p[1].type !== 'high' ||
      p[2].type !== 'low'  || p[3].type !== 'high') return 0

  const wA = p[1].price - p[0].price
  const wB = p[1].price - p[2].price
  const wC = p[3].price - p[2].price
  if (wA <= 0 || wB <= 0 || wC <= 0) return 0
  if (p[2].price <= p[0].price) return 0

  let sc = 0
  if (wB / wA >= 0.382 && wB / wA <= 0.618) sc += 3
  if (wC / wA >= 0.9   && wC / wA <= 1.618) sc += 3
  return sc
}

// ── Partial-pattern detection (for "in-progress" waves) ──────────────────────

type PartialMatch = {
  currentWave: ElliottWaveResult['currentWave']
  direction: 'bullish' | 'bearish'
  pts: Swing[]
  score: number
}

function detectPartial(swings: Swing[]): PartialMatch | null {
  const r = swings.slice(-5)   // look at last 5 swings
  let best: PartialMatch | null = null

  const tryMatch = (m: PartialMatch) => {
    if (!best || m.score > best.score) best = m
  }

  // ── 3-point partial bullish impulse (W0-W1-W2, expecting W3) ─────────────
  if (r.length >= 3) {
    const p = r.slice(-3)
    if (p[0].type === 'low' && p[1].type === 'high' && p[2].type === 'low') {
      const w1 = p[1].price - p[0].price
      const w2 = p[1].price - p[2].price
      if (w1 > 0 && w2 > 0 && w2 < w1 && p[2].price > p[0].price) {
        const sc = (w2 / w1 >= 0.382 && w2 / w1 <= 0.618) ? 5 : 3
        tryMatch({ currentWave: 'W2', direction: 'bullish', pts: p, score: sc })
      }
    }
    // 3-point partial bearish impulse
    if (p[0].type === 'high' && p[1].type === 'low' && p[2].type === 'high') {
      const w1 = p[0].price - p[1].price
      const w2 = p[2].price - p[1].price
      if (w1 > 0 && w2 > 0 && w2 < w1 && p[2].price < p[0].price) {
        const sc = (w2 / w1 >= 0.382 && w2 / w1 <= 0.618) ? 5 : 3
        tryMatch({ currentWave: 'W2', direction: 'bearish', pts: p, score: sc })
      }
    }
  }

  // ── 4-point partial bullish impulse (W0-W1-W2-W3, expecting W4) ──────────
  if (r.length >= 4) {
    const p = r.slice(-4)
    if (p[0].type === 'low' && p[1].type === 'high' && p[2].type === 'low' && p[3].type === 'high') {
      const w1 = p[1].price - p[0].price
      const w2 = p[1].price - p[2].price
      const w3 = p[3].price - p[2].price
      if (w1 > 0 && w2 > 0 && w3 > 0 && w2 < w1 && p[2].price > p[0].price && w3 >= w1 * 1.2) {
        tryMatch({ currentWave: 'W3', direction: 'bullish', pts: p, score: 7 })
      }
    }
    // 4-point partial bearish impulse
    if (p[0].type === 'high' && p[1].type === 'low' && p[2].type === 'high' && p[3].type === 'low') {
      const w1 = p[0].price - p[1].price
      const w2 = p[2].price - p[1].price
      const w3 = p[2].price - p[3].price
      if (w1 > 0 && w2 > 0 && w3 > 0 && w2 < w1 && p[2].price < p[0].price && w3 >= w1 * 1.2) {
        tryMatch({ currentWave: 'W3', direction: 'bearish', pts: p, score: 7 })
      }
    }
  }

  // ── 5-point partial bullish impulse (W0-W1-W2-W3-W4, expecting W5) ───────
  if (r.length >= 5) {
    const p = r.slice(-5)
    if (p[0].type === 'low' && p[1].type === 'high' && p[2].type === 'low' &&
        p[3].type === 'high' && p[4].type === 'low') {
      const w1 = p[1].price - p[0].price
      const w3 = p[3].price - p[2].price
      const w4 = p[3].price - p[4].price
      // W4 must not overlap W1 territory
      if (w1 > 0 && w3 > 0 && w4 > 0 && p[4].price > p[1].price && w3 > w1) {
        tryMatch({ currentWave: 'W4', direction: 'bullish', pts: p, score: 8 })
      }
    }
    if (p[0].type === 'high' && p[1].type === 'low' && p[2].type === 'high' &&
        p[3].type === 'low' && p[4].type === 'high') {
      const w1 = p[0].price - p[1].price
      const w3 = p[2].price - p[3].price
      const w4 = p[4].price - p[3].price
      if (w1 > 0 && w3 > 0 && w4 > 0 && p[4].price < p[1].price && w3 > w1) {
        tryMatch({ currentWave: 'W4', direction: 'bearish', pts: p, score: 8 })
      }
    }
  }

  return best
}

// ── Fib projection helpers ───────────────────────────────────────────────────

function bullImpulseFibs(base: number, w1End: number, w2End: number): EWFibLevel[] {
  const w1 = w1End - base
  return [
    { level: 1.0,   price: w2End + w1,         label: 'W3 = W1 (100%)' },
    { level: 1.618, price: w2End + w1 * 1.618, label: 'W3 = 161.8% W1' },
    { level: 2.618, price: w2End + w1 * 2.618, label: 'W3 = 261.8% W1' },
  ]
}

function bearImpulseFibs(base: number, w1End: number, w2End: number): EWFibLevel[] {
  const w1 = base - w1End
  return [
    { level: 1.0,   price: w2End - w1,         label: 'W3 = W1 (100%)' },
    { level: 1.618, price: w2End - w1 * 1.618, label: 'W3 = 161.8% W1' },
    { level: 2.618, price: w2End - w1 * 2.618, label: 'W3 = 261.8% W1' },
  ]
}

// ── Main export ──────────────────────────────────────────────────────────────

export function detectElliottWaves(klines: Kline[]): ElliottWaveResult {
  const UNCLEAR: ElliottWaveResult = {
    wave: 'unclear', direction: 'neutral', currentWave: 'unclear',
    points: [], nextTarget: null, invalidation: null,
    confidence: 'low', fibLevels: [],
  }

  if (!klines || klines.length < 20) return UNCLEAR

  const slice  = klines.slice(-89)
  const swings = findSwings(slice, 5)
  if (swings.length < 4) return UNCLEAR

  // ── Try complete patterns (score-based, best wins) ────────────────────────
  type Candidate = { score: number; result: ElliottWaveResult }
  const candidates: Candidate[] = []

  // Window: last 10 swings, try every 6-point window for impulse
  for (let i = Math.max(0, swings.length - 10); i <= swings.length - 6; i++) {
    const p = swings.slice(i, i + 6)

    const bs = scoreBullImpulse(p)
    if (bs > 0) {
      const w1 = p[1].price - p[0].price
      const totalMove = p[5].price - p[0].price
      candidates.push({
        score: bs,
        result: {
          wave: 'impulse', direction: 'bullish', currentWave: 'W5',
          points: p.map((pt, idx) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3','W4','W5'][idx] })),
          nextTarget:   p[5].price - totalMove * 0.382,
          invalidation: p[4].price,
          confidence:   bs >= 8 ? 'high' : bs >= 4 ? 'medium' : 'low',
          fibLevels: [
            { level: 0.236, price: p[5].price - totalMove * 0.236, label: 'Corrección 23.6%' },
            { level: 0.382, price: p[5].price - totalMove * 0.382, label: 'Corrección 38.2%' },
            { level: 0.618, price: p[5].price - totalMove * 0.618, label: 'Corrección 61.8%' },
          ],
        },
      })
    }

    const bers = scoreBearImpulse(p)
    if (bers > 0) {
      const totalMove = p[0].price - p[5].price
      candidates.push({
        score: bers,
        result: {
          wave: 'impulse', direction: 'bearish', currentWave: 'W5',
          points: p.map((pt, idx) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3','W4','W5'][idx] })),
          nextTarget:   p[5].price + totalMove * 0.382,
          invalidation: p[4].price,
          confidence:   bers >= 8 ? 'high' : bers >= 4 ? 'medium' : 'low',
          fibLevels: [
            { level: 0.236, price: p[5].price + totalMove * 0.236, label: 'Corrección 23.6%' },
            { level: 0.382, price: p[5].price + totalMove * 0.382, label: 'Corrección 38.2%' },
            { level: 0.618, price: p[5].price + totalMove * 0.618, label: 'Corrección 61.8%' },
          ],
        },
      })
    }
  }

  // Try every 4-point window for corrective ABC
  for (let i = Math.max(0, swings.length - 8); i <= swings.length - 4; i++) {
    const p = swings.slice(i, i + 4)

    const bcs = scoreBullCorrectiveABC(p)
    if (bcs > 0) {
      const wA = p[0].price - p[1].price
      candidates.push({
        score: bcs,
        result: {
          wave: 'corrective', direction: 'bullish', currentWave: 'WC',
          points: p.map((pt, idx) => ({ bar: pt.bar, price: pt.price, label: ['W0','WA','WB','WC'][idx] })),
          nextTarget:   p[3].price + wA * 1.618,
          invalidation: p[3].price - wA * 0.1,
          confidence:   bcs >= 5 ? 'medium' : 'low',
          fibLevels: [
            { level: 1.0,   price: p[3].price + wA,         label: 'Extensión 100%' },
            { level: 1.618, price: p[3].price + wA * 1.618, label: 'Extensión 161.8%' },
          ],
        },
      })
    }

    const bcrs = scoreBearCorrectiveABC(p)
    if (bcrs > 0) {
      const wA = p[1].price - p[0].price
      candidates.push({
        score: bcrs,
        result: {
          wave: 'corrective', direction: 'bearish', currentWave: 'WC',
          points: p.map((pt, idx) => ({ bar: pt.bar, price: pt.price, label: ['W0','WA','WB','WC'][idx] })),
          nextTarget:   p[3].price - wA * 1.618,
          invalidation: p[3].price + wA * 0.1,
          confidence:   bcrs >= 5 ? 'medium' : 'low',
          fibLevels: [
            { level: 1.0,   price: p[3].price - wA,         label: 'Extensión 100%' },
            { level: 1.618, price: p[3].price - wA * 1.618, label: 'Extensión 161.8%' },
          ],
        },
      })
    }
  }

  // Pick best complete pattern
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  // ── Partial-pattern fallback ──────────────────────────────────────────────
  const partial = detectPartial(swings)

  // Use complete if score ≥ 4; otherwise fall back to partial
  if (best && best.score >= 4) return best.result

  if (partial) {
    const p  = partial.pts
    const dir = partial.direction
    const cw  = partial.currentWave

    if (cw === 'W2' && dir === 'bullish') {
      const w1 = p[1].price - p[0].price
      return {
        wave: 'impulse', direction: 'bullish', currentWave: 'W2',
        points: p.slice(0, 3).map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2'][i] })),
        nextTarget:   p[2].price + w1 * 1.618,
        invalidation: p[0].price,
        confidence:   partial.score >= 5 ? 'medium' : 'low',
        fibLevels: bullImpulseFibs(p[0].price, p[1].price, p[2].price),
      }
    }

    if (cw === 'W2' && dir === 'bearish') {
      const w1 = p[0].price - p[1].price
      return {
        wave: 'impulse', direction: 'bearish', currentWave: 'W2',
        points: p.slice(0, 3).map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2'][i] })),
        nextTarget:   p[2].price - w1 * 1.618,
        invalidation: p[0].price,
        confidence:   partial.score >= 5 ? 'medium' : 'low',
        fibLevels: bearImpulseFibs(p[0].price, p[1].price, p[2].price),
      }
    }

    if (cw === 'W3' && dir === 'bullish') {
      const w1 = p[1].price - p[0].price
      const w3 = p[3].price - p[2].price
      return {
        wave: 'impulse', direction: 'bullish', currentWave: 'W3',
        points: p.map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3'][i] })),
        nextTarget:   p[3].price - w3 * 0.382,   // W4 pullback target
        invalidation: p[1].price,                 // W4 can't breach W1
        confidence:   'medium',
        fibLevels: [
          { level: 0.382, price: p[3].price - w3 * 0.382, label: 'W4 objetivo 38.2%' },
          { level: 0.618, price: p[3].price - w3 * 0.618, label: 'W4 máx 61.8%' },
          { level: 1.0,   price: p[3].price + w1,         label: 'W5 = W1' },
          { level: 1.618, price: p[3].price + w1 * 1.618, label: 'W5 ext 161.8%' },
        ],
      }
    }

    if (cw === 'W3' && dir === 'bearish') {
      const w1 = p[0].price - p[1].price
      const w3 = p[2].price - p[3].price
      return {
        wave: 'impulse', direction: 'bearish', currentWave: 'W3',
        points: p.map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3'][i] })),
        nextTarget:   p[3].price + w3 * 0.382,
        invalidation: p[1].price,
        confidence:   'medium',
        fibLevels: [
          { level: 0.382, price: p[3].price + w3 * 0.382, label: 'W4 objetivo 38.2%' },
          { level: 0.618, price: p[3].price + w3 * 0.618, label: 'W4 máx 61.8%' },
          { level: 1.0,   price: p[3].price - w1,         label: 'W5 = W1' },
        ],
      }
    }

    if (cw === 'W4' && dir === 'bullish') {
      const w1 = p[1].price - p[0].price
      return {
        wave: 'impulse', direction: 'bullish', currentWave: 'W4',
        points: p.map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3','W4'][i] })),
        nextTarget:   p[4].price + w1,        // W5 ≈ W1
        invalidation: p[1].price,
        confidence:   'medium',
        fibLevels: [
          { level: 1.0,   price: p[4].price + w1,         label: 'W5 = W1' },
          { level: 0.618, price: p[4].price + w1 * 0.618, label: 'W5 min 61.8%' },
        ],
      }
    }

    if (cw === 'W4' && dir === 'bearish') {
      const w1 = p[0].price - p[1].price
      return {
        wave: 'impulse', direction: 'bearish', currentWave: 'W4',
        points: p.map((pt, i) => ({ bar: pt.bar, price: pt.price, label: ['W0','W1','W2','W3','W4'][i] })),
        nextTarget:   p[4].price - w1,
        invalidation: p[1].price,
        confidence:   'medium',
        fibLevels: [
          { level: 1.0,   price: p[4].price - w1,         label: 'W5 = W1' },
          { level: 0.618, price: p[4].price - w1 * 0.618, label: 'W5 min 61.8%' },
        ],
      }
    }
  }

  return UNCLEAR
}
