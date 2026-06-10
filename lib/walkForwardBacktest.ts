// walkForwardBacktest.ts — out-of-sample validation using real Supabase signals
// Prevents overfitting by splitting closed signal history into train/test windows.
// Unlike lib/backtest.ts (synthetic klines), this uses ACTUAL live trades.

import type { SignalRecord } from './types'

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface WFWindow {
  trainStart:   string   // ISO
  trainEnd:     string
  testStart:    string
  testEnd:      string
  trainN:       number   // sample count
  testN:        number
  trainWR:      number   // win rate 0-1
  testWR:       number
  trainPnl:     number   // avg P&L %
  testPnl:      number
  trainPF:      number   // profit factor
  testPF:       number
  overfitScore: number   // trainWR - testWR (>0.15 = likely overfit)
}

export interface WFBreakdown {
  testWR:  number
  testPnl: number
  n:       number
}

export interface WalkForwardResult {
  windows:      WFWindow[]
  // Overall out-of-sample stats (pooled test windows)
  avgTrainWR:   number
  avgTestWR:    number
  avgTestPnl:   number   // % per trade
  totalTestPF:  number   // profit factor across all test windows
  consistency:  number   // % of test windows where WR > 50%
  overfitScore: number   // avg trainWR - testWR
  sampleSize:   number   // total resolved signals
  isReliable:   boolean  // needs >= 15 resolved signals
  grade:        'A' | 'B' | 'C' | 'D' | 'F'
  recommendation: string
  // Breakdown by dimension
  byType:       Record<string, WFBreakdown>
  bySide:       Record<string, WFBreakdown>
  byConfidence: Record<string, WFBreakdown>
  bySession:    Record<string, WFBreakdown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['sl_hit', 'tp1_hit', 'tp2_hit', 'tp3_hit', 'breakeven', 'closed_manual'])

function isWin(s: SignalRecord): boolean {
  return s.status !== 'sl_hit' && s.status !== 'breakeven' && (s.pnl ?? 0) > 0.1
}

function pf(records: SignalRecord[]): number {
  const gross = records.reduce((s, r) => s + Math.max(0, r.pnl ?? 0), 0)
  const loss  = records.reduce((s, r) => s + Math.abs(Math.min(0, r.pnl ?? 0)), 0)
  return loss > 0 ? gross / loss : gross > 0 ? 999 : 1
}

function stats(records: SignalRecord[]) {
  const wins   = records.filter(isWin)
  const avgPnl = records.length ? records.reduce((s, r) => s + (r.pnl ?? 0), 0) / records.length : 0
  return {
    wr:  records.length ? wins.length / records.length : 0,
    pnl: parseFloat(avgPnl.toFixed(3)),
    pfv: pf(records),
  }
}

function sessionOf(s: SignalRecord): string {
  const h = new Date(s.createdAt).getUTCHours()
  if (h >= 8  && h < 11) return 'London Open'
  if (h >= 11 && h < 13) return 'London Mid'
  if (h >= 13 && h < 16) return 'NY Overlap'
  if (h >= 16 && h < 18) return 'NY Afternoon'
  if (h >= 1  && h < 7)  return 'Asia'
  return 'Off-hours'
}

// ── Walk-Forward Engine ───────────────────────────────────────────────────────

/**
 * Runs walk-forward analysis on closed signals sorted by date.
 * Uses 3-fold time-series CV (no shuffling — respects temporal order).
 *
 * Example with 30 signals:
 *   Fold 1 — Train: 1-20,  Test: 21-24
 *   Fold 2 — Train: 1-24,  Test: 25-27
 *   Fold 3 — Train: 1-27,  Test: 28-30
 */
export function runWalkForward(signals: SignalRecord[]): WalkForwardResult {
  // 1. Filter to resolved signals, sort chronologically
  const resolved = signals
    .filter(s => TERMINAL.has(s.status) && s.pnl != null && s.closedAt != null)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime())

  const n = resolved.length

  const empty: WalkForwardResult = {
    windows: [], avgTrainWR: 0, avgTestWR: 0, avgTestPnl: 0,
    totalTestPF: 1, consistency: 0, overfitScore: 0, sampleSize: n,
    isReliable: false, grade: 'F',
    recommendation: n < 15
      ? `Datos insuficientes (${n} señales). Necesitas ≥15 señales cerradas para análisis confiable.`
      : 'Sin datos',
    byType: {}, bySide: {}, byConfidence: {}, bySession: {},
  }

  if (n < 15) return empty

  // 2. Build walk-forward windows (expand train, fix test size)
  const TEST_SIZE  = Math.max(3, Math.floor(n * 0.15))  // 15% per test window
  const N_FOLDS    = 3
  const windows: WFWindow[] = []

  for (let fold = 0; fold < N_FOLDS; fold++) {
    // Test window: last chunk of current expanded dataset
    const testEnd   = n - fold * TEST_SIZE
    const testStart = testEnd - TEST_SIZE
    if (testStart < 5) break   // not enough train data

    const trainSlice = resolved.slice(0, testStart)
    const testSlice  = resolved.slice(testStart, testEnd)
    if (!trainSlice.length || !testSlice.length) break

    const tr = stats(trainSlice)
    const te = stats(testSlice)

    windows.push({
      trainStart:   trainSlice[0].closedAt!,
      trainEnd:     trainSlice[trainSlice.length - 1].closedAt!,
      testStart:    testSlice[0].closedAt!,
      testEnd:      testSlice[testSlice.length - 1].closedAt!,
      trainN:       trainSlice.length,
      testN:        testSlice.length,
      trainWR:      parseFloat(tr.wr.toFixed(3)),
      testWR:       parseFloat(te.wr.toFixed(3)),
      trainPnl:     tr.pnl,
      testPnl:      te.pnl,
      trainPF:      parseFloat(tr.pfv.toFixed(2)),
      testPF:       parseFloat(te.pfv.toFixed(2)),
      overfitScore: parseFloat((tr.wr - te.wr).toFixed(3)),
    })
  }

  if (!windows.length) return empty

  // 3. Aggregate metrics across test windows
  const avgTrainWR   = windows.reduce((s, w) => s + w.trainWR, 0) / windows.length
  const avgTestWR    = windows.reduce((s, w) => s + w.testWR, 0)  / windows.length
  const avgTestPnl   = windows.reduce((s, w) => s + w.testPnl, 0) / windows.length
  const overfitScore = windows.reduce((s, w) => s + w.overfitScore, 0) / windows.length
  const consistency  = windows.filter(w => w.testWR > 0.5).length / windows.length

  // All test samples pooled for profit factor
  const allTest   = windows.flatMap(w => {
    const ts = new Date(w.testStart).getTime()
    const te = new Date(w.testEnd).getTime()
    return resolved.filter(s => {
      const t = new Date(s.closedAt!).getTime()
      return t >= ts && t <= te
    })
  })
  const totalTestPF = pf(allTest)

  // 4. Breakdown analysis (use all resolved signals for statistical power)
  function breakdown(key: (s: SignalRecord) => string): Record<string, WFBreakdown> {
    const groups: Record<string, SignalRecord[]> = {}
    for (const s of resolved) {
      const k = key(s)
      if (!groups[k]) groups[k] = []
      groups[k].push(s)
    }
    const out: Record<string, WFBreakdown> = {}
    for (const [k, recs] of Object.entries(groups)) {
      if (recs.length < 3) continue
      const st = stats(recs)
      out[k] = { testWR: parseFloat(st.wr.toFixed(3)), testPnl: st.pnl, n: recs.length }
    }
    return out
  }

  const byType       = breakdown(s => s.idea.tradeType)
  const bySide       = breakdown(s => s.idea.side)
  const byConfidence = breakdown(s => s.idea.confidence)
  const bySession    = breakdown(sessionOf)

  // 5. Grade
  let grade: WalkForwardResult['grade']
  if      (avgTestWR >= 0.62 && overfitScore < 0.10 && consistency >= 0.67) grade = 'A'
  else if (avgTestWR >= 0.55 && overfitScore < 0.15 && consistency >= 0.50) grade = 'B'
  else if (avgTestWR >= 0.50 && overfitScore < 0.20)                        grade = 'C'
  else if (avgTestWR >= 0.45)                                                grade = 'D'
  else                                                                       grade = 'F'

  // 6. Recommendation
  const bestType = Object.entries(byType).sort((a, b) => b[1].testPnl - a[1].testPnl)[0]
  const worstType = Object.entries(byType).sort((a, b) => a[1].testWR - b[1].testWR)[0]
  const rec: string[] = []

  if (overfitScore > 0.20) rec.push('⚠️ Posible sobreajuste — el modelo funciona mejor en datos históricos que en tiempo real.')
  if (avgTestWR < 0.50)    rec.push('❌ WR fuera de muestra < 50% — revisar criterios de entrada.')
  if (bestType)  rec.push(`✅ Mejor tipo: ${bestType[0]} (${(bestType[1].testWR*100).toFixed(0)}% WR, +${bestType[1].testPnl.toFixed(2)}%/op)`)
  if (worstType && worstType[1].testWR < 0.45) rec.push(`🔻 Evitar: ${worstType[0]} (${(worstType[1].testWR*100).toFixed(0)}% WR fuera de muestra)`)
  if (byConfidence['ALTA'] && byConfidence['BAJA'] && byConfidence['ALTA'].testWR > byConfidence['BAJA'].testWR + 0.10)
    rec.push('💡 Filtrar solo señales ALTA confianza mejora resultados.')
  if (!rec.length) rec.push('✅ Modelo estable — resultados fuera de muestra consistentes con in-sample.')

  return {
    windows, avgTrainWR: parseFloat(avgTrainWR.toFixed(3)),
    avgTestWR: parseFloat(avgTestWR.toFixed(3)),
    avgTestPnl: parseFloat(avgTestPnl.toFixed(3)),
    totalTestPF: parseFloat(totalTestPF.toFixed(2)),
    consistency: parseFloat(consistency.toFixed(2)),
    overfitScore: parseFloat(overfitScore.toFixed(3)),
    sampleSize: n, isReliable: n >= 15,
    grade, recommendation: rec.join('\n'),
    byType, bySide, byConfidence, bySession,
  }
}

// ── Human-readable report for NTFY / display ─────────────────────────────────

export function getWalkForwardReport(r: WalkForwardResult): string {
  if (!r.isReliable) return r.recommendation

  const lines: string[] = [
    `📊 WALK-FORWARD ANALYSIS — ${r.sampleSize} señales`,
    ``,
    `GRADO: ${r.grade} | WR out-of-sample: ${(r.avgTestWR * 100).toFixed(1)}%`,
    `Avg P&L fuera de muestra: ${r.avgTestPnl >= 0 ? '+' : ''}${r.avgTestPnl.toFixed(2)}%/op`,
    `Profit Factor (test): ${r.totalTestPF.toFixed(2)}x`,
    `Consistencia: ${(r.consistency * 100).toFixed(0)}% ventanas > 50% WR`,
    `Sobreajuste: ${(r.overfitScore * 100).toFixed(1)}% (train vs test WR gap)`,
    ``,
  ]

  if (Object.keys(r.byType).length) {
    lines.push('POR TIPO:')
    for (const [k, v] of Object.entries(r.byType)) {
      lines.push(`  ${k}: ${(v.testWR*100).toFixed(0)}% WR | ${v.testPnl >= 0 ? '+' : ''}${v.testPnl.toFixed(2)}% | n=${v.n}`)
    }
    lines.push('')
  }

  if (Object.keys(r.byConfidence).length) {
    lines.push('POR CONFIANZA:')
    for (const [k, v] of Object.entries(r.byConfidence)) {
      lines.push(`  ${k}: ${(v.testWR*100).toFixed(0)}% WR | ${v.testPnl >= 0 ? '+' : ''}${v.testPnl.toFixed(2)}%`)
    }
    lines.push('')
  }

  lines.push('RECOMENDACIONES:')
  lines.push(...r.recommendation.split('\n'))

  return lines.join('\n')
}
