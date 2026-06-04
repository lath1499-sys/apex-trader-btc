'use client'
import { useState, useEffect, useRef } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'
import { ntfyTest, getNtfySettings, saveNtfySettings, type NtfySettings } from '@/lib/ntfy'
import { loadCapitalConfig, saveCapitalConfig, DEFAULT_CONFIG } from '@/lib/capitalManagement'
import type { CapitalConfig } from '@/lib/capitalManagement'
import { getSupabase } from '@/lib/supabase'

type Alert = { id: number; price: number; dir: 'above' | 'below'; label: string; fired: boolean }

export default function PriceAlertPanel() {
  const T    = useTheme()
  const mkt  = useApexStore(s => s.mkt)
  const perm = useApexStore(s => s.notifPerm)

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [price,  setPrice]  = useState('')
  const [label,  setLabel]  = useState('')
  const [dir,    setDir]    = useState<'above' | 'below'>('above')
  const seeded = useRef(false)

  // ── NTFY state ─────────────────────────────────────────────────────────────
  const [topic,    setTopic]    = useState(() => { try { return localStorage.getItem('apex_ntfy_topic') ?? '' } catch { return '' } })
  const [settings, setSettings] = useState<NtfySettings>(() => getNtfySettings())
  const [testing,  setTesting]  = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // ── Capital config ──────────────────────────────────────────────────────────
  const [capitalConfig, setCapitalConfig] = useState<CapitalConfig>(DEFAULT_CONFIG)
  const [capitalSaving, setCapitalSaving] = useState(false)
  useEffect(() => {
    const sb = getSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loadCapitalConfig(sb as any).then(setCapitalConfig)
  }, [])

  function updateCapital(key: keyof CapitalConfig, raw: string) {
    const val = parseFloat(raw)
    if (isNaN(val) || val < 0) return
    setCapitalConfig(prev => ({ ...prev, [key]: val }))
  }

  async function saveCapital() {
    setCapitalSaving(true)
    const sb = getSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await saveCapitalConfig(sb as any, capitalConfig)
    setCapitalSaving(false)
  }

  function saveTopic(t: string) {
    setTopic(t)
    try { localStorage.setItem('apex_ntfy_topic', t) } catch {}
  }

  function toggleSetting(key: keyof NtfySettings) {
    const next = { ...settings, [key]: !settings[key] }
    setSettings(next)
    saveNtfySettings(next)
  }

  async function testNotif() {
    const t = topic.trim()
    if (!t) return
    setTesting(true)
    setTestResult('Enviando...')
    try {
      const ok = await ntfyTest(t)
      setTestResult(ok
        ? '✅ Notificación enviada — revisa tu app ntfy'
        : '❌ Error — verifica el tema e intenta de nuevo')
    } catch {
      setTestResult('❌ Error de red — verifica tu conexión')
    }
    setTesting(false)
  }

  useEffect(() => {
    if (mkt.price && !seeded.current) { seeded.current = true; setPrice(String(Math.round(mkt.price))) }
  }, [mkt.price])

  useEffect(() => {
    if (!mkt.price) return
    const cur = mkt.price
    setAlerts(prev => prev.map(a => {
      if (a.fired) return a
      const hit = a.dir === 'above' ? cur >= a.price : cur <= a.price
      if (!hit) return a
      if (perm === 'granted')
        new Notification(`APEX BTC ${a.dir === 'above' ? 'sube' : 'baja'} $${a.price.toLocaleString()}`, { body: a.label || 'Alerta de precio activada' })
      return { ...a, fired: true }
    }))
  }, [mkt.price, perm])

  function add() {
    const p = parseFloat(price)
    if (!p) return
    setAlerts(prev => [...prev, { id: Date.now(), price: p, dir, label: label || (dir === 'above' ? '↑ ' + p : '↓ ' + p), fired: false }])
    setPrice(''); setLabel('')
  }

  const cur = mkt.price ?? 0
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const NTFY_GROUPS: { header: string; items: { key: keyof NtfySettings; label: string }[] }[] = [
    { header: '📡 SEÑALES', items: [
      { key: 'newSignalNormal', label: '🚨 Nueva señal Normal' },
      { key: 'newSignalScalp',  label: '⚡ Nueva señal Scalp' },
      { key: 'autoClose',       label: '🤖 Cierre automático' },
      { key: 'limitOrder',      label: '📋 Orden límite activada' },
    ]},
    { header: '🎯 NIVELES', items: [
      { key: 'tp1Hit',  label: '✅ TP1 alcanzado' },
      { key: 'tp2Hit',  label: '✅ TP2 alcanzado' },
      { key: 'tp3Hit',  label: '🏆 TP3 alcanzado' },
      { key: 'slHit',   label: '❌ Stop Loss tocado' },
    ]},
    { header: '⚠️ WARNINGS', items: [
      { key: 'slWarning',     label: '⚠️ Precio cerca del SL' },
      { key: 'expiryWarning', label: '⏰ Señal próxima a expirar' },
      { key: 'trailingSL',    label: '💡 Sugerencia trailing SL' },
    ]},
    { header: '📊 ANÁLISIS', items: [
      { key: 'analysis30m', label: '📊 Análisis 30 minutos' },
      { key: 'analysis4h',  label: '📊 Análisis 4 horas' },
    ]},
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {perm !== 'granted' && (
        <div style={{ background: T.warn + '11', border: `1px solid ${T.warn}33`, borderRadius: 7, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 10, color: T.warn }}>🔔 Activa notificaciones browser para alertas de precio</div>
          <button onClick={async () => { if ('Notification' in window) { const r = await Notification.requestPermission(); useApexStore.getState().setNotifPerm(r) } }}
            style={{ background: T.warn + '22', border: `1px solid ${T.warn}`, color: T.warn, padding: '5px 14px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9, fontWeight: 700 }}>Activar</button>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, color: (mkt.change ?? 0) >= 0 ? T.bull : T.danger }}>
        ${fmt(cur, 0)} <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>BTC/USDT</span>
      </div>

      {/* ── NTFY Push Notifications ────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>📱 NTFY PUSH NOTIFICATIONS</div>
        <div style={{ fontSize: 9, color: T.textSec, lineHeight: 1.7, marginBottom: 10, background: T.bg, borderRadius: 5, padding: '8px 10px' }}>
          <strong style={{ color: T.accent }}>1.</strong> Descarga la app <strong>ntfy</strong> (Android/iOS) — gratis, sin cuenta<br />
          <strong style={{ color: T.accent }}>2.</strong> En la app: Subscribe → escribe tu tema único<br />
          <strong style={{ color: T.accent }}>3.</strong> Pega el mismo tema aquí → notificaciones al instante
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>TU TEMA ÚNICO (ej: apex-btc-miguel-2024)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={topic} onChange={e => saveTopic(e.target.value)} placeholder="mi-tema-secreto-unico"
              style={{ flex: 1, background: T.bg, border: `1px solid ${topic ? T.accent : T.border}`, color: T.text, fontFamily: 'inherit', fontSize: 11, padding: '7px 10px', borderRadius: 5, outline: 'none' }} />
            <button onClick={testNotif} disabled={!topic.trim() || testing} style={{
              background: T.accent + '22', border: `1px solid ${T.accent}`, color: T.accent,
              padding: '7px 12px', borderRadius: 5, cursor: topic ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 9, fontWeight: 700, opacity: topic ? 1 : 0.4, whiteSpace: 'nowrap',
            }}>{testing ? '...' : 'Probar'}</button>
          </div>
          {testResult && (
            <div style={{ fontSize: 9, marginTop: 4,
              color: testResult.startsWith('✅') ? T.bull : testResult.startsWith('❌') ? T.danger : T.muted }}>
              {testResult}
            </div>
          )}
        </div>
        {NTFY_GROUPS.map(group => (
          <div key={group.header} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.12em', marginBottom: 4, marginTop: 6 }}>{group.header}</div>
            {group.items.map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}18` }}>
                <span style={{ fontSize: 9, color: T.textSec }}>{label}</span>
                <button onClick={() => toggleSetting(key)} style={{
                  width: 36, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: settings[key] ? T.bull : T.muted + '44',
                  position: 'relative', transition: 'background .2s', flexShrink: 0,
                }}>
                  <div style={{ position: 'absolute', top: 2, left: settings[key] ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Price Alerts ───────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>NUEVA ALERTA DE PRECIO</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>PRECIO</div>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder={String(Math.round(cur))}
              style={{ width: '100%', background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: 'inherit', fontSize: 12, padding: '7px 10px', borderRadius: 5, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>ETIQUETA (opcional)</div>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Resistencia clave..."
              style={{ width: '100%', background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: 'inherit', fontSize: 11, padding: '7px 10px', borderRadius: 5, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 8, color: T.muted, marginBottom: 4 }}>DIRECCIÓN</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['above', 'below'] as const).map(d => (
                <button key={d} onClick={() => setDir(d)} style={{
                  background: dir === d ? (d === 'above' ? T.bull : T.danger) + '22' : 'transparent',
                  border: `1px solid ${dir === d ? (d === 'above' ? T.bull : T.danger) : T.border}`,
                  color: dir === d ? (d === 'above' ? T.bull : T.danger) : T.textSec,
                  padding: '7px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9,
                }}>{d === 'above' ? '↑ Sube' : '↓ Baja'}</button>
              ))}
            </div>
          </div>
          <button onClick={add} disabled={!price} style={{
            background: T.accent + '22', border: `1px solid ${T.accent}`, color: T.accent,
            padding: '7px 18px', borderRadius: 5, cursor: price ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, opacity: price ? 1 : 0.4,
          }}>+ Agregar</button>
        </div>
      </div>

      {/* ── Capital Management ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 12 }}>💰 GESTIÓN DE CAPITAL (KELLY)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {([
            { key: 'totalCapital',    label: 'Capital Total ($)',    min: 100,  step: 100 },
            { key: 'maxRiskPerTrade', label: 'Riesgo Máx/Op (%)',   min: 0.1,  step: 0.1 },
            { key: 'maxOpenTrades',   label: 'Ops Abiertas Máx',    min: 1,    step: 1   },
            { key: 'maxDailyLoss',    label: 'Pérd Diaria Máx (%)', min: 0.5,  step: 0.5 },
            { key: 'maxWeeklyLoss',   label: 'Pérd Semanal Máx (%)',min: 1,    step: 1   },
            { key: 'leverageLimit',   label: 'Leverage Máximo (x)', min: 1,    step: 1   },
          ] as Array<{ key: keyof typeof capitalConfig; label: string; min: number; step: number }>).map(({ key, label, min, step }) => (
            <div key={key}>
              <div style={{ fontSize: 8, color: T.muted, marginBottom: 3 }}>{label}</div>
              <input
                type="number" min={min} step={step}
                value={capitalConfig[key]}
                onChange={e => updateCapital(key, e.target.value)}
                style={{ width: '100%', background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: 'inherit', fontSize: 11, padding: '6px 8px', borderRadius: 5, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          ))}
        </div>
        <button onClick={saveCapital} disabled={capitalSaving} style={{
          width: '100%', background: T.accent + '22', border: `1px solid ${T.accent}`,
          color: T.accent, padding: '8px 0', borderRadius: 5, cursor: capitalSaving ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', fontSize: 9, fontWeight: 700, opacity: capitalSaving ? 0.5 : 1,
        }}>{capitalSaving ? 'GUARDANDO...' : '💾 GUARDAR CONFIGURACIÓN'}</button>
        <div style={{ fontSize: 8, color: T.muted, marginTop: 6, textAlign: 'center' }}>
          Kelly ½ · Riesgo por op: ${((capitalConfig.totalCapital * capitalConfig.maxRiskPerTrade) / 100).toFixed(0)}
          {' · '}Max open: ${((capitalConfig.totalCapital * capitalConfig.maxRiskPerTrade * capitalConfig.maxOpenTrades) / 100).toFixed(0)} total expuesto
        </div>
      </div>

      {alerts.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: 30, textAlign: 'center', color: T.textSec, fontSize: 11 }}>Sin alertas. Añade una arriba.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {alerts.map(a => {
            const triggered = a.dir === 'above' ? cur >= a.price : cur <= a.price
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: T.card, border: `1px solid ${triggered ? T.warn : T.border}`, borderRadius: 7 }}>
                <span style={{ fontSize: 16, color: a.dir === 'above' ? T.bull : T.danger }}>{a.dir === 'above' ? '↑' : '↓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: triggered ? T.warn : T.text }}>${fmt(a.price, 0)}</div>
                  <div style={{ fontSize: 9, color: T.muted }}>{a.label}{triggered ? ' · ACTIVA' : ''}</div>
                </div>
                <button onClick={() => setAlerts(p => p.filter(x => x.id !== a.id))} style={{ background: 'transparent', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 16, padding: 4 }}>×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
