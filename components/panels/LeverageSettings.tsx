'use client'
import React, { useState, useEffect } from 'react'

const TRADE_TYPES = ['Scalp', 'DayTrade', 'Swing'] as const
type TradeType = typeof TRADE_TYPES[number]

const TYPE_META: Record<TradeType, { emoji: string; desc: string; color: string }> = {
  Scalp:    { emoji: '⚡', desc: 'Minutos a 2h · 15M/1H charts', color: '#f0a868' },
  DayTrade: { emoji: '📊', desc: 'Horas a 1 día · 4H charts',    color: '#5fb3e8' },
  Swing:    { emoji: '🌊', desc: '1–7 días · 1D charts',          color: '#3ddc97' },
}

interface TypeConfig {
  trade_type:     string
  leverage_min:   number
  leverage_max:   number
  leverage_ideal: number
  sl_min_pct:     number
  sl_max_pct:     number
  notes:          string
}

interface Props { T: Record<string, string> }

function previewLeverage(cfg: TypeConfig, slFrac: number): string {
  if (!cfg || slFrac <= 0) return '—'
  const formula = 0.05 / slFrac
  const result  = Math.max(cfg.leverage_min, Math.min(cfg.leverage_max, Math.round(formula)))
  return `${result}x`
}

interface NumericRowProps {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step?: number; suffix: string
  color: string; T: Record<string, string>
}

function NumericRow({ label, value, onChange, min, max, step = 1, suffix, color, T }: NumericRowProps) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])

  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))

  const commit = () => {
    let n = parseFloat(raw)
    if (isNaN(n)) n = value
    n = parseFloat(Math.min(max, Math.max(min, n)).toFixed(2))
    onChange(n)
    setRaw(String(n))
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: T.textSec ?? '#7a7a96' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input
            type="text" inputMode="decimal" value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{
              width: 50, textAlign: 'right', background: T.bg ?? '#0a0a0f',
              border: `1px solid ${T.border ?? '#2a2a38'}`,
              borderRadius: 4, color, fontWeight: 700,
              fontSize: 12, padding: '2px 5px', outline: 'none',
              fontFamily: 'monospace',
            }}
          />
          <span style={{ fontSize: 10, color: T.textSec ?? '#7a7a96', minWidth: 12 }}>{suffix}</span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2,
          background: T.bg ?? '#0a0a0f', border: `1px solid ${T.border ?? '#2a2a38'}`,
        }} />
        <div style={{
          position: 'absolute', left: 0, height: 3, borderRadius: 2,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          pointerEvents: 'none',
        }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{
            position: 'relative', width: '100%', height: 16,
            appearance: 'none', background: 'transparent',
            outline: 'none', cursor: 'pointer', zIndex: 1,
          }}
        />
      </div>
    </div>
  )
}

export default function LeverageSettings({ T }: Props) {
  const [configs, setConfigs] = useState<Record<string, TypeConfig>>({})
  const [saving,  setSaving]  = useState<string | null>(null)
  const [saved,   setSaved]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const grn = T.accent  ?? '#00ff88'
  const bdr = T.border  ?? '#2a2a38'
  const bg  = T.card    ?? '#15151f'
  const bg2 = T.bg      ?? '#0a0a0f'
  const txt = T.text    ?? '#e8e8f0'
  const sec = T.textSec ?? '#7a7a96'

  useEffect(() => {
    fetch('/api/leverage-config')
      .then(r => r.json() as Promise<{ data: TypeConfig[] }>)
      .then(d => {
        const map: Record<string, TypeConfig> = {}
        for (const row of d.data ?? []) map[row.trade_type] = row
        setConfigs(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const update = (type: string, field: string, val: number) => {
    setConfigs(prev => ({ ...prev, [type]: { ...prev[type], [field]: val } }))
  }

  const save = async (type: string) => {
    setSaving(type)
    try {
      await fetch('/api/leverage-config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(configs[type]),
      })
      setSaved(type)
      setTimeout(() => setSaved(null), 2000)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return (
    <div style={{ padding: 20, color: sec, fontFamily: 'monospace', fontSize: 12 }}>
      Cargando configuración...
    </div>
  )

  if (Object.keys(configs).length === 0) return (
    <div style={{ padding: 20, color: sec, fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ marginBottom: 8, color: T.danger ?? '#ff4466', fontWeight: 700 }}>
        ⚠️ Tabla apex_leverage_config no encontrada en Supabase
      </div>
      <div>Ejecuta en el SQL Editor de Supabase:</div>
      <pre style={{
        marginTop: 10, background: bg2, border: `1px solid ${bdr}`,
        borderRadius: 8, padding: 12, fontSize: 10, overflowX: 'auto',
        color: T.text ?? '#e8e8f0',
      }}>{`CREATE TABLE IF NOT EXISTS apex_leverage_config (
  trade_type     TEXT PRIMARY KEY,
  leverage_min   INT     NOT NULL,
  leverage_max   INT     NOT NULL,
  leverage_ideal INT     NOT NULL,
  sl_min_pct     NUMERIC NOT NULL,
  sl_max_pct     NUMERIC NOT NULL,
  notes          TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_by     TEXT DEFAULT 'system'
);
INSERT INTO apex_leverage_config
  (trade_type, leverage_min, leverage_max, leverage_ideal, sl_min_pct, sl_max_pct, notes)
VALUES
  ('Scalp',    15, 25, 20, 0.004, 0.015, 'Movimientos rápidos 15M/1H'),
  ('DayTrade', 10, 20, 15, 0.010, 0.035, 'Setup 4H, duración horas'),
  ('Swing',     7, 10,  8, 0.025, 0.080, 'Estructura 1D, días a semanas')
ON CONFLICT (trade_type) DO UPDATE SET
  leverage_min   = EXCLUDED.leverage_min,
  leverage_max   = EXCLUDED.leverage_max,
  leverage_ideal = EXCLUDED.leverage_ideal,
  sl_min_pct     = EXCLUDED.sl_min_pct,
  sl_max_pct     = EXCLUDED.sl_max_pct,
  updated_at     = NOW();`}</pre>
    </div>
  )

  return (
    <div style={{ padding: '10px 2px 32px', color: txt }}>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Configuración de Leverage por Tipo de Trade
        </div>
        <div style={{ fontSize: 11, color: sec, lineHeight: 1.5 }}>
          El leverage se calcula:{' '}
          <span style={{ color: grn, fontFamily: 'monospace' }}>riesgo% ÷ distancia_SL%</span>,
          limitado por el rango que definas aquí. Los cambios aplican al próximo trade.
        </div>
      </div>

      {TRADE_TYPES.map(type => {
        const cfg  = configs[type]
        const meta = TYPE_META[type]
        if (!cfg) return null

        return (
          <div key={type} style={{
            background: bg, border: `1px solid ${bdr}`,
            borderRadius: 12, padding: '16px 15px',
            marginBottom: 14, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
            }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>
                  {meta.emoji} {type}
                </div>
                <div style={{ fontSize: 10, color: sec, marginTop: 2 }}>{meta.desc}</div>
              </div>
              <button
                onClick={() => void save(type)}
                disabled={saving === type}
                style={{
                  padding: '6px 14px',
                  background: saved === type ? grn + '22' : meta.color + '18',
                  border: `1px solid ${saved === type ? grn : meta.color}66`,
                  borderRadius: 7, cursor: 'pointer',
                  color: saved === type ? grn : meta.color,
                  fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                  transition: 'all 0.2s',
                }}
              >
                {saving === type ? 'Guardando...' : saved === type ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: bg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, color: sec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Rango de Leverage
                </div>
                <NumericRow label="Mínimo" value={cfg.leverage_min} suffix="x"
                  min={1} max={cfg.leverage_max - 1}
                  onChange={v => update(type, 'leverage_min', v)}
                  color={meta.color} T={T} />
                <NumericRow label="Máximo" value={cfg.leverage_max} suffix="x"
                  min={cfg.leverage_min + 1} max={125}
                  onChange={v => update(type, 'leverage_max', v)}
                  color={meta.color} T={T} />
                <NumericRow label="Ideal" value={cfg.leverage_ideal} suffix="x"
                  min={cfg.leverage_min} max={cfg.leverage_max}
                  onChange={v => update(type, 'leverage_ideal', v)}
                  color={meta.color} T={T} />
              </div>

              <div style={{ background: bg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, color: sec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Rango de Stop Loss
                </div>
                <NumericRow
                  label="SL mínimo"
                  value={parseFloat((cfg.sl_min_pct * 100).toFixed(2))}
                  suffix="%"
                  min={0.1}
                  max={parseFloat((cfg.sl_max_pct * 100 - 0.1).toFixed(2))}
                  step={0.1}
                  onChange={v => update(type, 'sl_min_pct', v / 100)}
                  color={meta.color} T={T}
                />
                <NumericRow
                  label="SL máximo"
                  value={parseFloat((cfg.sl_max_pct * 100).toFixed(2))}
                  suffix="%"
                  min={parseFloat((cfg.sl_min_pct * 100 + 0.1).toFixed(2))}
                  max={20}
                  step={0.1}
                  onChange={v => update(type, 'sl_max_pct', v / 100)}
                  color={meta.color} T={T}
                />
              </div>
            </div>

            <div style={{ marginTop: 12, background: bg2, border: `1px solid ${bdr}`, borderRadius: 8, padding: '10px 13px' }}>
              <div style={{ fontSize: 10, color: sec, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Vista previa — leverage según SL (riesgo fijo 5%)
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[cfg.sl_min_pct, (cfg.sl_min_pct + cfg.sl_max_pct) / 2, cfg.sl_max_pct].map(slFrac => (
                  <div key={slFrac} style={{
                    background: bg, border: `1px solid ${bdr}`,
                    borderRadius: 6, padding: '6px 10px', textAlign: 'center', flex: 1, minWidth: 70,
                  }}>
                    <div style={{ fontSize: 9, color: sec, marginBottom: 3 }}>
                      SL {(slFrac * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: meta.color, fontFamily: 'monospace' }}>
                      {previewLeverage(cfg, slFrac)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 12, padding: '14px 15px', marginTop: 4 }}>
        <div style={{ fontSize: 10, color: sec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Resumen
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: sec, fontSize: 10 }}>
              {['Tipo', 'Leverage', 'SL rango', 'SL 1% → Lev', 'SL 2% → Lev'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${bdr}`, fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TRADE_TYPES.map(type => {
              const cfg  = configs[type]
              const meta = TYPE_META[type]
              if (!cfg) return null
              return (
                <tr key={type}>
                  <td style={{ padding: '7px 8px', color: meta.color, fontWeight: 600 }}>{meta.emoji} {type}</td>
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace' }}>{cfg.leverage_min}x – {cfg.leverage_max}x</td>
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace' }}>
                    {(cfg.sl_min_pct * 100).toFixed(1)}% – {(cfg.sl_max_pct * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: meta.color }}>{previewLeverage(cfg, 0.01)}</td>
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: meta.color }}>{previewLeverage(cfg, 0.02)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ textAlign: 'center', marginTop: 14, fontSize: 10, color: sec, lineHeight: 1.5 }}>
        Los cambios se aplican al próximo trade que genere el agente.
        El leverage exacto depende del SL que Claude defina en cada señal.
      </div>
    </div>
  )
}
