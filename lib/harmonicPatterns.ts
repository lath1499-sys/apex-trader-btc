// APEX — Harmonic ABCD Pattern Detection
// Multi-TF: 15M, 1H, 4H, 12H, 1D, 2D
// Fib confirmation: D point must align with a Fibonacci level (±1.5%)
// Signal generation: PRZ + Fib + GOOD/PERFECT quality → tradeable signal

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { TradeReason } from './types'

export interface SwingPoint {
  price: number
  index: number
  time:  number
  type:  'HIGH' | 'LOW'
}

export interface ABCDPattern {
  A: SwingPoint
  B: SwingPoint
  C: SwingPoint
  D_target:     number
  D_hit?:       SwingPoint

  BC_retrace:   number
  CD_extension: number

  direction:    'BEARISH' | 'BULLISH'
  type:         'CLASSIC' | 'ALTERNATE'
  quality:      'PERFECT' | 'GOOD' | 'ACCEPTABLE'
  completion:   number

  prz_low:      number
  prz_high:     number
  at_prz:       boolean
  invalidation: number
  target1:      number
  target2:      number
  target3:      number

  fibConfluence: { level: number; label: string; price: number } | null
  fibConfirmed:  boolean

  timeframe:    string
  detectedAt:   number
}

export interface HarmonicSignalCandidate {
  id:         string
  pattern:    ABCDPattern
  side:       'LONG' | 'SHORT'
  tradeType:  'Scalp' | 'DayTrade' | 'Swing'
  entry:      number
  sl:         number
  tp1:        number
  tp2:        number
  tp3:        number
  maxLev:     number
  confidence: 'ALTA' | 'MEDIA' | 'BAJA'
  reasons:    TradeReason[]
  analysis:   string
}

// ── Fibonacci Helpers ────────────────────────────────────────────────────────

const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.414, 1.618]

function computeFibLevels(klines: any[]): Array<{ level: number; price: number; label: string }> {
  const n      = Math.min(60, klines.length)
  const slice  = klines.slice(-n)
  const highs  = slice.map((k: any) => parseFloat(k.h ?? k[2]))
  const lows   = slice.map((k: any) => parseFloat(k.l ?? k[3]))
  const closes = slice.map((k: any) => parseFloat(k.c ?? k[4]))
  const sh     = Math.max(...highs)
  const sl     = Math.min(...lows)
  const price  = closes[closes.length - 1]
  const up     = price > (sh + sl) / 2
  const rng    = sh - sl
  return FIB_LEVELS.map(lv => ({
    level: lv,
    price: up ? sh - rng * lv : sl + rng * lv,
    label: lv === 1.0 ? 'Ext 100%' : lv > 1.0 ? `Ext ${(lv * 100).toFixed(1)}%` : `${(lv * 100).toFixed(1)}%`,
  }))
}

function checkFibConfluence(
  D_target:  number,
  fibLevels: Array<{ level: number; price: number; label: string }>,
  tolerance  = 0.015,
): { level: number; label: string; price: number } | null {
  for (const fib of fibLevels) {
    if (Math.abs(D_target - fib.price) / Math.max(D_target, fib.price) < tolerance) {
      return fib
    }
  }
  return null
}

// ── Swing Point Detection ────────────────────────────────────────────────────

function detectSwingPoints(klines: any[], lookback = 5): SwingPoint[] {
  const points: SwingPoint[] = []
  const len = klines.length

  for (let i = lookback; i < len - lookback; i++) {
    const curr      = klines[i]
    const prevSlice = klines.slice(i - lookback, i)
    const nextSlice = klines.slice(i + 1, i + lookback + 1)

    const currHigh = parseFloat(curr.h ?? curr[2])
    const currLow  = parseFloat(curr.l ?? curr[3])

    const isSwingHigh =
      prevSlice.every((k: any) => parseFloat(k.h ?? k[2]) <= currHigh) &&
      nextSlice.every((k: any) => parseFloat(k.h ?? k[2]) <= currHigh)

    const isSwingLow =
      prevSlice.every((k: any) => parseFloat(k.l ?? k[3]) >= currLow) &&
      nextSlice.every((k: any) => parseFloat(k.l ?? k[3]) >= currLow)

    if (isSwingHigh) {
      points.push({ price: currHigh, index: i, time: parseInt(curr.t ?? curr[0]), type: 'HIGH' })
    }
    if (isSwingLow) {
      points.push({ price: currLow, index: i, time: parseInt(curr.t ?? curr[0]), type: 'LOW' })
    }
  }

  return points
}

// ── ABCD Ratio Validation ────────────────────────────────────────────────────

const ABCD_RULES = {
  classic:   { bc_min: 0.56, bc_max: 0.68, cd_min: 1.20, cd_max: 1.35 },
  alternate: { bc_min: 0.72, bc_max: 0.84, cd_min: 1.20, cd_max: 1.35 },
  deep:      { bc_min: 0.84, bc_max: 0.94, cd_min: 1.55, cd_max: 1.70 },
}

function validateABCD(
  A: number, B: number, C: number, D: number,
): { valid: boolean; type: ABCDPattern['type']; quality: ABCDPattern['quality']; bc_ratio: number; cd_ratio: number } {
  const AB = Math.abs(A - B)
  const BC = Math.abs(B - C)
  const CD = Math.abs(C - D)

  if (AB === 0) return { valid: false, type: 'CLASSIC', quality: 'ACCEPTABLE', bc_ratio: 0, cd_ratio: 0 }

  const bc_ratio = BC / AB
  const cd_ratio = CD / AB

  for (const [typeName, rules] of Object.entries(ABCD_RULES)) {
    if (bc_ratio >= rules.bc_min && bc_ratio <= rules.bc_max &&
        cd_ratio >= rules.cd_min && cd_ratio <= rules.cd_max) {
      const typeKey  = typeName === 'classic' ? 'CLASSIC' : 'ALTERNATE' as ABCDPattern['type']
      const idealBC  = typeName === 'classic' ? 0.618 : typeName === 'alternate' ? 0.786 : 0.886
      const idealCD  = typeName === 'deep'    ? 1.618 : 1.272
      const avgDev   = (Math.abs(bc_ratio - idealBC) / idealBC + Math.abs(cd_ratio - idealCD) / idealCD) / 2
      const quality: ABCDPattern['quality'] = avgDev < 0.03 ? 'PERFECT' : avgDev < 0.06 ? 'GOOD' : 'ACCEPTABLE'
      return { valid: true, type: typeKey, quality, bc_ratio, cd_ratio }
    }
  }

  return { valid: false, type: 'CLASSIC', quality: 'ACCEPTABLE', bc_ratio, cd_ratio }
}

// ── Main Pattern Detection ───────────────────────────────────────────────────

export function detectABCDPatterns(
  klines:       any[],
  timeframe:    string,
  currentPrice: number,
  lookback      = 5,
): ABCDPattern[] {
  if (!klines || klines.length < 50) return []

  const fibLevels = computeFibLevels(klines)
  const patterns: ABCDPattern[] = []
  const swings = detectSwingPoints(klines, lookback)
  if (swings.length < 4) return []

  for (let i = 0; i < swings.length - 3; i++) {
    const A = swings[i]
    const B = swings[i + 1]
    const C = swings[i + 2]

    if (A.type === B.type || B.type === C.type || A.type !== C.type) continue

    const isBearish = A.type === 'HIGH'

    if (isBearish) {
      if (C.price >= A.price || B.price >= A.price) continue
    } else {
      if (C.price <= A.price || B.price <= A.price) continue
    }

    const AB = Math.abs(A.price - B.price)
    const BC = Math.abs(B.price - C.price)
    if (BC > AB * 1.0) continue

    const bc_ratio     = BC / AB
    const cd_extension = bc_ratio >= 0.84 ? 1.618 : 1.272
    const D_target     = isBearish ? C.price - AB * cd_extension : C.price + AB * cd_extension

    const D_swing  = swings[i + 3]
    let validation = { valid: true, type: 'CLASSIC' as ABCDPattern['type'], quality: 'GOOD' as ABCDPattern['quality'], bc_ratio, cd_ratio: 0 }

    if (D_swing) {
      validation = validateABCD(A.price, B.price, C.price, D_swing.price)
      if (!validation.valid) continue
    }

    const fibConfluence = checkFibConfluence(D_target, fibLevels)
    const fibConfirmed  = fibConfluence !== null

    const prz_range  = D_target * 0.012
    const prz_low    = D_target - prz_range
    const prz_high   = D_target + prz_range
    const at_prz     = currentPrice >= prz_low && currentPrice <= prz_high

    const total_move = Math.abs(C.price - D_target)
    const completion = total_move > 0
      ? Math.min(100, Math.round(Math.abs(C.price - currentPrice) / total_move * 100))
      : 0

    const CD_range     = Math.abs(C.price - D_target)
    const target1      = isBearish ? D_target + CD_range * 0.382 : D_target - CD_range * 0.382
    const target2      = isBearish ? D_target + CD_range * 0.618 : D_target - CD_range * 0.618
    const target3      = C.price
    // SL is placed 1.5% on the far side of D_target:
    // BEARISH pattern → LONG trade: SL below D (isBearish true)
    // BULLISH pattern → SHORT trade: SL above D (isBearish false)
    const invalidation = isBearish ? D_target * (1 - 0.015) : D_target * (1 + 0.015)

    patterns.push({
      A, B, C,
      D_target:     parseFloat(D_target.toFixed(2)),
      D_hit:        D_swing,
      BC_retrace:   parseFloat(bc_ratio.toFixed(3)),
      CD_extension: parseFloat(cd_extension.toFixed(3)),
      direction:    isBearish ? 'BEARISH' : 'BULLISH',
      type:         validation.type,
      quality:      validation.quality,
      completion,
      prz_low:      parseFloat(prz_low.toFixed(2)),
      prz_high:     parseFloat(prz_high.toFixed(2)),
      at_prz,
      invalidation: parseFloat(invalidation.toFixed(2)),
      target1:      parseFloat(target1.toFixed(2)),
      target2:      parseFloat(target2.toFixed(2)),
      target3:      parseFloat(target3.toFixed(2)),
      fibConfluence,
      fibConfirmed,
      timeframe,
      detectedAt:   Date.now(),
    })
  }

  return patterns
    .filter(p => p.quality !== 'ACCEPTABLE' || p.at_prz)
    .sort((a, b) => {
      const q = { PERFECT: 3, GOOD: 2, ACCEPTABLE: 1 }
      // Prioritize: PRZ > Fib confirmed > quality
      const aScore = (a.at_prz ? 100 : 0) + (a.fibConfirmed ? 50 : 0) + q[a.quality] * 10
      const bScore = (b.at_prz ? 100 : 0) + (b.fibConfirmed ? 50 : 0) + q[b.quality] * 10
      return bScore - aScore
    })
    .slice(0, 3)
}

// ── Multi-Timeframe ABCD Analysis ────────────────────────────────────────────

export interface MultiTFABCD {
  patterns:          { tf: string; patterns: ABCDPattern[] }[]
  mostRelevant:      ABCDPattern | null
  inPRZ:             boolean
  przDetails:        string
  tradingSignal:     'LONG_AT_D' | 'SHORT_AT_D' | 'WAIT' | 'NONE'
  signalStrength:    number
  fibConfirmedCount: number
  analysis:          string
}

export function analyzeAllABCD(
  klinesMap:    Record<string, any[]>,
  currentPrice: number,
): MultiTFABCD {
  const allPatterns: { tf: string; patterns: ABCDPattern[] }[] = []
  const lookbackMap: Record<string, number> = {
    '15m': 3, '1h': 4, '4h': 5, '12h': 5, '1d': 4, '2d': 3,
  }

  for (const [tf, klines] of Object.entries(klinesMap)) {
    if (!klines?.length) continue
    const detected = detectABCDPatterns(klines, tf, currentPrice, lookbackMap[tf] ?? 4)
    if (detected.length > 0) allPatterns.push({ tf, patterns: detected })
  }

  const allFlat      = allPatterns.flatMap(x => x.patterns)
  const atPRZ        = allFlat.filter(p => p.at_prz)
  const qScore       = { PERFECT: 3, GOOD: 2, ACCEPTABLE: 1 }

  const mostRelevant = atPRZ.length > 0
    ? [...atPRZ].sort((a, b) => {
        const aS = (a.fibConfirmed ? 50 : 0) + qScore[a.quality] * 10
        const bS = (b.fibConfirmed ? 50 : 0) + qScore[b.quality] * 10
        return bS - aS
      })[0]
    : [...allFlat].sort((a, b) => b.completion - a.completion)[0] ?? null

  const inPRZ            = atPRZ.length > 0
  const fibConfirmedCount = allFlat.filter(p => p.fibConfirmed).length

  let signalStrength = 0
  if (mostRelevant) {
    signalStrength += qScore[mostRelevant.quality] * 13
    signalStrength += mostRelevant.at_prz ? 30 : mostRelevant.completion > 80 ? 15 : 5
    signalStrength += atPRZ.length > 1 ? 20 : 0
    signalStrength += ['4h', '1d'].includes(mostRelevant.timeframe) ? 10 : 5
    signalStrength += mostRelevant.fibConfirmed ? 15 : 0
    signalStrength += fibConfirmedCount > 1 ? 10 : 0
  }

  let tradingSignal: MultiTFABCD['tradingSignal'] = 'NONE'
  if (mostRelevant && inPRZ) {
    tradingSignal = mostRelevant.direction === 'BULLISH' ? 'SHORT_AT_D' : 'LONG_AT_D'
  } else if (mostRelevant && mostRelevant.completion > 85) {
    tradingSignal = 'WAIT'
  }

  let przDetails = ''
  if (mostRelevant) {
    const dir  = mostRelevant.direction === 'BEARISH' ? 'LONG' : 'SHORT'
    const dist = ((Math.abs(currentPrice - mostRelevant.D_target) / currentPrice) * 100).toFixed(1)
    const fib  = mostRelevant.fibConfluence ? ` | Fib ${mostRelevant.fibConfluence.label}` : ' | Sin Fib'
    przDetails = inPRZ
      ? `✅ Precio EN PRZ del ABCD ${dir} (${mostRelevant.timeframe.toUpperCase()})${fib} — D=$${Math.round(mostRelevant.D_target).toLocaleString()}.`
      : `⏳ ABCD ${dir} (${mostRelevant.timeframe.toUpperCase()}) ${mostRelevant.completion}% completado — D en $${Math.round(mostRelevant.D_target).toLocaleString()} (${dist}%)${fib}`
  }

  let analysis = ''
  if (!mostRelevant) {
    analysis = 'Sin patrones ABCD harmónicos activos en ningún timeframe.'
  } else {
    const tf     = mostRelevant.timeframe.toUpperCase()
    const dir    = mostRelevant.direction === 'BEARISH' ? 'bajista' : 'alcista'
    const action = mostRelevant.direction === 'BEARISH' ? 'LONG' : 'SHORT'
    const bc     = (mostRelevant.BC_retrace * 100).toFixed(0)
    const cd     = mostRelevant.CD_extension.toFixed(3)
    const fibStr = mostRelevant.fibConfluence
      ? ` Confirmado con Fibonacci ${mostRelevant.fibConfluence.label} ($${Math.round(mostRelevant.fibConfluence.price).toLocaleString()}).`
      : ' Sin confluencia Fibonacci.'

    if (inPRZ) {
      analysis = `ABCD harmónico ${dir} (${tf}) completado en PRZ.${fibStr} BC retrocedió ${bc}% de AB, CD extiende ${cd}x. ` +
        `Setup ${action} activo — T1: $${Math.round(mostRelevant.target1).toLocaleString()} | T2: $${Math.round(mostRelevant.target2).toLocaleString()} | ` +
        `Inv: $${Math.round(mostRelevant.invalidation).toLocaleString()}.`
    } else if (mostRelevant.completion > 85) {
      analysis = `ABCD ${dir} (${tf}) ${mostRelevant.completion}% completado.${fibStr} ` +
        `Aproximándose a D ($${Math.round(mostRelevant.D_target).toLocaleString()}).`
    } else {
      analysis = `ABCD ${dir} en formación (${tf}), ${mostRelevant.completion}% completado.${fibStr} ` +
        `D proyectado: $${Math.round(mostRelevant.D_target).toLocaleString()}.`
    }

    // Multi-TF details
    const perTF = allPatterns.map(({ tf: t, patterns: ps }) => {
      const best = ps[0]
      const fib  = best.fibConfirmed ? `✓Fib(${best.fibConfluence!.label})` : '✗Fib'
      const prz  = best.at_prz ? 'PRZ✓' : `${best.completion}%`
      return `${t.toUpperCase()}: ${best.direction === 'BEARISH' ? '▲LONG' : '▼SHORT'} ${prz} ${best.quality} ${fib}`
    }).join(' | ')
    if (perTF) analysis += `\nTF activos: ${perTF}`

    if (atPRZ.length > 1) analysis += ` ⚡ CONFLUENCIA MULTI-TF: ${atPRZ.length} timeframes en PRZ.`
    if (fibConfirmedCount > 1) analysis += ` 📊 ${fibConfirmedCount} TFs con Fib confirmado.`
  }

  return {
    patterns: allPatterns,
    mostRelevant,
    inPRZ,
    przDetails,
    tradingSignal,
    signalStrength: Math.min(100, signalStrength),
    fibConfirmedCount,
    analysis,
  }
}

// ── Signal Generation ────────────────────────────────────────────────────────

function tfToTradeType(tf: string): 'Scalp' | 'DayTrade' | 'Swing' {
  if (tf === '15m') return 'Scalp'
  if (tf === '1h' || tf === '4h') return 'DayTrade'
  return 'Swing'
}

function tfToMaxLev(tf: string): number {
  if (tf === '15m') return 8
  if (tf === '1h' || tf === '4h') return 5
  return 3
}

// Returns signal candidates for patterns that satisfy:
// 1) Price is in PRZ
// 2) Fibonacci level confirmed at D
// 3) Quality is GOOD or PERFECT
// These bypass the normal activeCount < 3 gate.
export function generateHarmonicSignals(
  abcd:         MultiTFABCD,
  currentPrice: number,
  multiTFCount: number,   // how many TFs in PRZ (for confidence boost)
): HarmonicSignalCandidate[] {
  const candidates: HarmonicSignalCandidate[] = []
  const seen = new Set<string>()

  for (const { tf, patterns } of abcd.patterns) {
    for (const p of patterns) {
      if (!p.at_prz)        continue
      if (!p.fibConfirmed)  continue
      if (p.quality === 'ACCEPTABLE') continue

      const side      = p.direction === 'BEARISH' ? 'LONG' : 'SHORT'
      const tradeType = tfToTradeType(tf)
      const maxLev    = tfToMaxLev(tf)

      // Dedup per TF+direction+D level
      const uid = `h_${tf}_${side}_${Math.round(p.D_target)}`
      if (seen.has(uid)) continue
      seen.add(uid)

      const baseConf: 'ALTA' | 'MEDIA' | 'BAJA' = p.quality === 'PERFECT' ? 'ALTA' : 'MEDIA'
      const confidence = (multiTFCount > 1 && baseConf === 'MEDIA') ? 'ALTA' : baseConf

      const sDir: 'bull' | 'bear' = side === 'LONG' ? 'bull' : 'bear'
      const dirStr = p.direction === 'BEARISH' ? 'bajista' : 'alcista'

      const reasons: TradeReason[] = [
        { s: sDir, txt: `📐 ABCD ${dirStr} ${tf.toUpperCase()} completado en PRZ` },
        { s: sDir, txt: `📊 Fibonacci ${p.fibConfluence!.label} confirmado en $${Math.round(p.fibConfluence!.price).toLocaleString()}` },
        { s: sDir, txt: `BC: ${(p.BC_retrace * 100).toFixed(0)}% | CD: ${p.CD_extension}x | Calidad: ${p.quality}` },
        ...(multiTFCount > 1 ? [{ s: sDir, txt: `⚡ Confluencia multi-TF: ${multiTFCount} timeframes confirman` } as TradeReason] : []),
      ]

      const analysis = [
        `📐 PATRÓN ABCD HARMÓNICO ${dirStr.toUpperCase()} — ${tf.toUpperCase()}`,
        ``,
        `El precio completó el movimiento CD y se encuentra en la Potential Reversal Zone (PRZ).`,
        `El punto D coincide con Fibonacci ${p.fibConfluence!.label} — confluencia técnica confirmada.`,
        ``,
        `BC retroceso: ${(p.BC_retrace * 100).toFixed(0)}% de AB | CD extensión: ${p.CD_extension}x`,
        `PRZ: $${Math.round(p.prz_low).toLocaleString()}–$${Math.round(p.prz_high).toLocaleString()}`,
        multiTFCount > 1 ? `⚡ ${multiTFCount} timeframes confirman la señal simultáneamente.` : '',
      ].filter(Boolean).join('\n')

      // Belt-and-suspenders: ensure SL is on the correct side of entry
      const isLongSide = side === 'LONG'
      const rawSL = p.invalidation
      const safeSL = (isLongSide ? rawSL < currentPrice : rawSL > currentPrice)
        ? rawSL
        : (isLongSide ? currentPrice * (1 - 0.015) : currentPrice * (1 + 0.015))

      candidates.push({
        id: uid,
        pattern: p,
        side,
        tradeType,
        entry: currentPrice,
        sl:    safeSL,
        tp1:   p.target1,
        tp2:   p.target2,
        tp3:   p.target3,
        maxLev,
        confidence,
        reasons,
        analysis,
      })
    }
  }

  return candidates
}

// ── Score Impact ─────────────────────────────────────────────────────────────

export function getABCDScoreImpact(
  abcd: MultiTFABCD,
  side: 'LONG' | 'SHORT',
): { bull: number; bear: number; reasons: string[] } {
  let bull = 0, bear = 0
  const reasons: string[] = []
  if (!abcd.mostRelevant) return { bull, bear, reasons }

  const p = abcd.mostRelevant

  if (p.at_prz) {
    const boost = p.quality === 'PERFECT' ? 4 : p.quality === 'GOOD' ? 3 : 2
    const fibBonus = p.fibConfirmed ? 1 : 0
    if (p.direction === 'BEARISH' && side === 'LONG') {
      bull += boost + fibBonus
      const fibStr = p.fibConfluence ? ` + Fib ${p.fibConfluence.label}` : ''
      reasons.push(`📐 ABCD bajista PRZ (${p.timeframe.toUpperCase()}, ${p.quality}${fibStr}) — reversión LONG en $${Math.round(p.D_target).toLocaleString()}`)
    }
    if (p.direction === 'BULLISH' && side === 'SHORT') {
      bear += boost + fibBonus
      const fibStr = p.fibConfluence ? ` + Fib ${p.fibConfluence.label}` : ''
      reasons.push(`📐 ABCD alcista PRZ (${p.timeframe.toUpperCase()}, ${p.quality}${fibStr}) — reversión SHORT en $${Math.round(p.D_target).toLocaleString()}`)
    }
    if (p.direction === 'BEARISH' && side === 'SHORT') {
      bear -= 2
      reasons.push(`⚠️ ABCD bajista en PRZ — SHORT contra reversión esperada`)
    }
    if (p.direction === 'BULLISH' && side === 'LONG') {
      bull -= 2
      reasons.push(`⚠️ ABCD alcista en PRZ — LONG contra reversión esperada`)
    }
    const multiPRZ = abcd.patterns.flatMap(x => x.patterns).filter(x => x.at_prz).length
    if (multiPRZ > 1) {
      if (p.direction === 'BEARISH' && side === 'LONG')  { bull += 2; reasons.push(`⚡ Confluencia ABCD multi-TF en PRZ`) }
      if (p.direction === 'BULLISH' && side === 'SHORT') { bear += 2; reasons.push(`⚡ Confluencia ABCD multi-TF en PRZ`) }
    }
    if (abcd.fibConfirmedCount > 1) {
      if (p.direction === 'BEARISH' && side === 'LONG')  { bull += 1; reasons.push(`📊 ${abcd.fibConfirmedCount} TFs con Fib confirmado`) }
      if (p.direction === 'BULLISH' && side === 'SHORT') { bear += 1; reasons.push(`📊 ${abcd.fibConfirmedCount} TFs con Fib confirmado`) }
    }
  } else if (p.completion > 85) {
    if (p.direction === 'BEARISH' && side === 'LONG')  { bull += 1; reasons.push(`📐 ABCD bajista ${p.completion}% — reversión LONG próxima`) }
    if (p.direction === 'BULLISH' && side === 'SHORT') { bear += 1; reasons.push(`📐 ABCD alcista ${p.completion}% — reversión SHORT próxima`) }
  }

  return { bull, bear, reasons }
}
