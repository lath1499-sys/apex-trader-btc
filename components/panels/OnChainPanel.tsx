'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'

export default function OnChainPanel() {
  const T = useTheme()
  const D = useApexStore(s => s.onchain)

  if (!D) return <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Cargando datos on-chain de mempool.space...</div>

  const metrics: [string, string, string, string][] = [
    ['HASH RATE',       D.hr ? D.hr.toFixed(1) + ' EH/s' : 'N/A', D.hr && D.hr > 500 ? '#00d084' : D.hr && D.hr > 300 ? '#ffd700' : '#ff4757', 'Poder de minería'],
    ['PRÓX. DIFICULTAD', D.diffAdj != null ? (D.diffAdj > 0 ? '+' : '') + D.diffAdj.toFixed(2) + '%' : 'N/A', D.diffAdj != null && D.diffAdj > 0 ? '#00d084' : '#ff4757', 'Ajuste estimado'],
    ['BLOQUE',          D.height ? '#' + D.height.toLocaleString() : 'N/A', '#8ab0aa', 'Altura actual de la cadena'],
    ['MEMPOOL',         D.mempool ? D.mempool.toLocaleString() + ' tx' : 'N/A', D.mempool && D.mempool > 50000 ? '#ff4757' : D.mempool && D.mempool > 20000 ? '#ffd700' : '#00d084', 'Transacciones pendientes'],
    ['FEE LENTO',       D.feeHour ? D.feeHour + ' sat/vB' : 'N/A', '#5a9a5a', '~1 hora'],
    ['FEE NORMAL',      D.feeMid  ? D.feeMid  + ' sat/vB' : 'N/A', '#ffd700',  '~30 min'],
    ['FEE RÁPIDO',      D.fee     ? D.fee     + ' sat/vB' : 'N/A', '#f7931a',  'Próximo bloque'],
    ['BLOCKS/24H',      D.recentBlocks?.length ? D.recentBlocks.length + ' últimos' : 'N/A', '#8aaa9a', 'Bloques recientes'],
  ]

  const signals: { c: string; t: string }[] = []
  if (D.hr && D.hr > 600)          signals.push({ c: '#00d084', t: 'Hash rate en máximos → mineros confiados.' })
  if (D.diffAdj != null && D.diffAdj > 3)  signals.push({ c: '#00d084', t: 'Dificultad subiendo → red creciendo.' })
  if (D.diffAdj != null && D.diffAdj < -5) signals.push({ c: '#ff4757', t: 'Dificultad bajando → posible capitulación.' })
  if (D.mempool && D.mempool > 50000)      signals.push({ c: '#ffd700', t: 'Mempool congestionado → alta actividad.' })
  if (D.fee && D.fee > 80)                 signals.push({ c: '#ff8c00', t: 'Fees altos → posible movimiento institucional.' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8 }}>
        {metrics.map(([l, v, c, sub]) => (
          <div key={l} style={{ background: T.card, border: `1px solid ${c}22`, borderRadius: 7, padding: '12px 14px' }}>
            <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</div>
            <div style={{ fontSize: 8, color: T.textSec, marginTop: 3 }}>{sub}</div>
          </div>
        ))}
      </div>
      {D.recentBlocks?.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: 14 }}>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>ÚLTIMOS BLOQUES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {D.recentBlocks.slice(0, 8).map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', background: T.bg, borderRadius: 4, fontSize: 9 }}>
                <span style={{ color: T.accent, fontFamily: 'monospace' }}>#{(b.height ?? '?').toLocaleString()}</span>
                <span style={{ color: T.textSec }}>{b.tx_count?.toLocaleString() ?? '?'} txs</span>
                <span style={{ color: T.textSec }}>{b.size ? Math.round(b.size / 1024) + 'KB' : '?'}</span>
                <span style={{ color: T.muted }}>{b.timestamp ? new Date(b.timestamp * 1000).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 8 }}>SEÑALES ON-CHAIN → APEX</div>
        {signals.length === 0
          ? <div style={{ fontSize: 9, color: T.textSec }}>Sin señales extremas — condiciones de red normales.</div>
          : signals.map((s, i) => <div key={i} style={{ fontSize: 9, color: s.c, lineHeight: 1.7, marginBottom: 3 }}>● {s.t}</div>)
        }
        <div style={{ fontSize: 8, color: T.muted, marginTop: 8 }}>Fuente: mempool.space · Refresh cada 90s</div>
      </div>
    </div>
  )
}
