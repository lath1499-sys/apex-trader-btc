import type { Kline, OrderBook } from './types'
import type { FVGResult } from './fvg'
import type { LiquidityResult } from './liquidity'
import { detectCandlePatterns } from './candlePatterns'
import { shouldGenerateSignal } from './tradingHours'

// ─────────────────────────────────────────────────────────────────────────────
// Exported types (used by store + components)
// ─────────────────────────────────────────────────────────────────────────────

export interface VWAPResult {
  vwap: number
  upper1: number
  upper2: number
  lower1: number
  lower2: number
}

export interface CVDResult {
  cvd: number[]
  delta: number[]
}

export interface ICTKillzone {
  name: string
  active: boolean
  color: string
  desc: string
}

export interface BOSCHoCHResult {
  bos:   { type: 'bullish' | 'bearish'; price: number; bar: number }[]
  choch: { type: 'bullish' | 'bearish'; price: number; bar: number }[]
}

export interface OTEResult {
  zone:  { top: number; bottom: number }
  ideal: number
  label: string
}

export type ScalpStatus = 'active' | 'tp1_hit' | 'tp2_hit' | 'tp3_hit' | 'sl_hit' | 'expired' | 'closed_manual'

export interface ScalpSignal {
  id:           string
  side:         'LONG' | 'SHORT'
  entry:        number
  sl:           number
  tp1:          number
  tp2:          number
  tp3:          number
  confidence:   'ALTA' | 'MEDIA' | 'BAJA'
  reasons:      string[]
  type:         'Scalp'
  duration:     string
  maxLeverage:  number
  killzone:     string | null
  bosChoch:     string | null
  cvdSignal:    string | null
  vwapRelation: string
  qualityLabel: string
  score:        number
  ts:           Date
  status:       ScalpStatus
  createdAt:    number        // Date.now()
  closedAt?:    number
  closePrice?:  number
  pnl?:         number
  tp1Hit?: boolean
  tp2Hit?: boolean
  slWarningFired?:     boolean
  expiryWarningFired?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 1c — VWAP + Bands (resets at UTC midnight)
// ─────────────────────────────────────────────────────────────────────────────

export function calcVWAP(klines: Kline[]): VWAPResult {
  const today = new Date()
  const startOfDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const intraday = klines.filter(k => k.t >= startOfDay)
  const base = intraday.length > 0 ? intraday : klines.slice(-20)

  let sumTPV = 0, sumV = 0
  for (const k of base) {
    const tp = (k.h + k.l + k.c) / 3
    sumTPV += tp * k.v
    sumV   += k.v
  }
  const vwap = sumV > 0 ? sumTPV / sumV : klines[klines.length - 1].c

  // Weighted std dev
  let sumVar = 0
  for (const k of base) {
    const tp = (k.h + k.l + k.c) / 3
    sumVar += ((tp - vwap) ** 2) * k.v
  }
  const std = sumV > 0 ? Math.sqrt(sumVar / sumV) : 0

  return {
    vwap,
    upper1: vwap + std,
    upper2: vwap + std * 2,
    lower1: vwap - std,
    lower2: vwap - std * 2,
  }
}

// Running VWAP series — one value per candle, resets at UTC midnight
export interface VWAPPoint { vwap: number; upper1: number; lower1: number; upper2: number; lower2: number }

export function calcVWAPSeries(klines: Kline[]): VWAPPoint[] {
  const result: VWAPPoint[] = []
  let sumTPV = 0, sumV = 0, sumVarTPV = 0, dayStart = -1

  for (const k of klines) {
    const d = new Date(k.t)
    const sod = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    if (sod !== dayStart) { sumTPV = 0; sumV = 0; sumVarTPV = 0; dayStart = sod }
    const tp = (k.h + k.l + k.c) / 3
    sumTPV    += tp * k.v
    sumV      += k.v
    const vwap = sumV > 0 ? sumTPV / sumV : k.c
    sumVarTPV += ((tp - vwap) ** 2) * k.v
    const std  = sumV > 0 ? Math.sqrt(sumVarTPV / sumV) : 0
    result.push({ vwap, upper1: vwap + std, lower1: vwap - std, upper2: vwap + std * 2, lower2: vwap - std * 2 })
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 1d — CVD (Cumulative Volume Delta)
// ─────────────────────────────────────────────────────────────────────────────

export function calcCVD(klines: Kline[]): CVDResult {
  const delta = klines.map(k => {
    const range = k.h - k.l
    if (range === 0) return 0
    const buyVol  = ((k.c - k.l) / range) * k.v
    const sellVol = ((k.h - k.c) / range) * k.v
    return buyVol - sellVol
  })
  let cum = 0
  const cvd = delta.map(d => { cum += d; return cum })
  return { cvd, delta }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2a — ICT Killzones
// ─────────────────────────────────────────────────────────────────────────────

export function getICTKillzones(): ICTKillzone[] {
  const now     = new Date()
  const utcH    = now.getUTCHours()
  const utcM    = now.getUTCMinutes()
  const decimal = utcH + utcM / 60

  const zones = [
    { name: 'Asian KZ',     start: 20,   end: 24,   color: '#4a8aaa', desc: 'Rango asiático — toma de liquidez' },
    { name: 'Asian KZ',     start: 0,    end: 2,    color: '#4a8aaa', desc: 'Rango asiático — toma de liquidez' },
    { name: 'London Open',  start: 2,    end: 5,    color: '#7b9fff', desc: 'Londres abre — mayor probabilidad de tendencia' },
    { name: 'NY AM',        start: 8.5,  end: 11,   color: '#ffd700', desc: 'Apertura NY — mayor volatilidad del día' },
    { name: 'London Close', start: 10,   end: 12,   color: '#f7931a', desc: 'Cierre Londres — posibles reversiones' },
    { name: 'NY PM',        start: 13.5, end: 16,   color: '#00d084', desc: 'Tarde NY — segunda oportunidad del día' },
  ]

  // Deduplicate Asian KZ into one zone
  const named = new Map<string, ICTKillzone>()
  for (const z of zones) {
    const active = decimal >= z.start && decimal < z.end
    const existing = named.get(z.name)
    named.set(z.name, {
      name: z.name, color: z.color, desc: z.desc,
      active: (existing?.active ?? false) || active,
    })
  }
  return Array.from(named.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b — BOS / CHoCH detection
// ─────────────────────────────────────────────────────────────────────────────

export function detectBOSCHoCH(klines: Kline[], lb = 3): BOSCHoCHResult {
  if (klines.length < lb * 2 + 2) return { bos: [], choch: [] }

  const swingHighs: { price: number; bar: number }[] = []
  const swingLows:  { price: number; bar: number }[] = []

  for (let i = lb; i < klines.length - lb; i++) {
    const slice = klines.slice(i - lb, i + lb + 1)
    const maxH  = Math.max(...slice.map(k => k.h))
    const minL  = Math.min(...slice.map(k => k.l))
    if (klines[i].h === maxH) swingHighs.push({ price: klines[i].h, bar: i })
    if (klines[i].l === minL) swingLows.push({ price: klines[i].l, bar: i })
  }

  const bos:   BOSCHoCHResult['bos']   = []
  const choch: BOSCHoCHResult['choch'] = []

  const last     = klines[klines.length - 1]
  const lastHigh = swingHighs[swingHighs.length - 1]
  const lastLow  = swingLows[swingLows.length - 1]
  const prevHigh = swingHighs[swingHighs.length - 2]
  const prevLow  = swingLows[swingLows.length - 2]

  if (lastHigh && last.c > lastHigh.price) {
    const isHigherHigh = !!(prevHigh && lastHigh.price > prevHigh.price)
    if (isHigherHigh) bos.push({ type: 'bullish', price: lastHigh.price, bar: klines.length - 1 })
    else              choch.push({ type: 'bullish', price: lastHigh.price, bar: klines.length - 1 })
  }
  if (lastLow && last.c < lastLow.price) {
    const isLowerLow = !!(prevLow && lastLow.price < prevLow.price)
    if (isLowerLow) bos.push({ type: 'bearish', price: lastLow.price, bar: klines.length - 1 })
    else            choch.push({ type: 'bearish', price: lastLow.price, bar: klines.length - 1 })
  }

  return { bos: bos.slice(-5), choch: choch.slice(-3) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2c — OTE Zone (Optimal Trade Entry: 61.8–78.6% retracement)
// ─────────────────────────────────────────────────────────────────────────────

export function calcOTE(swingLow: number, swingHigh: number, direction: 'long' | 'short'): OTEResult {
  const range = swingHigh - swingLow
  if (direction === 'long') {
    return {
      zone:  { top: swingHigh - range * 0.618, bottom: swingHigh - range * 0.786 },
      ideal: swingHigh - range * 0.705,
      label: 'OTE Long Zone (61.8–78.6%)',
    }
  }
  return {
    zone:  { bottom: swingLow + range * 0.618, top: swingLow + range * 0.786 },
    ideal: swingLow + range * 0.705,
    label: 'OTE Short Zone (61.8–78.6%)',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 — detectScalpSignals
// ─────────────────────────────────────────────────────────────────────────────

export function detectScalpSignals(
  price: number,
  klines15m: Kline[],
  klines1h: Kline[],
  vwapResult: VWAPResult,
  cvd: CVDResult,
  bosChoch: BOSCHoCHResult,
  killzones: ICTKillzone[],
  fvg15m: FVGResult | undefined,
  liquidity: LiquidityResult | null,
  orderBook: OrderBook | null,
  funding: number | undefined,
): ScalpSignal | null {
  if (!price || klines15m.length < 14) return null

  let bull = 0, bear = 0
  const reasons: string[] = []
  const b  = (t: string) => { bull++; reasons.push(t) }
  const be = (t: string) => { bear++; reasons.push(t) }

  // ── FILTER 0: Macro event gate (session restrictions removed — 24/7 trading allowed)
  if (!shouldGenerateSignal('Scalp', 'MEDIA')) return null

  // ── FILTER 1: Killzone bonus (no longer a hard gate — KZ raises signal quality)
  const activeKZ = killzones.find(kz => kz.active)

  // ── FILTER 2: BB Squeeze guard on 15M (skip if too compressed) ─────────────
  const closes15m = klines15m.map(k => k.c)
  const len = Math.min(20, closes15m.length)
  const sma20 = closes15m.slice(-len).reduce((a, v) => a + v, 0) / len
  const variance = closes15m.slice(-len).reduce((a, v) => a + (v - sma20) ** 2, 0) / len
  const std20 = Math.sqrt(variance)
  const bbWidth = sma20 > 0 ? (std20 * 4) / sma20 * 100 : 1
  if (bbWidth < 0.15) return null

  // ── FILTER 3: 1H trend filter — don't scalp hard against 1H trend ──────────
  if (klines1h.length >= 21) {
    const closes1h = klines1h.map(k => k.c)
    const ema21_1h: number[] = []
    let mult = 2 / (21 + 1)
    let prev = closes1h.slice(0, 21).reduce((a, v) => a + v, 0) / 21
    ema21_1h.push(prev)
    for (let i = 21; i < closes1h.length; i++) {
      prev = closes1h[i] * mult + prev * (1 - mult)
      ema21_1h.push(prev)
    }
    const ema1hLast = ema21_1h[ema21_1h.length - 1]
    const lastC1h   = closes1h[closes1h.length - 1]
    const prevC1h   = closes1h[closes1h.length - 5]
    // Skip long scalps in strong 1H downtrend
    if (price < ema1hLast && lastC1h < prevC1h * 0.995) {
      if (bull > bear) return null
    }
    // Skip short scalps in strong 1H uptrend
    if (price > ema1hLast && lastC1h > prevC1h * 1.005) {
      if (bear > bull) return null
    }
  }

  // ── VWAP Analysis ──────────────────────────────────────────────────────────
  const { vwap, upper1, upper2, lower1, lower2 } = vwapResult
  const vwapDist = ((price - vwap) / vwap) * 100

  if (price > vwap  && price < vwap * 1.001)  b('Precio justo encima de VWAP — momentum alcista')
  if (price < vwap  && price > vwap * 0.999)  be('Precio justo debajo de VWAP — momentum bajista')
  if (price <= lower1 && price > lower2)       b('Precio en banda VWAP −1σ — rebote probable')
  if (price >= upper1 && price < upper2)       be('Precio en banda VWAP +1σ — rechazo probable')
  if (price <= lower2)                         b('Precio en banda VWAP −2σ — sobreventa extrema')
  if (price >= upper2)                         be('Precio en banda VWAP +2σ — sobrecompra extrema')

  // ── CVD Analysis ───────────────────────────────────────────────────────────
  const delta   = cvd.delta
  const cvdArr  = cvd.cvd
  const lastD   = delta[delta.length - 1] ?? 0
  const prevD   = delta[delta.length - 2] ?? 0
  const cvdNow  = cvdArr[cvdArr.length - 1] ?? 0
  const cvdPrev = cvdArr[cvdArr.length - 3] ?? 0
  const lastC   = closes15m[closes15m.length - 1] ?? 0
  const prevC   = closes15m[closes15m.length - 3] ?? 0

  if (lastD > 0 && prevD > 0)                  b('CVD positivo 2 velas — compradores activos')
  if (lastD < 0 && prevD < 0)                  be('CVD negativo 2 velas — vendedores activos')
  if (lastC < prevC && cvdNow > cvdPrev)        b('Divergencia CVD alcista — precio baja, compradores absorben')
  if (lastC > prevC && cvdNow < cvdPrev)        be('Divergencia CVD bajista — precio sube, vendedores acumulan')

  // ── Order Book Imbalance (top-5 notional) ──────────────────────────────────
  if (orderBook?.bids?.length && orderBook?.asks?.length) {
    const topBids = orderBook.bids.slice(0, 5).reduce((a, [p, q]) => a + +p * +q, 0)
    const topAsks = orderBook.asks.slice(0, 5).reduce((a, [p, q]) => a + +p * +q, 0)
    const total   = topBids + topAsks
    if (total > 0) {
      const imb = topBids / total
      if (imb > 0.65) b(`Order book: ${(imb * 100).toFixed(0)}% bids — presión compradora`)
      if (imb < 0.35) be(`Order book: ${((1 - imb) * 100).toFixed(0)}% asks — presión vendedora`)
    }
  }

  // ── BOS / CHoCH ────────────────────────────────────────────────────────────
  if (bosChoch.choch.length > 0) {
    const last = bosChoch.choch[bosChoch.choch.length - 1]
    if (last.type === 'bullish') { bull += 2; reasons.push('CHoCH alcista — cambio de carácter, reversión') }
    if (last.type === 'bearish') { bear += 2; reasons.push('CHoCH bajista — cambio de carácter, reversión') }
  }
  if (bosChoch.bos.length > 0) {
    const last = bosChoch.bos[bosChoch.bos.length - 1]
    if (last.type === 'bullish') b('BOS alcista — continuación de estructura')
    if (last.type === 'bearish') be('BOS bajista — continuación de estructura')
  }

  // ── FVG on 15M ─────────────────────────────────────────────────────────────
  const allFVGs = [...(fvg15m?.bullish ?? []), ...(fvg15m?.bearish ?? [])]
  const nearFVG = allFVGs.find(f => !f.filled && Math.abs(price - f.midpoint) / price < 0.005)
  if (nearFVG) {
    if (nearFVG.type === 'bullish') { bull += 2; reasons.push(`FVG alcista 15M en $${nearFVG.midpoint.toFixed(0)} — soporte`) }
    if (nearFVG.type === 'bearish') { bear += 2; reasons.push(`FVG bajista 15M en $${nearFVG.midpoint.toFixed(0)} — resistencia`) }
  }

  // ── Liquidity sweeps ───────────────────────────────────────────────────────
  if (liquidity) {
    const ssl = liquidity.nearestSSL
    const bsl = liquidity.nearestBSL
    if (ssl && Math.abs(price - ssl) / price < 0.005) {
      bear += 2; reasons.push(`SSL en $${ssl.toFixed(0)} — barrido de liquidez bajista probable`)
    }
    if (bsl && Math.abs(price - bsl) / price < 0.005) {
      bull += 2; reasons.push(`BSL en $${bsl.toFixed(0)} — barrido de liquidez alcista probable`)
    }
  }

  // ── Funding ────────────────────────────────────────────────────────────────
  if (funding != null && funding > 0.04)  be('Funding extremo — longs sobreextendidos')
  if (funding != null && funding < -0.01) b('Funding negativo — favorable para longs')

  // ── Patrones de velas japonesas (15M) ─────────────────────────────────────
  const patterns15m = detectCandlePatterns(klines15m, 15)

  const strongBull15m = patterns15m.filter(p => p.pattern.type === 'bullish' && p.pattern.strength === 3)
  const strongBear15m = patterns15m.filter(p => p.pattern.type === 'bearish' && p.pattern.strength === 3)

  if (strongBull15m.length > 0) {
    bull += strongBull15m.length * 2
    reasons.push(`${strongBull15m[0].pattern.name} en 15M (${strongBull15m[0].confidence}%) — alcista`)
  }
  if (strongBear15m.length > 0) {
    bear += strongBear15m.length * 2
    reasons.push(`${strongBear15m[0].pattern.name} en 15M (${strongBear15m[0].confidence}%) — bajista`)
  }

  // Medium strength patterns in Killzone get a bonus point
  if (activeKZ) {
    patterns15m
      .filter(p => p.pattern.strength === 2 && p.confidence > 75)
      .forEach(p => {
        if (p.pattern.type === 'bullish') { bull++; reasons.push(`${p.pattern.name} 15M (KZ)`) }
        if (p.pattern.type === 'bearish') { bear++; reasons.push(`${p.pattern.name} 15M (KZ)`) }
      })
  }

  // ── Decision ───────────────────────────────────────────────────────────────
  const side: 'LONG' | 'SHORT' | null = bull > bear ? 'LONG' : bear > bull ? 'SHORT' : null
  const maxScore = Math.max(bull, bear)
  const minScore = activeKZ ? 4 : 5
  if (!side || maxScore < minScore) return null

  // ── SL: structure-based (swing high/low) + ATR floor, min 0.4% ──────────────
  // ATR on 15M used as baseline
  const h15 = klines15m.map(k => k.h)
  const l15 = klines15m.map(k => k.l)
  const c15 = klines15m.map(k => k.c)
  const tr15 = h15.map((h, i) =>
    i === 0 ? h - l15[i] : Math.max(h - l15[i], Math.abs(h - c15[i - 1]), Math.abs(l15[i] - c15[i - 1]))
  )
  const atr15 = tr15.slice(-14).reduce((a, v) => a + v, 0) / Math.min(14, tr15.length)

  const isLong = side === 'LONG'

  // Structure: swing high/low over last 8 candles (natural support/resistance)
  const recentSwingLow  = Math.min(...klines15m.slice(-8).map(k => k.l))
  const recentSwingHigh = Math.max(...klines15m.slice(-8).map(k => k.h))
  const structureDist   = isLong ? price - recentSwingLow : recentSwingHigh - price

  // ATR-based: 2.5× ATR15M (was 1.5×, bumped to reduce noise hits)
  const atrDist = atr15 * 2.5

  // Minimum: 0.4% of price (never stops within noise)
  const minDist = price * 0.004

  // Final SL: widest of structure (+ 10% buffer) vs ATR vs minimum
  const slDist = Math.max(minDist, atrDist, structureDist * 1.1)

  const sl  = isLong ? price - slDist        : price + slDist
  // TPs scale with the wider SL for proper R:R
  const tp1 = isLong ? price + slDist * 1.5  : price - slDist * 1.5   // 1.5:1
  const tp2 = isLong ? price + slDist * 2.5  : price - slDist * 2.5   // 2.5:1
  const tp3 = isLong ? price + slDist * 4.0  : price - slDist * 4.0   // 4:1

  const confidence: 'ALTA' | 'MEDIA' | 'BAJA' =
    maxScore >= 7 ? 'ALTA' : maxScore >= 5 ? 'MEDIA' : 'BAJA'

  const duration = bbWidth < 0.3 ? '15–30 min' : bbWidth < 0.5 ? '20–45 min' : '30–90 min'

  const qualityLabel =
    maxScore >= 8 && confidence === 'ALTA' && !!nearFVG ? 'Señal de libro' :
    maxScore >= 6 ? 'Buena señal' : 'Señal marginal'

  const cvdSignal =
    Math.abs(lastD) > Math.abs(prevD)
      ? (lastD > 0 ? 'CVD positivo acelerando' : 'CVD negativo acelerando')
      : null

  const bosChochLabel =
    bosChoch.choch.length > 0
      ? `${bosChoch.choch[bosChoch.choch.length - 1].type} CHoCH`
      : bosChoch.bos.length > 0
        ? `${bosChoch.bos[bosChoch.bos.length - 1].type} BOS`
        : null

  const vwapRelation =
    price > vwap
      ? `+${vwapDist.toFixed(2)}% sobre VWAP`
      : `${vwapDist.toFixed(2)}% bajo VWAP`

  const now = Date.now()
  return {
    id:        `scalp_${now}`,
    side, entry: price, sl, tp1, tp2, tp3,
    confidence, reasons,
    type: 'Scalp', duration, maxLeverage: 7,
    killzone:    activeKZ?.name ?? null,
    bosChoch:    bosChochLabel,
    cvdSignal,
    vwapRelation,
    qualityLabel,
    score:     maxScore,
    ts:        new Date(),
    status:    'active' as const,
    createdAt: now,
  }
}
