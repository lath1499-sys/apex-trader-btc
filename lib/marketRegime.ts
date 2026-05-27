// APEX — Market Regime Detection
// Classifies the current market environment before any signal is generated.
// Wrong regime = low probability. Filter first, signal second.

import { ema as calcEMA } from './indicators'
import type { Kline }     from './types'

export type MarketRegime =
  | 'STRONG_TREND_UP'
  | 'WEAK_TREND_UP'
  | 'STRONG_TREND_DOWN'
  | 'WEAK_TREND_DOWN'
  | 'RANGING'
  | 'BREAKOUT_IMMINENT'
  | 'HIGH_VOLATILITY'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'

export interface RegimeAnalysis {
  regime:             MarketRegime
  adx:                number
  adxTrend:           'rising' | 'falling' | 'flat'
  volatilityPct:      number   // ATR/price * 100
  bbWidthPct:         number
  trendStrength:      number   // 0-100
  description:        string
  allowedSignalTypes: ('Scalp' | 'DayTrade' | 'Swing')[]
  signalBias:         'long_only' | 'short_only' | 'both' | 'no_signal'
  confidence:         number   // 0-100
}

// ── ADX (Average Directional Index) ────────────────────────────────────────

function calcADX(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period * 2) return 25

  const trueRanges: number[] = []
  const plusDMs:    number[] = []
  const minusDMs:   number[] = []

  for (let i = 1; i < highs.length; i++) {
    const highDiff = highs[i] - highs[i - 1]
    const lowDiff  = lows[i - 1] - lows[i]
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    )
    trueRanges.push(tr)
    plusDMs.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0)
    minusDMs.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0)
  }

  // Wilder smoothing (cumulative EMA variant)
  function wilderSmooth(arr: number[], p: number): number[] {
    let val = arr.slice(0, p).reduce((a, b) => a + b, 0)
    const result = [val]
    for (let i = p; i < arr.length; i++) {
      val = val - val / p + arr[i]
      result.push(val)
    }
    return result
  }

  const atr14   = wilderSmooth(trueRanges, period)
  const plusDI  = wilderSmooth(plusDMs,  period).map((v, i) => atr14[i] ? (v / atr14[i]) * 100 : 0)
  const minusDI = wilderSmooth(minusDMs, period).map((v, i) => atr14[i] ? (v / atr14[i]) * 100 : 0)
  const dx      = plusDI.map((p, i) => {
    const sum = p + minusDI[i]
    return sum ? Math.abs(p - minusDI[i]) / sum * 100 : 0
  })

  const adxValues = wilderSmooth(dx, period)
  return adxValues[adxValues.length - 1] ?? 25
}

// ── Main export ─────────────────────────────────────────────────────────────

export function detectMarketRegime(klines: Kline[]): RegimeAnalysis {
  if (!klines || klines.length < 50) {
    return {
      regime: 'RANGING', adx: 20, adxTrend: 'flat', volatilityPct: 1,
      bbWidthPct: 2, trendStrength: 50,
      description: 'Datos insuficientes para análisis de régimen',
      allowedSignalTypes: ['DayTrade'], signalBias: 'both', confidence: 30,
    }
  }

  const highs  = klines.map(k => k.h)
  const lows   = klines.map(k => k.l)
  const closes = klines.map(k => k.c)
  const price  = closes[closes.length - 1]

  // ADX current and 3-bar ago for trend detection
  const adx     = calcADX(highs, lows, closes, 14)
  const adxPrev = calcADX(highs.slice(0, -3), lows.slice(0, -3), closes.slice(0, -3), 14)
  const adxTrend: 'rising' | 'falling' | 'flat' =
    adx > adxPrev + 1 ? 'rising' : adx < adxPrev - 1 ? 'falling' : 'flat'

  // EMAs
  const ema50Arr  = calcEMA(closes, 50)
  const ema200Arr = calcEMA(closes, 200)
  const ema50l    = ema50Arr[ema50Arr.length - 1]
  const ema200l   = ema200Arr[ema200Arr.length - 1]

  // Bollinger Band Width
  const bbSlice = closes.slice(-20)
  const sma20   = bbSlice.reduce((a, b) => a + b, 0) / 20
  const std20   = Math.sqrt(bbSlice.reduce((a, v) => a + (v - sma20) ** 2, 0) / 20)
  const bbWidthPct = (std20 * 4 / sma20) * 100

  // ATR volatility
  const atrSlice = klines.slice(-14)
  const atrVals  = atrSlice.map((k, i, arr) =>
    i === 0
      ? k.h - k.l
      : Math.max(k.h - k.l, Math.abs(k.h - arr[i - 1].c), Math.abs(k.l - arr[i - 1].c)),
  )
  const atr            = atrVals.reduce((a, b) => a + b, 0) / atrVals.length
  const volatilityPct  = (atr / price) * 100

  // Determine regime
  let regime:             MarketRegime
  let allowedSignalTypes: ('Scalp' | 'DayTrade' | 'Swing')[]
  let signalBias:         RegimeAnalysis['signalBias']

  if (adx < 18 && bbWidthPct < 1.0) {
    regime             = 'BREAKOUT_IMMINENT'
    allowedSignalTypes = ['Scalp']
    signalBias         = 'both'
  } else if (adx < 20) {
    regime             = 'RANGING'
    allowedSignalTypes = ['Scalp', 'DayTrade']
    signalBias         = 'both'
  } else if (adx > 30 && price > ema50l && ema50l > ema200l) {
    regime             = 'STRONG_TREND_UP'
    allowedSignalTypes = ['DayTrade', 'Swing']
    signalBias         = 'both'
  } else if (adx > 20 && price > ema50l) {
    regime             = 'WEAK_TREND_UP'
    allowedSignalTypes = ['Scalp', 'DayTrade', 'Swing']
    signalBias         = 'both'
  } else if (adx > 30 && price < ema50l && ema50l < ema200l) {
    regime             = 'STRONG_TREND_DOWN'
    allowedSignalTypes = ['DayTrade', 'Swing']
    signalBias         = 'both'
  } else if (adx > 20 && price < ema50l) {
    regime             = 'WEAK_TREND_DOWN'
    allowedSignalTypes = ['Scalp', 'DayTrade', 'Swing']
    signalBias         = 'both'
  } else if (volatilityPct > 2.5) {
    regime             = 'HIGH_VOLATILITY'
    allowedSignalTypes = ['DayTrade']
    signalBias         = 'both'
  } else {
    regime             = 'RANGING'
    allowedSignalTypes = ['Scalp', 'DayTrade']
    signalBias         = 'both'
  }

  const descriptions: Record<MarketRegime, string> = {
    STRONG_TREND_UP:   'Tendencia alcista fuerte — longs preferidos, shorts en sobrecompra extrema',
    WEAK_TREND_UP:     'Tendencia alcista débil — longs con confluencias altas',
    STRONG_TREND_DOWN: 'Tendencia bajista fuerte — shorts + longs contra-tendencia con condiciones extremas',
    WEAK_TREND_DOWN:   'Tendencia bajista débil — shorts con confluencias altas',
    RANGING:           'Mercado lateral — mean reversion, evitar breakouts falsos',
    BREAKOUT_IMMINENT: 'Compresión extrema — breakout inminente, preparar órdenes en ambos lados',
    HIGH_VOLATILITY:   'Alta volatilidad — reducir tamaño, stops más amplios',
    ACCUMULATION:      'Acumulación — paciencia, esperar confirmación de dirección',
    DISTRIBUTION:      'Distribución — posible techo, reducir longs',
  }

  return {
    regime,
    adx:               Math.round(adx * 10) / 10,
    adxTrend,
    volatilityPct:     Math.round(volatilityPct * 100) / 100,
    bbWidthPct:        Math.round(bbWidthPct * 100) / 100,
    trendStrength:     Math.min(100, Math.round((adx / 50) * 100)),
    description:       descriptions[regime],
    allowedSignalTypes,
    signalBias,
    confidence:        Math.min(95, 50 + (adx > 25 ? 30 : 10) + (volatilityPct > 1 ? 10 : 0)),
  }
}
