'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import type { SignalRecord } from '@/lib/types'

// ─── 1f: Sentiment Score ─────────────────────────────────────────────────────
function sentColor(score: number, bull: string, warn: string, danger: string): string {
  if (score >= 70) return bull
  if (score >= 40) return warn
  return danger
}

export function SentimentCard() {
  const T    = useTheme()
  const mkt  = useApexStore(s => s.mkt)
  const news = useApexStore(s => s.news)

  const fg      = mkt.fg ?? 50
  const lsr     = mkt.lsr ?? 1
  const funding = mkt.funding ?? 0

  const fgScore      = fg                                              // 0-100 direct
  const lsrScore     = lsr < 0.8 ? 80 : lsr > 1.5 ? 20 : 50
  const fundScore    = funding < -0.01 ? 75 : funding > 0.04 ? 25 : 50
  const oiScore      = (mkt.oi ?? 0) > 0 ? 55 : 50
  const newsBull     = news.filter(n => n.tag === 'bullish').length
  const newsBear     = news.filter(n => n.tag === 'bearish').length
  const newsScore    = news.length > 0 ? Math.min(100, 50 + (newsBull - newsBear) * 10) : 50

  const composite = Math.round(
    fgScore * 0.35 + lsrScore * 0.25 + fundScore * 0.20 + oiScore * 0.10 + newsScore * 0.10
  )
  const col   = sentColor(composite, T.bull, T.warn, T.danger)
  const label = composite >= 80 ? 'Euforia' : composite >= 65 ? 'Codicia' : composite >= 45 ? 'Neutral' : composite >= 25 ? 'Miedo' : 'Pánico'

  // SVG arc gauge (semicircle)
  const radius = 36, cx = 50, cy = 46
  const startAngle = Math.PI
  const endAngle   = startAngle + (composite / 100) * Math.PI
  const x1 = cx + radius * Math.cos(startAngle), y1 = cy + radius * Math.sin(startAngle)
  const x2 = cx + radius * Math.cos(endAngle),   y2 = cy + radius * Math.sin(endAngle)
  const largeArc = composite > 50 ? 1 : 0

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 6 }}>🧭 SENTIMIENTO COMPUESTO</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width={100} height={50} viewBox="0 0 100 50">
          <path d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none" stroke={T.border} strokeWidth={6} />
          <path d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" />
        </svg>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, color: col, lineHeight: 1 }}>{composite}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: col }}>{label}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', marginTop: 8, fontSize: 8 }}>
        {[['F&G (35%)', fg], ['L/S (25%)', lsrScore], ['Funding (20%)', fundScore], ['Noticias (10%)', newsScore]].map(([l, v]) => (
          <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: T.muted }}>{l}</span>
            <span style={{ color: sentColor(+v, T.bull, T.warn, T.danger), fontFamily: 'monospace' }}>{+v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 1g: Alert Heatmap ───────────────────────────────────────────────────────
export function AlertHeatmapCard() {
  const T      = useTheme()
  const alerts = useApexStore(s => s.alerts)
  const setTab = useApexStore(s => s.setTab)
  const card   = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  if (alerts.length === 0) return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 6 }}>🗺️ HEAT MAP DE ALERTAS</div>
      <div style={{ fontSize: 9, color: T.muted, textAlign: 'center', paddingTop: 12 }}>Sin alertas activas</div>
    </div>
  )

  const groups: Record<string, typeof alerts> = { INDICADORES: [], MERCADO: [], 'ON-CHAIN': [], NOTICIAS: [] }
  for (const a of alerts) {
    const tf = a.tf.toUpperCase()
    if (tf === 'ONCHAIN') groups['ON-CHAIN'].push(a)
    else if (tf === 'NEWS') groups['NOTICIAS'].push(a)
    else if (['DERIV', 'MARKET', 'FG'].some(k => tf.includes(k))) groups['MERCADO'].push(a)
    else groups['INDICADORES'].push(a)
  }

  const tabMap: Record<string, Parameters<typeof setTab>[0]> = {
    INDICADORES: 'indicators', MERCADO: 'dashboard', 'ON-CHAIN': 'onchain', NOTICIAS: 'news',
  }

  return (
    <div style={{ ...card, gridColumn: 'span 2' }}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🗺️ HEAT MAP DE ALERTAS ({alerts.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(groups).filter(([, v]) => v.length > 0).map(([cat, items]) => (
          <div key={cat}>
            <button onClick={() => setTab(tabMap[cat])} style={{
              fontSize: 7, letterSpacing: '.1em', color: T.muted, background: T.bg,
              border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 6px', cursor: 'pointer', marginBottom: 4,
            }}>{cat}</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {items.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20,
                  background: (a.lvl === 'danger' ? T.danger : a.lvl === 'good' ? T.bull : T.warn) + '22',
                  border: `1px solid ${(a.lvl === 'danger' ? T.danger : a.lvl === 'good' ? T.bull : T.warn)}55`,
                  fontSize: 9, cursor: 'pointer',
                }} onClick={() => setTab(tabMap[cat])}>
                  <span>{a.icon}</span>
                  <span style={{ color: a.lvl === 'danger' ? T.danger : a.lvl === 'good' ? T.bull : T.warn }}>
                    {a.msg.split('—')[0].trim().slice(0, 28)}
                  </span>
                  <span style={{ fontSize: 7, color: T.muted }}>{a.tf}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 1h: Upcoming Events ─────────────────────────────────────────────────────
export function EventsCard() {
  const T = useTheme()
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const now = new Date()
  const halvingDate = new Date('2028-04-17')
  const halvingDays = Math.round((halvingDate.getTime() - now.getTime()) / 86400000)

  // FOMC 2025 dates (static)
  const fomc = ['2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10']
    .map(d => new Date(d))
    .filter(d => d > now)
    .slice(0, 2)

  // Options expiry = last Friday of current month
  const lastFri = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    while (d.getDay() !== 5) d.setDate(d.getDate() - 1)
    return d
  })()

  const events = [
    { icon: '₿', label: 'BTC Halving #5', detail: `~${halvingDays} días (abr 2028)`, color: T.warn },
    { icon: '📅', label: 'Options Expiry', detail: lastFri.toLocaleDateString(), color: T.accent },
    ...fomc.map(d => ({ icon: '🏦', label: 'FOMC Meeting', detail: d.toLocaleDateString(), color: T.textSec })),
    { icon: '📊', label: 'US CPI próximo', detail: '~15 de cada mes', color: T.textSec },
  ]

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>📆 PRÓXIMOS EVENTOS</div>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span style={{ fontSize: 14 }}>{e.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: T.text }}>{e.label}</div>
            <div style={{ fontSize: 8, color: e.color, fontFamily: 'monospace' }}>{e.detail}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 7, color: T.muted, marginTop: 6 }}>Datos estáticos — verificar manualmente</div>
    </div>
  )
}

// ─── 1i: Personal Stats ──────────────────────────────────────────────────────
export function PersonalStatsCard() {
  const T = useTheme()
  const history = useApexStore(s => s.signalHistory) as SignalRecord[]
  const card    = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const closed   = history.filter(r => r.pnlR != null)
  // Win = pnlR > 0 regardless of how it closed (handles manual closes, breakeven, wrong-SL bugs)
  const wins     = closed.filter(r => (r.pnlR ?? 0) > 0)
  const wr       = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const pnls     = closed.map(r => r.pnlR ?? 0)
  const totPnl   = pnls.reduce((a, v) => a + v, 0)
  const bestPnl  = pnls.length ? Math.max(...pnls) : null
  const worstPnl = pnls.length ? Math.min(...pnls) : null

  // Streak: any terminal status counts (including closed_manual)
  const TERMINAL = new Set(['sl_hit', 'tp1_hit', 'tp2_hit', 'tp3_hit', 'closed_manual', 'breakeven'])
  let streak = 0, streakType = ''
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i]
    if (!TERMINAL.has(r.status)) break
    const isWin = (r.pnlR ?? 0) > 0
    if (i === history.length - 1) streakType = isWin ? 'win' : 'loss'
    if ((isWin && streakType === 'win') || (!isWin && streakType === 'loss')) streak++
    else break
  }

  const rows = [
    ['Total señales', String(history.length)],
    ['Cerradas',      String(closed.length)],
    ['Win Rate',      closed.length > 0 ? `${wr.toFixed(1)}%` : '—'],
    ['P&L total (R)', closed.length > 0 ? `${totPnl > 0 ? '+' : ''}${totPnl.toFixed(2)}R` : '—'],
    ['Mejor trade',   bestPnl  != null ? `${bestPnl  > 0 ? '+' : ''}${bestPnl.toFixed(2)}R`  : '—'],
    ['Peor trade',    worstPnl != null ? `${worstPnl > 0 ? '+' : ''}${worstPnl.toFixed(2)}R` : '—'],
    ['Racha actual',  streak > 0 ? `${streak} ${streakType === 'win' ? 'wins' : 'losses'}` : '—'],
  ]

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🏆 ESTADÍSTICAS PERSONALES</div>
      {rows.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span style={{ color: T.muted }}>{l}</span>
          <span style={{ color: v.includes('+') ? T.bull : v.includes('-') ? T.danger : T.text, fontFamily: 'monospace' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── 1j: Macro Correlation ───────────────────────────────────────────────────
export function MacroCorrelCard() {
  const T = useTheme()
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const items = [
    { asset: 'DXY (Dólar)',  corr: 'Inversa', icon: '📉', desc: 'DXY sube → BTC tiende a bajar', col: '#ef4444' },
    { asset: 'SPX (S&P500)', corr: 'Positiva', icon: '📈', desc: 'Risk-off afecta ambos activos', col: '#22c55e' },
    { asset: 'Oro (GOLD)',   corr: 'Positiva', icon: '🥇', desc: 'Correlación en incertidumbre', col: '#fbbf24' },
    { asset: '10Y UST Bond', corr: 'Inversa', icon: '🏛️', desc: 'Tasas altas compiten con BTC', col: '#ef4444' },
  ]

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🔗 CORRELACIÓN BTC / MACRO</div>
      {items.map(({ asset, corr, icon, desc, col }) => (
        <div key={asset} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span>{icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
              <span style={{ color: T.text, fontWeight: 600 }}>{asset}</span>
              <span style={{ color: col, fontWeight: 700, fontSize: 8 }}>{corr}</span>
            </div>
            <div style={{ fontSize: 8, color: T.muted }}>{desc}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 7, color: T.muted, marginTop: 6 }}>Correlaciones macro — referencia educativa</div>
    </div>
  )
}
