'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'
import { SESSIONS } from '@/lib/cycle'

export default function CyclePanel() {
  const T     = useTheme()
  const cycle = useApexStore(s => s.cycle)
  const mkt   = useApexStore(s => s.mkt)

  const PHASES = [
    { name: 'Acumulación',  range: '0-20%',   desc: 'Precio bajo, ballenas acumulando. Mejor momento para compras largas.' },
    { name: 'Expansión',    range: '20-60%',  desc: 'Bull market — tendencia alcista fuerte, seguir el momentum.' },
    { name: 'Distribución', range: '60-80%',  desc: 'Máximos de ciclo, euforia, reducir exposición gradualmente.' },
    { name: 'Contracción',  range: '80-100%', desc: 'Bear market — precios bajos, preparar capital para próximo ciclo.' },
  ]

  const nowH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cycle phase */}
      {cycle ? (
        <div style={{ background: T.card, border: `2px solid ${cycle.col}44`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>FASE DE CICLO BTC — HALVINGS</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: cycle.col, marginBottom: 10 }}>{cycle.phase}</div>
          <div style={{ height: 8, background: T.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ height: '100%', width: `${cycle.pct}%`, background: cycle.col, borderRadius: 4, transition: 'width .3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.muted, marginBottom: 14 }}>
            <span>0%</span><span style={{ color: cycle.col, fontWeight: 700 }}>{fmt(cycle.pct, 1)}% del ciclo</span><span>100%</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['DÍAS EN CICLO', cycle.days.toLocaleString(), T.accent],
              ['PRÓX. HALVING', cycle.toNext + 'd', T.warn],
              ['MVRV ESTIMADO', fmt(cycle.mvrv, 2) + 'x', cycle.mvrv > 3 ? T.danger : cycle.mvrv > 1.5 ? T.bull : T.textSec],
              ['PRECIO ACTUAL', '$' + fmt(mkt.price, 0), (mkt.change ?? 0) >= 0 ? T.bull : T.danger],
            ].map(([l, v, c]) => (
              <div key={l as string} style={{ background: T.bg, borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Calculando fase de ciclo...</div>
      )}

      {/* Phase descriptions */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>GUÍA DE FASES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PHASES.map(p => {
            const active = cycle?.phase.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]) ?? false
            return (
              <div key={p.name} style={{ padding: '8px 10px', borderRadius: 6, background: active ? T.accent + '11' : T.bg, border: `1px solid ${active ? T.accent : T.border}` }}>
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

      {/* Trading sessions — Session fields: n, s (start hour), e (end hour), c (color) */}
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
    </div>
  )
}
