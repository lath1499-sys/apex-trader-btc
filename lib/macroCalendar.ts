// APEX — Macro Calendar
// Blocks signal generation during high-impact macro events (FOMC, CPI, NFP).
// Events are hardcoded for 2026; update annually.

export interface MacroEvent {
  name:       string          // e.g. 'FOMC'
  label:      string          // human-readable e.g. 'FOMC Rate Decision'
  utcMs:      number          // exact UTC timestamp of the event
  blockBefore: number         // minutes to block BEFORE the event
  blockAfter:  number         // minutes to block AFTER the event
  impact:     'CRITICAL' | 'HIGH'
}

// ── 2026 Event Calendar ───────────────────────────────────────────────────────
// Times are approximate UTC — FOMC ~19:00 UTC, CPI ~13:30 UTC, NFP ~13:30 UTC

function utc(year: number, month: number, day: number, hour = 13, min = 30): number {
  return Date.UTC(year, month - 1, day, hour, min, 0)
}

export const MACRO_EVENTS: MacroEvent[] = [
  // FOMC 2026 (Federal Reserve rate decisions — ~19:00 UTC)
  { name: 'FOMC', label: 'FOMC Rate Decision Jan 2026',  utcMs: utc(2026, 1,  29, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Mar 2026',  utcMs: utc(2026, 3,  18, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision May 2026',  utcMs: utc(2026, 5,   6, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Jun 2026',  utcMs: utc(2026, 6,  17, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Jul 2026',  utcMs: utc(2026, 7,  29, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Sep 2026',  utcMs: utc(2026, 9,  16, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Nov 2026',  utcMs: utc(2026, 11,  4, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },
  { name: 'FOMC', label: 'FOMC Rate Decision Dec 2026',  utcMs: utc(2026, 12, 16, 19, 0), blockBefore: 60, blockAfter: 120, impact: 'CRITICAL' },

  // CPI 2026 (US Consumer Price Index — ~13:30 UTC)
  { name: 'CPI', label: 'US CPI Jan 2026',  utcMs: utc(2026, 1,  14), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Feb 2026',  utcMs: utc(2026, 2,  11), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Mar 2026',  utcMs: utc(2026, 3,  11), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Apr 2026',  utcMs: utc(2026, 4,  10), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI May 2026',  utcMs: utc(2026, 5,  13), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Jun 2026',  utcMs: utc(2026, 6,  10), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Jul 2026',  utcMs: utc(2026, 7,  14), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Aug 2026',  utcMs: utc(2026, 8,  12), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Sep 2026',  utcMs: utc(2026, 9,   9), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Oct 2026',  utcMs: utc(2026, 10, 14), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Nov 2026',  utcMs: utc(2026, 11, 12), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'CPI', label: 'US CPI Dec 2026',  utcMs: utc(2026, 12,  9), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },

  // NFP 2026 (US Non-Farm Payrolls — 1st Friday ~13:30 UTC)
  { name: 'NFP', label: 'NFP Jan 2026',  utcMs: utc(2026, 1,   9), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Feb 2026',  utcMs: utc(2026, 2,   6), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Mar 2026',  utcMs: utc(2026, 3,   6), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Apr 2026',  utcMs: utc(2026, 4,   3), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP May 2026',  utcMs: utc(2026, 5,   1), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Jun 2026',  utcMs: utc(2026, 6,   5), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Jul 2026',  utcMs: utc(2026, 7,   2), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Aug 2026',  utcMs: utc(2026, 8,   7), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Sep 2026',  utcMs: utc(2026, 9,   4), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Oct 2026',  utcMs: utc(2026, 10,  2), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Nov 2026',  utcMs: utc(2026, 11,  6), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
  { name: 'NFP', label: 'NFP Dec 2026',  utcMs: utc(2026, 12,  4), blockBefore: 30, blockAfter: 60, impact: 'HIGH' },
]

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the active blocking event if we are currently inside its block window.
 * Returns null if market is clear to trade.
 */
export function getActiveBlockingEvent(nowMs = Date.now()): MacroEvent | null {
  for (const ev of MACRO_EVENTS) {
    const start = ev.utcMs - ev.blockBefore * 60_000
    const end   = ev.utcMs + ev.blockAfter  * 60_000
    if (nowMs >= start && nowMs <= end) return ev
  }
  return null
}

/**
 * Returns the next upcoming event within the given lookahead window (default 24h).
 */
export function getUpcomingEvent(nowMs = Date.now(), lookaheadMs = 24 * 60 * 60_000): MacroEvent | null {
  const upcoming = MACRO_EVENTS
    .filter(ev => ev.utcMs > nowMs && ev.utcMs - nowMs <= lookaheadMs)
    .sort((a, b) => a.utcMs - b.utcMs)
  return upcoming[0] ?? null
}

/**
 * Returns minutes until the next event (negative = already past).
 */
export function minutesUntilEvent(ev: MacroEvent, nowMs = Date.now()): number {
  return Math.round((ev.utcMs - nowMs) / 60_000)
}
