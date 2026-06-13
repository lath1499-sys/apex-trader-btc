'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt, fmtB } from '@/lib/buildContext'
import { DominanceCard, CapitalFlowCard, SpreadCard, OIAnalysisCard, LiquidationsCard } from './DashboardCards1'
import { SentimentCard, AlertHeatmapCard, EventsCard, PersonalStatsCard, MacroCorrelCard, EquityCurveCard } from './DashboardCards2'

export default function DashboardPanel() {
  const T      = useTheme()
  const mkt    = useApexStore(s => s.mkt)
  const inds   = useApexStore(s => s.inds)
  const cycle  = useApexStore(s => s.cycle)
  const alerts = useApexStore(s => s.alerts)
  const PC     = (mkt.change ?? 0) >= 0 ? T.bull : T.danger
  const FC     = (mkt.funding ?? 0) > 0.05 ? T.danger : (mkt.funding ?? 0) < -0.01 ? T.bull : T.warn
  const card   = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>

      {/* ── Price ─────────────────────────────────────────────────────────── */}
      <div style={{ ...card, gridColumn: 'span 2', borderLeft: `4px solid ${PC}` }}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.16em', marginBottom: 8 }}>PRECIO · BTC/USDT PERP BINANCE</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: PC }}>${fmt(mkt.price)}</div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
          {[['HIGH 24H', '$' + fmt(mkt.high), T.bull], ['LOW 24H', '$' + fmt(mkt.low), T.danger],
            ['VOLUMEN', fmtB(mkt.vol), T.textSec], ['MARK', '$' + fmt(mkt.mark), T.warn],
            ['ATR 4H', '$' + fmt(inds['4h']?.atr), T.textSec],
            ['CICLO', cycle?.phase?.split(' ').slice(0, 2).join(' ') ?? '...', cycle?.col ?? T.textSec],
          ].map(([l, v, c]) => (
            <div key={l as string}>
              <div style={{ fontSize: 8, color: T.muted }}>{l}</div>
              <div style={{ color: c as string, fontSize: 12, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Funding ───────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>FUNDING RATE</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: FC }}>{mkt.funding != null ? (mkt.funding > 0 ? '+' : '') + fmt(mkt.funding, 4) + '%' : '—'}</div>
        <div style={{ height: 4, background: T.bg, borderRadius: 2, margin: '10px 0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: T.border }} />
          {mkt.funding != null && <div style={{ height: '100%', width: `${Math.min(Math.abs(mkt.funding) / 0.1 * 50, 50)}%`, marginLeft: mkt.funding >= 0 ? '50%' : `${50 - Math.min(Math.abs(mkt.funding) / 0.1 * 50, 50)}%`, background: FC, borderRadius: 2 }} />}
        </div>
        <div style={{ fontSize: 10, color: FC }}>{(mkt.funding ?? 0) > 0.05 ? '🔴 Longs sobreextendidos' : (mkt.funding ?? 0) > 0.01 ? '🟡 Sesgado long' : (mkt.funding ?? 0) > -0.01 ? '🟢 Neutral' : '🟢 Shorts pagando'}</div>
      </div>

      {/* ── L/S ───────────────────────────────────────────────────────────── */}
      <div style={{ ...card, borderTop: `3px solid ${(mkt.lsr ?? 1) > 1.6 ? T.danger : (mkt.lsr ?? 1) < 0.65 ? T.bull : T.warn}` }}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>LONG / SHORT RATIO</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: (mkt.lsr ?? 1) > 1.6 ? T.danger : (mkt.lsr ?? 1) < 0.65 ? T.bull : T.warn }}>{mkt.lsr ? fmt(mkt.lsr, 2) : '—'}</div>
        {mkt.longPct != null && <><div style={{ height: 5, background: T.bg, borderRadius: 3, overflow: 'hidden', margin: '8px 0' }}><div style={{ height: '100%', width: `${mkt.longPct}%`, background: T.bull }} /></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}><span style={{ color: T.bull }}>L {fmt(mkt.longPct, 1)}%</span><span style={{ color: T.danger }}>S {fmt(mkt.shortPct, 1)}%</span></div></>}
      </div>

      {/* ── F&G ───────────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>FEAR & GREED</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 38, fontWeight: 800, color: (mkt.fg ?? 50) < 25 ? T.danger : (mkt.fg ?? 50) > 75 ? T.bull : T.warn }}>{mkt.fg ?? '—'}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: (mkt.fg ?? 50) > 75 ? T.bull : T.warn }}>{mkt.fgLabel ?? ''}</div>
            <div style={{ height: 4, background: `linear-gradient(to right,${T.danger},${T.warn},${T.bull})`, borderRadius: 2, width: 100, marginTop: 8, position: 'relative' }}>
              <div style={{ position: 'absolute', top: -4, left: `${mkt.fg ?? 50}%`, width: 10, height: 10, background: T.text, borderRadius: '50%', transform: 'translateX(-50%)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── New blocks ────────────────────────────────────────────────────── */}
      <DominanceCard />
      <SentimentCard />
      <SpreadCard />
      <OIAnalysisCard />
      <CapitalFlowCard />
      <LiquidationsCard />

      {/* ── Alert heatmap (span 2) ────────────────────────────────────────── */}
      <AlertHeatmapCard />

      {/* ── Final row ─────────────────────────────────────────────────────── */}
      <EventsCard />
      <PersonalStatsCard />
      <MacroCorrelCard />
      <EquityCurveCard />

      {/* ── Legacy alerts strip (if any, small) ──────────────────────────── */}
      {alerts.length > 0 && (
        <div style={{ ...card, gridColumn: 'span 2', padding: 10 }}>
          <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 6 }}>⚡ ALERTAS TÉCNICAS ({alerts.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {alerts.slice(0, 4).map((a, i) => (
              <div key={i} style={{ fontSize: 9, color: a.lvl === 'danger' ? T.danger : a.lvl === 'good' ? T.bull : T.warn }}>
                {a.icon} {a.msg.slice(0, 40)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
