'use client'

import { useEffect, useState } from 'react'

interface CapitalConfig {
  maxCapitalDeployedPct: number
  maxPerTradePct:        number
  monthlyStartBalance:   number
}

interface CapitalState {
  availableBalance:    number
  deployedCapital:     number
  freeCapital:         number
  monthlyStartBalance: number
  monthlyPnl:          number
  monthlyPnlPct:       number
  monthlyProfitTarget: number
  targetReached:       boolean
  drawdownStage:       1 | 2 | 3
  drawdownPct:         number
  effectiveRiskPct:    number
  canOpenNewTrade:     boolean
  maxPositionSize:     number
  reason:              string
}

function StatCard({ label, value, color, T }: { label: string; value: string; color: string; T: Record<string, string> }) {
  return (
    <div style={{ flex: 1, minWidth: 90, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color }}>{value}</div>
    </div>
  )
}

const STAGE_META = {
  1: { label: 'NORMAL',   emoji: '✅', desc: '5% riesgo por trade' },
  2: { label: 'SURVIVAL', emoji: '⚠️', desc: '2% riesgo — recuperando DD' },
  3: { label: 'PAUSADO',  emoji: '🛑', desc: 'DD -20% — sin trades nuevos' },
} as const

const CONFIG_FIELDS: Array<{ key: keyof CapitalConfig; label: string; suffix: string; min: number; max: number; step: number; tip: string }> = [
  { key: 'monthlyStartBalance',   label: 'Balance en Binance',           suffix: 'USD', min: 0,  max: 100000, step: 100, tip: 'Tu capital real en Binance — actualiza manualmente cada mes' },
  { key: 'maxCapitalDeployedPct', label: 'Máx capital desplegado total', suffix: '%',   min: 10, max: 100,    step: 1,   tip: 'Del balance total entre todos los trades abiertos' },
  { key: 'maxPerTradePct',        label: 'Máx capital por trade',        suffix: '%',   min: 5,  max: 50,     step: 1,   tip: 'Del balance total por señal individual' },
]

export default function CapitalSettings({ T }: { T: Record<string, string> }) {
  const [config, setConfig] = useState<CapitalConfig>({ maxCapitalDeployedPct: 70, maxPerTradePct: 30, monthlyStartBalance: 0 })
  const [state,  setState]  = useState<CapitalState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => {
    fetch('/api/capital')
      .then(r => r.json())
      .then(d => {
        if (d.config) setConfig({
          maxCapitalDeployedPct: d.config.maxCapitalDeployedPct ?? 70,
          maxPerTradePct:        d.config.maxPerTradePct        ?? 30,
          monthlyStartBalance:   d.config.monthlyStartBalance   ?? 0,
        })
        if (d.state) setState(d.state)
      })
      .catch(() => {})
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
      const d = await fetch('/api/capital').then(r => r.json())
      if (d.state) setState(d.state)
    } catch { /* noop */ } finally {
      setSaving(false)
    }
  }

  const monthlyPnl    = state?.monthlyPnl    ?? 0
  const dynTarget     = state?.monthlyProfitTarget ?? (config.monthlyStartBalance * 0.15)
  const progress      = dynTarget > 0 ? Math.min(100, Math.max(0, (monthlyPnl / dynTarget) * 100)) : 0
  const progressColor = monthlyPnl >= dynTarget ? (T.grn ?? '#00ff88') : monthlyPnl >= 0 ? (T.yel ?? '#f59e0b') : (T.red ?? '#ef4444')
  const stage         = STAGE_META[state?.drawdownStage ?? 1]
  const stageColor    = state?.drawdownStage === 3 ? (T.red ?? '#ef4444') : state?.drawdownStage === 2 ? (T.org ?? '#f97316') : (T.grn ?? '#00ff88')
  const ddPct         = state?.drawdownPct ?? 0
  const ddBarWidth    = Math.min(100, Math.max(0, Math.abs(Math.min(0, ddPct)) / 20 * 100))
  const ddBarColor    = ddPct <= -20 ? (T.red ?? '#ef4444') : ddPct <= -15 ? (T.org ?? '#f97316') : (T.grn ?? '#00ff88')

  return (
    <div style={{ padding: '12px 4px 40px', color: T.text }}>

      {/* Status cards */}
      {state && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <StatCard label="Balance"      value={`$${(state.availableBalance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color={T.grn ?? '#00ff88'} T={T} />
          <StatCard label="Desplegado"   value={`$${state.deployedCapital.toFixed(0)}`}  color={T.org ?? '#f97316'} T={T} />
          <StatCard label="P&L Mes"      value={`${monthlyPnl >= 0 ? '+' : ''}$${monthlyPnl.toFixed(0)}`} color={monthlyPnl >= 0 ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444')} T={T} />
          <StatCard label={`Target 15%`} value={`$${dynTarget.toFixed(0)}`} color={T.yel ?? '#f59e0b'} T={T} />
          {/* Drawdown stage card */}
          <div style={{ flex: 1, minWidth: 110, background: T.bgCard, border: `1px solid ${stageColor}44`, borderRadius: 8, padding: '10px 12px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${stageColor}, transparent)` }} />
            <div style={{ fontSize: 9, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Riesgo</div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: stageColor }}>{stage.emoji} {stage.label}</div>
            <div style={{ fontSize: 9, color: T.textSec, marginTop: 2 }}>{stage.desc}</div>
          </div>
        </div>
      )}

      {/* Status badge */}
      {state && (
        <div style={{
          background: state.canOpenNewTrade ? 'rgba(0,255,136,0.06)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${state.canOpenNewTrade ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444')}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 11,
          color: state.canOpenNewTrade ? (T.grn ?? '#00ff88') : (T.red ?? '#ef4444'),
        }}>
          {state.canOpenNewTrade ? '✅ Sistema activo — puede abrir nuevos trades' : `⛔ ${state.reason}`}
        </div>
      )}

      {/* Monthly progress */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 11 }}>
          <span style={{ color: T.textSec }}>PROGRESO MENSUAL</span>
          <span style={{ color: progressColor, fontWeight: 700, fontFamily: 'monospace' }}>
            ${monthlyPnl.toFixed(0)} / ${dynTarget.toFixed(0)} (15%)
          </span>
        </div>
        <div style={{ height: 6, background: T.bg ?? '#111', borderRadius: 3 }}>
          <div style={{ height: 6, borderRadius: 3, width: `${progress}%`, background: progressColor, transition: 'width 0.4s ease' }} />
        </div>
        {state && (
          <div style={{ fontSize: 9, color: T.textSec, marginTop: 5 }}>
            Base de mes: ${state.monthlyStartBalance.toFixed(0)} · Target automático: 15% = ${dynTarget.toFixed(0)}
          </div>
        )}
      </div>

      {/* Drawdown bar */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 11 }}>
          <span style={{ color: T.textSec }}>DRAWDOWN MENSUAL</span>
          <span style={{ color: ddBarColor, fontWeight: 700, fontFamily: 'monospace' }}>
            {ddPct.toFixed(2)}%
          </span>
        </div>
        <div style={{ position: 'relative', height: 6, background: T.bg ?? '#111', borderRadius: 3 }}>
          <div style={{ position: 'absolute', left: '75%', top: -3, bottom: -3, width: 1, background: T.org ?? '#f97316', opacity: 0.6 }} />
          <div style={{ position: 'absolute', left: '100%', top: -3, bottom: -3, width: 1, background: T.red ?? '#ef4444', opacity: 0.6 }} />
          <div style={{ height: 6, borderRadius: 3, width: `${ddBarWidth}%`, background: ddBarColor, transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9, color: T.textSec }}>
          <span>0%</span>
          <span style={{ color: T.org ?? '#f97316' }}>-15% → survival (2%)</span>
          <span style={{ color: T.red ?? '#ef4444' }}>-20% → stop</span>
        </div>
      </div>

      {/* Config fields */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 15px' }}>
        <div style={{ fontSize: 10, color: T.textSec, letterSpacing: 0.5, marginBottom: 16, textTransform: 'uppercase' }}>
          Configuración de Capital
        </div>

        {/* Hardcoded thresholds info */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 18, fontSize: 10, color: T.textSec, lineHeight: 1.7 }}>
          <div style={{ color: T.text, fontWeight: 600, marginBottom: 4, fontSize: 11 }}>Sistema de drawdown automático</div>
          <div>{'>'} P&L {'>'} -15% → <span style={{ color: T.grn ?? '#00ff88' }}>NORMAL — 5% riesgo</span></div>
          <div>{'>'} P&L ≤ -15% → <span style={{ color: T.org ?? '#f97316' }}>SURVIVAL — 2% riesgo</span></div>
          <div>{'>'} P&L ≤ -20% → <span style={{ color: T.red ?? '#ef4444' }}>STOP — sin trades</span></div>
          <div>{'>'} P&L recupera 0% → <span style={{ color: T.grn ?? '#00ff88' }}>vuelve a NORMAL automáticamente</span></div>
        </div>

        {CONFIG_FIELDS.map(f => (
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
                  min={f.min} max={f.max} step={f.step}
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
            <input
              type="range" min={f.min} max={f.max} step={f.step}
              value={config[f.key]}
              onChange={e => setConfig(c => ({ ...c, [f.key]: parseFloat(e.target.value) }))}
              className="apex-calc-range"
              style={{ width: '100%', height: 20, cursor: 'pointer' }}
            />
          </div>
        ))}

        <button
          onClick={save} disabled={saving}
          style={{
            width: '100%', padding: '11px 0', marginTop: 4,
            background: T.grn ?? '#00ff88', color: T.bg ?? '#0a0a0f',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
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
