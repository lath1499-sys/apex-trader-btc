// circuitBreaker.ts — protects capital from drawdown spirals
// Checks daily loss, weekly loss, and consecutive losses against CapitalConfig limits.
// If any limit is breached, new signal generation is blocked for the remainder of the period.

import type { SignalRecord } from './types'
import type { CapitalConfig } from './capitalManagement'

export interface CircuitBreakerResult {
  blocked:     boolean
  reason:      string | null
  dailyPnl:    number   // % sum of closed signals today
  weeklyPnl:   number   // % sum of closed signals this week
  consecLosses: number  // streak of consecutive SL hits
}

const TERMINAL = new Set(['sl_hit', 'tp1_hit', 'tp2_hit', 'tp3_hit', 'breakeven', 'closed_manual'])

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth()      === now.getUTCMonth()
    && d.getUTCDate()       === now.getUTCDate()
}

function isThisWeek(iso: string): boolean {
  const d   = new Date(iso)
  const now = new Date()
  // ISO week: Monday-based, compare monday of each week
  const monday = (dt: Date) => {
    const day = dt.getUTCDay() || 7
    const m   = new Date(dt)
    m.setUTCDate(dt.getUTCDate() - day + 1)
    m.setUTCHours(0, 0, 0, 0)
    return m.getTime()
  }
  return monday(d) === monday(now)
}

export function checkCircuitBreaker(
  signals:  SignalRecord[],
  config:   CapitalConfig,
): CircuitBreakerResult {
  // Only closed signals with a P&L value contribute
  const closed = signals.filter(s => TERMINAL.has(s.status) && s.pnl != null)

  // Daily P&L
  const dailyPnl = closed
    .filter(s => isToday(s.closedAt ?? s.createdAt))
    .reduce((sum, s) => sum + (s.pnl ?? 0), 0)

  // Weekly P&L
  const weeklyPnl = closed
    .filter(s => isThisWeek(s.closedAt ?? s.createdAt))
    .reduce((sum, s) => sum + (s.pnl ?? 0), 0)

  // Consecutive SL losses (from most recent backwards, stop at first non-loss)
  const byTime = [...closed].sort((a, b) =>
    new Date(b.closedAt ?? b.createdAt).getTime() - new Date(a.closedAt ?? a.createdAt).getTime()
  )
  let consecLosses = 0
  for (const s of byTime) {
    if (s.status === 'sl_hit' && (s.pnl ?? 0) < -0.1) consecLosses++
    else break
  }

  // Evaluate limits
  if (dailyPnl <= -Math.abs(config.maxDailyLoss)) {
    return {
      blocked: true,
      reason: `🛑 Límite diario alcanzado: ${dailyPnl.toFixed(2)}% (máx -${config.maxDailyLoss}%). Sin nuevas señales hoy.`,
      dailyPnl, weeklyPnl, consecLosses,
    }
  }

  if (weeklyPnl <= -Math.abs(config.maxWeeklyLoss)) {
    return {
      blocked: true,
      reason: `🛑 Límite semanal alcanzado: ${weeklyPnl.toFixed(2)}% (máx -${config.maxWeeklyLoss}%). Sin nuevas señales esta semana.`,
      dailyPnl, weeklyPnl, consecLosses,
    }
  }

  // 5 consecutive losses → pause until next session (was 3 — too aggressive)
  if (consecLosses >= 5) {
    return {
      blocked: true,
      reason: `🛑 5 pérdidas consecutivas. Pausa automática — espera nueva sesión de mercado.`,
      dailyPnl, weeklyPnl, consecLosses,
    }
  }

  return { blocked: false, reason: null, dailyPnl, weeklyPnl, consecLosses }
}
