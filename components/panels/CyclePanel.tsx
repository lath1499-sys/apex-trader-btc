'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { SESSIONS } from '@/lib/cycle'

function fmt(n: number | undefined, d = 0): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function CyclePanel() {
  const T     = useTheme()
  const cycle = useApexStore(s => s.cycle)
  const mkt   = useApexStore(s => s.mkt)

  const nowH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Cycle phase card ─────────────────────────────────── */}
      {cycle ? (
        <div style={{ background: T.card, border: `2px solid ${cycle.col}44`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>FASE DE CICLO BTC — HALVINGS</div>

          {/* Phase label */}
          <div style={{ fontSize: 22, fontWeight: 800, color: cycle.col, marginBottom: 10, lineHeight: 1.2 }}>
            {cycle.phaseLabel}
          </div>

          {/* Progress bar */}
          <div style={{ height: 8, background: T.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${cycle.pct}%`, background: cycle.col, borderRadius: 4, transition: 'width .3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.muted, marginBottom: 14 }}>
            <span>0%</span>
            <span style={{ color: cycle.col, fontWeight: 700 }}>{fmt(cycle.pct, 1)}% del ciclo</span>
            <span>100%</span>
          </div>

          {/* Key stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {([
              ['ATH DEL CICLO',   `$${fmt(cycle.cycleATH, 0)}`,                        cycle.col],
              ['CAÍDA DESDE ATH', `${fmt(cycle.drawdownFromATH, 1)}%`,                 T.danger],
              ['DÍAS DESDE ATH',  `${cycle.daysSinceATH}d`,                             T.warn],
              ['PRÓX. HALVING',   `${cycle.toNext}d`,                                   T.warn],
              ['MA200',           cycle.ma200 > 0 ? `$${fmt(cycle.ma200, 0)}` : '—',   cycle.aboveMA200 ? T.bull : T.danger],
              ['ESTADO MA200',    cycle.ma200 > 0 ? (cycle.aboveMA200 ? '↑ SOBRE' : '↓ BAJO') : '—', cycle.aboveMA200 ? T.bull : T.danger],
              ['MVRV LOG',        fmt(cycle.mvrv, 2) + 'x',                             cycle.mvrv > 3 ? T.danger : cycle.mvrv > 1.5 ? T.bull : T.textSec],
              ['MVRV ESTIMADO',   fmt(cycle.mvrvEstimate, 1) + 'x',                    cycle.mvrvEstimate > 2 ? T.danger : cycle.mvrvEstimate > 1 ? T.warn : T.bull],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: T.bg, borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div style={{ fontSize: 10, color: T.textSec, lineHeight: 1.7, background: T.bg, borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
            {cycle.description}
          </div>

          {/* Trading bias */}
          <div style={{ background: cycle.col + '18', border: `1px solid ${cycle.col}55`, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4, letterSpacing: '.1em' }}>SESGO DE TRADING</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: cycle.col, lineHeight: 1.5 }}>{cycle.tradingBias}</div>
          </div>
        </div>
      ) : (
        <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Calculando fase de ciclo...</div>
      )}

      {/* ── Phase guide ───────────────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>GUÍA DE FASES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            { name: 'Acumulación / Recuperación', code: 'ACUMULACION', range: '0–25%',  desc: 'Precio bajo, ballenas acumulando. Mejor momento para compras largas.' },
            { name: 'Expansión Alcista',          code: 'BULL_EXPANSION', range: '25–60%', desc: 'Bull market temprano — tendencia alcista fuerte, seguir el momentum.' },
            { name: 'Bull Market Tardío',         code: 'BULL_TARDIO',    range: '60–75%', desc: 'Fase avanzada del ciclo alcista, reducir exposición gradualmente.' },
            { name: 'Distribución',               code: 'DISTRIBUCION',   range: '70–80%', desc: 'Máximos de ciclo, euforia, reducir exposición. Señales de techo.' },
            { name: 'Bear Market Markdown',       code: 'BEAR_MARKET',    range: '80–95%', desc: 'Post-ATH markdown. Shorts favorecidos. Longs solo con RSI extremo.' },
            { name: 'Capitulación / Fondo',       code: 'CAPITULACION',   range: '85–100%', desc: 'Caída > 70%. Zona histórica de fondo. Acumulación a largo plazo.' },
          ] as { name: string; code: string; range: string; desc: string }[]).map(p => {
            const active = cycle?.phase === p.code
            return (
              <div key={p.code} style={{ padding: '8px 10px', borderRadius: 6, background: active ? T.accent + '11' : T.bg, border: `1px solid ${active ? T.accent : T.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? T.accent : T.text }}>{p.name}</span>
                  <span style={{ fontSize: 8, color: T.muted }}>{p.range}</span>
                </div>
                <div style={{ fontSize: 9, color: T.textSec, lineHeight: 1.6 }}>{p.desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Trading sessions ──────────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>SESIONES DE TRADING — UTC</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SESSIONS.map(s => {
            const active = s.s <= s.e ? nowH >= s.s && nowH < s.e : nowH >= s.s || nowH < s.e
            const startStr = String(s.s).padStart(2, '0') + ':00'
            const endStr   = String(s.e).padStart(2, '0') + ':00'
            return (
              <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 5, background: active ? s.c + '11' : T.bg, border: `1px solid ${active ? s.c : T.border}` }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? s.c : T.border, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? s.c : T.text }}>{s.n}</div>
                  <div style={{ fontSize: 8, color: T.muted }}>{startStr} – {endStr} UTC</div>
                </div>
                {active && <span style={{ fontSize: 8, color: s.c, fontWeight: 700 }}>ACTIVA</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Price reference ───────────────────────────────────── */}
      {mkt.price && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>PRECIO ACTUAL</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: (mkt.change ?? 0) >= 0 ? T.bull : T.danger }}>
            ${fmt(mkt.price, 0)}
          </div>
          {mkt.change != null && (
            <div style={{ fontSize: 11, color: mkt.change >= 0 ? T.bull : T.danger, marginTop: 4 }}>
              {mkt.change >= 0 ? '+' : ''}{fmt(mkt.change, 2)}% (24h)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
