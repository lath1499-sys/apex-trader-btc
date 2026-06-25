'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import type { Theme, SignalRecord, Timeframe, TradeType } from '@/lib/types'

// ─── HV helpers ──────────────────────────────────────────────────────────────
function calcHV(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null
  const slice = closes.slice(-(days + 1))
  const returns: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0 && slice[i] > 0) returns.push(Math.log(slice[i] / slice[i - 1]))
  }
  if (returns.length < 2) return null
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(365) * 100
}

function hvColor(hv: number | null, T: Theme): string {
  if (hv == null) return T.muted
  if (hv < 45) return T.bull
  if (hv < 75) return T.warn
  return T.danger
}

// ─── 1: Historical Volatility ─────────────────────────────────────────────────
export function HVCard() {
  const T    = useTheme()
  const rawK = useApexStore(s => s.rawK)
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const closes = (rawK['1d'] ?? []).map(k => k.c)
  const hv7  = calcHV(closes, 7)
  const hv30 = calcHV(closes, 30)
  const hv90 = calcHV(closes, 90)

  const sparkVals: number[] = []
  for (let i = 8; i <= closes.length; i++) {
    const h = calcHV(closes.slice(i - 8, i), 7)
    if (h != null) sparkVals.push(h)
  }
  const spark = sparkVals.slice(-30)

  const baseline = hv90 ?? hv30 ?? 60
  const gaugePct = hv7 != null
    ? Math.min(100, Math.max(0, (hv7 - baseline * 0.3) / (baseline * 1.7) * 100))
    : null

  const ratio   = hv7 != null && hv30 != null ? hv7 / hv30 : null
  const signal  =
    ratio == null ? null :
    ratio < 0.65  ? { label: '⚡ COMPRESIÓN — breakout potencial', col: T.warn } :
    ratio > 1.40  ? { label: '🔥 EXPANSIÓN — volatilidad elevada', col: T.danger } :
                    { label: '✓ Volatilidad normal', col: T.bull }

  const W = 220, H = 36
  const minS = spark.length ? Math.min(...spark) : 0
  const maxS = spark.length ? Math.max(...spark) : 1
  const rng  = (maxS - minS) || 1
  const toX  = (i: number) => (i / Math.max(spark.length - 1, 1)) * W
  const toY  = (v: number) => H - ((v - minS) / rng) * (H - 6) - 3
  const lineStr = spark.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const lastCol = hvColor(hv7, T)

  if (closes.length < 10) return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em' }}>📉 VOLATILIDAD HISTÓRICA (HV)</div>
      <div style={{ fontSize: 9, color: T.muted, marginTop: 10 }}>Cargando datos 1D...</div>
    </div>
  )

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>📉 VOLATILIDAD HISTÓRICA · ANUALIZADA</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
        {(['HV 7D', 'HV 30D', 'HV 90D'] as const).map((l, idx) => {
          const v = [hv7, hv30, hv90][idx]
          return (
            <div key={l} style={{ background: T.bg, borderRadius: 6, padding: '5px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: hvColor(v, T), fontFamily: 'monospace' }}>
                {v != null ? v.toFixed(1) + '%' : '—'}
              </div>
            </div>
          )
        })}
      </div>
      {gaugePct != null && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: T.muted, marginBottom: 3 }}>
            <span>Vol baja</span><span>Vol alta</span>
          </div>
          <div style={{ position: 'relative', height: 7, borderRadius: 4, background: T.bg, overflow: 'visible' }}>
            <div style={{ position: 'absolute', left: 0,     width: '35%', height: '100%', background: T.bull,   opacity: 0.25, borderRadius: '4px 0 0 4px' }} />
            <div style={{ position: 'absolute', left: '35%', width: '35%', height: '100%', background: T.warn,   opacity: 0.25 }} />
            <div style={{ position: 'absolute', left: '70%', width: '30%', height: '100%', background: T.danger, opacity: 0.25, borderRadius: '0 4px 4px 0' }} />
            <div style={{ position: 'absolute', top: -3, left: `${gaugePct}%`, transform: 'translateX(-50%)',
              width: 13, height: 13, borderRadius: '50%', background: lastCol, border: `2px solid ${T.card}` }} />
          </div>
        </div>
      )}
      {spark.length > 3 && (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginBottom: 8 }}>
          <polyline points={lineStr} fill="none" stroke={lastCol} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={toX(spark.length - 1).toFixed(1)} cy={toY(spark[spark.length - 1]).toFixed(1)} r={3} fill={lastCol} />
        </svg>
      )}
      {signal && <div style={{ fontSize: 8, fontWeight: 600, color: signal.col }}>{signal.label}</div>}
    </div>
  )
}

// ─── 2: Realized Price / MVRV ─────────────────────────────────────────────────
export function MVRVCard() {
  const T     = useTheme()
  const cycle = useApexStore(s => s.cycle)
  const mkt   = useApexStore(s => s.mkt)
  const card  = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const mvrv   = cycle?.mvrv ?? null
  const ma200  = cycle?.ma200 ?? null
  const price  = mkt.price ?? 0
  const distMA = ma200 && price ? (price - ma200) / ma200 * 100 : null

  const mvrvZone =
    mvrv == null ? null :
    mvrv < 1     ? { label: 'SUBVALORADO — zona de fondo', col: T.bull } :
    mvrv < 2     ? { label: 'ACUMULACIÓN — fair value', col: T.accent } :
    mvrv < 3.5   ? { label: 'BULL en progreso', col: T.warn } :
    mvrv < 5     ? { label: 'SOBRECOMPRADO — ciclo tardío', col: T.danger } :
                   { label: '🔥 EUFORIA — distribución', col: T.danger }

  const gaugePct = mvrv != null ? Math.min(100, (mvrv / 6) * 100) : null
  const gaugeCol = mvrvZone?.col ?? T.muted

  if (!cycle) return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em' }}>⛓ REALIZED PRICE / MVRV</div>
      <div style={{ fontSize: 9, color: T.muted, marginTop: 10 }}>Cargando ciclo...</div>
    </div>
  )

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>⛓ REALIZED PRICE / MVRV</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div style={{ background: T.bg, borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 3 }}>MVRV RATIO</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: gaugeCol }}>{mvrv?.toFixed(2) ?? '—'}</div>
        </div>
        <div style={{ background: T.bg, borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 3 }}>MA200 (REF)</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>
            {ma200 ? '$' + ma200.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
          </div>
          {distMA != null && (
            <div style={{ fontSize: 8, color: distMA >= 0 ? T.bull : T.danger }}>
              {distMA >= 0 ? '+' : ''}{distMA.toFixed(1)}% de MA200
            </div>
          )}
        </div>
      </div>
      {gaugePct != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: T.muted, marginBottom: 3 }}>
            <span>0</span><span>1 Fondo</span><span>3.5</span><span>6+</span>
          </div>
          <div style={{ position: 'relative', height: 7, borderRadius: 4, background: T.bg, overflow: 'visible' }}>
            <div style={{ position: 'absolute', left: 0,    width: '17%', height: '100%', background: T.bull,   opacity: 0.3, borderRadius: '4px 0 0 4px' }} />
            <div style={{ position: 'absolute', left: '17%', width: '16%', height: '100%', background: T.accent, opacity: 0.3 }} />
            <div style={{ position: 'absolute', left: '33%', width: '25%', height: '100%', background: T.warn,   opacity: 0.3 }} />
            <div style={{ position: 'absolute', left: '58%', width: '42%', height: '100%', background: T.danger, opacity: 0.3, borderRadius: '0 4px 4px 0' }} />
            <div style={{ position: 'absolute', top: -3, left: `${gaugePct}%`, transform: 'translateX(-50%)',
              width: 13, height: 13, borderRadius: '50%', background: gaugeCol, border: `2px solid ${T.card}` }} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 8, color: cycle.col, fontWeight: 600, marginBottom: 3 }}>● {cycle.phaseLabel}</div>
      {mvrvZone && <div style={{ fontSize: 7, color: mvrvZone.col }}>{mvrvZone.label}</div>}
    </div>
  )
}

// ─── 3: Bias Multi-Timeframe ──────────────────────────────────────────────────
const TF_LIST: { key: Timeframe; label: string }[] = [
  { key: '1d', label: '1D' }, { key: '4h', label: '4H' },
  { key: '1h', label: '1H' }, { key: '15m', label: '15M' },
]

function biasCol(bias: string | undefined, T: Theme): string {
  if (!bias) return T.muted
  if (bias === 'ALCISTA') return T.bull
  if (bias === 'BAJISTA') return T.danger
  return T.warn
}

export function MultiTFBiasCard() {
  const T    = useTheme()
  const inds = useApexStore(s => s.inds)
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const biases  = TF_LIST.map(tf => inds[tf.key]?.bias)
  const bulls   = biases.filter(b => b === 'ALCISTA').length
  const bears   = biases.filter(b => b === 'BAJISTA').length
  const consLabel = bulls >= 3 ? 'ALCISTA FUERTE' : bulls === 2 ? 'SESGO ALCISTA' :
                    bears >= 3 ? 'BAJISTA FUERTE' : bears === 2 ? 'SESGO BAJISTA' : 'MIXTO'
  const consCol   = bulls >= 3 ? T.bull : bulls > bears ? T.bull :
                    bears >= 3 ? T.danger : bears > bulls ? T.danger : T.warn

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🚦 BIAS MULTI-TIMEFRAME</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        {TF_LIST.map(tf => {
          const ind = inds[tf.key]
          const col = biasCol(ind?.bias, T)
          return (
            <div key={tf.key} style={{ background: col + '18', border: `1px solid ${col}44`, borderRadius: 7, padding: '7px 10px' }}>
              <div style={{ fontSize: 7, color: T.muted, marginBottom: 3 }}>{tf.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: col }}>{ind?.bias ?? '—'}</div>
              <div style={{ fontSize: 7, color: T.muted, marginTop: 2 }}>
                RSI {ind?.rsi != null ? ind.rsi.toFixed(0) : '—'} · {ind?.score != null ? ind.score : '—'}pts
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: consCol + '18', borderRadius: 6, padding: '6px 10px' }}>
        <span style={{ fontSize: 8, color: T.muted }}>Consenso 4 TF</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: consCol }}>{consLabel}</span>
        <span style={{ fontSize: 8, color: T.muted }}>{bulls}↑ {bears}↓</span>
      </div>
    </div>
  )
}

// ─── 4: Score APEX Compuesto ──────────────────────────────────────────────────
function biasScore(bias: string | undefined): number {
  return bias === 'ALCISTA' ? 80 : bias === 'BAJISTA' ? 20 : 50
}

export function ApexScoreCard() {
  const T    = useTheme()
  const inds = useApexStore(s => s.inds)
  const mkt  = useApexStore(s => s.mkt)
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const d1 = inds['1d'], h4 = inds['4h'], h1 = inds['1h']
  const funding = mkt.funding ?? 0

  const rows: [string, number, number][] = [
    ['Bias 1D    (28%)', biasScore(d1?.bias), 0.28],
    ['Bias 4H    (22%)', biasScore(h4?.bias), 0.22],
    ['Bias 1H    (18%)', biasScore(h1?.bias), 0.18],
    ['RSI 4H     (14%)', h4?.rsi != null ? (h4.rsi < 30 ? 75 : h4.rsi > 70 ? 25 : 50) : 50, 0.14],
    ['MACD 4H    (12%)', h4?.macd?.hist != null ? (h4.macd.hist > 0 ? 72 : 28) : 50, 0.12],
    ['Funding     (6%)', funding < -0.01 ? 70 : funding > 0.04 ? 30 : 50, 0.06],
  ]

  const composite = Math.round(rows.reduce((a, [, v, w]) => a + v * w, 0))
  const scoreCol  = composite >= 65 ? T.bull : composite <= 35 ? T.danger : T.warn
  const scoreLabel =
    composite >= 75 ? 'SETUP ALCISTA FUERTE' :
    composite >= 60 ? 'Sesgo alcista' :
    composite <= 25 ? 'SETUP BAJISTA FUERTE' :
    composite <= 40 ? 'Sesgo bajista' : 'Sin sesgo claro'

  const radius = 36, cx = 50, cy = 46
  const angle   = Math.PI + (composite / 100) * Math.PI
  const x2 = cx + radius * Math.cos(angle), y2 = cy + radius * Math.sin(angle)
  const largeArc = composite > 50 ? 1 : 0

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 6 }}>🎯 SCORE APEX COMPUESTO</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <svg width={100} height={50} viewBox="0 0 100 50">
          <path d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none" stroke={T.border} strokeWidth={6} />
          <path d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`}
            fill="none" stroke={scoreCol} strokeWidth={6} strokeLinecap="round" />
        </svg>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, color: scoreCol, lineHeight: 1 }}>{composite}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: scoreCol }}>{scoreLabel}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: 8 }}>
        {rows.map(([l, v]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: T.muted }}>{l}</span>
            <span style={{ color: v >= 65 ? T.bull : v <= 35 ? T.danger : T.warn, fontFamily: 'monospace' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 5: CVD — Volume Delta Acumulado ─────────────────────────────────────────
function fmtK(n: number): string {
  return Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' :
         Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'K' :
         n.toFixed(0)
}

export function CVDCard() {
  const T    = useTheme()
  const rawK = useApexStore(s => s.rawK)
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const k1h = (rawK['1h'] ?? []).slice(-48)

  // Approximate delta per candle: weight volume by body direction
  const deltas = k1h.map(k => {
    const range = (k.h - k.l) || 0.001
    return k.v * ((k.c - k.o) / range)
  })

  let cum = 0
  const cvd = deltas.map(d => { cum += d; return cum })
  const start = cvd[0] ?? 0
  const norm  = cvd.map(v => v - start)

  const last      = norm[norm.length - 1] ?? 0
  const recent5   = deltas.slice(-5).reduce((a, b) => a + b, 0)
  const trendBull = recent5 > 0
  const C         = last >= 0 ? T.bull : T.danger

  const divergence = (last > 0 && recent5 < 0) || (last < 0 && recent5 > 0)

  const W = 220, H = 48
  const minV = Math.min(...norm, 0), maxV = Math.max(...norm, 0)
  const rng  = (maxV - minV) || 1
  const zeroY = H - ((0 - minV) / rng) * (H - 8) - 4
  const toX   = (i: number) => (i / Math.max(norm.length - 1, 1)) * W
  const toY   = (v: number) => H - ((v - minV) / rng) * (H - 8) - 4
  const lineStr = norm.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

  if (k1h.length < 5) return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em' }}>📊 CVD — VOLUME DELTA</div>
      <div style={{ fontSize: 9, color: T.muted, marginTop: 10 }}>Cargando klines 1H...</div>
    </div>
  )

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>📊 CVD — VOLUME DELTA ACUMULADO · 1H</div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 7, color: T.muted }}>CVD NETO 48H</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C }}>{last >= 0 ? '+' : ''}{fmtK(last)}</div>
        </div>
        <div style={{ paddingBottom: 2 }}>
          <div style={{ fontSize: 7, color: T.muted }}>PRESIÓN RECIENTE</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: trendBull ? T.bull : T.danger }}>
            {trendBull ? '▲ COMPRA' : '▼ VENTA'}
          </div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <line x1={0} y1={zeroY.toFixed(1)} x2={W} y2={zeroY.toFixed(1)}
          stroke={T.border} strokeWidth={0.5} strokeDasharray="3 3" />
        <polyline points={lineStr} fill="none" stroke={C} strokeWidth={1.5}
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={toX(norm.length - 1).toFixed(1)} cy={toY(last).toFixed(1)} r={3} fill={C} />
      </svg>
      {divergence && (
        <div style={{ fontSize: 7, color: T.warn, marginTop: 6 }}>
          ⚠ Divergencia CVD — potencial cambio de dirección
        </div>
      )}
    </div>
  )
}

// ─── 6: Señales Activas ───────────────────────────────────────────────────────
const TYPE_ICON: Record<TradeType, string> = { Scalp: '⚡', DayTrade: '📊', Swing: '🌊' }

export function ActiveSignalsCard() {
  const T       = useTheme()
  const history = useApexStore(s => s.signalHistory) as SignalRecord[]
  const mkt     = useApexStore(s => s.mkt)
  const setTab  = useApexStore(s => s.setTab)
  const card    = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14,
                    gridColumn: 'span 2' as const }

  const active = history.filter(r => r.status === 'active' || r.status === 'pending_confirmation')
  const price  = mkt.price ?? 0

  function unrealizedR(r: SignalRecord): number | null {
    const { price: entry, sl, side } = r.idea
    if (!price || !entry || !sl) return null
    const rUnit = Math.abs(entry - sl)
    if (rUnit === 0) return null
    return side === 'LONG' ? (price - entry) / rUnit : (entry - price) / rUnit
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em' }}>📋 SEÑALES ACTIVAS</div>
        <div style={{ fontSize: 9, color: T.muted }}>{active.length} abierta{active.length !== 1 ? 's' : ''}</div>
      </div>

      {active.length === 0 && (
        <div style={{ fontSize: 9, color: T.muted, textAlign: 'center', padding: '12px 0' }}>
          Sin señales activas actualmente
        </div>
      )}

      {active.map(r => {
        const pnlR    = unrealizedR(r)
        const pnlCol  = pnlR == null ? T.muted : pnlR > 0 ? T.bull : T.danger
        const sideCol = r.idea.side === 'LONG' ? T.bull : T.danger
        const icon    = TYPE_ICON[r.idea.tradeType] ?? '📌'
        const isPend  = r.status === 'pending_confirmation'
        return (
          <div key={r.id}
            style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0',
              borderBottom: `1px solid ${T.border}22`, cursor: 'pointer' }}
            onClick={() => setTab('journal')}>
            <span style={{ fontSize: 14 }}>{icon}</span>
            <div style={{ width: 88 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: sideCol }}>{r.idea.side} </span>
              <span style={{ fontSize: 7, color: T.muted }}>{r.idea.tradeType}</span>
            </div>
            <div style={{ flex: 1, fontSize: 8, color: T.muted }}>
              Entrada <span style={{ color: T.text, fontFamily: 'monospace' }}>
                ${r.idea.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              {' · '}SL <span style={{ color: T.danger, fontFamily: 'monospace' }}>
                ${r.idea.sl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div style={{ textAlign: 'right', minWidth: 50 }}>
              {isPend ? (
                <span style={{ fontSize: 7, color: T.warn }}>Pendiente</span>
              ) : pnlR != null ? (
                <span style={{ fontSize: 10, fontWeight: 700, color: pnlCol, fontFamily: 'monospace' }}>
                  {pnlR >= 0 ? '+' : ''}{pnlR.toFixed(2)}R
                </span>
              ) : (
                <span style={{ fontSize: 8, color: T.muted }}>—</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
