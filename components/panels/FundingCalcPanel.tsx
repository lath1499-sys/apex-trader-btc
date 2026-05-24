'use client'
import { useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'

export default function FundingCalcPanel() {
  const T   = useTheme()
  const mkt = useApexStore(s => s.mkt)

  const [size,    setSize]    = useState('1000')
  const [rate,    setRate]    = useState(String(Math.abs(mkt.funding ?? 0.01).toFixed(4)))
  const [hours,   setHours]   = useState('8')
  const [periods, setPeriods] = useState('3')

  const sizeN    = parseFloat(size)    || 0
  const rateN    = parseFloat(rate)    || 0
  const hoursN   = parseFloat(hours)   || 8
  const periodsN = parseFloat(periods) || 3

  const perPeriod = sizeN * rateN / 100
  const daily     = sizeN * rateN / 100 * (24 / hoursN)
  const totalCost = perPeriod * periodsN
  const weekly    = daily * 7
  const monthly   = daily * 30

  const fundingRate = mkt.funding ?? 0
  const fundingCol  = fundingRate > 0.05 ? T.danger : fundingRate < -0.01 ? T.bull : T.warn

  const inp = (label: string, val: string, set: (v: string) => void, unit = '') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 8, color: T.muted, letterSpacing: '.12em' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: '7px 10px' }}>
        <input type="number" value={val} onChange={e => set(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', color: T.text, fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
        {unit && <span style={{ fontSize: 9, color: T.muted }}>{unit}</span>}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Live rate */}
      <div style={{ background: T.card, border: `1px solid ${fundingCol}33`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 6 }}>FUNDING RATE ACTUAL — BINANCE PERP</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: fundingCol }}>{fundingRate > 0 ? '+' : ''}{fmt(fundingRate, 4)}%</div>
        <div style={{ fontSize: 10, color: fundingCol, marginTop: 4 }}>
          {fundingRate > 0.05 ? '🔴 Longs pagando mucho — cuidado con posiciones largas' :
           fundingRate > 0.01 ? '🟡 Funding positivo — longs pagan a shorts' :
           fundingRate > -0.01 ? '🟢 Neutral' :
           '🟢 Shorts pagando — oportunidad para longs'}
        </div>
        <button onClick={() => setRate(String(Math.abs(fundingRate).toFixed(4)))}
          style={{ marginTop: 10, background: T.accent + '22', border: `1px solid ${T.accent}`, color: T.accent, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 8 }}>
          Usar tasa actual
        </button>
      </div>

      {/* Inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {inp('TAMAÑO POSICIÓN', size, setSize, 'USDT')}
        {inp('TASA FUNDING', rate, setRate, '%')}
        {inp('CADA (HORAS)', hours, setHours, 'h')}
        {inp('PERÍODOS', periods, setPeriods, 'x')}
      </div>

      {/* Results */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          ['POR PERÍODO', '$' + fmt(perPeriod, 4), T.warn],
          ['COSTO TOTAL', '$' + fmt(totalCost, 4), T.danger],
          ['DIARIO', '$' + fmt(daily, 4), T.textSec],
          ['SEMANAL', '$' + fmt(weekly, 3), T.textSec],
          ['MENSUAL', '$' + fmt(monthly, 2), T.textSec],
          ['% DEL TAMAÑO', fmt(totalCost / sizeN * 100, 4) + '%', totalCost / sizeN > 0.001 ? T.danger : T.textSec],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 14px', fontSize: 9, color: T.textSec, lineHeight: 1.8 }}>
        <span style={{ color: T.warn, fontWeight: 700 }}>Nota:</span> El funding se paga/recibe cada 8h en Binance. Tasas &gt;0.1% indican mercado sobrecalentado.
      </div>
    </div>
  )
}
