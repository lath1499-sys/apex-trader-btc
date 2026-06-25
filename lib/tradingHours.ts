// APEX — Trading Hours & Session Quality
// Agents know when NOT to trade. Low liquidity = bad signals.

import { getActiveBlockingEvent } from './macroCalendar'

export interface TradingSession {
  name:           string
  utcStart:       number
  utcEnd:         number
  quality:        'optimal' | 'good' | 'caution' | 'avoid'
  reason:         string
  allowScalp:     boolean
  allowDayTrade:  boolean
  allowSwing:     boolean
  minConfidence:  'ALTA' | 'MEDIA' | 'BAJA'
}

export const TRADING_SESSIONS: TradingSession[] = [
  {
    name: 'Asia Deep Night (dead zone)',
    utcStart: 22, utcEnd: 6,   // narrowed from 21-01 to 22-06 (was blocking 8h, now 8h but tighter night)
    quality: 'avoid',
    reason: 'Liquidez minima, spreads amplios, movimientos manipulados',
    allowScalp: false, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'Asia Opening',
    utcStart: 1, utcEnd: 4,
    quality: 'caution',
    reason: 'Liquidez baja, tendencia a falsas rupturas',
    allowScalp: false, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'Asia Session',
    utcStart: 4, utcEnd: 7,
    quality: 'caution',
    reason: 'Rango asiatico - generalmente consolidacion',
    allowScalp: false, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'Frankfurt Pre-Market',
    utcStart: 7, utcEnd: 8,
    quality: 'good',
    reason: 'Volatilidad Europa comienza',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'London Open (OPTIMAL)',
    utcStart: 8, utcEnd: 11,
    quality: 'optimal',
    reason: 'Mayor liquidez europea, setups de alta probabilidad',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'BAJA',
  },
  {
    name: 'London Mid',
    utcStart: 11, utcEnd: 13,
    quality: 'good',
    reason: 'Sesion europea activa, buen volumen',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'London-NY Overlap (BEST)',
    utcStart: 13, utcEnd: 16,
    quality: 'optimal',
    reason: 'Mayor liquidez global, mejores setups del dia',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'BAJA',
  },
  {
    name: 'NY Afternoon',
    utcStart: 16, utcEnd: 18,
    quality: 'good',
    reason: 'Buen volumen, tendencias claras',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
  {
    name: 'NY Close / Rollover',
    utcStart: 18, utcEnd: 21,
    quality: 'caution',
    reason: 'Cierre NY, posible reversion de posiciones, spreads ampliandose',
    allowScalp: true, allowDayTrade: true, allowSwing: true,
    minConfidence: 'MEDIA',
  },
]

export function getCurrentTradingSession(): TradingSession {
  const utcH = new Date().getUTCHours()
  return TRADING_SESSIONS.find(s => {
    if (s.utcStart < s.utcEnd) return utcH >= s.utcStart && utcH < s.utcEnd
    // Wraps midnight (e.g. 21-1)
    return utcH >= s.utcStart || utcH < s.utcEnd
  }) ?? TRADING_SESSIONS[0]
}

const CONF_RANK: Record<string, number> = { ALTA: 3, MEDIA: 2, BAJA: 1 }

export function shouldGenerateSignal(
  tradeType: 'Scalp' | 'DayTrade' | 'Swing',
  confidence: string,
): boolean {
  // Block during macro events (FOMC / CPI / NFP)
  const macroBlock = getActiveBlockingEvent()
  if (macroBlock) {
    // Swing trades survive macro events — only Scalp and DayTrade are blocked
    if (tradeType !== 'Swing') return false
  }

  const session = getCurrentTradingSession()

  if (tradeType === 'Scalp'    && !session.allowScalp)    return false
  if (tradeType === 'DayTrade' && !session.allowDayTrade)  return false
  if (tradeType === 'Swing'    && !session.allowSwing)     return false

  const minRank    = CONF_RANK[session.minConfidence] ?? 1
  const signalRank = CONF_RANK[confidence]            ?? 1
  return signalRank >= minRank
}

export function getSessionAdvice(session: TradingSession): string {
  const badges: Record<TradingSession['quality'], string> = {
    optimal: 'OPTIMAL',
    good:    'BUENO',
    caution: 'PRECAUCION',
    avoid:   'EVITAR',
  }
  return `[${badges[session.quality]}] ${session.name}: ${session.reason}`
}

export function getSessionColor(quality: TradingSession['quality']): string {
  return { optimal: '#22c55e', good: '#eab308', caution: '#f97316', avoid: '#ef4444' }[quality]
}
