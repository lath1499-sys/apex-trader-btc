import type { Kline, IndicatorResult, FibLevel, Divergence } from './types'

export function ema(d: number[], p: number): number[] {
  const k = 2 / (p + 1)
  const r = [d[0]]
  for (let i = 1; i < d.length; i++) r.push(d[i] * k + r[i - 1] * (1 - k))
  return r
}

export function sma(d: number[], p: number): (number | null)[] {
  return d.map((_, i) =>
    i < p - 1 ? null : d.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p
  )
}

export function calcRSI(c: number[], p = 14): (number | null)[] {
  const r: (number | null)[] = new Array(c.length).fill(null)
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? (ag += d) : (al -= d) }
  ag /= p; al /= p
  r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    ag = (ag * (p - 1) + Math.max(d, 0)) / p
    al = (al * (p - 1) + Math.max(-d, 0)) / p
    r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return r
}

export function calcMACD(c: number[], f = 12, s = 26, sg = 9) {
  const ef = ema(c, f), es = ema(c, s)
  const ml = ef.map((v, i) => v - es[i])
  const sl = ema(ml, sg)
  return { macd: ml, signal: sl, hist: ml.map((v, i) => v - sl[i]) }
}

export function calcBB(c: number[], p = 20, m = 2) {
  const sm = sma(c, p)
  return c.map((_, i) => {
    if (i < p - 1) return { upper: null, mid: null, lower: null, width: null }
    const sl = c.slice(i - p + 1, i + 1)
    const mn = sm[i] as number
    const std = Math.sqrt(sl.reduce((a, v) => a + (v - mn) ** 2, 0) / p)
    return { upper: mn + m * std, mid: mn, lower: mn - m * std, width: (m * 2 * std / mn) * 100 }
  })
}

export function calcATR(h: number[], l: number[], c: number[], p = 14): number[] {
  const tr = h.map((hh, i) =>
    i === 0 ? hh - l[i] : Math.max(hh - l[i], Math.abs(hh - c[i - 1]), Math.abs(l[i] - c[i - 1]))
  )
  return ema(tr, p)
}

export function calcStoch(c: number[], rp = 14, sp = 14, kp = 3, dp = 3) {
  const rv = calcRSI(c, rp)
  const st = rv.map((_, i) => {
    if (i < rp + sp - 1) return null
    const w = rv.slice(i - sp + 1, i + 1).filter((v): v is number => v != null)
    const mn = Math.min(...w), mx = Math.max(...w)
    return mx === mn ? 50 : ((rv[i] as number - mn) / (mx - mn)) * 100
  })
  const kr = st.map((_, i) => {
    if (i < kp - 1) return null
    const w = st.slice(i - kp + 1, i + 1).filter((v): v is number => v != null)
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null
  })
  const dr = kr.map((_, i) => {
    if (i < dp - 1) return null
    const w = kr.slice(i - dp + 1, i + 1).filter((v): v is number => v != null)
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null
  })
  return { k: kr, d: dr }
}

export function calcFib(h: number[], l: number[], c: number[]): FibLevel[] {
  const n = Math.min(60, h.length)
  const sh = Math.max(...h.slice(-n)), sl = Math.min(...l.slice(-n))
  const rng = sh - sl, price = c[c.length - 1], up = price > (sh + sl) / 2
  return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.414, 1.618].map(lv => ({
    level: lv,
    price: up ? sh - rng * lv : sl + rng * lv,
    label: lv === 0 ? 'SwingH' : lv === 1.0 ? 'SwingL' : `${(lv * 100).toFixed(1)}%`,
    isExt: lv > 1.0,
    active: Math.abs(price - (up ? sh - rng * lv : sl + rng * lv)) / price < 0.015,
  }))
}

export function runInds(klines: Kline[]): IndicatorResult | null {
  if (!klines || klines.length < 30) return null
  const c = klines.map(k => k.c), h = klines.map(k => k.h)
  const l = klines.map(k => k.l), v = klines.map(k => k.v)
  const last = c[c.length - 1]
  const e9 = ema(c, 9), e21 = ema(c, 21), e50 = ema(c, 50)
  const e100 = ema(c, 100), e200 = ema(c, 200)
  const rA = calcRSI(c), mR = calcMACD(c), bA = calcBB(c)
  const aA = calcATR(h, l, c), sR = calcStoch(c)
  const bb = bA[bA.length - 1], mh = mR.hist[mR.hist.length - 1]
  const mp = mR.hist[mR.hist.length - 2], rV = rA[rA.length - 1] ?? 50
  const sk = sR.k[sR.k.length - 1]
  const bbp = bb.upper && bb.lower ? ((last - bb.lower) / (bb.upper - bb.lower)) * 100 : null
  let sc = 0
  if (last > e9[e9.length - 1]) sc++; else sc--
  if (last > e21[e21.length - 1]) sc++; else sc--
  if (last > e50[e50.length - 1]) sc++; else sc--
  if (last > e200[e200.length - 1]) sc++; else sc--
  if (rV > 50) sc++; else sc--
  if (mh > 0) sc++; else sc--
  if (mh > mp) sc++; else sc--
  if (bbp != null && bbp > 50) sc++; else sc--
  if (sk != null && sk > 50) sc++; else sc--
  const avgV = v.slice(-20).reduce((a, b) => a + b, 0) / 20
  return {
    close: last, rsi: rV, prevRsi: rA[rA.length - 2] ?? rV,
    macd: { line: mR.macd[mR.macd.length - 1], signal: mR.signal[mR.signal.length - 1], hist: mh, prev: mp },
    bb: { ...bb, pct: bbp },
    atr: aA[aA.length - 1],
    stoch: { k: sk, d: sR.d[sR.d.length - 1] },
    ema: { e9: e9[e9.length - 1], e21: e21[e21.length - 1], e50: e50[e50.length - 1], e100: e100[e100.length - 1], e200: e200[e200.length - 1] },
    fib: calcFib(h, l, c),
    vol: { avg: avgV, last: v[v.length - 1], ratio: v[v.length - 1] / avgV, surge: v[v.length - 1] > avgV * 1.5 },
    score: sc,
    bias: sc >= 4 ? 'ALCISTA' : sc <= -4 ? 'BAJISTA' : 'NEUTRAL',
    klines,
  }
}

export function calcAutoSR(h: number[], l: number[], c: number[]) {
  const lb = 3, res: number[] = [], sup: number[] = []
  for (let i = lb; i < c.length - lb; i++) {
    if (h[i] === Math.max(...h.slice(i - lb, i + lb + 1))) res.push(h[i])
    if (l[i] === Math.min(...l.slice(i - lb, i + lb + 1))) sup.push(l[i])
  }
  function cluster(arr: number[]): number[] {
    const s = [...arr].sort((a, b) => a - b)
    const out: number[] = []
    let g = [s[0]]
    for (let i = 1; i < s.length; i++) {
      if (s[i] && s[i - 1] && (s[i] - s[i - 1]) / s[i - 1] < 0.004) g.push(s[i])
      else { if (g.length) out.push(g.reduce((a, b) => a + b, 0) / g.length); g = [s[i]] }
    }
    if (g.length) out.push(g.reduce((a, b) => a + b, 0) / g.length)
    return out
  }
  const price = c[c.length - 1]
  return {
    res: cluster(res.filter(Boolean)).filter(p => p > price).slice(0, 5),
    sup: cluster(sup.filter(Boolean)).filter(p => p < price).slice(-5),
  }
}

function calcRSIInline(c: number[], p = 14): number[] {
  if (c.length < p + 2) return new Array(c.length).fill(50)
  const r: (number | null)[] = new Array(c.length).fill(null)
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? (ag += d) : (al -= d) }
  ag /= p; al /= p
  r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    ag = (ag * (p - 1) + Math.max(d, 0)) / p
    al = (al * (p - 1) + Math.max(-d, 0)) / p
    r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return r.map(v => v ?? 50)
}

export function detectDivergences(klines: Kline[]): Divergence[] {
  if (!klines || klines.length < 30) return []
  const c = klines.map(k => k.c)
  const rsiVals = calcRSIInline(c)
  const divs: Divergence[] = []
  const W = Math.min(25, klines.length)
  const cs = c.slice(-W), rs = rsiVals.slice(-W)
  function findSwings(arr: number[], lb = 3) {
    const hi: number[] = [], lo: number[] = []
    for (let i = lb; i < arr.length - lb; i++) {
      if (arr[i] === Math.max(...arr.slice(i - lb, i + lb + 1))) hi.push(i)
      if (arr[i] === Math.min(...arr.slice(i - lb, i + lb + 1))) lo.push(i)
    }
    return { hi, lo }
  }
  const ps = findSwings(cs), rs2 = findSwings(rs)
  if (ps.hi.length >= 2 && rs2.hi.length >= 2) {
    const ph1 = ps.hi[ps.hi.length - 2], ph2 = ps.hi[ps.hi.length - 1]
    const rh1 = rs2.hi[rs2.hi.length - 2], rh2 = rs2.hi[rs2.hi.length - 1]
    if (cs[ph2] > cs[ph1] && rs[rh2] < rs[rh1])
      divs.push({ type: 'bearish', ind: 'RSI', desc: 'Precio HH → RSI LH — momentum agotado' })
  }
  if (ps.lo.length >= 2 && rs2.lo.length >= 2) {
    const pl1 = ps.lo[ps.lo.length - 2], pl2 = ps.lo[ps.lo.length - 1]
    const rl1 = rs2.lo[rs2.lo.length - 2], rl2 = rs2.lo[rs2.lo.length - 1]
    if (cs[pl2] < cs[pl1] && rs[rl2] > rs[rl1])
      divs.push({ type: 'bullish', ind: 'RSI', desc: 'Precio LL → RSI HL — reversión posible' })
  }
  return divs
}
