'use client'
import { useState, useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'

const TOTAL = 45

export default function RefreshCountdown() {
  const T = useTheme()
  const [secs, setSecs] = useState(TOTAL)

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s <= 1 ? TOTAL : s - 1), 1000)
    return () => clearInterval(t)
  }, [])

  const pct   = (secs / TOTAL) * 100
  const r     = 11
  const circ  = 2 * Math.PI * r
  const color = secs < 10 ? T.danger : T.accent

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, color: T.textSec }}>
      <div style={{ width: 28, height: 28, position: 'relative' }}>
        <svg width="28" height="28" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="14" cy="14" r={r} fill="none" stroke={T.border} strokeWidth="2" />
          <circle cx="14" cy="14" r={r} fill="none" stroke={color} strokeWidth="2"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct / 100)}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          fontSize: 7, color: secs < 10 ? T.danger : T.textSec, fontWeight: 700,
        }}>{secs}</div>
      </div>
    </div>
  )
}
