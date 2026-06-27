'use client'

import { useEffect, useState } from 'react'

interface CapitalConfig {
  maxCapitalDeployedPct: number
  maxPerTradePct:        number
  riskPerTradePct:       number
  monthlyProfitTarget:   number
  maxDrawdownPct:        number
  monthlyStartBalance:   number
}

interface CapitalState {
  availableBalance:    number
  deployedCapital:     number
  freeCapital:         number
  monthlyPnl:          number
  monthlyPnlPct:       number
  targetReached:       boolean
  drawdownTriggered:   boolean
  canOpenNewTrade:     boolean
  maxPositionSize:     number
  reason:              string
}

function StatCard({ label, value, color, T }: { label: string; value: string; color: string; T: Record<string, string> }) {
  return (
    <div style={{ flex: 1, minWidth: 100, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color }}>{value}</div>
    </div>
  )
}

const FIELDS: Array<{ key: keyof CapitalConfig; label: string; suffix: string; min: number; max: number; step: number; tip: string }> = [
  { key: 'monthlyStartBalance',   label: 'Balance en Binance',           suffix: 'USD', min: 0,   max: 100000, step: 100, tip: 'Tu capital real disponible en Binance (actualiza manualmente)' },
  { key: 'maxCapitalDeployedPct', label: 'Máx capital desplegado total', suffix: '%',   min: 10,  max: 100,    step: 1,   tip: 'Del balance total en Binance entre todos los trades abiertos' },
  { key: 'maxPerTradePct',        label: 'Máx capital por trade',        suffix: '%',   min: 5,   max: 50,     step: 1,   tip: 'Del balance total por señal individual' },
  { key: 'riskPerTradePct',       label: 'Riesgo por trade',             suffix: '%',   min: 1,   max: 20,     step: 1,   tip: 'Pérdida máxima si el SL es tocado' },
  { key: 'monthlyProfitTarget',   label: 'Target de profit mensual',     suffix: 'USD', min: 50,  max: 10000,  step: 50,  tip: 'Pausa el trading automático al alcanzarlo' },
  { key: 'maxDrawdownPct',        label: 'Drawdown máximo mensual',      suffix: '%',   min: 5,   max: 50,     step: 1,   tip: 'Pausa el trading si se supera esta pérdida mensual' },
]

export default function CapitalSettings({ T }: { T: Record<string, string> }) {
  const [config, setConfig] = useState<CapitalConfig>({
    maxCapitalDeployedPct: 70,
    maxPerTradePct:        30,
    riskPerTradePct:       5,
    monthlyProfitTarget:   500,
    maxDrawdownPct:        15,
    monthlyStartBalance:   0,
  })
  const [state,   setState]   = useState<CapitalState | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/capital')
      .then(r => r.json())
      .then(d => {
        if (d.config) setConfig(d.config)
        if (d.state)  setState(d.state)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Refresh state
      const d = await fetch('/api/capital').then(r => r.json())
      if (d.state) setState(d.state)
    } catch { /* noop */ } finally {
      setSaving(false)
    }
  }

  const monthlyTarget = config.monthlyProfitTarget
  const monthlyPnl    = state?.monthlyPnl ?? 0
  const progress      = monthlyTarget > 0 ? Math.min(100, Math.max(0, (monthlyPnl / monthlyTarget) * 100)) : 0
  const progressColor = monthlyPnl >= monthlyTarget ? (T.grn ?? '#00ff88') : monthlyPnl >= 0 ? (T.yel ?? '#f59e0b') : (T.red ?? '#ef4444')

  return (
    <div style={{ padding: '12px 4px 40px', color: T.text }}>
      {/* Status cards */}
      {state && !loading && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <StatCard label="Balance Binance"  value={`$${(state.availableBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={T.grn ?? '#00ff88'} T={T} />
          <StatCard label="Desplegado"       value={`$${(state.deployedCapital  ?? 0).toFixed(2)}`} color={T.org ?? '#f97316'} T={T} />
          <StatCard label="P&L Este Mes"     value={`${monthlyPnl >= 0 ? '+' : ''}$${monthlyPnl.toFixed(0)}`} color={monthlyPnl >= 0 ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444')} T={T} />
          <StatCard label={`Target $${monthlyTarget}`} value={`${progress.toFixed(0)}%`} color={T.yel ?? '#f59e0b'} T={T} />
        </div>
      )}

      {/* Status badge */}
      {state && (
        <div style={{
          background: state.canOpenNewTrade ? 'rgba(0,255,136,0.08)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${state.canOpenNewTrade ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444')}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 11,
          color: state.canOpenNewTrade ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444'),
        }}>
          {state.canOpenNewTrade ? '✅ Sistema activo — puede abrir nuevos trades' : `⛔ ${state.reason}`}
        </div>
      )}

      {/* Monthly progress */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11 }}>
          <span style={{ color: T.textSec }}>PROGRESO MENSUAL</span>
          <span style={{ color: progressColor, fontWeight: 700, fontFamily: 'monospace' }}>
            ${monthlyPnl.toFixed(0)} / ${monthlyTarget} target
          </span>
        </div>
        <div style={{ height: 6, background: T.bg ?? '#111', borderRadius: 3 }}>
          <div style={{
            height: 6, borderRadius: 3, width: `${progress}%`,
            background: progressColor, transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Config fields */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 15px' }}>
        <div style={{ fontSize: 10, color: T.textSec, letterSpacing: 0.5, marginBottom: 16, textTransform: 'uppercase' }}>
          Configuración de Capital
        </div>

        {FIELDS.map(f => (
          <div key={f.key} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 11, color: T.text, textTransform: 'uppercase', letterSpacing: 0.3 }}>{f.label}</div>
                <div style={{ fontSize: 9, color: T.textSec, marginTop: 2 }}>{f.tip}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={config[f.key]}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  onChange={e => setConfig(c => ({ ...c, [f.key]: parseFloat(e.target.value) || 0 }))}
                  style={{
                    width: 80, textAlign: 'right',
                    background: T.bgCard2 ?? T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 5, color: T.grn ?? '#00ff88',
                    fontWeight: 700, fontSize: 13,
                    padding: '3px 6px', outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <span style={{ fontSize: 11, color: T.textSec, minWidth: 30 }}>{f.suffix}</span>
              </div>
            </div>
            {f.suffix !== 'USD' || f.key === 'monthlyStartBalance' ? null : null}
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={config[f.key]}
              onChange={e => setConfig(c => ({ ...c, [f.key]: parseFloat(e.target.value) }))}
              className="apex-calc-range"
              style={{ width: '100%', height: 20, cursor: 'pointer' }}
            />
          </div>
        ))}

        <button
          onClick={save}
          disabled={saving}
          style={{
            width: '100%', padding: '11px 0', marginTop: 4,
            background: saved ? (T.grn ?? '#00ff88') : (T.grn ?? '#00ff88'),
            color: T.bg ?? '#0a0a0f',
            border: 'none', borderRadius: 8,
            fontWeight: 700, fontSize: 13,
            fontFamily: 'monospace', cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1, transition: 'opacity 0.2s',
          }}
        >
          {saved ? '✅ Guardado' : saving ? 'Guardando...' : '💾 Guardar configuración'}
        </button>
      </div>
    </div>
  )
}
