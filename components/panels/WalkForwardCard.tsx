'use client'
import { useState, useMemo } from 'react'
import { useApexStore }    from '@/store/apexStore'
import { useTheme }        from '@/hooks/useTheme'
import { runWalkForward }  from '@/lib/walkForwardBacktest'

const GRADE_COLOR: Record<string, string> = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
}

export default function WalkForwardCard() {
  const T             = useTheme()
  const signalHistory = useApexStore(s => s.signalHistory)
  const [open, setOpen] = useState(true)

  const wf = useMemo(() => runWalkForward(signalHistory), [signalHistory])

  const card   = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, overflow: 'hidden' as const }
  const header = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderBottom: open ? `1px solid ${T.border}` : 'none' }

  const metricCol = (v: number, good: number, bad: number) =>
    v >= good ? T.bull : v <= bad ? T.danger : T.warn

  return (
    <div style={card}>
      {/* Header */}
      <div onClick={() => setOpen(!open)} style={header}>
        <span style={{ fontSize: 9, color: T.textSec, letterSpacing: '.1em', fontWeight: 600 }}>
          📊 WALK-FORWARD · SEÑALES REALES
        </span>
        {wf.isReliable && (
          <span style={{ fontSize: 11, fontWeight: 700, color: GRADE_COLOR[wf.grade] }}>
            {wf.grade}
          </span>
        )}
        <span style={{ fontSize: 8, color: T.muted, marginLeft: 'auto' }}>
          {wf.sampleSize} señales {open ? '▲' : '▼'}
        </span>
      </div>

      {open && !wf.isReliable && (
        <div style={{ padding: '14px', fontSize: 9, color: T.muted, textAlign: 'center' }}>
          {wf.recommendation}
        </div>
      )}

      {open && wf.isReliable && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Key metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
            {([
              { label: 'WR OOS',   val: `${(wf.avgTestWR * 100).toFixed(1)}%`,            col: metricCol(wf.avgTestWR,  0.55, 0.50) },
              { label: 'PNL/OP',   val: `${wf.avgTestPnl >= 0 ? '+' : ''}${wf.avgTestPnl.toFixed(2)}%`, col: wf.avgTestPnl > 0 ? T.bull : T.danger },
              { label: 'PF TEST',  val: `${wf.totalTestPF.toFixed(2)}x`,                   col: metricCol(wf.totalTestPF,  1.5, 1.0) },
              { label: 'CONSIST',  val: `${(wf.consistency * 100).toFixed(0)}%`,            col: metricCol(wf.consistency,  0.67, 0.5) },
              { label: 'OVERFIT',  val: `${(wf.overfitScore * 100).toFixed(1)}%`,           col: wf.overfitScore < 0.10 ? T.bull : wf.overfitScore < 0.20 ? T.warn : T.danger },
            ] as { label: string; val: string; col: string }[]).map(({ label, val, col }) => (
              <div key={label} style={{ background: T.bg, borderRadius: 5, padding: '6px 4px', textAlign: 'center' }}>
                <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: col }}>{val}</div>
              </div>
            ))}
          </div>

          {/* By type */}
          {Object.keys(wf.byType).length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
              {Object.entries(wf.byType).map(([k, v]) => (
                <div key={k} style={{ fontSize: 8, color: T.textSec, background: T.bg, borderRadius: 4, padding: '3px 7px' }}>
                  <span style={{ color: T.muted }}>{k} </span>
                  <span style={{ color: v.testWR >= 0.55 ? T.bull : v.testWR < 0.45 ? T.danger : T.warn, fontWeight: 600 }}>
                    {(v.testWR * 100).toFixed(0)}%
                  </span>
                  {' · '}{v.testPnl >= 0 ? '+' : ''}{v.testPnl.toFixed(2)}% · n={v.n}
                </div>
              ))}
            </div>
          )}

          {/* By confidence */}
          {Object.keys(wf.byConfidence).length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
              {Object.entries(wf.byConfidence).map(([k, v]) => (
                <div key={k} style={{ fontSize: 8, color: T.textSec, background: T.bg, borderRadius: 4, padding: '3px 7px' }}>
                  <span style={{ color: T.muted }}>{k} </span>
                  <span style={{ color: v.testWR >= 0.55 ? T.bull : v.testWR < 0.45 ? T.danger : T.warn, fontWeight: 600 }}>
                    {(v.testWR * 100).toFixed(0)}%
                  </span>
                  {' · '}{v.testPnl >= 0 ? '+' : ''}{v.testPnl.toFixed(2)}%
                </div>
              ))}
            </div>
          )}

          {/* CV windows */}
          {wf.windows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.08em' }}>VENTANAS CV (train → test)</div>
              {wf.windows.map((w, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 80px', gap: 6, fontSize: 8, color: T.textSec, background: T.bg, borderRadius: 4, padding: '4px 8px' }}>
                  <span style={{ color: T.muted }}>Fold {i + 1}</span>
                  <span>Train WR <span style={{ color: metricCol(w.trainWR, 0.55, 0.45) }}>{(w.trainWR * 100).toFixed(0)}%</span> (n={w.trainN})</span>
                  <span>Test WR <span style={{ color: metricCol(w.testWR, 0.55, 0.45) }}>{(w.testWR * 100).toFixed(0)}%</span> (n={w.testN})</span>
                  <span style={{ color: w.overfitScore > 0.15 ? T.danger : T.muted }}>gap {(w.overfitScore * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          <div style={{ fontSize: 8, color: T.textSec, lineHeight: 1.75, whiteSpace: 'pre-line' as const, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
            {wf.recommendation}
          </div>

        </div>
      )}
    </div>
  )
}
