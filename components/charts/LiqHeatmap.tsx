'use client'
import { useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'

const LEVS = [2, 3, 5, 10, 15, 20, 25, 50, 100]

export default function LiqHeatmap() {
  const T     = useTheme()
  const mkt   = useApexStore(s => s.mkt)
  const price = mkt.price
  const [cursorPrice, setCursorPrice] = useState<number | null>(null)

  if (!price) return null

  const range = price * 0.30
  const mn = price - range, mx = price + range
  const steps = 30, step = (mx - mn) / steps

  const bars = Array.from({ length: steps }, (_, i) => {
    const lo = mn + i * step, hi = lo + step, mid = (lo + hi) / 2
    let longLiq = 0, shortLiq = 0
    LEVS.forEach(lv => {
      const w = 1 / lv
      if (price * (1 - 1 / lv) >= lo && price * (1 - 1 / lv) < hi) longLiq  += w * 100
      if (price * (1 + 1 / lv) >= lo && price * (1 + 1 / lv) < hi) shortLiq += w * 100
    })
    return { lo, hi, mid, longLiq, shortLiq, total: longLiq + shortLiq }
  })

  const maxT  = Math.max(...bars.map(b => b.total), 1)
  const toY   = (p: number) => ((p - mn) / (mx - mn)) * 100

  return (
    <div>
      <div
        style={{ position: 'relative', height: 360, background: T.card, borderRadius: 8, overflow: 'hidden', marginBottom: 12, border: `1px solid ${T.border}`, cursor: 'crosshair' }}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setCursorPrice(mn + (1 - (e.clientY - r.top) / r.height) * (mx - mn)) }}
        onMouseLeave={() => setCursorPrice(null)}
      >
        {bars.map((b, i) => {
          const y = 100 - toY(b.hi), h = toY(b.hi) - toY(b.lo)
          const lW = (b.longLiq / maxT) * 45, sW = (b.shortLiq / maxT) * 45
          const isPrice = price >= b.lo && price < b.hi
          return (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${y}%`, height: `${h}%`, display: 'flex', alignItems: 'center' }}>
              {isPrice && <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: T.text, zIndex: 5, opacity: .9 }} />}
              {b.longLiq  > 0 && <div style={{ position: 'absolute', left: `${50 - lW}%`, width: `${lW}%`, height: '80%', background: T.danger + '77', borderRadius: '2px 0 0 2px' }} />}
              {b.shortLiq > 0 && <div style={{ position: 'absolute', left: '50%', width: `${sW}%`, height: '80%', background: T.bull + '77', borderRadius: '0 2px 2px 0' }} />}
              {isPrice && <div style={{ position: 'absolute', right: 4, fontSize: 8, color: T.text, fontFamily: 'monospace', zIndex: 6, background: T.card, padding: '0 3px' }}>▶ ${fmt(price, 0)}</div>}
              <div style={{ position: 'absolute', left: 2, fontSize: 7, color: T.textSec, fontFamily: 'monospace' }}>${Math.round(b.mid).toLocaleString()}</div>
            </div>
          )
        })}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: T.border, opacity: .3 }} />
        {cursorPrice != null && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: `${((1 - (cursorPrice - mn) / (mx - mn)) * 100).toFixed(1)}%`, height: 1, background: T.warn, zIndex: 10 }}>
            <div style={{ position: 'absolute', right: 4, top: -13, background: T.warn, color: '#000', fontSize: 9, fontFamily: 'monospace', fontWeight: 700, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
              ${Math.round(cursorPrice).toLocaleString()}
            </div>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 2, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 4px', fontSize: 7, color: T.muted, fontFamily: 'monospace' }}>
          <span>← LONGS LIQ</span><span>SHORTS LIQ →</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[5, 10, 20, 50].map(lv => (
          <div key={lv} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 5, padding: '6px 10px', flex: 1, minWidth: 110 }}>
            <div style={{ fontSize: 7, color: T.textSec, letterSpacing: '.1em', marginBottom: 3 }}>{lv}x LEVERAGE</div>
            <div style={{ fontSize: 10, color: T.danger }}>Long LIQ: ${fmt(price * (1 - 1 / lv), 0)}</div>
            <div style={{ fontSize: 10, color: T.bull }}>Short LIQ: ${fmt(price * (1 + 1 / lv), 0)}</div>
            <div style={{ fontSize: 8, color: T.muted }}>±{(1 / lv * 100).toFixed(1)}% desde precio</div>
          </div>
        ))}
      </div>
    </div>
  )
}
