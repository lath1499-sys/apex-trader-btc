'use client'
import { useState } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'

type Side = 'LONG' | 'SHORT'
type Entry = {
  id: number; date: string; side: Side; entry: number; exit: number
  size: number; pnl: number; tag: string; notes: string
}

function calcPnl(side: Side, entry: number, exit: number, size: number): number {
  if (!entry || !exit || !size) return 0
  return side === 'LONG' ? (exit - entry) / entry * size * 100 : (entry - exit) / entry * size * 100
}

export default function TradeJournal() {
  const T = useTheme()
  const [trades, setTrades] = useState<Entry[]>([])
  const [form, setForm] = useState({ side: 'LONG' as Side, entry: '', exit: '', size: '', tag: '', notes: '' })

  function addTrade() {
    const e = parseFloat(form.entry), x = parseFloat(form.exit), s = parseFloat(form.size)
    if (!e || !x || !s) return
    const pnl = calcPnl(form.side, e, x, s)
    setTrades(prev => [{
      id: Date.now(), date: new Date().toLocaleDateString(), side: form.side,
      entry: e, exit: x, size: s, pnl, tag: form.tag, notes: form.notes,
    }, ...prev])
    setForm({ side: 'LONG', entry: '', exit: '', size: '', tag: '', notes: '' })
  }

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins     = trades.filter(t => t.pnl > 0).length
  const wr       = trades.length ? Math.round(wins / trades.length * 100) : 0

  const inp = (key: keyof typeof form, label: string, ph = '') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 8, color: T.muted }}>{label}</label>
      <input value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={ph}
        style={{ background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: 'inherit', fontSize: 11, padding: '6px 9px', borderRadius: 5, outline: 'none' }} />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Stats */}
      {trades.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            ['TRADES', trades.length.toString(), T.accent],
            ['WIN RATE', wr + '%', wr >= 55 ? T.bull : wr >= 45 ? T.warn : T.danger],
            ['P&L TOTAL', (totalPnl >= 0 ? '+' : '') + fmt(totalPnl, 2) + '%', totalPnl >= 0 ? T.bull : T.danger],
          ].map(([l, v, c]) => (
            <div key={l as string} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>REGISTRAR TRADE</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 8, color: T.muted }}>LADO</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['LONG', 'SHORT'] as Side[]).map(s => (
                <button key={s} onClick={() => setForm(p => ({ ...p, side: s }))} style={{
                  flex: 1, background: form.side === s ? (s === 'LONG' ? T.bull : T.danger) + '22' : 'transparent',
                  border: `1px solid ${form.side === s ? (s === 'LONG' ? T.bull : T.danger) : T.border}`,
                  color: form.side === s ? (s === 'LONG' ? T.bull : T.danger) : T.textSec,
                  padding: '6px 4px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9,
                }}>{s}</button>
              ))}
            </div>
          </div>
          {inp('entry', 'ENTRADA', '95000')}
          {inp('exit',  'SALIDA',  '96500')}
          {inp('size',  'TAMAÑO %', '2')}
          {inp('tag',   'TAG',     'setup, SFP...')}
        </div>
        <div style={{ marginBottom: 10 }}>{inp('notes', 'NOTAS', 'Descripción del trade...')}</div>
        <button onClick={addTrade} style={{
          background: T.accent + '22', border: `1px solid ${T.accent}`, color: T.accent,
          padding: '7px 20px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
        }}>+ Registrar</button>
      </div>

      {/* List */}
      {trades.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: 30, textAlign: 'center', color: T.textSec, fontSize: 11 }}>
          Sin trades registrados. Añade tu primer trade arriba.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
          {trades.map(t => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '60px 60px 1fr 1fr 1fr 80px', gap: 6, padding: '8px 12px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, alignItems: 'center', fontSize: 10 }}>
              <span style={{ color: T.muted, fontSize: 8 }}>{t.date}</span>
              <span style={{ color: t.side === 'LONG' ? T.bull : T.danger, fontWeight: 700 }}>{t.side}</span>
              <span style={{ color: T.textSec, fontFamily: 'monospace' }}>${fmt(t.entry, 0)}</span>
              <span style={{ color: T.textSec, fontFamily: 'monospace' }}>${fmt(t.exit, 0)}</span>
              <span style={{ fontSize: 8, color: T.muted }}>{t.tag}</span>
              <span style={{ color: t.pnl >= 0 ? T.bull : T.danger, fontWeight: 700, textAlign: 'right' }}>{t.pnl >= 0 ? '+' : ''}{fmt(t.pnl, 2)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
