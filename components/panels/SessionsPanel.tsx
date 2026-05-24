'use client'
import { useTheme } from '@/hooks/useTheme'
import { SESSIONS } from '@/lib/cycle'

const TIPS: Record<string, string[]> = {
  'ASIA':      ['Rango estrecho, ideal para acumulación.', 'Evitar trades con alto apalancamiento.', 'Observar soporte/resistencia asiática para breakout en NY.'],
  'FRANKFURT': ['Abre antes que Londres, menor liquidez.', 'Suele definir la dirección europea del día.'],
  'LONDON':    ['Inicio de alta volatilidad europea.', 'Buscar breakouts de rangos asiáticos.', 'Alta liquidez en BTC/USD y BTC/EUR.'],
  'NY OPEN':   ['Máxima liquidez y volatilidad del día.', 'Noticias macro (CPI, FED) afectan aquí.', 'Cierres de posiciones europeas crean movimientos fuertes.'],
  'NY':        ['Segunda parte de la sesión americana.', 'Volumen decreciente, menos oportunidades.'],
  'CIERRE':    ['Liquidez cayendo, spreads ampliándose.', 'Evitar entradas cerca del cierre.'],
}

const VOLATILITY: Record<string, number> = {
  'ASIA': 30, 'FRANKFURT': 40, 'LONDON': 65, 'NY OPEN': 100, 'NY': 55, 'CIERRE': 25,
}

export default function SessionsPanel() {
  const T = useTheme()

  const nowH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* UTC clock */}
      <div style={{ textAlign: 'center', background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '12px 0' }}>
        <div style={{ fontSize: 9, color: T.muted, marginBottom: 4 }}>HORA UTC ACTUAL</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: T.accent, fontFamily: 'monospace' }}>
          {String(new Date().getUTCHours()).padStart(2, '0')}:{String(new Date().getUTCMinutes()).padStart(2, '0')}
        </div>
      </div>

      {/* Sessions — Session fields: n (name), s (start hour UTC), e (end hour UTC), c (color) */}
      {SESSIONS.map(s => {
        const active = s.s <= s.e ? nowH >= s.s && nowH < s.e : nowH >= s.s || nowH < s.e
        const dur    = s.s <= s.e ? s.e - s.s : 24 - s.s + s.e
        const elapsed = s.s <= s.e
          ? nowH - s.s
          : (nowH >= s.s ? nowH - s.s : 24 - s.s + nowH)
        const progress = active ? Math.min(100, Math.round(elapsed / dur * 100)) : 0

        const vol  = VOLATILITY[s.n] ?? 50
        const tips = TIPS[s.n] ?? []
        const startStr = String(s.s).padStart(2, '0') + ':00'
        const endStr   = String(s.e).padStart(2, '0') + ':00'

        return (
          <div key={s.n} style={{ background: T.card, border: `2px solid ${active ? s.c : T.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? s.c : T.border, boxShadow: active ? `0 0 8px ${s.c}` : 'none' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: active ? s.c : T.text }}>{s.n}</span>
                {active && <span style={{ fontSize: 8, background: s.c + '22', color: s.c, border: `1px solid ${s.c}44`, padding: '2px 8px', borderRadius: 3 }}>ACTIVA {progress}%</span>}
              </div>
              <span style={{ fontSize: 10, color: T.muted }}>{startStr} – {endStr} UTC</span>
            </div>

            {active && (
              <div style={{ height: 3, background: T.bg, borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ height: '100%', width: `${progress}%`, background: s.c, borderRadius: 2 }} />
              </div>
            )}

            {/* Volatility indicator */}
            <div style={{ marginBottom: tips.length ? 8 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.muted, marginBottom: 3 }}>
                <span>VOLATILIDAD RELATIVA</span><span>{vol}%</span>
              </div>
              <div style={{ height: 4, background: T.bg, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${vol}%`, background: vol > 70 ? T.danger : vol > 40 ? T.warn : T.bull, borderRadius: 2 }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {tips.map((tip, i) => (
                <div key={i} style={{ fontSize: 9, color: T.textSec, lineHeight: 1.6 }}>
                  <span style={{ color: T.muted, marginRight: 6 }}>·</span>{tip}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
