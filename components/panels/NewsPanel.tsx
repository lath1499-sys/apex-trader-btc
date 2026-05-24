'use client'
import { useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { getSession } from '@/lib/cycle'

type Filter = 'all' | 'macro' | 'bullish' | 'bearish' | 'neutral'

const FILTERS: [Filter, string][] = [['all', 'Todas'], ['macro', '🌍 Macro'], ['bullish', '📈 Alcista'], ['bearish', '📉 Bajista'], ['neutral', '📰 Neutral']]

function ago(ts: number): string {
  const m = Math.floor((Date.now() / 1000 - ts) / 60)
  return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'
}

export default function NewsPanel() {
  const T    = useTheme()
  const news = useApexStore(s => s.news)
  const [filt, setFilt] = useState<Filter>('all')
  const sess = getSession()

  const tagColor = (tag: string) => tag === 'macro' ? T.warn : tag === 'bullish' ? T.bull : tag === 'bearish' ? T.danger : T.textSec
  const filtered = filt === 'all' ? news : news.filter(n => n.tag === filt)
  const macroCount = news.filter(n => n.tag === 'macro').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {macroCount > 0 && (
        <div style={{ background: T.warn + '11', border: `1px solid ${T.warn}33`, borderRadius: 7, padding: '10px 14px' }}>
          <div style={{ fontSize: 9, color: T.warn, fontWeight: 700, marginBottom: 4 }}>⚠️ {macroCount} EVENTOS MACRO ACTIVOS — SESIÓN {sess.n}</div>
          <div style={{ fontSize: 9, color: T.textSec, lineHeight: 1.7 }}>
            {sess.n === 'NY OPEN' ? 'Máximo impacto — monitorear antes de entrar posiciones.' : 'Ajustar SLs en posiciones abiertas.'}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(([f, l]) => (
          <button key={f} onClick={() => setFilt(f)} style={{
            background: filt === f ? T.accent + '22' : 'transparent', border: `1px solid ${filt === f ? T.accent : T.border}`,
            color: filt === f ? T.accent : T.textSec, padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9,
          }}>{l} ({f === 'all' ? news.length : news.filter(n => n.tag === f).length})</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: 40, textAlign: 'center', color: T.textSec, fontSize: 11 }}>
          {news.length === 0 ? '📡 Cargando noticias de múltiples fuentes...' : 'Sin noticias en esta categoría'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 540, overflowY: 'auto' }}>
          {filtered.slice(0, 30).map((n, i) => (
            <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <div style={{ padding: '10px 14px', background: T.card, border: `1px solid ${tagColor(n.tag ?? 'neutral')}22`, borderRadius: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                  <div style={{ fontSize: 11, color: tagColor(n.tag ?? 'neutral'), fontWeight: 600, lineHeight: 1.5, flex: 1 }}>{n.title}</div>
                  <span style={{ fontSize: 8, color: T.muted, flexShrink: 0, marginTop: 2 }}>{ago(n.published_on)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 7, padding: '2px 7px', borderRadius: 3, background: tagColor(n.tag ?? 'neutral') + '22', color: tagColor(n.tag ?? 'neutral') }}>{(n.tag ?? 'neutral').toUpperCase()}</span>
                  <span style={{ fontSize: 8, color: T.muted }}>{n.source_info.name}</span>
                  <span style={{ fontSize: 8, color: T.muted, marginLeft: 'auto' }}>↗ leer</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
