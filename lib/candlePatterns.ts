import type { Kline } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Types — Steve Nison "Japanese Candlestick Charting Techniques"
// ─────────────────────────────────────────────────────────────────────────────

export interface CandlePattern {
  name: string
  nameJP?: string
  type: 'bullish' | 'bearish' | 'neutral' | 'continuation'
  strength: 1 | 2 | 3
  reliability: 1 | 2 | 3
  candles: number
  description: string
  tradingAdvice: string
}

export interface PatternDetection {
  pattern: CandlePattern
  confidence: number
  startBar: number
  endBar: number
  needsConfirmation: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern definitions (Nison catalogue)
// ─────────────────────────────────────────────────────────────────────────────

export const PATTERNS: Record<string, CandlePattern> = {
  hammer: {
    name: 'Hammer', nameJP: 'Takuri', type: 'bullish', strength: 2, reliability: 3, candles: 1,
    description: 'Martillo — cuerpo pequeño arriba, sombra inferior ≥2× cuerpo',
    tradingAdvice: 'Comprar en apertura de siguiente vela si cierra alcista',
  },
  hangingMan: {
    name: 'Hanging Man', nameJP: 'Kubitsuri', type: 'bearish', strength: 2, reliability: 2, candles: 1,
    description: 'Hombre Colgado — misma forma que Hammer pero en tendencia alcista',
    tradingAdvice: 'Esperar confirmación bajista antes de vender',
  },
  shootingStar: {
    name: 'Shooting Star', nameJP: 'Nagare-boshi', type: 'bearish', strength: 2, reliability: 3, candles: 1,
    description: 'Estrella Fugaz — sombra superior larga, rechaza precios altos',
    tradingAdvice: 'Vender en siguiente vela bajista confirmatoria',
  },
  invertedHammer: {
    name: 'Inverted Hammer', type: 'bullish', strength: 1, reliability: 2, candles: 1,
    description: 'Martillo Invertido — sombra superior larga en downtrend',
    tradingAdvice: 'Solo actuar si siguiente vela es alcista fuerte',
  },
  doji: {
    name: 'Doji', nameJP: 'Doji', type: 'neutral', strength: 1, reliability: 2, candles: 1,
    description: 'Indecisión — apertura ≈ cierre, cuerpo < 5% del rango',
    tradingAdvice: 'Esperar dirección de siguiente vela antes de actuar',
  },
  dragonflyDoji: {
    name: 'Dragonfly Doji', nameJP: 'Tonbo', type: 'bullish', strength: 3, reliability: 3, candles: 1,
    description: 'Doji Libélula — rechaza fuertemente precios bajos en downtrend',
    tradingAdvice: 'Señal de reversión alcista fuerte. SL bajo el mínimo',
  },
  gravestoneDoji: {
    name: 'Gravestone Doji', nameJP: 'Tohba', type: 'bearish', strength: 3, reliability: 3, candles: 1,
    description: 'Doji Lápida — rechaza fuertemente precios altos en uptrend',
    tradingAdvice: 'Señal de reversión bajista fuerte. SL sobre el máximo',
  },
  spinningTop: {
    name: 'Spinning Top', type: 'neutral', strength: 1, reliability: 1, candles: 1,
    description: 'Peonza — cuerpo pequeño con sombras en ambos lados',
    tradingAdvice: 'Indecisión. Esperar breakout en cualquier dirección',
  },
  bullishMarubozu: {
    name: 'Bullish Marubozu', nameJP: 'Marubozu', type: 'bullish', strength: 3, reliability: 3, candles: 1,
    description: 'Vela blanca sin sombras — compradores totalmente en control',
    tradingAdvice: 'Continuación alcista muy probable. Comprar en retrocesos menores',
  },
  bearishMarubozu: {
    name: 'Bearish Marubozu', nameJP: 'Marubozu', type: 'bearish', strength: 3, reliability: 3, candles: 1,
    description: 'Vela negra sin sombras — vendedores totalmente en control',
    tradingAdvice: 'Continuación bajista muy probable. Vender en rebotes menores',
  },
  bullishEngulfing: {
    name: 'Bullish Engulfing', nameJP: 'Tsutsumi', type: 'bullish', strength: 3, reliability: 3, candles: 2,
    description: 'Envolvente alcista — segunda vela verde engulle completamente la primera',
    tradingAdvice: 'Entrar long al cierre. SL bajo el mínimo del patrón',
  },
  bearishEngulfing: {
    name: 'Bearish Engulfing', nameJP: 'Tsutsumi', type: 'bearish', strength: 3, reliability: 3, candles: 2,
    description: 'Envolvente bajista — segunda vela roja engulle completamente la primera',
    tradingAdvice: 'Entrar short al cierre. SL sobre el máximo del patrón',
  },
  bullishHarami: {
    name: 'Bullish Harami', nameJP: 'Harami', type: 'bullish', strength: 2, reliability: 2, candles: 2,
    description: 'Harami alcista — bebé alcista dentro de vela bajista grande',
    tradingAdvice: 'Esperar confirmación. SL bajo el mínimo del patrón',
  },
  bearishHarami: {
    name: 'Bearish Harami', nameJP: 'Harami', type: 'bearish', strength: 2, reliability: 2, candles: 2,
    description: 'Harami bajista — bebé bajista dentro de vela alcista grande',
    tradingAdvice: 'Esperar confirmación. SL sobre el máximo del patrón',
  },
  haramiCrossBull: {
    name: 'Bullish Harami Cross', type: 'bullish', strength: 3, reliability: 3, candles: 2,
    description: 'Harami Cross alcista — Doji dentro de vela bajista (más fuerte)',
    tradingAdvice: 'Más confiable que Harami. Confirmar con vela alcista siguiente',
  },
  haramiCrossBear: {
    name: 'Bearish Harami Cross', type: 'bearish', strength: 3, reliability: 3, candles: 2,
    description: 'Harami Cross bajista — Doji dentro de vela alcista (más fuerte)',
    tradingAdvice: 'Más confiable que Harami. Confirmar con vela bajista siguiente',
  },
  piercingLine: {
    name: 'Piercing Line', nameJP: 'Kirikomi', type: 'bullish', strength: 3, reliability: 3, candles: 2,
    description: 'Línea Penetrante — abre bajo mínimo previo, cierra >50% en cuerpo anterior',
    tradingAdvice: 'Reversión alcista fuerte. SL bajo el mínimo de la segunda vela',
  },
  darkCloudCover: {
    name: 'Dark Cloud Cover', nameJP: 'Kabuse', type: 'bearish', strength: 3, reliability: 3, candles: 2,
    description: 'Nube Oscura — abre sobre máximo previo, cierra <50% en cuerpo anterior',
    tradingAdvice: 'Reversión bajista fuerte. SL sobre el máximo de la segunda vela',
  },
  tweezerTops: {
    name: 'Tweezer Tops', nameJP: 'Kenuki', type: 'bearish', strength: 2, reliability: 2, candles: 2,
    description: 'Techo de pinza — dos máximos iguales forman resistencia doble',
    tradingAdvice: 'SL sobre el nivel de resistencia. Confirmar con vela bajista',
  },
  tweezerBottoms: {
    name: 'Tweezer Bottoms', nameJP: 'Kenuki', type: 'bullish', strength: 2, reliability: 2, candles: 2,
    description: 'Base de pinza — dos mínimos iguales forman soporte doble',
    tradingAdvice: 'SL bajo el nivel de soporte. Confirmar con vela alcista',
  },
  onNeckLine: {
    name: 'On Neck Line', type: 'bearish', strength: 1, reliability: 2, candles: 2,
    description: 'En el Cuello — segunda vela cierra cerca del cierre anterior bajista',
    tradingAdvice: 'Continuación bajista. Vender si siguiente vela confirma',
  },
  morningStar: {
    name: 'Morning Star', nameJP: 'Sankawa Ake no Myojo', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Estrella de la Mañana — el patrón de reversión alcista más fiable de Nison',
    tradingAdvice: 'Entrar long en apertura de cuarta vela. SL bajo el mínimo de la estrella',
  },
  eveningStar: {
    name: 'Evening Star', nameJP: 'Sankawa Yoi no Myojo', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Estrella de la Tarde — el patrón de reversión bajista más fiable',
    tradingAdvice: 'Entrar short. SL sobre el máximo de la estrella',
  },
  morningDojiStar: {
    name: 'Morning Doji Star', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Estrella Doji de la Mañana — versión ultra-fuerte del Morning Star',
    tradingAdvice: 'Señal de reversión extremadamente confiable. Entrar long',
  },
  eveningDojiStar: {
    name: 'Evening Doji Star', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Estrella Doji de la Tarde — versión ultra-fuerte del Evening Star',
    tradingAdvice: 'Señal de reversión bajista extremadamente confiable',
  },
  abandonedBabyBull: {
    name: 'Abandoned Baby (Bull)', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Bebé Abandonado alcista — gap completo en estrella, muy raro',
    tradingAdvice: 'Nison: señal de reversión rarísima y muy poderosa. Entrar long agresivo',
  },
  abandonedBabyBear: {
    name: 'Abandoned Baby (Bear)', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Bebé Abandonado bajista — gap completo en estrella, muy raro',
    tradingAdvice: 'Nison: señal de reversión rarísima y muy poderosa. Entrar short agresivo',
  },
  threeWhiteSoldiers: {
    name: 'Three White Soldiers', nameJP: 'Sanpei Sanku', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Soldados Blancos — tres velas alcistas largas consecutivas',
    tradingAdvice: 'Tendencia alcista muy fuerte. Comprar en retrocesos menores',
  },
  threeBlackCrows: {
    name: 'Three Black Crows', nameJP: 'Sanba Garasu', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Cuervos Negros — tres velas bajistas largas consecutivas',
    tradingAdvice: 'Tendencia bajista muy fuerte. Vender en rebotes menores',
  },
  threeInsideUp: {
    name: 'Three Inside Up', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Dentro Arriba — Harami bullish confirmado por tercera vela',
    tradingAdvice: 'Más fiable que Harami solo. Entrar long en cierre de tercera vela',
  },
  threeInsideDown: {
    name: 'Three Inside Down', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Dentro Abajo — Harami bearish confirmado por tercera vela',
    tradingAdvice: 'Más fiable que Harami solo. Entrar short en cierre de tercera vela',
  },
  threeOutsideUp: {
    name: 'Three Outside Up', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Fuera Arriba — Engulfing bullish confirmado por tercera vela',
    tradingAdvice: 'Muy confiable. Tendencia alcista confirmada. Comprar',
  },
  threeOutsideDown: {
    name: 'Three Outside Down', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Tres Fuera Abajo — Engulfing bearish confirmado por tercera vela',
    tradingAdvice: 'Muy confiable. Tendencia bajista confirmada. Vender',
  },
  triStarBull: {
    name: 'Tri-Star Bullish', type: 'bullish', strength: 3, reliability: 3, candles: 3,
    description: 'Tri-Estrella alcista — tres Dojis consecutivos en downtrend',
    tradingAdvice: 'Muy raro y muy fuerte. Reversión alcista inminente',
  },
  triStarBear: {
    name: 'Tri-Star Bearish', type: 'bearish', strength: 3, reliability: 3, candles: 3,
    description: 'Tri-Estrella bajista — tres Dojis consecutivos en uptrend',
    tradingAdvice: 'Muy raro y muy fuerte. Reversión bajista inminente',
  },
  bullishKicker: {
    name: 'Bullish Kicker', nameJP: 'Keri Ashi', type: 'bullish', strength: 3, reliability: 3, candles: 2,
    description: 'Patada Alcista — gap al alza entre vela bajista y alcista',
    tradingAdvice: 'Nison: el patrón más poderoso. Entrar long inmediatamente',
  },
  bearishKicker: {
    name: 'Bearish Kicker', nameJP: 'Keri Ashi', type: 'bearish', strength: 3, reliability: 3, candles: 2,
    description: 'Patada Bajista — gap a la baja entre vela alcista y bajista',
    tradingAdvice: 'Nison: el patrón más poderoso bajista. Entrar short inmediatamente',
  },
  upsideTasukiGap: {
    name: 'Upside Tasuki Gap', type: 'continuation', strength: 2, reliability: 3, candles: 3,
    description: 'Gap Tasuki Alcista — gap no completamente llenado = continuación',
    tradingAdvice: 'Continuación alcista. Mantener longs si gap no se cierra',
  },
  downsideTasukiGap: {
    name: 'Downside Tasuki Gap', type: 'continuation', strength: 2, reliability: 3, candles: 3,
    description: 'Gap Tasuki Bajista — gap bajista no llenado = continuación',
    tradingAdvice: 'Continuación bajista. Mantener shorts si gap no se cierra',
  },
  risingThreeMethods: {
    name: 'Rising Three Methods', nameJP: 'Uwa-banare Sanpoo Hataraki', type: 'continuation', strength: 2, reliability: 3, candles: 5,
    description: 'Tres Métodos Alcistas — pausa en tendencia alcista, luego continuación',
    tradingAdvice: 'Mantener longs. Patrón de consolidación y continuación',
  },
  fallingThreeMethods: {
    name: 'Falling Three Methods', type: 'continuation', strength: 2, reliability: 3, candles: 5,
    description: 'Tres Métodos Bajistas — pausa en tendencia bajista, luego continuación',
    tradingAdvice: 'Mantener shorts. Patrón de consolidación y continuación',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

const body        = (k: Kline) => Math.abs(k.c - k.o)
const range       = (k: Kline) => k.h - k.l || 0.0001
const isBull      = (k: Kline) => k.c >= k.o
const isBear      = (k: Kline) => k.c < k.o
const upperShadow = (k: Kline) => k.h - Math.max(k.o, k.c)
const lowerShadow = (k: Kline) => Math.min(k.o, k.c) - k.l
const midBody     = (k: Kline) => (k.o + k.c) / 2
const isDoji      = (k: Kline) => body(k) / range(k) < 0.05
const isSmallBody = (k: Kline) => body(k) / range(k) < 0.25
const isLargeBody = (k: Kline) => body(k) / range(k) > 0.65

function isTrend(bars: Kline[], dir: 'up' | 'down'): boolean {
  if (bars.length < 3) return false
  const c = bars.map(k => k.c)
  return dir === 'up'
    ? c[c.length - 1] > c[0] * 1.005
    : c[c.length - 1] < c[0] * 0.995
}

function push(
  results: PatternDetection[],
  key: string,
  confidence: number,
  startBar: number,
  endBar: number,
  needsConfirmation: boolean,
) {
  const pattern = PATTERNS[key]
  if (pattern) results.push({ pattern, confidence, startBar, endBar, needsConfirmation })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main detection function
// ─────────────────────────────────────────────────────────────────────────────

export function detectCandlePatterns(klines: Kline[], lookback = 50): PatternDetection[] {
  const results: PatternDetection[] = []
  const recent = klines.slice(-lookback)
  const n = recent.length
  if (n < 3) return []

  for (let i = 2; i < n; i++) {
    const c0   = recent[i]
    const c1   = recent[i - 1]
    const c2   = recent[i - 2]
    const prev = recent.slice(Math.max(0, i - 7), i)
    const down = isTrend(prev, 'down')
    const up   = isTrend(prev, 'up')

    // ── Single candle patterns ──────────────────────────────────────────────

    if (down && isSmallBody(c0) && lowerShadow(c0) >= body(c0) * 2 && upperShadow(c0) <= body(c0) * 0.3)
      push(results, 'hammer', 72, i, i, true)

    if (up && isSmallBody(c0) && lowerShadow(c0) >= body(c0) * 2 && upperShadow(c0) <= body(c0) * 0.3)
      push(results, 'hangingMan', 68, i, i, true)

    if (up && isSmallBody(c0) && upperShadow(c0) >= body(c0) * 2 && lowerShadow(c0) <= body(c0) * 0.3)
      push(results, 'shootingStar', 75, i, i, true)

    if (down && isSmallBody(c0) && upperShadow(c0) >= body(c0) * 2 && lowerShadow(c0) <= body(c0) * 0.3)
      push(results, 'invertedHammer', 65, i, i, true)

    if (isSmallBody(c0) && upperShadow(c0) > range(c0) * 0.15 && lowerShadow(c0) > range(c0) * 0.15 && !isDoji(c0))
      push(results, 'spinningTop', 45, i, i, true)

    if (isDoji(c0)) {
      push(results, 'doji', (up || down) ? 65 : 45, i, i, true)
      if (upperShadow(c0) < range(c0) * 0.05 && lowerShadow(c0) > range(c0) * 0.6 && down)
        push(results, 'dragonflyDoji', 80, i, i, false)
      if (lowerShadow(c0) < range(c0) * 0.05 && upperShadow(c0) > range(c0) * 0.6 && up)
        push(results, 'gravestoneDoji', 80, i, i, false)
    }

    if (isLargeBody(c0) && upperShadow(c0) < body(c0) * 0.05 && lowerShadow(c0) < body(c0) * 0.05)
      push(results, isBull(c0) ? 'bullishMarubozu' : 'bearishMarubozu', 85, i, i, false)

    // ── Two candle patterns ─────────────────────────────────────────────────

    if (down && isBear(c1) && isBull(c0) && c0.o < c1.c && c0.c > c1.o && body(c0) > body(c1))
      push(results, 'bullishEngulfing', 82, i - 1, i, false)

    if (up && isBull(c1) && isBear(c0) && c0.o > c1.c && c0.c < c1.o && body(c0) > body(c1))
      push(results, 'bearishEngulfing', 82, i - 1, i, false)

    if (down && isBear(c1) && isBull(c0) && isSmallBody(c0) && c0.o > c1.c && c0.c < c1.o) {
      push(results, isDoji(c0) ? 'haramiCrossBull' : 'bullishHarami', isDoji(c0) ? 78 : 65, i - 1, i, true)
    }

    if (up && isBull(c1) && isBear(c0) && isSmallBody(c0) && c0.o < c1.c && c0.c > c1.o) {
      push(results, isDoji(c0) ? 'haramiCrossBear' : 'bearishHarami', isDoji(c0) ? 78 : 65, i - 1, i, true)
    }

    if (down && isBear(c1) && isLargeBody(c1) && isBull(c0) && c0.o < c1.l && c0.c > midBody(c1) && c0.c < c1.o)
      push(results, 'piercingLine', 78, i - 1, i, false)

    if (up && isBull(c1) && isLargeBody(c1) && isBear(c0) && c0.o > c1.h && c0.c < midBody(c1) && c0.c > c1.o)
      push(results, 'darkCloudCover', 78, i - 1, i, false)

    if (up && Math.abs(c0.h - c1.h) / (c0.h || 1) < 0.001 && isBear(c0) && isBull(c1))
      push(results, 'tweezerTops', 70, i - 1, i, true)

    if (down && Math.abs(c0.l - c1.l) / (c0.l || 1) < 0.001 && isBull(c0) && isBear(c1))
      push(results, 'tweezerBottoms', 70, i - 1, i, false)

    // On Neck Line
    if (down && isBear(c1) && isLargeBody(c1) && isBull(c0) && Math.abs(c0.c - c1.c) / (c1.c || 1) < 0.002)
      push(results, 'onNeckLine', 60, i - 1, i, false)

    // Kicker (most powerful — no trend required)
    if (isBear(c1) && isBull(c0) && c0.o > c1.o && isLargeBody(c1) && isLargeBody(c0))
      push(results, 'bullishKicker', 92, i - 1, i, false)

    if (isBull(c1) && isBear(c0) && c0.o < c1.o && isLargeBody(c1) && isLargeBody(c0))
      push(results, 'bearishKicker', 92, i - 1, i, false)

    // ── Three candle patterns ───────────────────────────────────────────────

    // Morning Star / Morning Doji Star
    if (down && isBear(c2) && isLargeBody(c2) && isSmallBody(c1) && c1.h < c2.l + body(c2) * 0.3
        && isBull(c0) && c0.c > midBody(c2)) {
      push(results, isDoji(c1) ? 'morningDojiStar' : 'morningStar', isDoji(c1) ? 92 : 85, i - 2, i, false)
    }

    // Evening Star / Evening Doji Star
    if (up && isBull(c2) && isLargeBody(c2) && isSmallBody(c1) && c1.l > c2.h - body(c2) * 0.3
        && isBear(c0) && c0.c < midBody(c2)) {
      push(results, isDoji(c1) ? 'eveningDojiStar' : 'eveningStar', isDoji(c1) ? 92 : 85, i - 2, i, false)
    }

    // Abandoned Baby — gaps must not overlap
    if (down && isBear(c2) && isDoji(c1) && isBull(c0)
        && c1.h < c2.l && c1.h < c0.l)  // complete gap both sides
      push(results, 'abandonedBabyBull', 95, i - 2, i, false)

    if (up && isBull(c2) && isDoji(c1) && isBear(c0)
        && c1.l > c2.h && c1.l > c0.h)
      push(results, 'abandonedBabyBear', 95, i - 2, i, false)

    // Three White Soldiers
    if (isBull(c2) && isBull(c1) && isBull(c0)
        && isLargeBody(c2) && isLargeBody(c1) && isLargeBody(c0)
        && c1.o > c2.o && c1.o < c2.c
        && c0.o > c1.o && c0.o < c1.c
        && upperShadow(c0) < body(c0) * 0.2
        && upperShadow(c1) < body(c1) * 0.2)
      push(results, 'threeWhiteSoldiers', 88, i - 2, i, false)

    // Three Black Crows
    if (isBear(c2) && isBear(c1) && isBear(c0)
        && isLargeBody(c2) && isLargeBody(c1) && isLargeBody(c0)
        && c1.o < c2.o && c1.o > c2.c
        && c0.o < c1.o && c0.o > c1.c
        && lowerShadow(c0) < body(c0) * 0.2)
      push(results, 'threeBlackCrows', 88, i - 2, i, false)

    // Three Inside Up
    if (down && isBear(c2) && isSmallBody(c1) && isBull(c1)
        && c1.o > c2.c && c1.c < c2.o   // harami
        && isBull(c0) && c0.c > c2.o)
      push(results, 'threeInsideUp', 80, i - 2, i, false)

    // Three Inside Down
    if (up && isBull(c2) && isSmallBody(c1) && isBear(c1)
        && c1.o < c2.c && c1.c > c2.o
        && isBear(c0) && c0.c < c2.o)
      push(results, 'threeInsideDown', 80, i - 2, i, false)

    // Three Outside Up
    if (down && isBear(c2) && isBull(c1) && body(c1) > body(c2)
        && c1.o < c2.c && c1.c > c2.o   // engulfing
        && isBull(c0) && c0.c > c1.c)
      push(results, 'threeOutsideUp', 83, i - 2, i, false)

    // Three Outside Down
    if (up && isBull(c2) && isBear(c1) && body(c1) > body(c2)
        && c1.o > c2.c && c1.c < c2.o
        && isBear(c0) && c0.c < c1.c)
      push(results, 'threeOutsideDown', 83, i - 2, i, false)

    // Tri-Star
    if (isDoji(c2) && isDoji(c1) && isDoji(c0)) {
      push(results, down ? 'triStarBull' : 'triStarBear', 90, i - 2, i, false)
    }

    // Upside Tasuki Gap
    if (isBull(c2) && isBull(c1) && c1.l > c2.h  // gap up
        && isBear(c0) && c0.o < c1.c && c0.c > c1.o && c0.c > c2.h) // partial fill, gap intact
      push(results, 'upsideTasukiGap', 75, i - 2, i, false)

    // Downside Tasuki Gap
    if (isBear(c2) && isBear(c1) && c1.h < c2.l  // gap down
        && isBull(c0) && c0.o > c1.c && c0.c < c1.o && c0.c < c2.l) // partial fill, gap intact
      push(results, 'downsideTasukiGap', 75, i - 2, i, false)

    // Rising Three Methods (needs 5 bars — use i >= 4)
    if (i >= 4) {
      const c3 = recent[i - 3]
      const c4 = recent[i - 4]
      if (isBull(c4) && isLargeBody(c4)
          && isBear(c3) && isSmallBody(c3) && c3.h < c4.h && c3.l > c4.l
          && isBear(c2) && isSmallBody(c2) && c2.h < c4.h && c2.l > c4.l
          && isBear(c1) && isSmallBody(c1) && c1.h < c4.h && c1.l > c4.l
          && isBull(c0) && isLargeBody(c0) && c0.c > c4.c)
        push(results, 'risingThreeMethods', 78, i - 4, i, false)

      if (isBear(c4) && isLargeBody(c4)
          && isBull(c3) && isSmallBody(c3) && c3.h < c4.h && c3.l > c4.l
          && isBull(c2) && isSmallBody(c2) && c2.h < c4.h && c2.l > c4.l
          && isBull(c1) && isSmallBody(c1) && c1.h < c4.h && c1.l > c4.l
          && isBear(c0) && isLargeBody(c0) && c0.c < c4.c)
        push(results, 'fallingThreeMethods', 78, i - 4, i, false)
    }
  }

  // Deduplicate: keep highest confidence per pattern name per bar region
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .filter((r, idx, arr) =>
      idx === arr.findIndex(x =>
        x.pattern.name === r.pattern.name && Math.abs(x.endBar - r.endBar) < 3
      )
    )
    .slice(0, 8)
}
