// NTFY — free push notifications, direct browser → ntfy.sh (CORS supported)
// User installs ntfy app, subscribes to their unique topic
// Doc: https://ntfy.sh/docs/
import type { StopUpdate } from './stopManagement'

// HTTP headers must be ISO-8859-1 — strip all non-ASCII chars (emojis, em-dash, etc.)
// Emojis belong in the body only, never in headers.
function sanitizeHeader(s: string): string {
  return s.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim() || 'APEX'
}
// Legacy alias
const toAsciiHeader = sanitizeHeader

export async function sendNtfy(
  topic:    string,
  title:    string,
  message:  string,
  priority: 1 | 2 | 3 | 4 | 5 = 3,
  tags:     string[] = [],
): Promise<boolean> {
  if (!topic || topic.trim() === '') {
    console.warn('[APEX NTFY] No topic configured — skipping push')
    return false
  }
  try {
    const res = await fetch(`https://ntfy.sh/${topic.trim()}`, {
      method: 'POST',
      headers: {
        'Title':        toAsciiHeader(title),
        'Priority':     String(priority),
        'Tags':         tags.join(','),     // tag names are always ASCII emoji-shortcodes
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: message,  // body can be UTF-8 — emojis here are fine
    })
    if (!res.ok) {
      console.error(`[APEX NTFY] Failed: ${res.status} ${res.statusText}`)
      return false
    }
    console.log('[APEX NTFY] Sent OK →', topic)
    return true
  } catch (err) {
    console.error('[APEX NTFY] Network error:', err)
    return false
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

export function getNtfyTopic(): string | null {
  try {
    const t = localStorage.getItem('apex_ntfy_topic')
    return t && t.trim() !== '' ? t.trim() : null
  } catch {
    return null
  }
}

export function isNtfyEnabled(settingKey: string): boolean {
  try {
    const s = JSON.parse(localStorage.getItem('apex_ntfy_settings') ?? '{}') as Record<string, boolean>
    // Default TRUE for all — opt-out model
    return s[settingKey] !== false
  } catch {
    return true
  }
}

export interface NtfySettings {
  newSignalNormal: boolean
  newSignalScalp:  boolean
  tp1Hit:          boolean
  tp2Hit:          boolean
  tp3Hit:          boolean
  slHit:           boolean
  slWarning:       boolean
  expiryWarning:   boolean
  trailingSL:      boolean
  autoClose:       boolean
  limitOrder:      boolean
  analysis30m:     boolean
  analysis4h:      boolean
}

const DEFAULT_SETTINGS: NtfySettings = {
  newSignalNormal: true,
  newSignalScalp:  true,
  tp1Hit:          true,
  tp2Hit:          true,
  tp3Hit:          true,
  slHit:           true,
  slWarning:       true,
  expiryWarning:   true,
  trailingSL:      true,
  autoClose:       true,
  limitOrder:      true,
  analysis30m:     false,
  analysis4h:      false,
}

export function getNtfySettings(): NtfySettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('apex_ntfy_settings') ?? '{}') }
  } catch { return DEFAULT_SETTINGS }
}

export function saveNtfySettings(s: NtfySettings): void {
  try { localStorage.setItem('apex_ntfy_settings', JSON.stringify(s)) } catch {}
}

// ── Pre-built notification templates ─────────────────────────────────────────

export function ntfyNewSignal(signal: {
  side: string; confidence: string; tradeType?: string
  entry: number; sl: number; tp1: number; tp2: number; tp3?: number
  reasons?: Array<{ txt: string } | string>; score?: number; maxLev?: number
}): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('newSignalNormal')) return
  const reasons = (signal.reasons ?? [])
    .slice(0, 3)
    .map(r => (typeof r === 'string' ? r : r.txt))
    .join('\n')
  sendNtfy(
    topic,
    `APEX SIGNAL: ${signal.side} BTC - ${signal.confidence}`,
    [
      `${signal.side === 'LONG' ? '▲ LONG' : '▼ SHORT'} BTC/USDT PERP`,
      `Tipo: ${signal.tradeType ?? 'DayTrade'} | Confianza: ${signal.confidence}`,
      '',
      `Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `SL: $${Math.round(signal.sl).toLocaleString()}`,
      `TP1: $${Math.round(signal.tp1).toLocaleString()}`,
      `TP2: $${Math.round(signal.tp2).toLocaleString()}`,
      signal.tp3 ? `TP3: $${Math.round(signal.tp3).toLocaleString()}` : '',
      '',
      reasons,
      `Score: ${signal.score ?? '?'} | Leverage: ${signal.maxLev ?? '?'}x`,
    ].filter(l => l !== '').join('\n'),
    signal.confidence === 'ALTA' ? 5 : signal.confidence === 'MEDIA' ? 3 : 2,
    [signal.side === 'LONG' ? 'green_circle' : 'red_circle', 'chart_with_upwards_trend'],
  )
}

export function ntfySignalClosed(signal: {
  side: string; entry: number; closePrice?: number
}, pnl: number, reason: string): void {
  const topic = getNtfyTopic()
  if (!topic) return
  sendNtfy(
    topic,
    `${pnl >= 0 ? 'WIN' : 'LOSS'} - APEX ${signal.side} cerrado`,
    [
      `${signal.side} BTC cerrado`,
      `Razón: ${reason}`,
      '',
      `Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `Cierre: $${Math.round(signal.closePrice ?? signal.entry).toLocaleString()}`,
      `P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`,
    ].join('\n'),
    pnl >= 0 ? 4 : 5,
    [pnl >= 0 ? 'white_check_mark' : 'x', 'moneybag'],
  )
}

export function ntfyScalpSignal(signal: {
  side: string; entry: number; sl: number; tp1: number
  killzone?: string | null; duration?: string
  cvdSignal?: string | null; qualityLabel?: string
}): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('newSignalScalp')) return
  sendNtfy(
    topic,
    `SCALP ${signal.side} BTC - ${signal.killzone ?? 'KZ'}`,
    [
      `${signal.side} BTC Scalp`,
      `Killzone: ${signal.killzone ?? 'N/A'}`,
      `Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `SL: $${Math.round(signal.sl).toLocaleString()}`,
      `TP1: $${Math.round(signal.tp1).toLocaleString()}`,
      `Duración: ${signal.duration ?? '15-30min'}`,
      `CVD: ${signal.cvdSignal ?? 'N/A'}`,
      `Calidad: ${signal.qualityLabel ?? 'N/A'}`,
    ].join('\n'),
    5,
    ['zap', signal.side === 'LONG' ? 'green_circle' : 'red_circle'],
  )
}

export function ntfyAutoClose(signal: {
  side: string; entry: number; closePrice?: number
}, reason: string, pnl: number): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('autoClose')) return
  sendNtfy(
    topic,
    `Auto-cierre - ${signal.side} ${pnl >= 0 ? 'WIN' : 'LOSS'}`,
    [
      `El agente cerró automáticamente tu ${signal.side}`,
      `Razón: ${reason}`,
      `P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`,
      `Precio de cierre: $${Math.round(signal.closePrice ?? signal.entry).toLocaleString()}`,
    ].join('\n'),
    5,
    ['robot', pnl >= 0 ? 'white_check_mark' : 'x'],
  )
}

export function ntfyMarketAnalysis(text: string, period: '30m' | '4h'): void {
  const topic = getNtfyTopic()
  const key   = period === '30m' ? 'analysis30m' : 'analysis4h'
  if (!topic || !isNtfyEnabled(key)) return
  sendNtfy(
    topic,
    period === '30m' ? 'APEX Analisis 30min' : 'APEX Analisis 4H',
    text,
    2,
    ['bar_chart'],
  )
}

export function ntfyTest(topic: string): Promise<boolean> {
  return sendNtfy(
    topic,
    'APEX Trader — Test OK',
    `Notificaciones NTFY funcionando correctamente.\nAhora recibirás señales de trading en tu teléfono.\nTema: ${topic}`,
    3,
    ['white_check_mark', 'bell'],
  )
}

// ── TP Hit ───────────────────────────────────────────────────────────────────

export function ntfyTPHit(
  signal:   { side: string; entry: number; tradeType?: string },
  tpLevel:  'tp1' | 'tp2' | 'tp3',
  price:    number,
  pnl:      number,
): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled(tpLevel === 'tp1' ? 'tp1Hit' : tpLevel === 'tp2' ? 'tp2Hit' : 'tp3Hit')) return
  const labels    = { tp1: 'TP1', tp2: 'TP2', tp3: 'TP3' }         // ASCII only — used in headers
  const bodyLabels = { tp1: 'TP1 🎯', tp2: 'TP2 🎯🎯', tp3: 'TP3 🏆' } // emojis OK in body
  const emojis    = { tp1: 'dart', tp2: 'tada', tp3: 'trophy' }
  sendNtfy(
    topic,
    `${labels[tpLevel]} ALCANZADO - ${signal.side} BTC`,
    [
      `${signal.side} BTC/USDT llegó a ${bodyLabels[tpLevel]}`,
      '',
      `📍 Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `✅ ${bodyLabels[tpLevel]}: $${Math.round(price).toLocaleString()}`,
      '',
      `P&L: +${pnl.toFixed(2)}%`,
      `Tipo: ${signal.tradeType ?? 'DayTrade'}`,
      tpLevel !== 'tp3' ? '⚠️ Considera mover SL a breakeven ahora.' : '🏆 Objetivo maximo alcanzado.',
    ].join('\n'),
    tpLevel === 'tp3' ? 5 : 4,
    ['white_check_mark', emojis[tpLevel], 'moneybag'],
  )
}

// ── SL Hit ───────────────────────────────────────────────────────────────────

export function ntfySLHit(
  signal: { side: string; entry: number; sl: number; tradeType?: string },
  price:  number,
  pnl:    number,
): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('slHit')) return
  sendNtfy(
    topic,
    `STOP LOSS TOCADO - ${signal.side} BTC`,
    [
      `Tu ${signal.side} BTC fue cerrado por Stop Loss`,
      '',
      `📍 Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `🔴 SL hit:  $${Math.round(price).toLocaleString()}`,
      '',
      `P&L: ${pnl.toFixed(2)}%`,
      `Tipo: ${signal.tradeType ?? 'DayTrade'}`,
      '',
      'El agente analizará la próxima oportunidad.',
    ].join('\n'),
    5,
    ['x', 'red_circle', 'chart_with_downwards_trend'],
  )
}

// ── SL Warning (approaching) ─────────────────────────────────────────────────

export function ntfyApproachingSL(
  signal:      { side: string; entry: number; sl: number },
  currentPrice: number,
  distancePct:  number,
): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('slWarning')) return
  sendNtfy(
    topic,
    `PRECIO CERCA DEL SL - ${signal.side} BTC`,
    [
      `Tu ${signal.side} se acerca al Stop Loss`,
      '',
      `📍 Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `💰 Precio:  $${Math.round(currentPrice).toLocaleString()}`,
      `🔴 SL:      $${Math.round(signal.sl).toLocaleString()}`,
      '',
      `Distancia al SL: ${distancePct.toFixed(2)}%`,
      '',
      'Decide ahora: ¿mantener o cerrar manual?',
    ].join('\n'),
    4,
    ['warning', 'bell'],
  )
}

// ── Expiry Warning ────────────────────────────────────────────────────────────

export function ntfyAboutToExpire(
  signal:     { side: string; entry: number; tradeType?: string },
  minutesLeft: number,
): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('expiryWarning')) return
  sendNtfy(
    topic,
    `SENAL EXPIRA EN ${minutesLeft}min - ${signal.side} BTC`,
    [
      `Tu ${signal.side} ${signal.tradeType ?? ''} está por expirar`,
      '',
      `📍 Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `⏱ Tiempo restante: ~${minutesLeft} minutos`,
      '',
      'El agente cerrará automáticamente si no actúas.',
      'Opciones: cerrar en app o dejar que expire.',
    ].join('\n'),
    3,
    ['alarm_clock', 'bell'],
  )
}

// ── Trailing SL suggestion ────────────────────────────────────────────────────

export function ntfyTrailingSL(
  signal: { side: string; entry: number; sl: number },
  newSL:  number,
): void {
  const topic = getNtfyTopic()
  if (!topic || !isNtfyEnabled('trailingSL')) return
  sendNtfy(
    topic,
    `MUEVE SL A BREAKEVEN - ${signal.side} BTC`,
    [
      'TP1 alcanzado - protege el trade',
      '',
      `Mueve tu SL a: $${Math.round(newSL).toLocaleString()}`,
      '(breakeven o cerca de la entrada)',
      '',
      `Entrada: $${Math.round(signal.entry).toLocaleString()}`,
      `SL actual: $${Math.round(signal.sl).toLocaleString()}`,
      `SL sugerido: $${Math.round(newSL).toLocaleString()}`,
    ].join('\n'),
    3,
    ['bulb', 'shield'],
  )
}

// ── Stop Management notification ─────────────────────────────────────────────

export function ntfyStopMoved(
  signal:    { side: string; idea?: { price: number; tradeType?: string }; entry?: number; tradeType?: string },
  update:    StopUpdate,
): void {
  const topic = getNtfyTopic() ?? ''
  if (!topic || !isNtfyEnabled('trailingSL')) return

  const ACTION_LABELS: Record<StopUpdate['action'], string> = {
    move_to_breakeven:      'BREAKEVEN ACTIVADO',
    trail_to_tp1:           'TRAILING A TP1',
    trail_tighter:          'TRAILING AJUSTADO',
    trail_behind_structure: 'TRAILING ESTRUCTURA',
  }

  const entry = signal.idea?.price ?? (signal as { entry?: number }).entry ?? 0
  const title = sanitizeHeader(`${ACTION_LABELS[update.action]} - ${signal.side} BTC`)

  sendNtfy(
    topic,
    title,
    [
      `Stop Loss actualizado en tu ${signal.side} BTC`,
      ``,
      `Accion: ${update.reason}`,
      ``,
      `SL anterior: $${Math.round(update.oldSL).toLocaleString()}`,
      `SL nuevo:    $${Math.round(update.newSL).toLocaleString()}`,
      `P&L protegido: ${update.pnlProtected >= 0 ? '+' : ''}${update.pnlProtected.toFixed(2)}%`,
      ``,
      `Entrada original: $${Math.round(entry).toLocaleString()}`,
    ].join('\n'),
    3,
    ['shield'],
  )
}

// Legacy alias — used by hooks/useSignalHistory.ts (auto-close path)
export const ntfyTemplates = {
  autoCloseAlert: (
    signal: { side: string; entry: number; closePrice?: number },
    reason: string,
    pnl:    number,
  ) => {
    ntfyAutoClose(signal, reason, pnl)
    return Promise.resolve(true)
  },
  testNotification: (topic: string) => ntfyTest(topic),
}

// Legacy compat for PriceAlertPanel (getNtfySettings / saveNtfySettings already exported above)
