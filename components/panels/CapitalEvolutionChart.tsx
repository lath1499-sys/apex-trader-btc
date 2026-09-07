'use client'
import { useEffect, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '@/hooks/useTheme'
import type { Theme } from '@/lib/types'

interface HistoryRow {
  balance:         number
  monthly_pnl_pct: number
  drawdown_stage:  number
  recorded_at:     string
}

interface ChartPoint {
  t:       number
  balance: number
  pnlPct:  number
  label:   string
}

function ApexTooltip({ active, payload, T }: { active?: boolean; payload?: Array<{ payload: ChartPoint }>; T: Theme }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', fontFamily: 'monospace', fontSize: 10 }}>
      <div style={{ color: T.textSec, marginBottom: 4 }}>{p.label}</div>
      <div style={{ color: T.accent, fontWeight: 700 }}>${Math.round(p.balance).toLocaleString()}</div>
      <div style={{ color: p.pnlPct >= 0 ? T.bull : T.bear }}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%</div>
    </div>
  )
}

export default function CapitalEvolutionChart() {
  const T = useTheme()
  const [rows, setRows]       = useState<HistoryRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/capital/history')
      .then(r => r.json() as Promise<{ data: HistoryRow[] }>)
      .then(d => setRows(d.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: 20, color: T.textSec, fontFamily: 'monospace', fontSize: 12 }}>Cargando evolución de capital...</div>
  }

  if (!rows || rows.length < 2) {
    return (
      <div style={{ padding: 20, color: T.textSec, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ marginBottom: 8, color: T.warn, fontWeight: 700 }}>
          ⚠️ Aún no hay suficiente historial de capital
        </div>
        <div>Cada vez que el balance real cambie (un trade se cierra), queda un punto guardado aquí. Si esto sigue vacío después de que se cierre un trade, la tabla probablemente no existe — ejecuta en el SQL Editor de Supabase:</div>
        <pre style={{
          marginTop: 10, background: T.bg, border: `1px solid ${T.border}`,
          borderRadius: 8, padding: 12, fontSize: 10, overflowX: 'auto', color: T.text,
        }}>{`CREATE TABLE IF NOT EXISTS apex_capital_history (
  id BIGSERIAL PRIMARY KEY,
  balance NUMERIC NOT NULL,
  monthly_pnl_pct NUMERIC NOT NULL,
  drawdown_stage SMALLINT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_capital_history_recorded_at
  ON apex_capital_history(recorded_at);`}</pre>
      </div>
    )
  }

  const data: ChartPoint[] = rows.map(r => {
    const d = new Date(r.recorded_at)
    return {
      t:       d.getTime(),
      balance: r.balance,
      pnlPct:  r.monthly_pnl_pct,
      label:   d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    }
  })

  const first = data[0].balance
  const last  = data[data.length - 1].balance
  const totalChangePct = first > 0 ? ((last - first) / first) * 100 : 0

  return (
    <div style={{ padding: '10px 2px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Evolución de Capital</div>
          <div style={{ fontSize: 10, color: T.textSec, marginTop: 2 }}>{data.length} puntos registrados</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: T.text }}>${Math.round(last).toLocaleString()}</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: totalChangePct >= 0 ? T.bull : T.bear }}>
            {totalChangePct >= 0 ? '+' : ''}{totalChangePct.toFixed(2)}% desde el primer punto
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="apexCapitalGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={T.accent} stopOpacity={0.32} />
              <stop offset="100%" stopColor={T.accent} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={T.textSec} tick={{ fontSize: 9, fontFamily: 'monospace', fill: T.textSec }}
            axisLine={{ stroke: T.border }} tickLine={false}
            minTickGap={40}
          />
          <YAxis
            yAxisId="balance"
            tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
            stroke={T.textSec} tick={{ fontSize: 9, fontFamily: 'monospace', fill: T.textSec }}
            axisLine={false} tickLine={false} width={64}
          />
          <YAxis
            yAxisId="pnl"
            orientation="right"
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            stroke={T.textSec} tick={{ fontSize: 9, fontFamily: 'monospace', fill: T.textSec }}
            axisLine={false} tickLine={false} width={44}
          />
          <Tooltip content={<ApexTooltip T={T} />} />
          <Area yAxisId="balance" type="monotone" dataKey="balance" stroke={T.accent} strokeWidth={2.5} fill="url(#apexCapitalGrad)" dot={false} activeDot={{ r: 4, fill: T.accent }} />
          <Line yAxisId="pnl" type="monotone" dataKey="pnlPct" stroke={T.warn} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: T.warn }} />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 14, height: 2, background: T.accent }} />
          <span style={{ fontSize: 9, color: T.textSec }}>Balance ($)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 14, height: 0, borderTop: `2px dashed ${T.warn}` }} />
          <span style={{ fontSize: 9, color: T.textSec }}>P&amp;L del mes (%)</span>
        </div>
      </div>
    </div>
  )
}
