import type { Kline, Strategy, StrategyType, BacktestTrade, BacktestStats } from './types'

function emaLocal(d: number[], p: number): number[] {
  if (!d?.length) return []
  const k = 2 / (p + 1), r = [d[0]]
  for (let i = 1; i < d.length; i++) r.push(d[i] * k + r[i - 1] * (1 - k))
  return r
}

function rsiLocal(c: number[], p = 14): number[] {
  if (c.length < p + 2) return new Array(c.length).fill(50)
  const r: number[] = new Array(c.length).fill(50)
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

function macdLocal(c: number[], f = 12, s = 26, sg = 9) {
  const ef = emaLocal(c, f), es = emaLocal(c, s)
  const ml = ef.map((v, i) => v - es[i])
  return { hist: ml.map((v, i) => v - emaLocal(ml, sg)[i]) }
}

function bbLocal(c: number[], p = 20, m = 2) {
  const sm = c.map((_, i) => i < p - 1 ? null : c.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)
  return c.map((_, i) => {
    if (i < p - 1 || sm[i] == null) return { u: null, l: null }
    const sl = c.slice(i - p + 1, i + 1), mn = sm[i] as number
    const std = Math.sqrt(sl.reduce((a, v) => a + (v - mn) ** 2, 0) / p)
    return { u: mn + m * std, l: mn - m * std }
  })
}

function atrLocal(h: number[], l: number[], c: number[], p = 14): number[] {
  const tr = h.map((hh, i) =>
    i === 0 ? hh - l[i] : Math.max(hh - l[i], Math.abs(hh - c[i - 1]), Math.abs(l[i] - c[i - 1]))
  )
  return emaLocal(tr, p)
}

function genStrategies(): Strategy[] {
  const S: Strategy[] = []
  const ps = [5, 8, 9, 13, 21, 34, 50, 89, 100, 144, 200]
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      S.push({ id: `ema_${ps[i]}_${ps[j]}`, name: `EMA ${ps[i]}/${ps[j]}`, type: 'ema', p: { fast: ps[i], slow: ps[j] } })
  const rsiParams: [number, number, number][] = [[7,20,80],[14,25,75],[14,30,70],[14,35,65],[21,30,70],[7,25,75],[14,28,72],[21,25,75],[14,32,68],[21,35,65]]
  rsiParams.forEach(([p, os, ob]) =>
    S.push({ id: `rsi_${p}_${os}`, name: `RSI(${p}) ${os}/${ob}`, type: 'rsi', p: { period: p, os, ob } }))
  const bbParams: [number, number][] = [[10,1.5],[10,2],[20,1.5],[20,2],[20,2.5],[30,2]]
  bbParams.forEach(([p, m]) =>
    S.push({ id: `bb_${p}_${m}`, name: `BB(${p},${m})`, type: 'bb', p: { period: p, mult: m } }))
  const macdParams: [number, number, number][] = [[12,26,9],[8,21,5],[5,13,4],[10,20,7],[7,14,5],[15,30,9]]
  macdParams.forEach(([f, s, sg]) =>
    S.push({ id: `macd_${f}_${s}`, name: `MACD(${f},${s},${sg})`, type: 'macd', p: { f, s, sg } }))
  const stochPairs: [number, number][] = [[14,3],[5,3],[21,5]]
  const stochZones: [number, number][] = [[20,80],[25,75],[30,70]]
  stochPairs.forEach(([p, sm]) => stochZones.forEach(([os, ob]) =>
    S.push({ id: `stoch_${p}_${os}`, name: `Stoch(${p}) ${os}/${ob}`, type: 'stoch', p: { period: p, smooth: sm, os, ob } })))
  const emrPairs: [number, number][] = [[9,21],[21,50],[50,200]]
  emrPairs.forEach(([f, s]) => stochZones.forEach(([os, ob]) =>
    S.push({ id: `emr_${f}_${s}_${os}`, name: `EMA${f}/${s}+RSI`, type: 'ema_rsi', p: { fast: f, slow: s, os, ob } })))
  const scalpPairs: [number, number][] = [[5,8],[5,13],[8,21],[13,21],[5,21],[8,13]]
  scalpPairs.forEach(([f, s]) =>
    S.push({ id: `sc_${f}_${s}`, name: `Scalp ${f}/${s}`, type: 'ema', p: { fast: f, slow: s } }))
  const triPairs: [number, number, number][] = [[5,13,21],[9,21,50],[13,34,89],[21,50,100],[34,89,200]]
  triPairs.forEach(([e1, e2, e3]) =>
    [true, false].forEach(vl =>
      S.push({ id: `tri_${e1}_${vl}`, name: `3EMA ${e1}/${e2}/${e3}${vl ? '+V' : ''}`, type: 'triple', p: { e1, e2, e3, vl } })))
  return S
}

export const ALL_STRATEGIES: Strategy[] = genStrategies()

export function runStrategy(klines: Kline[], strat: Strategy): BacktestTrade[] {
  if (!klines || klines.length < 50) return []
  const c = klines.map(k => k.c), h = klines.map(k => k.h), l = klines.map(k => k.l)
  const trades: BacktestTrade[] = []
  let inTrade: (BacktestTrade & { exit?: number; result?: string }) | null = null
  const p = strat.p as Record<string, number>

  function sig(i: number): number {
    if (i < 5) return 0
    const cs = c.slice(0, i + 1)
    const t = strat.type as StrategyType
    if (t === 'ema') {
      const ef = emaLocal(cs, p.fast), es = emaLocal(cs, p.slow)
      if (ef[ef.length-2] <= es[es.length-2] && ef[ef.length-1] > es[es.length-1]) return 1
      if (ef[ef.length-2] >= es[es.length-2] && ef[ef.length-1] < es[es.length-1]) return -1
    }
    if (t === 'rsi') {
      const rv = rsiLocal(cs, p.period), r = rv[rv.length-1], rp = rv[rv.length-2]
      if (rp <= p.os && r > p.os) return 1
      if (rp >= p.ob && r < p.ob) return -1
    }
    if (t === 'bb') {
      const bv = bbLocal(cs, p.period, p.mult), b = bv[bv.length-1], bp = bv[bv.length-2]
      if (!b.l || !bp?.l) return 0
      if (cs[i-1] <= (bp.l ?? 0) && cs[i] > (b.l ?? 0)) return 1
      if (cs[i-1] >= (bp.u ?? 0) && cs[i] < (b.u ?? 0)) return -1
    }
    if (t === 'macd') {
      const mr = macdLocal(cs, p.f, p.s, p.sg), mh = mr.hist
      if (mh[mh.length-2] <= 0 && mh[mh.length-1] > 0) return 1
      if (mh[mh.length-2] >= 0 && mh[mh.length-1] < 0) return -1
    }
    if (t === 'stoch') {
      const rv = rsiLocal(cs, p.period)
      const st = rv.map((_, i2) => {
        if (i2 < p.period + p.smooth - 1) return null
        const w = rv.slice(i2 - p.smooth + 1, i2 + 1).filter((v): v is number => v != null)
        const mn = Math.min(...w), mx = Math.max(...w)
        return mx === mn ? 50 : ((rv[i2] - mn) / (mx - mn)) * 100
      })
      const k = st[st.length-1], kp = st[st.length-2]
      if (kp != null && k != null) {
        if (kp <= p.os && k > p.os) return 1
        if (kp >= p.ob && k < p.ob) return -1
      }
    }
    if (t === 'ema_rsi') {
      const ef = emaLocal(cs, p.fast), es = emaLocal(cs, p.slow), rv = rsiLocal(cs, 14)
      const r = rv[rv.length-1]
      if (ef[ef.length-1] > es[es.length-1] && r < p.os) return 1
      if (ef[ef.length-1] < es[es.length-1] && r > p.ob) return -1
    }
    if (t === 'triple') {
      const e1 = emaLocal(cs, p.e1), e2 = emaLocal(cs, p.e2), e3 = emaLocal(cs, p.e3)
      const a = e1[e1.length-1], b2 = e2[e2.length-1], d = e3[e3.length-1]
      if (a > b2 && b2 > d && cs[i] > a) return 1
      if (a < b2 && b2 < d && cs[i] < a) return -1
    }
    return 0
  }

  for (let i = 10; i < klines.length - 1; i++) {
    const s = sig(i)
    if (!inTrade && s !== 0) {
      const av = atrLocal(h.slice(0, i+1), l.slice(0, i+1), c.slice(0, i+1), 14)
      inTrade = { side: s === 1 ? 'long' : 'short', entry: c[i+1], atr: av[av.length-1] || c[i]*0.01, exit: 0, result: 'open', pnl: 0 }
    }
    if (inTrade) {
      const av = inTrade.atr
      const sl = inTrade.side === 'long' ? inTrade.entry - av*1.5 : inTrade.entry + av*1.5
      const tp = inTrade.side === 'long' ? inTrade.entry + av*2.5 : inTrade.entry - av*2.5
      const price = c[i+1]
      const hitSL = inTrade.side === 'long' ? price <= sl : price >= sl
      const hitTP = inTrade.side === 'long' ? price >= tp : price <= tp
      if (hitSL || hitTP || i === klines.length - 2) {
        const ex = hitSL ? sl : hitTP ? tp : price
        const pnl = inTrade.side === 'long'
          ? (ex - inTrade.entry) / inTrade.entry * 100
          : (inTrade.entry - ex) / inTrade.entry * 100
        trades.push({ ...inTrade, exit: ex, result: hitSL ? 'sl' : hitTP ? 'tp' : 'open', pnl })
        inTrade = null
      }
    }
  }
  return trades
}

export function btStats(trades: BacktestTrade[]): BacktestStats {
  const cl = trades.filter(t => t.result !== 'open')
  const w = cl.filter(t => t.pnl > 0), lo = cl.filter(t => t.pnl <= 0)
  const wr = cl.length ? w.length / cl.length * 100 : 0
  const totPnl = cl.reduce((a, t) => a + t.pnl, 0)
  const avgW = w.length ? w.reduce((a, t) => a + t.pnl, 0) / w.length : 0
  const avgL = lo.length ? lo.reduce((a, t) => a + t.pnl, 0) / lo.length : 0
  let pk = 0, mdd = 0, cum = 0
  for (const t of cl) { cum += t.pnl; if (cum > pk) pk = cum; if (pk - cum > mdd) mdd = pk - cum }
  return { total: cl.length, wins: w.length, wr, totPnl, avgW, avgL, mdd, pf: avgL !== 0 ? Math.abs(avgW / avgL) : 999 }
}
