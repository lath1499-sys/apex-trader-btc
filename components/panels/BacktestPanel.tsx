'use client'
import { useState, useMemo } from 'react'
import { useApexStore }    from '@/store/apexStore'
import { useTheme }        from '@/hooks/useTheme'
import { fmt }             from '@/lib/buildContext'
import { ALL_STRATEGIES, runStrategy, btStats } from '@/lib/backtest'
import WalkForwardCard     from './WalkForwardCard'
import type { BacktestStats } from '@/lib/types'

type Row = { name: string; stats: BacktestStats }

export default function BacktestPanel() {
  const T    = useTheme()
  const rawK = useApexStore(s => s.rawK)
  const [tf, setTf]             = useState<'1h' | '4h' | '1d'>('1h')
  const [running, setRunning]   = useState(false)
  const [rows, setRows]         = useState<Row[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort]         = useState<keyof BacktestStats>('wr')

  const klines = rawK[tf] ?? []

  async function runAll() {
    if (!klines.length) return
    setRunning(true)
    await new Promise(r => setTimeout(r, 0)) // flush render before blocking loop
    const results: Row[] = []
    for (let i = 0; i < ALL_STRATEGIES.length; i++) {
      const trades = runStrategy(klines, ALL_STRATEGIES[i])
      if (trades.length >= 3) results.push({ name: ALL_STRATEGIES[i].name, stats: btStats(trades) })
      if (i % 20 === 19) await new Promise(r => setTimeout(r, 0)) // yield every 20 strats
    }
    results.sort((a, b) => (b.stats[sort] as number) - (a.stats[sort] as number))
    setRows(results)
    setRunning(false)
  }

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (b.stats[sort] as number) - (a.stats[sort] as number)),
    [rows, sort]
  )

  const colFor = (v: number, good: number, bad: number) =>
    v >= good ? T.bull : v <= bad ? T.danger : T.warn

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Walk-Forward Analysis (real closed signals) */}
      <WalkForwardCard />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['1h', '4h', '1d'] as const).map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            background: tf === t ? T.accent + '22' : 'transparent',
            border: `1px solid ${tf === t ? T.accent : T.border}`,
            color: tf === t ? T.accent : T.textSec,
            padding: '5px 14px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9,
          }}>{t.toUpperCase()}</button>
        ))}
        <button onClick={runAll} disabled={running || !klines.length} style={{
          background: T.bull + '22', border: `1px solid ${T.bull}`, color: T.bull,
          padding: '5px 18px', borderRadius: 5, cursor: running ? 'wait' : 'pointer',
          fontFamily: 'inherit', fontSize: 9, fontWeight: 700, opacity: running ? 0.6 : 1,
        }}>{running ? 'Ejecutando...' : `▶ Run ${ALL_STRATEGIES.length} estrategias`}</button>
        <span style={{ fontSize: 9, color: T.muted, marginLeft: 'auto' }}>{klines.length} velas · {rows.length} resultados</span>
      </div>

      {/* Sort */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['wr', 'pf', 'avgW', 'total', 'mdd'] as (keyof BacktestStats)[]).map(k => (
            <button key={k} onClick={() => setSort(k)} style={{
              background: sort === k ? T.accent + '22' : 'transparent',
              border: `1px solid ${sort === k ? T.accent : T.border}`,
              color: sort === k ? T.accent : T.textSec,
              padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 8,
            }}>{k.toUpperCase()}</button>
          ))}
        </div>
      )}

      {/* Table */}
      {sorted.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 520, overflowY: 'auto' }}>
          {sorted.slice(0, 50).map((r, i) => (
            <div key={r.name}>
              <div onClick={() => setExpanded(expanded === r.name ? null : r.name)}
                style={{ display: 'grid', gridTemplateColumns: '24px 1fr repeat(5,80px)', gap: 6, padding: '8px 10px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 9, alignItems: 'center' }}>
                <span style={{ color: T.muted, fontFamily: 'monospace' }}>{i + 1}</span>
                <span style={{ color: T.text, fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: colFor(r.stats.wr, 55, 40), textAlign: 'right' }}>{fmt(r.stats.wr, 1)}%</span>
                <span style={{ color: colFor(r.stats.pf, 1.5, 1), textAlign: 'right' }}>{fmt(r.stats.pf, 2)}</span>
                <span style={{ color: colFor(r.stats.avgW, 0.5, -0.5), textAlign: 'right' }}>{fmt(r.stats.avgW, 2)}%</span>
                <span style={{ color: T.textSec, textAlign: 'right' }}>{r.stats.total}</span>
                <span style={{ color: r.stats.mdd < -15 ? T.danger : T.textSec, textAlign: 'right' }}>{fmt(r.stats.mdd, 1)}%</span>
              </div>
              {expanded === r.name && (
                <div style={{ background: T.bg, border: `1px solid ${T.accent}33`, borderRadius: '0 0 6px 6px', padding: '10px 14px', fontSize: 9, color: T.textSec, lineHeight: 1.8 }}>
                  Win Rate: {fmt(r.stats.wr, 2)}% · Profit Factor: {fmt(r.stats.pf, 3)} · Avg Win: {fmt(r.stats.avgW, 3)}% · Max DD: {fmt(r.stats.mdd, 2)}% · Trades: {r.stats.total}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: 40, textAlign: 'center', color: T.textSec, fontSize: 11 }}>
          {klines.length ? 'Pulsa "Run" para testear todas las estrategias sobre los datos actuales.' : 'Esperando datos de velas...'}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ fontSize: 8, color: T.muted }}>
          Columnas: WR (win rate) · PF (profit factor) · AVG (retorno medio/trade) · TRADES · MAX DD · Click fila para expandir
        </div>
      )}
    </div>
  )
}
