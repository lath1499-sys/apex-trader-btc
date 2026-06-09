// APEX — Harmonic ABCD Pattern Detection
// Detects on 15M, 1H, 4H, 12H, 1D, 2D timeframes.
// Results flow into signal scoring, NTFY alerts, Trade Ideas analysis.

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  timeframe:    string
  detectedAt:   number
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
      points.push({ price: currLow,  index: i, time: parseInt(curr.t ?? curr[0]), type: 'LOW' })
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

    const bc_ratio    = BC / AB
    const cd_extension = bc_ratio >= 0.84 ? 1.618 : 1.272
    const D_target    = isBearish ? C.price - AB * cd_extension : C.price + AB * cd_extension

    const D_swing = swings[i + 3]
    let validation = { valid: true, type: 'CLASSIC' as ABCDPattern['type'], quality: 'GOOD' as ABCDPattern['quality'], bc_ratio, cd_ratio: 0 }

    if (D_swing) {
      validation = validateABCD(A.price, B.price, C.price, D_swing.price)
      if (!validation.valid) continue
    }

    const prz_range  = D_target * 0.012
    const prz_low    = D_target - prz_range
    const prz_high   = D_target + prz_range
    const at_prz     = currentPrice >= prz_low && currentPrice <= prz_high

    const total_move = Math.abs(C.price - D_target)
    const completion = total_move > 0
      ? Math.min(100, Math.round(Math.abs(C.price - currentPrice) / total_move * 100))
      : 0

    const CD_range   = Math.abs(C.price - D_target)
    const target1    = isBearish ? D_target + CD_range * 0.382 : D_target - CD_range * 0.382
    const target2    = isBearish ? D_target + CD_range * 0.618 : D_target - CD_range * 0.618
    const target3    = C.price
    const invalidation = isBearish ? A.price + AB * 0.05 : A.price - AB * 0.05

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
      timeframe,
      detectedAt:   Date.now(),
    })
  }

  return patterns
    .filter(p => p.quality !== 'ACCEPTABLE' || p.at_prz)
    .sort((a, b) => {
      const q = { PERFECT: 3, GOOD: 2, ACCEPTABLE: 1 }
      return q[b.quality] - q[a.quality]
    })
    .slice(0, 3)
}

// ── Multi-Timeframe ABCD Analysis ────────────────────────────────────────────

export interface MultiTFABCD {
  patterns:       { tf: string; patterns: ABCDPattern[] }[]
  mostRelevant:   ABCDPattern | null
  inPRZ:          boolean
  przDetails:     string
  tradingSignal:  'LONG_AT_D' | 'SHORT_AT_D' | 'WAIT' | 'NONE'
  signalStrength: number
  analysis:       string
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
    ? [...atPRZ].sort((a, b) => qScore[b.quality] - qScore[a.quality])[0]
    : [...allFlat].sort((a, b) => b.completion - a.completion)[0] ?? null

  const inPRZ = atPRZ.length > 0

  let signalStrength = 0
  if (mostRelevant) {
    signalStrength += qScore[mostRelevant.quality] * 13
    signalStrength += mostRelevant.at_prz ? 30 : mostRelevant.completion > 80 ? 15 : 5
    signalStrength += atPRZ.length > 1 ? 20 : 0
    signalStrength += ['4h', '1d'].includes(mostRelevant.timeframe) ? 10 : 5
  }

  let tradingSignal: MultiTFABCD['tradingSignal'] = 'NONE'
  if (mostRelevant && inPRZ) {
    tradingSignal = mostRelevant.direction === 'BULLISH' ? 'LONG_AT_D' : 'SHORT_AT_D'
  } else if (mostRelevant && mostRelevant.completion > 85) {
    tradingSignal = 'WAIT'
  }

  let przDetails = ''
  if (mostRelevant) {
    const dir  = mostRelevant.direction === 'BEARISH' ? 'SHORT' : 'LONG'
    const dist = ((Math.abs(currentPrice - mostRelevant.D_target) / currentPrice) * 100).toFixed(1)
    przDetails = inPRZ
      ? `✅ Precio EN PRZ del ABCD ${dir} (${mostRelevant.timeframe.toUpperCase()}) — D=$${Math.round(mostRelevant.D_target).toLocaleString()}. Buscar entrada ${dir}.`
      : `⏳ ABCD ${dir} (${mostRelevant.timeframe.toUpperCase()}) ${mostRelevant.completion}% completado — D en $${Math.round(mostRelevant.D_target).toLocaleString()} (${dist}% de distancia)`
  }

  let analysis = ''
  if (!mostRelevant) {
    analysis = 'Sin patrones ABCD harmónicos activos en ningún timeframe.'
  } else {
    const tf     = mostRelevant.timeframe.toUpperCase()
    const dir    = mostRelevant.direction === 'BEARISH' ? 'bajista' : 'alcista'
    const action = mostRelevant.direction === 'BEARISH' ? 'SHORT' : 'LONG'
    const bc     = (mostRelevant.BC_retrace * 100).toFixed(0)
    const cd     = mostRelevant.CD_extension.toFixed(3)

    if (inPRZ) {
      analysis = `ABCD harmónico ${dir} (${tf}) completado en PRZ. BC retrocedió ${bc}% de AB, CD extiende ${cd}x. ` +
        `Precio en zona de reversión — setup ${action} con R:R favorable. ` +
        `T1: $${Math.round(mostRelevant.target1).toLocaleString()} | T2: $${Math.round(mostRelevant.target2).toLocaleString()} | ` +
        `Inv: $${Math.round(mostRelevant.invalidation).toLocaleString()}.`
    } else if (mostRelevant.completion > 85) {
      analysis = `ABCD ${dir} (${tf}) ${mostRelevant.completion}% completado. ` +
        `Aproximándose a D ($${Math.round(mostRelevant.D_target).toLocaleString()}). ` +
        `Preparar ${action} en $${Math.round(mostRelevant.prz_low).toLocaleString()}–$${Math.round(mostRelevant.prz_high).toLocaleString()}.`
    } else {
      analysis = `ABCD ${dir} en formación (${tf}), ${mostRelevant.completion}% completado. ` +
        `D proyectado en $${Math.round(mostRelevant.D_target).toLocaleString()}.`
    }
    if (atPRZ.length > 1) analysis += ` ⚡ CONFLUENCIA MULTI-TF: ${atPRZ.length} timeframes confirman.`
  }

  return {
    patterns: allPatterns,
    mostRelevant,
    inPRZ,
    przDetails,
    tradingSignal,
    signalStrength: Math.min(100, signalStrength),
    analysis,
  }
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
    if (p.direction === 'BULLISH' && side === 'LONG') {
      bull += boost
      reasons.push(`📐 ABCD bullish PRZ (${p.timeframe.toUpperCase()}, ${p.quality}) — entrada LONG $${Math.round(p.D_target).toLocaleString()}`)
    }
    if (p.direction === 'BEARISH' && side === 'SHORT') {
      bear += boost
      reasons.push(`📐 ABCD bearish PRZ (${p.timeframe.toUpperCase()}, ${p.quality}) — entrada SHORT $${Math.round(p.D_target).toLocaleString()}`)
    }
    if (p.direction === 'BULLISH' && side === 'SHORT') {
      bear -= 2
      reasons.push(`⚠️ ABCD bullish en PRZ — SHORT contra patrón, riesgo elevado`)
    }
    if (p.direction === 'BEARISH' && side === 'LONG') {
      bull -= 2
      reasons.push(`⚠️ ABCD bearish en PRZ — LONG contra patrón, riesgo elevado`)
    }
    // Multi-TF confluence bonus
    const multiPRZ = abcd.patterns.flatMap(x => x.patterns).filter(x => x.at_prz).length
    if (multiPRZ > 1) {
      if (p.direction === 'BULLISH' && side === 'LONG')  { bull += 2; reasons.push(`⚡ Confluencia ABCD multi-TF en PRZ`) }
      if (p.direction === 'BEARISH' && side === 'SHORT') { bear += 2; reasons.push(`⚡ Confluencia ABCD multi-TF en PRZ`) }
    }
  } else if (p.completion > 85) {
    if (p.direction === 'BULLISH' && side === 'LONG')  { bull += 1; reasons.push(`📐 ABCD bullish ${p.completion}% — D próximo $${Math.round(p.D_target).toLocaleString()}`) }
    if (p.direction === 'BEARISH' && side === 'SHORT') { bear += 1; reasons.push(`📐 ABCD bearish ${p.completion}% — D próximo $${Math.round(p.D_target).toLocaleString()}`) }
  }

  return { bull, bear, reasons }
}
