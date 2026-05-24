'use client'
import { useTheme } from '@/hooks/useTheme'

interface Props { score: number }

export default function ScoreBar({ score }: Props) {
  const T = useTheme()
  const max = 9
  const p = ((score + max) / (max * 2)) * 100
  const col = score >= 4 ? T.bull : score <= -4 ? T.danger : T.warn
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 5, background: T.bg, borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: T.border }} />
        <div style={{
          height: '100%',
          width: `${Math.abs(p - 50)}%`,
          marginLeft: score >= 0 ? '50%' : `${p}%`,
          background: col, borderRadius: 2, transition: 'all .5s',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: T.muted, marginTop: 2 }}>
        <span>BAJISTA</span><span>NEUTRAL</span><span>ALCISTA</span>
      </div>
    </div>
  )
}
