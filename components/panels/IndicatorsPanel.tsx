'use client'
import { useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'
import ScoreBar from '@/components/ui/ScoreBar'
import type { IndicatorResult } from '@/lib/types'
import { detectCandlePatterns } from '@/lib/candlePatterns'
import type { CandlePattern } from '@/lib/candlePatterns'

const TFS = ['1d', '4h', '1h', '15m'] as const
type TF = typeof TFS[number]
const TF_LABELS: Record<TF, string> = { '1d': '1D', '4h': '4H', '1h': '1H', '15m': '15M' }

const IND_KEYS = ['Bias','Score','RSI','MACD','BB%B','BBWidth','Stoch','ATR','EMAs','Fib','Divergencias'] as const
type IndKey = typeof IND_KEYS[number]

function rsiColor(rsi: number, T: ReturnType<typeof useTheme>): string {
  if (rsi >= 70) return T.danger
  if (rsi >= 60) return T.warn
  if (rsi <= 30) return T.bull
  if (rsi <= 40) return '#7bed9f'
  return T.textSec
}

function IndCard({ tf, ind, vis }: { tf: TF; ind: IndicatorResult; vis: Set<IndKey> }) {
  const T   = useTheme()
  const col = ind.bias === 'ALCISTA' ? T.bull : ind.bias === 'BAJISTA' ? T.danger : T.warn

  const rows: [IndKey, string, string][] = [
    ['RSI',     fmt(ind.rsi, 1),                                         rsiColor(ind.rsi, T)],
    ['MACD',    (ind.macd.hist > 0 ? '+' : '') + fmt(ind.macd.hist, 4), ind.macd.hist > 0 ? T.bull : T.danger],
    ['BB%B',    fmt(ind.bb.pct, 1) + '%',                                (ind.bb.pct ?? 50) > 60 ? T.warn : T.textSec],
    ['BBWidth', fmt(ind.bb.width, 2) + '%',                              (ind.bb.width ?? 5) < 1.5 ? T.accent : T.textSec],
    ['Stoch',   fmt(ind.stoch.k, 1),                                     (ind.stoch.k ?? 50) > 80 ? T.danger : (ind.stoch.k ?? 50) < 20 ? T.bull : T.textSec],
    ['ATR',     '$' + fmt(ind.atr, 0),                                   T.textSec],
  ]

  return (
    <div style={{ background: T.card, border: `2px solid ${col}33`, borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em' }}>{TF_LABELS[tf]}</span>
        {vis.has('Bias') && <span style={{ fontSize: 13, fontWeight: 800, color: col }}>{ind.bias}</span>}
      </div>
      {vis.has('Score') && <ScoreBar score={ind.score} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {rows.filter(([k]) => vis.has(k)).map(([l, v, c]) => (
          <div key={l}>
            <div style={{ fontSize: 7, color: T.muted }}>{l === 'BB%B' ? 'BB %B' : l === 'BBWidth' ? 'BB Width' : l}</div>
            <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      {vis.has('EMAs') && (
        <div style={{ paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 4 }}>EMAs</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(ind.ema).map(([k, v]) => (
              <span key={k} style={{ fontSize: 8, color: T.textSec }}>{k.replace('e', 'EMA ')}: ${fmt(v, 0)}</span>
            ))}
          </div>
        </div>
      )}
      {vis.has('Fib') && ind.fib && (
        <div style={{ paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 6 }}>FIBONACCI</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ind.fib.filter(f => !f.isExt).map(f => (
              <div key={f.level} style={{ background: f.active ? T.accent + '22' : T.bg, border: `1px solid ${f.active ? T.accent : T.border}`, borderRadius: 4, padding: '3px 7px' }}>
                <div style={{ fontSize: 6, color: T.muted }}>{f.label}</div>
                <div style={{ fontSize: 9, color: f.active ? T.accent : T.textSec, fontWeight: f.active ? 700 : 400 }}>${fmt(f.price, 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function IndicatorsPanel() {
  const T    = useTheme()
  const inds = useApexStore(s => s.inds)
  const mkt  = useApexStore(s => s.mkt)
  const divs = useApexStore(s => s.divergences)
  const rawK = useApexStore(s => s.rawK)

  const [tf,  setTf]  = useState<TF>('4h')
  const [vis, setVis] = useState<Set<IndKey>>(new Set(IND_KEYS))

  function toggle(k: IndKey) {
    setVis(prev => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  const ind = inds[tf]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* TF selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {TFS.map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            background: tf === t ? T.accent + '22' : 'transparent',
            border: `1px solid ${tf === t ? T.accent : T.border}`,
            color: tf === t ? T.accent : T.textSec,
            padding: '5px 16px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, fontWeight: tf === t ? 700 : 400,
          }}>{TF_LABELS[t]}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: T.muted, alignSelf: 'center' }}>${fmt(mkt.price)}</span>
      </div>

      {/* Indicator toggles */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {IND_KEYS.map(k => (
          <button key={k} onClick={() => toggle(k)} style={{
            background: vis.has(k) ? T.accent + '18' : 'transparent',
            border: `1px solid ${vis.has(k) ? T.accent + '88' : T.border}`,
            color: vis.has(k) ? T.accent : T.muted,
            padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 8,
          }}>{k}</button>
        ))}
      </div>

      {/* Single TF card */}
      {ind
        ? <IndCard tf={tf} ind={ind} vis={vis} />
        : <div style={{ color: T.muted, textAlign: 'center', padding: 40, fontSize: 11 }}>Cargando {TF_LABELS[tf]}...</div>
      }

      {/* Divergences */}
      {vis.has('Divergencias') && divs.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>DIVERGENCIAS DETECTADAS</div>
          {divs.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: d.type === 'bullish' ? T.bull : T.danger, lineHeight: 1.7 }}>
              {d.type === 'bullish' ? '📈' : '📉'} {d.ind}: {d.desc}
            </div>
          ))}
        </div>
      )}

      {/* 🕯️ Nison Candlestick Patterns */}
      <NisonPatternsCard T={T} rawK={rawK} tf={tf} />
    </div>
  )
}

// ── Nison patterns sub-component (keeps IndicatorsPanel under 150 lines) ─────

const TYPE_COLOR: Record<CandlePattern['type'], string> = {
  bullish: '#22c55e', bearish: '#ef4444', neutral: '#fbbf24', continuation: '#7b9fff',
}
const TYPE_LABEL: Record<CandlePattern['type'], string> = {
  bullish: '📈 ALCISTAS', bearish: '📉 BAJISTAS', neutral: '⚖️ NEUTRAL', continuation: '➡️ CONTINUACIÓN',
}

function NisonPatternsCard({ T, rawK, tf }: {
  T: ReturnType<typeof useTheme>
  rawK: ReturnType<typeof useApexStore<ReturnType<typeof useApexStore>>>
  tf: string
}) {
  const klines = (rawK as Partial<Record<string, import('@/lib/types').Kline[]>>)[tf] ?? []
  const patterns = detectCandlePatterns(klines, 30)

  const groups: Record<string, typeof patterns> = { bullish: [], bearish: [], neutral: [], continuation: [] }
  for (const p of patterns) groups[p.pattern.type]?.push(p)

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🕯️ PATRONES DE VELAS — STEVE NISON ({tf.toUpperCase()})</div>
      {patterns.length === 0
        ? <div style={{ fontSize: 10, color: T.muted, textAlign: 'center', padding: '10px 0' }}>Sin patrones activos en {tf.toUpperCase()}</div>
        : Object.entries(groups).filter(([, v]) => v.length > 0).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 7, color: TYPE_COLOR[type as CandlePattern['type']], letterSpacing: '.12em', marginBottom: 4 }}>
              {TYPE_LABEL[type as CandlePattern['type']]}
            </div>
            {items.map((det, idx) => (
              <div key={idx} style={{ padding: '6px 0', borderBottom: `1px solid ${T.border}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLOR[det.pattern.type] }}>
                    {det.pattern.name}
                  </span>
                  {det.pattern.nameJP && <span style={{ fontSize: 8, color: T.muted }}>({det.pattern.nameJP})</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 8, fontFamily: 'monospace',
                    color: det.confidence >= 85 ? T.bull : det.confidence >= 70 ? T.warn : T.textSec }}>
                    {det.confidence}%
                  </span>
                  {det.needsConfirmation && (
                    <span style={{ fontSize: 7, color: T.warn, background: T.warn + '22', borderRadius: 3, padding: '1px 4px' }}>Confirmar</span>
                  )}
                </div>
                <div style={{ fontSize: 8, color: T.textSec, marginBottom: 2 }}>{det.pattern.description}</div>
                <div style={{ fontSize: 8, color: TYPE_COLOR[det.pattern.type], fontStyle: 'italic' }}>→ {det.pattern.tradingAdvice}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                  <span style={{ fontSize: 7, color: T.muted }}>Fuerza:</span>
                  {'⭐'.repeat(det.pattern.strength)}
                  <span style={{ fontSize: 7, color: T.muted, marginLeft: 6 }}>Fiabilidad:</span>
                  {'⭐'.repeat(det.pattern.reliability)}
                </div>
              </div>
            ))}
          </div>
        ))
      }
    </div>
  )
}
