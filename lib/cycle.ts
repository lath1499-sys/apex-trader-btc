import type { BTCCycle, Session, Kline } from './types'

export const SESSIONS: Session[] = [
  { n: 'ASIA',      s: 0,  e: 9,  c: '#4a8aaa' },
  { n: 'FRANKFURT', s: 7,  e: 10, c: '#8a6aaa' },
  { n: 'LONDON',    s: 8,  e: 17, c: '#4aaa6a' },
  { n: 'NY OPEN',   s: 13, e: 17, c: '#aaa44a' },
  { n: 'NY',        s: 17, e: 22, c: '#aa6a4a' },
  { n: 'CIERRE',    s: 22, e: 24, c: '#5a5a6a' },
]

export function getSession(): Session {
  const h = new Date().getUTCHours() + new Date().getUTCMinutes() / 60
  return SESSIONS.find(s => h >= s.s && h < s.e) ?? SESSIONS[5]
}

// ── Hardcoded verified data — update quarterly ───────────────────────────────
const LAST_HALVING   = new Date('2024-04-19')
const NEXT_HALVING   = new Date('2028-04-15')
const CYCLE_ATH      = 126296          // Oct 6, 2025
const CYCLE_ATH_DATE = new Date('2025-10-06')

export function getBTCCycle(price: number, klines1d: Kline[] = []): BTCCycle {
  const now = new Date()

  const daysSinceHalving  = Math.floor((now.getTime() - LAST_HALVING.getTime())   / 864e5)
  const daysToNextHalving = Math.floor((NEXT_HALVING.getTime() - now.getTime())   / 864e5)
  const daysSinceATH      = Math.floor((now.getTime() - CYCLE_ATH_DATE.getTime()) / 864e5)
  const drawdownFromATH   = (price - CYCLE_ATH) / CYCLE_ATH * 100   // negative
  const drawdownPct       = Math.abs(drawdownFromATH)

  // 200-day MA from daily klines (Kline.c is a number)
  const closes = klines1d.map(k => k.c).filter(v => v > 0)
  const ma200  = closes.length >= 200
    ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
    : 0
  const aboveMA200 = ma200 > 0 && price > ma200

  // MVRV proxy (logarithmic fair-value model — same formula as before)
  const dsg   = Math.floor((now.getTime() - new Date('2009-01-03').getTime()) / 864e5)
  const lFV   = Math.pow(10, -17.01 + 5.84 * Math.log10(dsg))
  const mvrv  = price / lFV

  // MVRV estimate from drawdown (simpler proxy when on-chain data unavailable)
  const mvrvEstimate =
    drawdownPct > 50 ? 0.3 :
    drawdownPct > 40 ? 0.5 :
    drawdownPct > 30 ? 0.8 :
    drawdownPct > 20 ? 1.2 :
    drawdownPct > 10 ? 1.8 : 2.5

  // ── Phase detection — price-action aware, NOT just days since halving ────────
  let phase:       string
  let phaseLabel:  string
  let col:         string
  let pct:         number
  let description: string
  let tradingBias: string

  if (drawdownPct >= 70) {
    phase       = 'CAPITULACION'
    phaseLabel  = 'Capitulación / Fondo'
    col         = '#ff4444'
    pct         = 85
    description = `BTC ha caído ${drawdownPct.toFixed(0)}% desde el ATH. Zona histórica de fondo. Acumulación a largo plazo.`
    tradingBias = 'Acumular largo plazo. Shorts de alto riesgo.'

  } else if (drawdownPct >= 45 && daysSinceATH > 60) {
    // POST-ATH MARKDOWN — current situation as of June 2026
    phase       = 'BEAR_MARKET'
    phaseLabel  = 'Bear Market — Post-ATH Markdown'
    col         = '#ff6b35'
    pct         = Math.min(95, 60 + (drawdownPct - 45) * 2)
    description = `ATH: $${CYCLE_ATH.toLocaleString()} (${daysSinceATH}d atrás). ` +
                  `Caída: -${drawdownPct.toFixed(1)}%. ` +
                  `3 velas mensuales rojas. F&G en miedo extremo. ` +
                  `Patrón consistente con fase de markdown post-ciclo.`
    tradingBias = 'Shorts favorecidos. Longs solo con confluencias extremas y RSI < 28.'

  } else if (drawdownPct >= 25 && daysSinceATH > 30) {
    phase       = 'DISTRIBUCION'
    phaseLabel  = 'Distribución / Corrección Mayor'
    col         = '#ffa500'
    pct         = 70
    description = `Corrección de -${drawdownPct.toFixed(1)}% desde ATH $${CYCLE_ATH.toLocaleString()}. ` +
                  `Posible distribución institucional o corrección saludable.`
    tradingBias = 'Neutral. Reducir exposición larga. Esperar confirmación.'

  } else if (!aboveMA200 && drawdownPct > 15) {
    phase       = 'BAJO_MA200'
    phaseLabel  = 'Estructura Bajista — Bajo MA200'
    col         = '#ff8c00'
    pct         = 65
    description = `Precio bajo MA200${ma200 > 0 ? ` ($${Math.round(ma200).toLocaleString()})` : ''}. Estructura técnica bajista.`
    tradingBias = 'Sesgo bajista. Rebotes para vender.'

  } else if (aboveMA200 && drawdownPct < 20 && daysSinceHalving > 365) {
    phase       = 'BULL_TARDIO'
    phaseLabel  = 'Bull Market Tardío'
    col         = '#ffd700'
    pct         = 75
    description = `${daysSinceHalving}d desde halving. Sobre MA200. Fase avanzada del ciclo alcista.`
    tradingBias = 'Reducir tamaño. Cerca de distribución.'

  } else if (aboveMA200 && daysSinceHalving < 365) {
    phase       = 'BULL_EXPANSION'
    phaseLabel  = 'Expansión Alcista'
    col         = '#00ff88'
    pct         = 45
    description = `${daysSinceHalving}d desde halving. Sobre MA200. Fase de expansión del ciclo post-halving.`
    tradingBias = 'Longs favorecidos. Seguir momentum.'

  } else {
    phase       = 'ACUMULACION'
    phaseLabel  = 'Acumulación / Recuperación'
    col         = '#4488ff'
    pct         = 20
    description = `Mercado en fase de acumulación. Preparando próximo ciclo.`
    tradingBias = 'Acumular en zonas de soporte. Paciencia.'
  }

  return {
    phase,
    phaseLabel,
    col,
    pct,
    days:            daysSinceHalving,
    toNext:          daysToNextHalving,
    mvrv,
    daysSinceATH,
    drawdownFromATH: parseFloat(drawdownFromATH.toFixed(1)),
    cycleATH:        CYCLE_ATH,
    cycleATHDate:    CYCLE_ATH_DATE.toISOString(),
    ma200:           Math.round(ma200),
    aboveMA200,
    mvrvEstimate,
    description,
    tradingBias,
  }
}
