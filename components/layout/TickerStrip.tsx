'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt, fmtB } from '@/lib/buildContext'
import { getSession } from '@/lib/cycle'

export default function TickerStrip() {
  const T   = useTheme()
  const mkt = useApexStore(s => s.mkt)
  const sess = getSession()

  const FC =
    (mkt.funding ?? 0) > 0.05  ? T.danger :
    (mkt.funding ?? 0) < -0.01 ? T.bull   :
    (mkt.funding ?? 0) > 0.01  ? T.warn   : T.accent

  const items: [string, string, string][] = [
    ['FUNDING', mkt.funding != null ? (mkt.funding > 0 ? '+' : '') + fmt(mkt.funding, 4) + '%' : '—', FC],
    ['OI',      mkt.oi ? fmt(mkt.oi, 0) + ' BTC' : '—', '#8ab0aa'],
    ['L/S',     mkt.lsr ? fmt(mkt.lsr, 2) : '—', (mkt.lsr ?? 1) > 1.6 ? T.danger : (mkt.lsr ?? 1) < 0.65 ? T.bull : T.warn],
    ['F&G',     mkt.fg != null ? `${mkt.fg} — ${mkt.fgLabel ?? ''}` : '—', (mkt.fg ?? 50) < 25 ? T.danger : (mkt.fg ?? 50) > 75 ? T.warn : T.bull],
    ['MARK',    '$' + fmt(mkt.mark), T.textSec],
    ['VOL 24H', fmtB(mkt.vol), T.textSec],
    ['SESIÓN',  sess.n, sess.c],
    ['BYBIT',   mkt.bybitPrice ? '$' + fmt(mkt.bybitPrice, 0) : '—', T.textSec],
    ['KRAKEN',  mkt.krakenPrice ? '$' + fmt(mkt.krakenPrice, 0) : '—', T.textSec],
  ]

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, flexWrap: 'wrap' }}>
      {items.map(([label, value, color]) => (
        <div key={label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 14px', flexShrink: 0, minWidth: 110 }}>
          <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.12em', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, color, fontWeight: 700 }}>{value}</div>
        </div>
      ))}
    </div>
  )
}
