'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { THEMES, THEME_NAMES } from '@/lib/themes'
import { fmt } from '@/lib/buildContext'
import { getSession } from '@/lib/cycle'
import RefreshCountdown from '@/components/ui/RefreshCountdown'

export default function Header() {
  const T          = useTheme()
  const mkt        = useApexStore(s => s.mkt)
  const inds       = useApexStore(s => s.inds)
  const cycle      = useApexStore(s => s.cycle)
  const alerts     = useApexStore(s => s.alerts)
  const themeName  = useApexStore(s => s.themeName)
  const setThemeName = useApexStore(s => s.setThemeName)

  const sess       = getSession()
  const PC         = (mkt.change ?? 0) >= 0 ? T.bull : T.danger
  const dangerCnt    = alerts.filter(a => a.lvl === 'danger').length
  const signalHistory = useApexStore(s => s.signalHistory)
  const setTab        = useApexStore(s => s.setTab)
  const activeSignals = signalHistory.filter(r => r.status === 'active')
  const longActives   = activeSignals.filter(r => r.idea.side === 'LONG').length
  const shortActives  = activeSignals.filter(r => r.idea.side === 'SHORT').length
  const signalBadgeColor = longActives > 0 && shortActives > 0 ? '#f97316'  // orange = mixed
    : longActives  > 0 ? T.bull   // green = all long
    : shortActives > 0 ? T.danger // red = all short
    : T.accent

  function changeTheme(name: typeof THEME_NAMES[number]) {
    setThemeName(name)
    try { localStorage.setItem('apex_theme', name) } catch { /* SSR guard */ }
  }

  const biasMeta   = useApexStore(s => s.biasMeta)
  const biasColor  = (bias: string | undefined) =>
    bias === 'ALCISTA' ? T.bull : bias === 'BAJISTA' ? T.danger : T.warn

  return (
    <div style={{
      background: T.card, borderBottom: `1px solid ${T.border}`,
      padding: '10px 20px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 99,
    }}>
      {/* Logo + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'linear-gradient(135deg,#f7931a,#d06010)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 19, fontWeight: 900, color: '#fff', boxShadow: '0 0 18px #f7931a44',
        }}>₿</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: '.1em' }}>
            APEX TRADER BTC{' '}
            <span style={{ fontSize: 9, color: T.textSec, fontWeight: 400 }}>v8</span>
            {dangerCnt > 0 && (
              <span style={{ marginLeft: 8, background: T.danger + '22', border: `1px solid ${T.danger}44`, color: T.danger, fontSize: 8, padding: '1px 6px', borderRadius: 3 }}>
                {dangerCnt} ALERTA{dangerCnt > 1 ? 'S' : ''}
              </span>
            )}
            {activeSignals.length > 0 && (
              <span
                onClick={() => setTab('tradeideas')}
                title="Ver señales activas"
                style={{
                  marginLeft: 8, cursor: 'pointer',
                  background: signalBadgeColor + '22',
                  border: `1px solid ${signalBadgeColor}55`,
                  color: signalBadgeColor,
                  fontSize: 8, padding: '1px 7px', borderRadius: 3,
                  fontWeight: 700, letterSpacing: '.06em',
                }}
              >
                {activeSignals.length === 1
                  ? `${activeSignals[0].idea.side} ACTIVA`
                  : `${activeSignals.length} SEÑALES ACTIVAS`}
              </span>
            )}
          </div>
          <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.18em' }} suppressHydrationWarning>
            {sess.n} · {new Date().toUTCString().split(' ')[4]} UTC · {cycle?.phase ?? '...'}
          </div>
        </div>
      </div>

      {/* Right side controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Theme switcher */}
        <div style={{ display: 'flex', gap: 4 }}>
          {THEME_NAMES.map(name => (
            <button key={name} title={name} onClick={() => changeTheme(name)} style={{
              width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', padding: 0,
              border: `2px solid ${themeName === name ? '#fff' : 'transparent'}`,
              background: THEMES[name].accent,
            }} />
          ))}
        </div>

        <RefreshCountdown />

        {/* Price */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: PC }}>${fmt(mkt.price)}</div>
          <div style={{ fontSize: 9, color: PC }}>
            {(mkt.change ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(mkt.change ?? 0).toFixed(2)}% 24h
          </div>
        </div>

        {/* Multi-TF bias */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(['1d', '4h', '1h'] as const).map(tf => {
            const bias     = inds[tf]?.bias
            const meta     = biasMeta[tf]
            const now      = Date.now()
            const changed  = meta?.changedAt ?? null
            const arrow    = changed && (now - changed < 5 * 60 * 1000)
              ? (bias === 'ALCISTA' ? ' ↑' : bias === 'BAJISTA' ? ' ↓' : '') : ''
            const showPrev = changed && (now - changed < 30 * 1000) && meta?.prevBias
            return (
              <div key={tf} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 7, color: T.muted, width: 16 }}>{tf.toUpperCase()}</span>
                {showPrev && (
                  <span style={{ fontSize: 7, color: T.muted, textDecoration: 'line-through', marginRight: 2 }}>
                    {meta.prevBias}
                  </span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, color: biasColor(bias) }}>
                  {bias ?? '...'}{arrow}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
