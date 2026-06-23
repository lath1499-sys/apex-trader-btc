'use client'
import React, { useState, useMemo, useEffect } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '@/hooks/useTheme'

const fmtFull = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

const fmtCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'k'
  return '$' + Math.round(n)
}

const FREQS = [
  { label: 'Mensual',    ppy: 12 },
  { label: 'Trimestral', ppy: 4  },
  { label: 'Anual',      ppy: 1  },
]
const TFS = [1, 3, 5, 10, 20]

interface Row {
  year: number
  compound: number
  contributed: number
  simple: number
  withdrawn: number
}

function simulate(
  principal: number, contribution: number, withdrawal: number,
  ratePct: number, years: number, ppy: number,
): Row[] {
  const r       = ratePct / 100 / ppy
  const contribP = contribution * (12 / ppy)
  const wdP      = withdrawal   * (12 / ppy)
  const periods  = Math.round(years * ppy)
  let bal = principal, totalContrib = principal, totalWd = 0
  const rows: Row[] = [{ year: 0, compound: principal, contributed: principal, simple: principal, withdrawn: 0 }]
  for (let i = 1; i <= periods; i++) {
    bal = bal * (1 + r) + contribP - wdP
    if (bal < 0) bal = 0
    totalContrib += contribP
    totalWd      += wdP
    if (i % ppy === 0) {
      const yr  = i / ppy
      const sim = principal * (1 + (ratePct / 100) * yr) + (totalContrib - principal - totalWd)
      rows.push({
        year:        yr,
        compound:    Math.round(Math.max(0, bal)),
        contributed: Math.round(totalContrib),
        simple:      Math.round(Math.max(0, sim)),
        withdrawn:   Math.round(totalWd),
      })
    }
  }
  return rows
}

interface Palette {
  bgCard: string; bgCard2: string; border: string; text: string
  textSec: string; accent: string; accent2: string
  orange: string; purple: string; blue: string
}

function ApexTooltip({ active, payload, label, s }: { active?: boolean; payload?: { payload: Row }[]; label?: number; s: Palette }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: s.bgCard, border: `1px solid ${s.border}`,
      borderRadius: 8, padding: '10px 14px', fontSize: 11,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 160,
    }}>
      <div style={{ color: s.textSec, marginBottom: 8, fontSize: 10, fontWeight: 600 }}>
        AÑO {label}
      </div>
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

interface FieldProps {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number
  prefix?: string; suffix?: string; s: Palette
}

function Field({ label, value, onChange, min, max, step, prefix = '', suffix = '', s }: FieldProps) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const commit = () => {
    let n = parseFloat(raw.replace(/[^0-9.\-]/g, ''))
    if (isNaN(n)) n = value
    n = Math.min(max, Math.max(min, n))
    onChange(n)
    setRaw(String(n))
  }
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 10, color: s.textSec, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {prefix && <span style={{ fontSize: 12, color: s.accent, fontWeight: 700 }}>{prefix}</span>}
          <input
            type="text" inputMode="decimal" value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{
              width: 68, textAlign: 'right',
              background: s.bgCard2,
              border: `1px solid ${s.border}`,
              borderRadius: 5, color: s.accent,
              fontWeight: 700, fontSize: 13,
              padding: '3px 6px', outline: 'none', fontFamily: 'monospace',
            }}
          />
          {suffix && <span style={{ fontSize: 11, color: s.textSec, marginLeft: 2 }}>{suffix}</span>}
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 3,
          borderRadius: 2, background: s.bgCard2,
          border: `1px solid ${s.border}`,
        }} />
        <div style={{
          position: 'absolute', left: 0, height: 3, borderRadius: 2,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${s.accent2}, ${s.accent})`,
          pointerEvents: 'none',
        }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{
            position: 'relative', width: '100%', height: 20,
            WebkitAppearance: 'none', appearance: 'none',
            background: 'transparent', outline: 'none', cursor: 'pointer', zIndex: 1,
          }}
          className="apex-calc-range"
        />
      </div>
    </div>
  )
}

export default function CompoundCalculator() {
  const T = useTheme()

  const [principal,    setPrincipal]    = useState(1890)
  const [contribution, setContribution] = useState(200)
  const [withdrawal,   setWithdrawal]   = useState(500)
  const [rate,         setRate]         = useState(35)
  const [years,        setYears]        = useState(5)
  const [freqIdx,      setFreqIdx]      = useState(0)

  const ppy  = FREQS[freqIdx].ppy
  const data = useMemo(
    () => simulate(principal, contribution, withdrawal, rate, years, ppy),
    [principal, contribution, withdrawal, rate, years, ppy],
  )
  const final        = data[data.length - 1]
  const totalContrib = final.contributed
  const interest     = Math.max(0, final.compound - totalContrib + final.withdrawn)
  const multiplier   = principal > 0 ? final.compound / principal : 0
  const compAdv      = final.compound - final.simple

  const tfResults = useMemo(
    () => TFS.map(y => ({
      y,
      val: simulate(principal, contribution, withdrawal, rate, y, ppy).slice(-1)[0].compound,
    })),
    [principal, contribution, withdrawal, rate, ppy],
  )

  useEffect(() => {
    const id = 'apex-calc-style'
    if (document.getElementById(id)) return
    const st = document.createElement('style')
    st.id = id
    st.textContent = `
      .apex-calc-range::-webkit-slider-thumb {
        -webkit-appearance:none;appearance:none;
        width:15px;height:15px;border-radius:50%;
        background:#00ff88;cursor:pointer;margin-top:-6px;
        box-shadow:0 0 0 3px rgba(0,0,0,0.5),0 0 8px #00ff8866;
      }
      .apex-calc-range::-moz-range-thumb {
        width:15px;height:15px;border-radius:50%;border:none;
        background:#00ff88;cursor:pointer;
        box-shadow:0 0 0 3px rgba(0,0,0,0.5);
      }
    `
    document.head.appendChild(st)
  }, [])

  const s: Palette = {
    bgCard:  T.card,
    bgCard2: T.bg,
    border:  T.border,
    text:    T.text,
    textSec: T.textSec,
    accent:  T.accent,
    accent2: T.bull,
    orange:  T.price,
    purple:  T.warn,
    blue:    T.danger,
  }

  return (
    <div style={{ padding: '10px 2px 32px', color: s.text }}>

      {/* Hero */}
      <div style={{
        background: s.bgCard, border: `1px solid ${s.border}`,
        borderRadius: 12, padding: '20px', marginBottom: 14,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -30,
          width: 130, height: 130, borderRadius: '50%',
          background: `radial-gradient(circle, ${s.accent}14, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.8, marginBottom: 5 }}>
          VALOR PROYECTADO EN {years} {years === 1 ? 'AÑO' : 'AÑOS'}
        </div>
        <div style={{
          fontSize: 36, fontWeight: 800, color: s.accent,
          fontFamily: 'monospace', letterSpacing: -1, lineHeight: 1, marginBottom: 8,
        }}>
          {fmtFull(final.compound)}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: s.textSec }}>
          <span><span style={{ color: s.orange, fontWeight: 700 }}>{multiplier.toFixed(2)}×</span> capital inicial</span>
          <span><span style={{ color: s.purple, fontWeight: 700 }}>+{fmtCompact(compAdv)}</span> vs interés simple</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          { label: 'Aportado',       val: totalContrib,    col: s.text,   sub: `${fmtFull(principal)} inicial + aportes` },
          { label: 'Interés ganado', val: interest,        col: s.accent, sub: `${totalContrib > 0 ? Math.round((interest / totalContrib) * 100) : 0}% retorno` },
          { label: 'Total retirado', val: final.withdrawn, col: s.orange, sub: `$${withdrawal}/mes × ${years} años` },
        ] as { label: string; val: number; col: string; sub: string }[]).map(({ label, val, col, sub }) => (
          <div key={label} style={{
            background: s.bgCard,
            border: `1px solid ${col === s.text ? s.border : col + '44'}`,
            borderRadius: 10, padding: '13px 14px',
            flex: 1, minWidth: 100, position: 'relative', overflow: 'hidden',
          }}>
            {col !== s.text && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg,transparent,${col},transparent)`,
              }} />
            )}
            <div style={{ fontSize: 9, color: s.textSec, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col, fontFamily: 'monospace' }}>{fmtCompact(val)}</div>
            <div style={{ fontSize: 10, color: s.textSec, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: s.bgCard, border: `1px solid ${s.border}`, borderRadius: 12, padding: '14px 10px 6px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px 10px', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.5 }}>EVOLUCIÓN DE LA INVERSIÓN</span>
          <div style={{ display: 'flex', gap: 10, fontSize: 10, flexWrap: 'wrap' }}>
            {([
              { color: s.accent, label: 'Compuesto', dash: false },
              { color: s.purple, label: 'Simple',     dash: true  },
              { color: s.blue,   label: 'Aportado',   dash: true  },
              { color: s.orange, label: 'Retirado',   dash: true  },
            ] as { color: string; label: string; dash: boolean }[]).map(({ color, label, dash }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 10, height: dash ? 0 : 2, minWidth: 10,
                  borderTop: dash ? `1.5px dashed ${color}` : 'none',
                  background: dash ? 'transparent' : color, borderRadius: 1,
                }} />
                <span style={{ color: s.textSec }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="apexCalcGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={s.accent} stopOpacity={0.32} />
                <stop offset="100%" stopColor={s.accent} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={s.border} vertical={false} />
            <XAxis dataKey="year" tickFormatter={y => `A${y}`} stroke={s.textSec}
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: s.textSec }}
              axisLine={{ stroke: s.border }} tickLine={false} />
            <YAxis tickFormatter={fmtCompact} stroke={s.textSec}
              tick={{ fontSize: 9, fontFamily: 'monospace', fill: s.textSec }}
              axisLine={false} tickLine={false} width={50} />
            <Tooltip content={<ApexTooltip s={s} />} />
            <Area type="monotone" dataKey="compound" stroke={s.accent} strokeWidth={2.5}
              fill="url(#apexCalcGrad)" dot={false} activeDot={{ r: 4, fill: s.accent }} />
            <Line type="monotone" dataKey="simple" stroke={s.purple} strokeWidth={1.5}
              strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: s.purple }} />
            <Line type="monotone" dataKey="contributed" stroke={s.blue} strokeWidth={1.2}
              strokeDasharray="2 4" dot={false} activeDot={{ r: 3, fill: s.blue }} />
            <Line type="monotone" dataKey="withdrawn" stroke={s.orange} strokeWidth={1.2}
              strokeDasharray="2 4" dot={false} activeDot={{ r: 3, fill: s.orange }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Timeframe row */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.5, marginBottom: 7 }}>PROYECCIÓN POR PERIODO</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 3 }}>
          {tfResults.map(({ y, val }) => {
            const active = years === y
            return (
              <button key={y} onClick={() => setYears(y)} style={{
                flex: '0 0 auto', minWidth: 80,
                background: active ? `${s.accent}14` : s.bgCard,
                border: `1px solid ${active ? s.accent + '66' : s.border}`,
                borderRadius: 9, padding: '9px 11px',
                cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ fontSize: 9, color: active ? s.accent : s.textSec, fontFamily: 'monospace', marginBottom: 3 }}>
                  {y} AÑO{y > 1 ? 'S' : ''}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: active ? s.text : s.textSec, fontFamily: 'monospace' }}>
                  {fmtCompact(val)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Controls */}
      <div style={{ background: s.bgCard, border: `1px solid ${s.border}`, borderRadius: 12, padding: '16px 15px' }}>
        <div style={{ fontSize: 10, color: s.textSec, letterSpacing: 0.5, marginBottom: 16 }}>
          PARÁMETROS — escribe el valor o usa el slider
        </div>
        <Field s={s} label="Capital inicial"       value={principal}    onChange={setPrincipal}    min={0} max={500000} step={100}  prefix="$" />
        <Field s={s} label="Aporte mensual"        value={contribution} onChange={setContribution} min={0} max={20000}  step={50}   prefix="$" />
        <Field s={s} label="Retiro mensual"        value={withdrawal}   onChange={setWithdrawal}   min={0} max={20000}  step={50}   prefix="$" />
        <Field s={s} label="Tasa de interés anual" value={rate}         onChange={setRate}         min={0} max={500}    step={1}    suffix="%" />
        <Field s={s} label="Periodo"               value={years}        onChange={setYears}        min={1} max={30}     step={1}    suffix=" años" />
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: s.textSec, marginBottom: 8 }}>FRECUENCIA DE CAPITALIZACIÓN</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {FREQS.map((f, i) => (
              <button key={f.label} onClick={() => setFreqIdx(i)} style={{
                flex: 1, padding: '7px 0',
                background: freqIdx === i ? `${s.accent}18` : s.bgCard2,
                border: `1px solid ${freqIdx === i ? s.accent + '66' : s.border}`,
                borderRadius: 7, cursor: 'pointer',
                color: freqIdx === i ? s.accent : s.textSec,
                fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
              }}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 9, color: s.textSec, lineHeight: 1.6 }}>
        Proyección con tasa fija — no considera volatilidad, drawdowns ni interrupciones.
      </div>
    </div>
  )
}
