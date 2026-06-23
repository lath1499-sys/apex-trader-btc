'use client'
import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '@/hooks/useTheme'

const fmtFull    = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'k'
  return '$' + Math.round(n)
}

const FREQS      = [{ label: 'Mensual', ppy: 12 }, { label: 'Trimestral', ppy: 4 }, { label: 'Anual', ppy: 1 }]
const RATE_TYPES = [{ label: 'Anual', mult: 1 }, { label: 'Mensual', mult: 12 }, { label: 'Trimestral', mult: 4 }]
const TFS        = [1, 3, 5, 10, 20]

type RateTypeIdx = 0 | 1 | 2

interface CalcParams { principal: number; contribution: number; withdrawal: number; annualRate: number; years: number; ppy: number }
interface Row { year: number; compound: number; contributed: number; simple: number; withdrawn: number }
interface SimResult { rows: Row[]; depletionYear: number | null }

function simulate(p: CalcParams): SimResult {
  const { principal, contribution, withdrawal, annualRate, years, ppy } = p
  const r         = annualRate / 100 / ppy
  const contribP  = contribution * (12 / ppy)
  const wdP       = withdrawal   * (12 / ppy)
  const periods   = Math.round(years * ppy)
  let bal = principal, totalContrib = principal, totalWd = 0
  let depletionYear: number | null = null
  const rows: Row[] = [{ year: 0, compound: principal, contributed: principal, simple: principal, withdrawn: 0 }]

  for (let i = 1; i <= periods; i++) {
    bal = bal * (1 + r) + contribP - wdP
    if (bal <= 0 && depletionYear === null) depletionYear = parseFloat((i / ppy).toFixed(1))
    bal = Math.max(0, bal)
    totalContrib += contribP
    totalWd      += wdP
    if (i % ppy === 0) {
      const yr  = i / ppy
      const sim = principal * (1 + (annualRate / 100) * yr) + (totalContrib - principal - totalWd)
      rows.push({ year: yr, compound: Math.round(bal), contributed: Math.round(totalContrib), simple: Math.round(Math.max(0, sim)), withdrawn: Math.round(totalWd) })
    }
  }
  return { rows, depletionYear }
}

type ChartView = 'annual' | 'monthly' | 'daily'

interface ChartRow { period: number; compound: number; contributed: number; simple: number; withdrawn: number }

function simulateChart(p: CalcParams, view: ChartView): ChartRow[] {
  const ppy      = view === 'annual' ? 1 : view === 'monthly' ? 12 : 365
  const r        = p.annualRate / 100 / ppy
  const contribP = p.contribution * (12 / ppy)
  const wdP      = p.withdrawal   * (12 / ppy)
  const total    = Math.round(p.years * ppy)
  let bal = p.principal, tc = p.principal, tw = 0
  const rows: ChartRow[] = [{ period: 0, compound: p.principal, contributed: p.principal, simple: p.principal, withdrawn: 0 }]
  for (let i = 1; i <= total; i++) {
    bal = Math.max(0, bal * (1 + r) + contribP - wdP)
    tc += contribP; tw += wdP
    const sim = p.principal * (1 + (p.annualRate / 100) * (i / ppy)) + (tc - p.principal - tw)
    rows.push({ period: i, compound: Math.round(bal), contributed: Math.round(tc), simple: Math.round(Math.max(0, sim)), withdrawn: Math.round(tw) })
  }
  return rows
}

interface Palette { bgCard: string; bgCard2: string; border: string; text: string; textSec: string; accent: string; accent2: string; orange: string; purple: string; blue: string; danger: string }

function ApexTooltip({ active, payload, label, s, view }: { active?: boolean; payload?: { payload: ChartRow }[]; label?: number; s: Palette; view: ChartView }) {
  if (!active || !payload?.length || label === undefined) return null
  const d = payload[0].payload
  let periodLabel: string
  if (view === 'annual')  periodLabel = `AÑO ${label}`
  else if (view === 'monthly') periodLabel = `MES ${label}  (AÑO ${Math.floor(label / 12)})`
  else { const m = Math.floor(label / 30); periodLabel = `DÍA ${label}  (MES ${m}, AÑO ${Math.floor(label / 365)})` }
  return (
    <div style={{ background: s.bgCard, border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 180 }}>
      <div style={{ color: s.textSec, marginBottom: 8, fontSize: 10, fontWeight: 600 }}>{periodLabel}</div>
      {([
        { label: 'Compuesto',      val: d.compound,    color: s.accent  },
        { label: 'Simple',         val: d.simple,      color: s.purple  },
        { label: 'Aportado',       val: d.contributed, color: s.blue    },
        { label: 'Total retirado', val: d.withdrawn,   color: s.orange  },
      ] as { label: string; val: number; color: string }[]).map(({ label: lbl, val, color }) => (
        <div key={lbl} style={{ marginBottom: 3, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: s.textSec }}>{lbl}</span>
          <span style={{ fontWeight: 700, color }}>{fmtFull(val)}</span>
        </div>
      ))}
    </div>
  )
}

// Reusable slider+input field — commits on blur/Enter, slider updates live
function Field({ label, value, onChange, min, max, step, prefix = '', suffix = '', s }: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number; prefix?: string; suffix?: string; s: Palette
}) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])
  const pct    = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const commit = () => {
    let n = parseFloat(raw.replace(/[^0-9.\-]/g, ''))
    if (isNaN(n)) n = value
    n = Math.min(max, Math.max(min, n))
    onChange(n); setRaw(String(n))
  }
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 10, color: s.textSec, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {prefix && <span style={{ fontSize: 12, color: s.accent, fontWeight: 700 }}>{prefix}</span>}
          <input
            type="text" inputMode="decimal" value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: 80, textAlign: 'right', background: s.bgCard2, border: `1px solid ${s.border}`, borderRadius: 5, color: s.accent, fontWeight: 700, fontSize: 13, padding: '3px 8px', outline: 'none', fontFamily: 'monospace' }}
          />
          {suffix && <span style={{ fontSize: 11, color: s.textSec, marginLeft: 3 }}>{suffix}</span>}
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: s.bgCard2, border: `1px solid ${s.border}` }} />
        <div style={{ position: 'absolute', left: 0, height: 3, borderRadius: 2, width: `${pct}%`, background: `linear-gradient(90deg,${s.accent2},${s.accent})`, pointerEvents: 'none' }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'relative', width: '100%', height: 20, WebkitAppearance: 'none', appearance: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', zIndex: 1 }}
          className="apex-calc-range" />
      </div>
    </div>
  )
}

// Rate field — same pattern as Field but with local raw state
function RateField({ value, onChange, s }: { value: number; onChange: (v: number) => void; s: Palette }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])
  const commit = () => {
    let n = parseFloat(raw.replace(/[^0-9.\-]/g, ''))
    if (isNaN(n)) n = value
    n = Math.min(500, Math.max(0, n))
    onChange(n); setRaw(String(n))
  }
  const pct = Math.min(100, Math.max(0, (value / 500) * 100))
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 10, color: s.textSec, textTransform: 'uppercase', letterSpacing: 0.6 }}>Tasa de interés</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input type="text" inputMode="decimal" value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: 68, textAlign: 'right', background: s.bgCard2, border: `1px solid ${s.border}`, borderRadius: 5, color: s.accent, fontWeight: 700, fontSize: 13, padding: '3px 8px', outline: 'none', fontFamily: 'monospace' }}
          />
          <span style={{ fontSize: 11, color: s.textSec, marginLeft: 3 }}>%</span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: s.bgCard2, border: `1px solid ${s.border}` }} />
        <div style={{ position: 'absolute', left: 0, height: 3, borderRadius: 2, width: `${pct}%`, background: `linear-gradient(90deg,${s.accent2},${s.accent})`, pointerEvents: 'none' }} />
        <input type="range" min={0} max={500} step={1} value={value}
          onChange={e => { const n = parseFloat(e.target.value); onChange(n); setRaw(String(n)) }}
          style={{ position: 'relative', width: '100%', height: 20, WebkitAppearance: 'none', appearance: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', zIndex: 1 }}
          className="apex-calc-range" />
      </div>
    </>
  )
}

// ── Defaults that produce visible growth ───────────────────────────────────
const INIT = { principal: 5000, contribution: 500, withdrawal: 0, rate: 35, years: 10, freqIdx: 0, rateTypeIdx: 0 as RateTypeIdx }

export default function CompoundCalculator() {
  const T = useTheme()

  const [principal,    setPrincipal]    = useState(INIT.principal)
  const [contribution, setContribution] = useState(INIT.contribution)
  const [withdrawal,   setWithdrawal]   = useState(INIT.withdrawal)
  const [rate,         setRate]         = useState(INIT.rate)
  const [years,        setYears]        = useState(INIT.years)
  const [freqIdx,      setFreqIdx]      = useState(INIT.freqIdx)
  const [rateTypeIdx,  setRateTypeIdx]  = useState<RateTypeIdx>(INIT.rateTypeIdx)
  const [dirty,        setDirty]        = useState(false)
  const [flash,        setFlash]        = useState(false)
  const [chartView,    setChartView]    = useState<ChartView>('annual')

  // Committed snapshot — only updated on CALCULAR click
  const [committed, setCommitted] = useState<CalcParams>({
    principal: INIT.principal, contribution: INIT.contribution, withdrawal: INIT.withdrawal,
    annualRate: INIT.rate, years: INIT.years, ppy: FREQS[INIT.freqIdx].ppy,
  })

  const ppy        = FREQS[freqIdx].ppy
  const annualRate = rate * RATE_TYPES[rateTypeIdx].mult

  const mark = () => setDirty(true)

  function doCalc(overrideYears?: number) {
    const newYears = overrideYears ?? years
    setCommitted({ principal, contribution, withdrawal, annualRate, years: newYears, ppy })
    if (overrideYears !== undefined) setYears(newYears)
    setDirty(false)
    // Flash feedback
    setFlash(true)
    setTimeout(() => setFlash(false), 600)
  }

  const { rows: data, depletionYear } = useMemo(() => simulate(committed), [committed])
  const chartData = useMemo(() => simulateChart(committed, chartView), [committed, chartView])

  const final        = data[data.length - 1]
  const totalContrib = final.contributed
  const interest     = Math.max(0, final.compound - totalContrib + final.withdrawn)
  const multiplier   = committed.principal > 0 ? final.compound / committed.principal : 0
  const compAdv      = final.compound - final.simple

  const tfResults = useMemo(
    () => TFS.map(y => ({ y, val: simulate({ ...committed, years: y }).rows.slice(-1)[0].compound })),
    [committed],
  )

  useEffect(() => {
    const id = 'apex-calc-style'
    if (document.getElementById(id)) return
    const st = document.createElement('style')
    st.id = id
    st.textContent = `
      .apex-calc-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:#00ff88;cursor:pointer;margin-top:-6px;box-shadow:0 0 0 3px rgba(0,0,0,.5),0 0 8px #00ff8866}
      .apex-calc-range::-moz-range-thumb{width:15px;height:15px;border-radius:50%;border:none;background:#00ff88;cursor:pointer;box-shadow:0 0 0 3px rgba(0,0,0,.5)}
    `
    document.head.appendChild(st)
  }, [])

  const s: Palette = {
    bgCard: T.card, bgCard2: T.bg, border: T.border, text: T.text,
    textSec: T.textSec, accent: T.accent, accent2: T.bull,
    orange: T.price, purple: T.warn, blue: T.danger, danger: T.danger,
  }

  const pillBtn = (active: boolean) => ({
    flex: 1, padding: '7px 0',
    background: active ? `${s.accent}18` : s.bgCard2,
    border: `1px solid ${active ? s.accent + '66' : s.border}`,
    borderRadius: 7, cursor: 'pointer',
    color: active ? s.accent : s.textSec,
    fontSize: 11, fontWeight: 600 as const, fontFamily: 'monospace',
  })

  return (
    <div style={{ padding: '10px 2px 32px', color: s.text }}>

      {/* Hero */}
      <div style={{ background: s.bgCard, border: `1px solid ${s.border}`, borderRadius: 12, padding: '20px', marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', background: `radial-gradient(circle,${s.accent}14,transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.8, marginBottom: 5 }}>
          VALOR PROYECTADO EN {committed.years} {committed.years === 1 ? 'AÑO' : 'AÑOS'}
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, color: depletionYear ? s.danger : s.accent, fontFamily: 'monospace', letterSpacing: -1, lineHeight: 1, marginBottom: 8 }}>
          {fmtFull(final.compound)}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: s.textSec }}>
          <span><span style={{ color: s.orange, fontWeight: 700 }}>{multiplier.toFixed(2)}×</span> capital inicial</span>
          <span><span style={{ color: s.purple, fontWeight: 700 }}>+{fmtCompact(compAdv)}</span> vs simple</span>
          <span style={{ color: s.textSec }}>
            Tasa {RATE_TYPES[rateTypeIdx].label.toLowerCase()}: <span style={{ color: s.accent }}>{rate}%</span>
            {rateTypeIdx !== 0 && <> → anual: <span style={{ color: s.accent }}>{annualRate}%</span></>}
          </span>
        </div>
      </div>

      {/* Depletion warning */}
      {depletionYear !== null && (
        <div style={{ background: `${s.danger}15`, border: `1px solid ${s.danger}55`, borderRadius: 10, padding: '11px 14px', marginBottom: 14, fontSize: 11, color: s.danger }}>
          ⚠️ El saldo se agota en el año {depletionYear} — los retiros superan el interés generado.
          Reduce el retiro mensual o aumenta el capital inicial.
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          { label: 'Aportado',       val: totalContrib,    col: s.text,   sub: `${fmtFull(committed.principal)} inicial + aportes` },
          { label: 'Interés ganado', val: interest,        col: s.accent, sub: `${totalContrib > 0 ? Math.round((interest / totalContrib) * 100) : 0}% retorno` },
          { label: 'Total retirado', val: final.withdrawn, col: s.orange, sub: `$${committed.withdrawal}/mes × ${committed.years} años` },
        ] as { label: string; val: number; col: string; sub: string }[]).map(({ label, val, col, sub }) => (
          <div key={label} style={{ background: s.bgCard, border: `1px solid ${col === s.text ? s.border : col + '44'}`, borderRadius: 10, padding: '13px 14px', flex: 1, minWidth: 100, position: 'relative', overflow: 'hidden' }}>
            {col !== s.text && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${col},transparent)` }} />}
            <div style={{ fontSize: 9, color: s.textSec, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col, fontFamily: 'monospace' }}>{fmtCompact(val)}</div>
            <div style={{ fontSize: 10, color: s.textSec, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: s.bgCard, border: `1px solid ${s.border}`, borderRadius: 12, padding: '14px 10px 6px', marginBottom: 14 }}>
        {/* Header row: title + legend + view toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 6px 10px', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.5, marginBottom: 6 }}>EVOLUCIÓN DE LA INVERSIÓN</div>
            {/* View toggle */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['annual', 'monthly', 'daily'] as ChartView[]).map(v => {
                const lbl = v === 'annual' ? 'Anual' : v === 'monthly' ? 'Mensual' : 'Diario'
                const active = chartView === v
                return (
                  <button key={v} onClick={() => setChartView(v)} style={{
                    padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontFamily: 'monospace',
                    background: active ? `${s.accent}22` : 'transparent',
                    border: `1px solid ${active ? s.accent + '88' : s.border}`,
                    color: active ? s.accent : s.textSec, fontWeight: active ? 700 : 400,
                  }}>{lbl}</button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 10, flexWrap: 'wrap', paddingTop: 2 }}>
            {([
              { color: s.accent, label: 'Compuesto', dash: false },
              { color: s.purple, label: 'Simple',     dash: true  },
              { color: s.blue,   label: 'Aportado',   dash: true  },
              { color: s.orange, label: 'Retirado',   dash: true  },
            ] as { color: string; label: string; dash: boolean }[]).map(({ color, label, dash }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: dash ? 0 : 2, minWidth: 10, borderTop: dash ? `1.5px dashed ${color}` : 'none', background: dash ? 'transparent' : color, borderRadius: 1 }} />
                <span style={{ color: s.textSec }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="apexCalcGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={s.accent} stopOpacity={0.32} />
                <stop offset="100%" stopColor={s.accent} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={s.border} vertical={false} />
            <XAxis
              dataKey="period"
              type="number"
              domain={[0, chartData.length - 1]}
              ticks={chartView === 'annual'
                ? Array.from({ length: committed.years + 1 }, (_, i) => i)
                : chartView === 'monthly'
                  ? Array.from({ length: committed.years + 1 }, (_, i) => i * 12)
                  : Array.from({ length: committed.years + 1 }, (_, i) => i * 365)
              }
              tickFormatter={p => {
                if (chartView === 'annual')  return `A${p}`
                if (chartView === 'monthly') return `A${p / 12}`
                return `A${Math.round(p / 365)}`
              }}
              stroke={s.textSec} tick={{ fontSize: 10, fontFamily: 'monospace', fill: s.textSec }}
              axisLine={{ stroke: s.border }} tickLine={false}
            />
            <YAxis tickFormatter={fmtCompact} stroke={s.textSec} tick={{ fontSize: 9, fontFamily: 'monospace', fill: s.textSec }} axisLine={false} tickLine={false} width={50} />
            <Tooltip content={<ApexTooltip s={s} view={chartView} />} />
            <Area type="monotone" dataKey="compound" stroke={s.accent} strokeWidth={2.5} fill="url(#apexCalcGrad)" dot={false} activeDot={{ r: 4, fill: s.accent }} />
            <Line type="monotone" dataKey="simple" stroke={s.purple} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: s.purple }} />
            <Line type="monotone" dataKey="contributed" stroke={s.blue} strokeWidth={1.2} strokeDasharray="2 4" dot={false} activeDot={{ r: 3, fill: s.blue }} />
            <Line type="monotone" dataKey="withdrawn" stroke={s.orange} strokeWidth={1.2} strokeDasharray="2 4" dot={false} activeDot={{ r: 3, fill: s.orange }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Timeframe row */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.5, marginBottom: 7 }}>PROYECCIÓN POR PERIODO — click para recalcular</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 3 }}>
          {tfResults.map(({ y, val }) => {
            const active = committed.years === y
            return (
              <button key={y} onClick={() => doCalc(y)} style={{ flex: '0 0 auto', minWidth: 80, background: active ? `${s.accent}14` : s.bgCard, border: `1px solid ${active ? s.accent + '66' : s.border}`, borderRadius: 9, padding: '9px 11px', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 9, color: active ? s.accent : s.textSec, fontFamily: 'monospace', marginBottom: 3 }}>{y} AÑO{y > 1 ? 'S' : ''}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: active ? s.text : s.textSec, fontFamily: 'monospace' }}>{fmtCompact(val)}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Controls */}
      <div style={{ background: s.bgCard, border: `1px solid ${dirty ? s.accent + '66' : s.border}`, borderRadius: 12, padding: '16px 15px', transition: 'border-color .3s' }}>
        <div style={{ fontSize: 10, color: dirty ? s.accent : s.textSec, letterSpacing: 0.5, marginBottom: 16, transition: 'color .3s' }}>
          {dirty ? '● PARÁMETROS MODIFICADOS — presiona CALCULAR' : 'PARÁMETROS'}
        </div>

        <Field s={s} label="Capital inicial"  value={principal}    onChange={v => { setPrincipal(v);    mark() }} min={0} max={500000} step={100} prefix="$" />
        <Field s={s} label="Aporte mensual"   value={contribution} onChange={v => { setContribution(v); mark() }} min={0} max={20000}  step={50}  prefix="$" />
        <Field s={s} label="Retiro mensual"   value={withdrawal}   onChange={v => { setWithdrawal(v);   mark() }} min={0} max={20000}  step={50}  prefix="$" />

        {/* Rate + type */}
        <div style={{ marginBottom: 18 }}>
          <RateField value={rate} onChange={v => { setRate(v); mark() }} s={s} />
          <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
            {RATE_TYPES.map((rt, i) => (
              <button key={rt.label} onClick={() => { setRateTypeIdx(i as RateTypeIdx); mark() }} style={pillBtn(rateTypeIdx === i)}>{rt.label}</button>
            ))}
          </div>
          {rateTypeIdx !== 0 && (
            <div style={{ fontSize: 9, color: s.textSec }}>
              Equivalente anual: <span style={{ color: s.accent, fontWeight: 700 }}>{annualRate}%</span>
            </div>
          )}
        </div>

        <Field s={s} label="Periodo" value={years} onChange={v => { setYears(v); mark() }} min={1} max={30} step={1} suffix=" años" />

        {/* Compounding freq */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: s.textSec, marginBottom: 8 }}>FRECUENCIA DE CAPITALIZACIÓN</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {FREQS.map((f, i) => (
              <button key={f.label} onClick={() => { setFreqIdx(i); mark() }} style={pillBtn(freqIdx === i)}>{f.label}</button>
            ))}
          </div>
        </div>

        {/* CALCULAR */}
        <button
          onClick={() => doCalc()}
          style={{
            width: '100%', padding: '14px 0',
            background: flash ? s.accent : dirty ? `${s.accent}22` : `${s.accent}10`,
            border: `2px solid ${dirty || flash ? s.accent : s.border}`,
            borderRadius: 9, cursor: 'pointer',
            color: flash ? s.bgCard : dirty ? s.accent : s.textSec,
            fontSize: 13, fontWeight: 800, letterSpacing: 2,
            fontFamily: 'monospace', transition: 'all .15s',
            boxShadow: dirty ? `0 0 20px ${s.accent}44` : 'none',
          }}
        >
          {flash ? '✓ CALCULADO' : dirty ? '▶  CALCULAR' : '▶  CALCULAR'}
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 9, color: s.textSec, lineHeight: 1.6 }}>
        Proyección con tasa fija — no considera volatilidad, drawdowns ni interrupciones.
      </div>
    </div>
  )
}
