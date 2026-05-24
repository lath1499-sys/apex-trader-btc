'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'

export default function OrderBookPanel() {
  const T   = useTheme()
  const ob  = useApexStore(s => s.orderBook)
  const mkt = useApexStore(s => s.mkt)

  if (!ob) return (
    <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>
      Cargando order book...
    </div>
  )

  // bids/asks come as [string, string] tuples from Binance
  const asks = [...ob.asks].map(([p, q]) => [parseFloat(p), parseFloat(q)] as [number, number])
    .sort((a, b) => a[0] - b[0]).slice(0, 15)
  const bids = [...ob.bids].map(([p, q]) => [parseFloat(p), parseFloat(q)] as [number, number])
    .sort((a, b) => b[0] - a[0]).slice(0, 15)

  const maxQty = asks.length || bids.length
    ? Math.max(...asks.map(r => r[1]), ...bids.map(r => r[1]))
    : 1

  const totalBid = bids.reduce((s, r) => s + r[1], 0)
  const totalAsk = asks.reduce((s, r) => s + r[1], 0)
  const bidPct   = Math.round(totalBid / (totalBid + totalAsk) * 100)

  const spread    = asks.length && bids.length ? asks[0][0] - bids[0][0] : 0
  const spreadPct = mkt.price ? (spread / mkt.price * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          ['SPREAD', '$' + fmt(spread, 2) + ' (' + fmt(spreadPct, 3) + '%)', T.warn],
          ['TOTAL BIDS', fmt(totalBid, 2) + ' BTC', T.bull],
          ['TOTAL ASKS', fmt(totalAsk, 2) + ' BTC', T.danger],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Bid/Ask pressure bar */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 6 }}>
          <span style={{ color: T.bull }}>BIDS {bidPct}%</span>
          <span style={{ color: T.danger }}>ASKS {100 - bidPct}%</span>
        </div>
        <div style={{ height: 6, background: T.danger + '44', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${bidPct}%`, background: T.bull, borderRadius: 3 }} />
        </div>
      </div>

      {/* Book */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Asks — reversed so lowest ask is closest to mid */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.muted }}>
            <span>PRECIO</span><span>CANTIDAD</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[...asks].reverse().map(([price, qty], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 10px', position: 'relative', fontSize: 10 }}>
                <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: `${(qty / maxQty) * 100}%`, background: T.danger + '18' }} />
                <span style={{ color: T.danger, fontFamily: 'monospace', position: 'relative' }}>${fmt(price, 0)}</span>
                <span style={{ color: T.textSec, fontFamily: 'monospace', position: 'relative' }}>{fmt(qty, 3)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bids */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.muted }}>
            <span>PRECIO</span><span>CANTIDAD</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {bids.map(([price, qty], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 10px', position: 'relative', fontSize: 10 }}>
                <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: `${(qty / maxQty) * 100}%`, background: T.bull + '18' }} />
                <span style={{ color: T.bull, fontFamily: 'monospace', position: 'relative' }}>${fmt(price, 0)}</span>
                <span style={{ color: T.textSec, fontFamily: 'monospace', position: 'relative' }}>{fmt(qty, 3)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 800, color: (mkt.change ?? 0) >= 0 ? T.bull : T.danger }}>
        ${fmt(mkt.price, 0)}
        <span style={{ fontSize: 10, color: T.muted, fontWeight: 400, marginLeft: 8 }}>MARK</span>
      </div>
    </div>
  )
}
