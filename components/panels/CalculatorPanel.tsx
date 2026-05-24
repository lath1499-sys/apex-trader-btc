'use client'
import { useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'

export default function CalculatorPanel() {
  const T   = useTheme()
  const mkt = useApexStore(s => s.mkt)

  const [capital,  setCapital]  = useState('10000')
  const [risk,     setRisk]     = useState('1')
  const [entry,    setEntry]    = useState(String(Math.round(mkt.price || 50000)))
  const [sl,       setSl]       = useState('')
  const [leverage, setLeverage] = useState('10')

  const cap  = parseFloat(capital)  || 0
  const r    = parseFloat(risk)     || 0
  const ent  = parseFloat(entry)    || 0
  const stop = parseFloat(sl)       || 0
  const lev  = parseFloat(leverage) || 1

  const riskAmt    = cap * r / 100
  const stopPct    = stop && ent ? Math.abs((ent - stop) / ent * 100) : 0
  const posSizeUSD = stopPct > 0 ? riskAmt / (stopPct / 100) : 0
  const posSizeBTC = ent > 0 ? posSizeUSD / ent : 0
  const margin     = posSizeUSD / lev
  const liqDist    = ent / lev
  const liqLong    = ent - liqDist
  const liqShort   = ent + liqDist

  const input = (label: string, val: string, set: (v: string) => void, unit = '') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 9, color: T.muted, letterSpacing: '.12em' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: '7px 10px' }}>
        <input
          type="number" value={val} onChange={e => set(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', color: T.text, fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
        />
        {unit && <span style={{ fontSize: 9, color: T.muted }}>{unit}</span>}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {input('CAPITAL TOTAL', capital, setCapital, 'USDT')}
        {input('RIESGO POR TRADE', risk, setRisk, '%')}
        {input('PRECIO DE ENTRADA', entry, setEntry, 'USDT')}
        {input('STOP LOSS', sl, setSl, 'USDT')}
        {input('APALANCAMIENTO', leverage, setLeverage, 'x')}
      </div>

      {/* Results */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          ['RIESGO $', '$' + fmt(riskAmt, 2), T.danger],
          ['STOP %', fmt(stopPct, 3) + '%', T.warn],
          ['TAMAÑO POSICIÓN', '$' + fmt(posSizeUSD, 0), T.text],
          ['TAMAÑO BTC', fmt(posSizeBTC, 5) + ' BTC', T.accent],
          ['MARGEN REQUERIDO', '$' + fmt(margin, 2), T.warn],
          ['APALANCAMIENTO', lev + 'x', lev > 20 ? T.danger : lev > 10 ? T.warn : T.bull],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: '12px 14px' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Liquidation */}
      <div style={{ background: T.card, border: `1px solid ${T.danger}33`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>PRECIOS DE LIQUIDACIÓN (estimado)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 8, color: T.bull, marginBottom: 3 }}>LONG</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.danger }}>${fmt(liqLong, 0)}</div>
            <div style={{ fontSize: 8, color: T.muted }}>{fmt(Math.abs(liqLong - ent) / ent * 100, 2)}% debajo de entrada</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: T.danger, marginBottom: 3 }}>SHORT</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.danger }}>${fmt(liqShort, 0)}</div>
            <div style={{ fontSize: 8, color: T.muted }}>{fmt(Math.abs(liqShort - ent) / ent * 100, 2)}% encima de entrada</div>
          </div>
        </div>
      </div>

      {/* Regla */}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 14px', fontSize: 9, color: T.textSec, lineHeight: 1.8 }}>
        <span style={{ color: T.warn, fontWeight: 700 }}>Regla de oro APEX:</span> Nunca arriesgues más del 1-2% del capital por trade. Con apalancamiento &gt;20x el riesgo de liquidación es extremo.
      </div>
    </div>
  )
}
