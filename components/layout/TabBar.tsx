'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import type { TabName } from '@/lib/types'

const TABS: [TabName, string][] = [
  ['dashboard',  '📊 Mercado'],
  ['chart',      '📈 Chart'],
  ['cycle',      '🌈 Ciclo'],
  ['indicators', '📊 Indicadores'],
  ['vpvr',       '📉 VPVR'],
  ['orderbook',  '📖 OBook'],
  ['heatmap',    '🔥 Heatmap'],
  ['onchain',    '⛓ OnChain'],
  ['news',       '📰 News'],
  ['tradeideas', '🚨 Agente APEX BTC'],
  ['backtest',   '🔬 Backtest'],
  ['calc',       '🧮 Calc'],
  ['compound',   '📈 Compuesto'],
  ['alerts',     '🔔 Alertas'],
  ['journal',    '📓 Diario'],
  ['sessions',   '🕐 Sesiones'],
  ['funding',    '💸 Funding'],
  ['capital',    '💰 Capital'],
  ['status',     '🔗 Status'],
]

export default function TabBar() {
  const T      = useTheme()
  const tab    = useApexStore(s => s.tab)
  const setTab = useApexStore(s => s.setTab)

  return (
    <div style={{
      display: 'flex', gap: 1, marginBottom: 14,
      background: T.bg, borderRadius: 8, padding: 3,
      border: `1px solid ${T.border}`, overflowX: 'auto',
    }}>
      {TABS.map(([id, label]) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          style={{
            flex: 1, minWidth: 52, background: 'none', border: tab === id ? `1px solid ${T.accent}33` : '1px solid transparent',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, letterSpacing: '.07em',
            padding: '6px 10px', borderRadius: 5, whiteSpace: 'nowrap', transition: 'all .2s',
            color: tab === id ? T.accent : T.muted,
            backgroundColor: tab === id ? T.accent + '22' : 'transparent',
            fontWeight: tab === id ? 700 : 400,
          }}
        >{label}</button>
      ))}
    </div>
  )
}
