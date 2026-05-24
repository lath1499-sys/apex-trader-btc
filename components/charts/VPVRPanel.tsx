'use client'
import { useMemo } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import type { VPVRData } from '@/lib/types'

function calcVPVR(klines: { h: number; l: number; c: number; v: number }[], buckets = 24): VPVRData | null {
  if (!klines?.length) return null
  const mn = Math.min(...klines.map(k => k.l)), mx = Math.max(...klines.map(k => k.h))
  const step = (mx - mn) / buckets
  const prof = Array.from({ length: buckets }, (_, i) => ({ pl: mn + (i + 0.5) * step, ph: mn + (i + 1) * step, vol: 0 }))
  for (const k of klines) {
    const tp = (k.h + k.l + k.c) / 3
    const idx = Math.min(Math.floor((tp - mn) / step), buckets - 1)
    if (idx >= 0) prof[idx].vol += k.v
  }
  const maxV = Math.max(...prof.map(p => p.vol))
  const sorted = [...prof].sort((a, b) => b.vol - a.vol)
  const poc = sorted[0]
  let cum = 0; const tot = prof.reduce((a, p) => a + p.vol, 0); const vaSet = new Set<number>()
  for (const p of sorted) { vaSet.add(p.pl); cum += p.vol; if (cum >= tot * 0.7) break }
  const va = prof.filter(p => vaSet.has(p.pl))
  return { prof, poc, vah: Math.max(...va.map(p => p.ph)), val: Math.min(...va.map(p => p.pl - step)), maxV, mn, mx }
}

export default function VPVRPanel() {
  const T    = useTheme()
  const rawK = useApexStore(s => s.rawK)
  const mkt  = useApexStore(s => s.mkt)
  const vpvr = useMemo(() => calcVPVR(rawK['4h'] ?? []), [rawK])

  if (!vpvr) return <div style={{ color: T.muted, textAlign: 'center', padding: 48, fontSize: 14 }}>Cargando VPVR...</div>

  const step = (vpvr.mx - vpvr.mn) / vpvr.prof.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>VOLUME PROFILE (VPVR) — 4H · {(rawK['4h'] ?? []).length} VELAS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[...vpvr.prof].reverse().map((p, i) => {
            const isPOC  = Math.abs(p.pl - vpvr.poc.pl) < step
            const isNear = mkt.price != null && Math.abs(p.pl - mkt.price) < step
            const barW   = (p.vol / vpvr.maxV) * 100
            const tag    = isPOC ? 'POC' : Math.abs(p.pl - vpvr.vah) < step ? 'VAH' : Math.abs(p.pl - vpvr.val) < step ? 'VAL' : ''
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 8, color: isPOC ? T.warn : isNear ? T.text : T.muted, width: 72, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>${Math.round(p.pl).toLocaleString()}</div>
                <div style={{ flex: 1, height: 7, background: T.bg, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ height: '100%', width: `${barW}%`, background: isPOC ? T.warn : isNear ? T.accent : T.textSec + '44', borderRadius: 2 }} />
                  {isNear && <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 2, background: T.text }} />}
                </div>
                <div style={{ width: 32, fontSize: 8, color: isPOC ? T.warn : T.muted, flexShrink: 0 }}>{tag}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          {[['POC', '$' + Math.round(vpvr.poc.pl).toLocaleString(), T.warn], ['VAH', '$' + Math.round(vpvr.vah).toLocaleString(), T.danger], ['VAL', '$' + Math.round(vpvr.val).toLocaleString(), T.bull]].map(([l, v, c]) => (
            <div key={l}><div style={{ fontSize: 8, color: T.muted }}>{l}</div><div style={{ fontSize: 13, color: c, fontWeight: 700, marginTop: 2 }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: 14, fontSize: 10, color: T.textSec, lineHeight: 1.9 }}>
        {mkt.price && mkt.price > vpvr.vah ? `⚡ Precio sobre VAH ($${Math.round(vpvr.vah).toLocaleString()}) — zona baja liquidez.`
          : mkt.price && mkt.price < vpvr.val ? `⚡ Precio bajo VAL ($${Math.round(vpvr.val).toLocaleString()}) — fuera del value area.`
          : `✓ Precio dentro del Value Area ($${Math.round(vpvr.val).toLocaleString()} – $${Math.round(vpvr.vah).toLocaleString()})`}
        <br />POC ${Math.round(vpvr.poc.pl).toLocaleString()}: mayor volumen — precio tiende a volver aquí.
      </div>
    </div>
  )
}
