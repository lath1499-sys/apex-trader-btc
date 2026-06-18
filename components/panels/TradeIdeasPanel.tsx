'use client'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt } from '@/lib/buildContext'
import { calcSignalStats, closeManualSignal, loadSignalHistory, saveSignalHistory } from '@/lib/signalHistory'
import { getSupabase } from '@/lib/supabase'
import { getLearnedWeights } from '@/lib/scoreWeights'
import type { TradeIdea, SignalRecord, IndicatorMap, MarketData } from '@/lib/types'
import type { FVGResult } from '@/lib/fvg'
import { generateLimitOrders }   from '@/lib/limitOrders'
import { calcWinProbability }    from '@/lib/probabilisticModel'
import { writeTradeAnalysis }    from '@/lib/analysisWriter'
import { detectMarketRegime }    from '@/lib/marketRegime'
import type { ScalpSignal }      from '@/lib/scalpSignals'
import { usePerformanceStats }  from '@/hooks/useSignalHistory'
import { analyzeMacroSentiment } from '@/lib/macroSentiment'
import type { MacroSentiment }   from '@/lib/macroSentiment'
import { calcPositionSize, loadCapitalConfig, DEFAULT_CONFIG } from '@/lib/capitalManagement'
import type { CapitalConfig, PositionSize } from '@/lib/capitalManagement'
import PerformanceCalendar from './PerformanceCalendar'

const STATUS_COLOR: Record<string, string> = {
  active: '#a78bfa', pending_confirmation: '#fbbf24',
  tp1_hit: '#22c55e', tp2_hit: '#16a34a', tp3_hit: '#15803d',
  sl_hit: '#ef4444', breakeven: '#6b7280', closed_manual: '#f97316',
}
const STATUS_LABEL: Record<string, string> = {
  active: 'ACTIVO', pending_confirmation: '⚠️ CONTRARIA',
  tp1_hit: 'TP1 ✓', tp2_hit: 'TP2 ✓', tp3_hit: 'TP3 ✓',
  sl_hit: 'SL ✗', breakeven: 'B/E', closed_manual: 'CERRADO',
}

const CLOSE_REASONS = [
  'TP1 manual', 'TP2 manual', 'TP3 manual', 'SL manual', 'Decisión propia',
]

function buildAlertMsg(idea: TradeIdea): string {
  const rr = (Math.abs(idea.tp1 - idea.price) / (Math.abs(idea.sl - idea.price) || 1)).toFixed(1)
  return [
    `🚨 APEX: ${idea.side} BTC`,
    `Tipo: ${idea.tradeType} | Confianza: ${idea.confidence}`,
    `Entrada: $${Math.round(idea.price).toLocaleString()}`,
    `SL: $${Math.round(idea.sl).toLocaleString()} | TP1: $${Math.round(idea.tp1).toLocaleString()} | TP2: $${Math.round(idea.tp2).toLocaleString()} | TP3: $${Math.round(idea.tp3).toLocaleString()}`,
    `R:R ${rr} | Apalancamiento máx: ${idea.maxLev}x`,
    idea.analysis.slice(0, 120),
  ].join('\n')
}

function buildScalpAnalysis(sig: ScalpSignal): string {
  const now   = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const slDst = Math.abs(sig.entry - sig.sl).toFixed(0)
  const tpDst = Math.abs(sig.tp1 - sig.entry).toFixed(0)
  return [
    `⚡ SCALP ANALYSIS — ${now}`,
    `Killzone: ${sig.killzone ?? 'Fuera de KZ'} — ${sig.killzone ? 'alta probabilidad' : 'baja probabilidad'}`,
    `VWAP: Precio ${sig.vwapRelation}`,
    `CVD: ${sig.cvdSignal ?? 'Sin señal de volumen'}`,
    `Estructura: ${sig.bosChoch ?? 'Sin BOS/CHoCH reciente'}`,
    ``,
    `Setup: ${sig.side} Scalp ${sig.duration}`,
    `Entrada: $${Math.round(sig.entry).toLocaleString()} | SL: $${Math.round(sig.sl).toLocaleString()} (−${slDst}$) | TP1: $${Math.round(sig.tp1).toLocaleString()} (+${tpDst}$)`,
    `Confianza: ${sig.confidence} | Score: ${sig.score}/9`,
    `Calidad: ${sig.qualityLabel} | Max leverage: ${sig.maxLeverage}x`,
  ].join('\n')
}

function ScalpCard({ sig }: { sig: ScalpSignal }) {
  const T               = useTheme()
  const price           = useApexStore(s => s.mkt.price)
  const setScalpSignal  = useApexStore(s => s.setScalpSignal)
  const pushScalpHistory = useApexStore(s => s.pushScalpHistory)
  const [elapsed, setElapsed] = React.useState(0)

  // tick every second for live time + P&L
  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - sig.createdAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [sig.createdAt])

  const isLong   = sig.side === 'LONG'
  const sideC    = isLong ? T.bull : T.danger
  const confC    = sig.confidence === 'ALTA' ? T.bull : sig.confidence === 'MEDIA' ? T.warn : T.muted
  const qlC      = sig.qualityLabel === 'Señal de libro' ? T.bull : sig.qualityLabel === 'Buena señal' ? T.warn : T.muted
  const rr       = (Math.abs(sig.tp1 - sig.entry) / (Math.abs(sig.sl - sig.entry) || 1)).toFixed(1)
  const pnlPct   = price
    ? (isLong ? (price - sig.entry) / sig.entry : (sig.entry - price) / sig.entry) * 100
    : null
  const pnlC     = pnlPct == null ? T.muted : pnlPct >= 0 ? T.bull : T.danger
  const mins     = Math.floor(elapsed / 60)
  const secs     = elapsed % 60
  const timeStr  = `${mins}m ${secs.toString().padStart(2, '0')}s`

  const statusLabels: Record<string, string> = {
    active: '🟢 ACTIVO', tp1_hit: '🎯 TP1', tp2_hit: '🎯🎯 TP2', tp3_hit: '🏆 TP3',
  }

  function handleClose() {
    const now = Date.now()
    pushScalpHistory({
      ...sig,
      status:     'closed_manual',
      closedAt:   now,
      closePrice: price ?? sig.entry,
      pnl:        pnlPct ?? 0,
    })
    setScalpSignal(null)
  }

  return (
    <div style={{ background: T.card, border: `2px solid ${sideC}44`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 18 }}>{isLong ? '⚡🟢' : '⚡🔴'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: sideC, letterSpacing: '.06em' }}>
            SCALP {sig.side}
            <span style={{ fontSize: 9, fontWeight: 400, color: T.muted, marginLeft: 8 }}>{sig.duration}</span>
            {sig.status !== 'active' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: T.warn, marginLeft: 8 }}>{statusLabels[sig.status] ?? sig.status}</span>
            )}
            {sig.status === 'active' && sig.tp2Hit && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', marginLeft: 8 }}>🎯🎯 TP2 tocado · SL→TP1</span>
            )}
            {sig.status === 'active' && sig.tp1Hit && !sig.tp2Hit && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', marginLeft: 8 }}>🎯 TP1 tocado · SL→entrada</span>
            )}
          </div>
          <div style={{ fontSize: 9, color: T.textSec, marginTop: 2 }}>
            {sig.killzone && <span style={{ color: '#7b9fff', marginRight: 8 }}>🕐 {sig.killzone}</span>}
            <span style={{ color: qlC, fontWeight: 700 }}>
              {sig.qualityLabel === 'Señal de libro' ? '📗' : sig.qualityLabel === 'Buena señal' ? '📘' : '📙'} {sig.qualityLabel}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: confC }}>{sig.confidence}</div>
          <div style={{ fontSize: 8, color: T.muted }}>Score {sig.score}/9</div>
        </div>
      </div>

      {/* Live P&L + time bar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: T.bg, border: `1px solid ${pnlC}44`, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>P&L LIVE</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: pnlC, fontFamily: 'monospace' }}>
            {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}
          </div>
          {price && <div style={{ fontSize: 8, color: T.muted }}>${Math.round(price).toLocaleString()}</div>}
        </div>
        <div style={{ flex: 1, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>TIEMPO</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>{timeStr}</div>
          <div style={{ fontSize: 8, color: T.muted }}>duración: {sig.duration}</div>
        </div>
      </div>

      {/* Context badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8, color: T.textSec, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 3, padding: '2px 6px' }}>
          📍 {sig.vwapRelation}
        </span>
        {sig.cvdSignal && (
          <span style={{ fontSize: 8, color: '#22c55e', background: '#22c55e18', border: '1px solid #22c55e44', borderRadius: 3, padding: '2px 6px' }}>
            📊 {sig.cvdSignal}
          </span>
        )}
        {sig.bosChoch && (
          <span style={{ fontSize: 8, color: '#00d084', background: '#00d08418', border: '1px solid #00d08444', borderRadius: 3, padding: '2px 6px' }}>
            🏗 {sig.bosChoch}
          </span>
        )}
      </div>

      {/* Levels grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, fontSize: 9 }}>
        {[
          { l: 'ENTRADA', v: `$${Math.round(sig.entry).toLocaleString()}`, c: '#fbbf24' },
          { l: `SL (R:R ${rr})`, v: `$${Math.round(sig.sl).toLocaleString()}`, c: T.danger },
          { l: 'TP1',    v: `$${Math.round(sig.tp1).toLocaleString()}`, c: T.bull },
          { l: 'TP2',    v: `$${Math.round(sig.tp2).toLocaleString()}`, c: T.bull },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 7, color: T.muted, marginBottom: 3 }}>{l}</div>
            <div style={{ fontWeight: 700, color: c, fontFamily: 'monospace' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Max leverage + close button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: T.textSec }}>
        <span>Max leverage: <strong style={{ color: T.warn }}>{sig.maxLeverage}x</strong></span>
        <span>{sig.reasons.length} confluencias</span>
        <button onClick={handleClose} style={{
          padding: '4px 10px', borderRadius: 5, border: `1px solid ${T.danger}88`,
          background: T.danger + '18', color: T.danger, cursor: 'pointer',
          fontSize: 9, fontFamily: 'inherit', fontWeight: 700,
        }}>✕ Cerrar</button>
      </div>

      {/* Reasons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sig.reasons.slice(0, 5).map((r, i) => (
          <div key={i} style={{ fontSize: 9, color: T.textSec }}>
            <span style={{ color: isLong ? T.bull : T.danger }}>{'▲▼'[isLong ? 0 : 1]}</span> {r}
          </div>
        ))}
        {sig.reasons.length > 5 && <div style={{ fontSize: 8, color: T.muted }}>+{sig.reasons.length - 5} más…</div>}
      </div>
    </div>
  )
}

function IdeaCard({ idea, rec, defaultOpen, onClose }: {
  idea: TradeIdea; rec?: SignalRecord; defaultOpen?: boolean
  onClose?: (id: string, price: number, reason: string) => void
}) {
  const T = useTheme()
  const mkt = useApexStore(s => s.mkt)
  const [open, setOpen]           = useState(defaultOpen ?? false)
  const [showClose, setShowClose] = useState(false)
  const [closePrice, setClosePrice] = useState('')
  const [closeReason, setCloseReason] = useState(CLOSE_REASONS[0])
  const [alertPhone] = useState(() => { try { return localStorage.getItem('apex_alert_phone') ?? '' } catch { return '' } })
  const [alertEmail] = useState(() => { try { return localStorage.getItem('apex_alert_email') ?? '' } catch { return '' } })
  const [capitalConfig, setCapitalConfig] = useState<CapitalConfig>(DEFAULT_CONFIG)
  useEffect(() => {
    const sb = getSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loadCapitalConfig(sb as any).then(setCapitalConfig)
  }, [])
  const sideCol = idea.side === 'LONG' ? T.bull : T.danger
  const confCol = idea.confidence === 'ALTA' ? T.bull : idea.confidence === 'MEDIA' ? T.warn : T.danger
  const bullPct = (idea.bull + idea.bear) > 0 ? Math.round(idea.bull / (idea.bull + idea.bear) * 100) : 50
  const setTab  = useApexStore(s => s.setTab)
  const rrRaw   = Math.abs(idea.tp1 - idea.price) / (Math.abs(idea.sl - idea.price) || 1)
  const rr2     = Math.abs(idea.tp2 - idea.price) / (Math.abs(idea.sl - idea.price) || 1)
  const rr3     = Math.abs(idea.tp3 - idea.price) / (Math.abs(idea.sl - idea.price) || 1)
  const ts      = idea.ts ? new Date(idea.ts) : null
  const status  = rec?.status ?? 'active'
  const isActive  = status === 'active'
  const isPending = status === 'pending_confirmation'

  // Live unrealized P&L for active signals (updates on every price tick)
  const curPrice   = mkt.price ?? null
  const unrealized = (isActive && curPrice != null)
    ? idea.side === 'LONG'
      ? (curPrice - idea.price) / idea.price * 100
      : (idea.price - curPrice) / idea.price * 100
    : null
  const distToSLPct = (isActive && curPrice != null)
    ? idea.side === 'LONG'
      ? (idea.price - idea.sl) / idea.price * 100
      : (idea.sl - idea.price) / idea.price * 100
    : null
  const hoursAlive = rec?.createdAt
    ? Math.floor((Date.now() - new Date(rec.createdAt).getTime()) / 3_600_000)
    : null

  const signalHistory  = useApexStore(s => s.signalHistory)
  const indsCard       = useApexStore(s => s.inds)
  const rawKCard       = useApexStore(s => s.rawK)
  const cycleCard      = useApexStore(s => s.cycle)
  const newsCard       = useApexStore(s => s.news)
  const elliottCard    = useApexStore(s => s.elliottWaves)

  const analysisText = useMemo(() => {
    if (!idea || !indsCard) return idea?.analysis ?? ''
    const k4h    = rawKCard?.['4h'] ?? []
    const regime = k4h.length >= 20 ? detectMarketRegime(k4h) : null
    return writeTradeAnalysis({
      idea, inds: indsCard, regime, ew: null,
      mkt: mkt ?? {} as typeof mkt,
      cycle: cycleCard ?? null,
      news: newsCard ?? [],
    })
  }, [idea, mkt?.price, indsCard, cycleCard])

  const probScore = React.useMemo(() => calcWinProbability(
    {
      side:      idea.side,
      tradeType: idea.tradeType,
      score:     idea.bull + idea.bear,
      entry:     idea.price,
      sl:        idea.sl,
      tp1:       idea.tp1,
      fg:        mkt.fg,
      funding:   mkt.funding,
      patterns:  idea.reasons
        .filter(r => r.s === 'bull' || r.s === 'bear')
        .map(r => ({ name: r.txt, type: r.s === 'bull' ? 'bullish' as const : 'bearish' as const })),
    },
    null,
    signalHistory,
  ), [idea, mkt.fg, mkt.funding, signalHistory])

  const positionSize: PositionSize | null = React.useMemo(() => {
    if (!idea.price || !idea.sl) return null
    try {
      return calcPositionSize(
        { entry: idea.price, sl: idea.sl, maxLeverage: idea.maxLev },
        capitalConfig,
        probScore.winProbability,
        probScore.winProbability,   // use prob score as win rate proxy if no history
        1.5,
        1.0,
      )
    } catch { return null }
  }, [idea.price, idea.sl, idea.maxLev, capitalConfig, probScore.winProbability])

  function handleConfirmClose() {
    const price = parseFloat(closePrice) || mkt.price || idea.price
    if (rec?.id && onClose) onClose(rec.id, price, closeReason)
    setShowClose(false)
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${sideCol}33`, borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 5, height: 32, borderRadius: 3, background: sideCol, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: sideCol }}>{idea.side}</span>
            <span style={{ fontSize: 8, color: T.muted, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 5px' }}>{idea.tradeType.toUpperCase()}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: confCol }}>{idea.confidence}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: STATUS_COLOR[status] ?? T.muted }}>{STATUS_LABEL[status] ?? status}</span>
            {(status === 'tp2_hit' || (status === 'active' && rec?.tp2Hit)) && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#16a34a' }}>🎯🎯 TP2·SL→TP1</span>
            )}
            {(status === 'tp1_hit' || (status === 'active' && rec?.tp1Hit && !rec?.tp2Hit)) && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#22c55e' }}>🎯 TP1·SL→entry</span>
            )}
            {rec?.pnlR != null && <span style={{ fontSize: 8, color: rec.pnlR >= 0 ? T.bull : T.danger }}>{rec.pnlR >= 0 ? '+' : ''}{rec.pnlR.toFixed(2)}R</span>}
            {unrealized != null && (
              <span style={{ fontSize: 9, fontWeight: 800, color: unrealized >= 0 ? T.bull : T.danger }}>
                {unrealized >= 0 ? '+' : ''}{unrealized.toFixed(2)}%
              </span>
            )}
          </div>
          <div style={{ fontSize: 9, color: T.textSec }}>
            📍 ${fmt(idea.price, 0)} · 🔴 SL ${fmt(idea.sl, 0)} · TP1 ${fmt(idea.tp1, 0)} · TP2 ${fmt(idea.tp2, 0)} · TP3 ${fmt(idea.tp3, 0)} · R:R {rrRaw.toFixed(1)} · {idea.maxLev}x
          </div>
          {rec && (rec.tp1ClosePct ?? 0) > 0 && (
            <div style={{ fontSize: 8, color: T.muted, marginTop: 2 }}>
              {rec.tp1Hit && rec.tp2Hit
                ? <span style={{ color: T.bull }}>
                    💰 Banqueado: +{(rec.tp1BankedPnl ?? 0).toFixed(2)}% TP1 · +{(rec.tp2BankedPnl ?? 0).toFixed(2)}% TP2 = +{(rec.totalBankedPnl ?? 0).toFixed(2)}% asegurado · {rec.remainingSizePct ?? 25}% resta (SL→TP1)
                  </span>
                : rec.tp1Hit
                ? <span style={{ color: T.bull }}>
                    💰 Banqueado: +{(rec.tp1BankedPnl ?? 0).toFixed(2)}% (TP1 {rec.tp1ClosePct}% cerrado) · {rec.remainingSizePct ?? 60}% resta · SL→breakeven
                  </span>
                : <span>
                    Parciales: TP1 {rec.tp1ClosePct}% · TP2 {rec.tp2ClosePct}% · TP3 {rec.tp3ClosePct}% | R:R {rec.tp1RR}:{rec.tp2RR}:{rec.tp3RR}
                  </span>
              }
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 8, color: T.muted }}>{ts?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div style={{ fontSize: 8, color: T.muted }}>{ts?.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
        </div>
        <span style={{ fontSize: 9, color: T.muted }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ height: 4, background: T.danger + '44', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', width: `${bullPct}%`, background: T.bull, borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
              <span style={{ color: T.bull }}>● {idea.bull} alcistas</span>
              <span style={{ color: T.danger }}>○ {idea.bear} bajistas</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
            {([
              ['SL',  idea.sl,     T.danger],
              ['TP1', idea.tp1,    T.bull],
              ['TP2', idea.tp2,    T.bull],
              ['TP3', idea.tp3,    T.bull],
              ['LEV', idea.maxLev, idea.maxLev <= 5 ? T.bull : T.warn],
            ] as [string, number, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: c }}>{l === 'LEV' ? `${v}x` : `$${fmt(v, 0)}`}</div>
              </div>
            ))}
          </div>
          <div style={{ background: T.bg, borderRadius: 6, padding: '8px 10px', border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 5 }}>SEÑALES ({idea.reasons.length})</div>
            {idea.reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 9, color: r.s === 'bull' ? T.bull : T.danger, lineHeight: 1.6 }}>
                {r.s === 'bull' ? '●' : '○'} {r.txt}
              </div>
            ))}
          </div>
          <div style={{ background: T.accent + '0a', border: `1px solid ${T.accent}33`, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 7, color: T.accent, letterSpacing: '.1em', marginBottom: 5 }}>ANÁLISIS E HIPÓTESIS</div>
            <div style={{ fontSize: 10, color: T.textSec, lineHeight: 1.7 }}>{analysisText}</div>
          </div>

          {/* Win Probability bar */}
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.textSec, marginBottom: 4 }}>
              <span style={{ letterSpacing: '.08em' }}>PROBABILIDAD DE ÉXITO</span>
              <span style={{ fontWeight: 700, color: probScore.winProbability >= 60 ? T.bull : probScore.winProbability >= 50 ? T.warn : T.danger }}>
                {probScore.winProbability}% [IC90: {probScore.confidenceInterval[0]}-{probScore.confidenceInterval[1]}%]
              </span>
            </div>
            <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${probScore.winProbability}%`,
                background: probScore.winProbability >= 60 ? T.bull : probScore.winProbability >= 50 ? T.warn : T.danger,
                transition: 'width .4s ease',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 8, color: T.textSec }}>
              <span>EV: <strong style={{ color: probScore.expectedValue > 0 ? T.bull : T.danger }}>{probScore.expectedValue > 0 ? '+' : ''}{probScore.expectedValue}R</strong></span>
              <span>Kelly: <strong style={{ color: T.warn }}>{probScore.kellyCriterion}%</strong></span>
              <span>Riesgo sugerido: <strong>{Math.min(2, probScore.kellyCriterion).toFixed(1)}%</strong></span>
            </div>
            {probScore.factors.length > 0 && (
              <div style={{ marginTop: 5, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                {probScore.factors.slice(0, 4).map((f, i) => (
                  <div key={i} style={{ fontSize: 8, color: f.direction === '+' ? T.bull : T.danger, lineHeight: 1.6 }}>
                    {f.direction}{f.contribution}% — {f.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Capital Management ──────────────────────────────────────── */}
          {positionSize && (
            <div style={{ background: '#1a2634', border: `1px solid #2563eb44`, borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 7, color: '#60a5fa', letterSpacing: '.1em', marginBottom: 6 }}>💰 GESTIÓN DE CAPITAL</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginBottom: 6 }}>
                {([
                  ['Riesgo', `${positionSize.kellyFraction}% = $${positionSize.riskAmount.toFixed(0)}`],
                  ['Posición', `$${positionSize.positionSize.toFixed(0)} @ ${positionSize.leverage}x`],
                  ['Pérd.Máx', `$${positionSize.maxLoss.toFixed(0)}`],
                ] as [string, string][]).map(([l, v]) => (
                  <div key={l} style={{ background: '#0f1923', border: '1px solid #2563eb33', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 7, color: '#60a5fa88', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#93c5fd' }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 8, color: positionSize.kellyFraction <= 0 ? T.danger : T.textSec }}>
                {positionSize.recommendation}
              </div>
            </div>
          )}

          {/* Live stats row for active signals */}
          {isActive && unrealized != null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {[
                ['P&L No Real.', `${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}%`, unrealized >= 0 ? T.bull : T.danger],
                ['Dist. SL', distToSLPct != null ? `${distToSLPct.toFixed(2)}%` : '—', T.danger],
                ['Activo', hoursAlive != null ? `${hoursAlive}h` : '—', T.textSec],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: '5px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: String(c) }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Stop management status badges */}
          {isActive && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              <span style={{
                padding: '2px 8px', borderRadius: 3, fontSize: 8,
                background: (rec as { breakevenSet?: boolean })?.breakevenSet ? T.bull + '22' : T.textSec + '22',
                color:      (rec as { breakevenSet?: boolean })?.breakevenSet ? T.bull : T.textSec,
              }}>
                {(rec as { breakevenSet?: boolean })?.breakevenSet ? '🛡️ Breakeven activado' : '🔓 SL original'}
              </span>
              {(rec as { trailing2Set?: boolean })?.trailing2Set && (
                <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 8, background: T.accent + '22', color: T.accent }}>
                  📈 Trailing TP1
                </span>
              )}
              {!(rec as { breakevenSet?: boolean })?.breakevenSet && (
                <span style={{ fontSize: 8, color: T.muted }}>
                  Breakeven en TP1 ${Math.round(idea.tp1).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* Stop history */}
          {isActive && (rec as { stopHistory?: Array<{ from: number; to: number; reason: string; ts: string }> })?.stopHistory?.length ? (
            <div style={{ marginTop: 4, fontSize: 8, color: T.textSec, borderTop: `1px solid ${T.border}`, paddingTop: 4 }}>
              <div style={{ color: T.muted, marginBottom: 2 }}>MOVIMIENTOS DE SL:</div>
              {(rec as { stopHistory?: Array<{ from: number; to: number; reason: string; ts: string }> }).stopHistory!.map((sh, i) => (
                <div key={i} style={{ color: T.bull, lineHeight: 1.6 }}>
                  {new Date(sh.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} — {sh.reason}
                  {' '}(${Math.round(sh.from).toLocaleString()} → ${Math.round(sh.to).toLocaleString()})
                </div>
              ))}
            </div>
          ) : null}

          {/* R:R breakdown for active signals */}
          {isActive && (
            <div style={{ fontSize: 9, color: T.textSec, padding: '4px 0' }}>
              R:R → TP1 <strong style={{ color: T.bull }}>{rrRaw.toFixed(1)}:1</strong>
              {' · '}TP2 <strong style={{ color: T.bull }}>{rr2.toFixed(1)}:1</strong>
              {' · '}TP3 <strong style={{ color: T.bull }}>{rr3.toFixed(1)}:1</strong>
            </div>
          )}

          {/* Alert share buttons — active ALTA signals only */}
          {isActive && idea.confidence === 'ALTA' && (alertPhone || alertEmail) && (
            <div style={{ display: 'flex', gap: 6 }}>
              {alertPhone && (
                <a href={`https://wa.me/${alertPhone.replace(/\D/g, '')}?text=${encodeURIComponent(buildAlertMsg(idea))}`}
                  target="_blank" rel="noreferrer"
                  style={{ flex: 1, display: 'block', background: '#25d36622', border: '1px solid #25d366',
                    color: '#25d366', borderRadius: 6, padding: '7px', textAlign: 'center',
                    textDecoration: 'none', fontFamily: 'inherit', fontSize: 10 }}>
                  📱 WhatsApp
                </a>
              )}
              {alertEmail && (
                <a href={`mailto:${alertEmail}?subject=${encodeURIComponent(`🚨 APEX: ${idea.side} BTC`)}&body=${encodeURIComponent(buildAlertMsg(idea))}`}
                  style={{ flex: 1, display: 'block', background: T.accent + '22', border: `1px solid ${T.accent}`,
                    color: T.accent, borderRadius: 6, padding: '7px', textAlign: 'center',
                    textDecoration: 'none', fontFamily: 'inherit', fontSize: 10 }}>
                  📧 Email
                </a>
              )}
            </div>
          )}

          {/* Pending confirmation banner */}
          {isPending && (
            <div style={{ background: '#fbbf2422', border: '1px solid #fbbf24', borderRadius: 6, padding: '8px 12px', fontSize: 10, color: '#fbbf24' }}>
              ⚠️ Nueva señal contraria detectada — espera a cerrar la señal activa antes de operar esta.
            </div>
          )}

          {/* Manual close reason banner */}
          {status === 'closed_manual' && rec?.closeReason && (
            <div style={{ background: '#f9741622', border: '1px solid #f97416', borderRadius: 6, padding: '8px 12px', fontSize: 10, color: '#f97416' }}>
              ✋ Cerrado manualmente: {rec.closeReason}
              {rec.pnl != null && (
                <span style={{ marginLeft: 8, fontWeight: 700, color: rec.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  {rec.pnl >= 0 ? '+' : ''}{rec.pnl.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Close signal UI — only for active signals */}
          {isActive && onClose && !showClose && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setTab('chart')}
                style={{ flex: 1, background: T.accent + '22', border: `1px solid ${T.accent}`, color: T.accent,
                  borderRadius: 6, padding: '7px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}>
                📍 Ver en Chart
              </button>
              <button onClick={() => { setClosePrice(String(Math.round(mkt.price ?? idea.price))); setShowClose(true) }}
                style={{ flex: 1, background: T.danger + '22', border: `1px solid ${T.danger}`, color: T.danger,
                  borderRadius: 6, padding: '7px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}>
                Cerrar Señal
              </button>
            </div>
          )}
          {isActive && onClose && showClose && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '12px' }}>
              <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>CONFIRMAR CIERRE</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: T.muted, marginBottom: 3 }}>Precio de cierre</div>
                  <input value={closePrice} onChange={e => setClosePrice(e.target.value)}
                    style={{ width: '100%', background: T.card, border: `1px solid ${T.border}`, color: T.text,
                      borderRadius: 5, padding: '5px 8px', fontFamily: 'inherit', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: T.muted, marginBottom: 3 }}>Razón</div>
                  <select value={closeReason} onChange={e => setCloseReason(e.target.value)}
                    style={{ width: '100%', background: T.card, border: `1px solid ${T.border}`, color: T.text,
                      borderRadius: 5, padding: '5px 8px', fontFamily: 'inherit', fontSize: 10, boxSizing: 'border-box' }}>
                    {CLOSE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleConfirmClose}
                  style={{ flex: 1, background: T.danger, color: '#fff', border: 'none', borderRadius: 5,
                    padding: '7px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700 }}>
                  Confirmar Cierre
                </button>
                <button onClick={() => setShowClose(false)}
                  style={{ background: 'transparent', border: `1px solid ${T.border}`, color: T.textSec,
                    borderRadius: 5, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AlertasTab() {
  const T = useTheme()
  const ls = (k: string, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } }
  const [phone,        setPhone]        = useState(() => ls('apex_alert_phone'))
  const [callmebotKey, setCallmebotKey] = useState(() => ls('apex_callmebot_key'))
  const [ntfyTopic,    setNtfyTopic]    = useState(() => ls('apex_ntfy_topic'))
  const [email,        setEmail]        = useState(() => ls('apex_alert_email'))
  const [auto,         setAuto]         = useState(() => ls('apex_auto_alert') === 'true')
  const [saved,        setSaved]        = useState(false)
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState('')
  const [notifResult,  setNotifResult]  = useState('')

  async function testBrowserNotif() {
    setNotifResult('')
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm !== 'granted') { setNotifResult('❌ Permiso denegado — activa notificaciones en el navegador'); return }
    new Notification('🚨 APEX: SHORT BTC', {
      body: '$75,400 | Swing | Confianza ALTA\nEsta es una prueba de alerta APEX Trader.',
      icon: '/favicon.ico',
    })
    setNotifResult('✅ Notificación enviada — revisa la esquina de tu pantalla')
  }

  function save() {
    try {
      localStorage.setItem('apex_alert_phone',   phone)
      localStorage.setItem('apex_callmebot_key', callmebotKey)
      localStorage.setItem('apex_ntfy_topic',    ntfyTopic)
      localStorage.setItem('apex_alert_email',   email)
      localStorage.setItem('apex_auto_alert',    String(auto))
    } catch {}
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function testAlert() {
    setTesting(true); setTestResult('')
    const r = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg: '🚨 APEX TEST\nEsta es una alerta de prueba desde APEX Trader BTC.\nSi ves esto, las alertas automáticas funcionan ✅',
        phone:        phone        || undefined,
        callmebotKey: callmebotKey || undefined,
        ntfyTopic:    ntfyTopic    || undefined,
        email:        email        || undefined,
      }),
    })
    const d = await r.json() as { ok: boolean; sent: string[]; errors: string[] }
    setTestResult(d.ok ? `✅ Enviado: ${d.sent.join(', ')}` : `❌ Error: ${d.errors.join(', ')}`)
    setTesting(false)
  }

  const inputStyle = { width: '100%', background: T.card, border: `1px solid ${T.border}`, color: T.text,
    borderRadius: 5, padding: '7px 10px', fontFamily: 'inherit', fontSize: 11, boxSizing: 'border-box' as const }
  const label = (txt: string) => <div style={{ fontSize: 8, color: T.textSec, marginBottom: 5 }}>{txt}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em' }}>ALERTAS AUTOMÁTICAS — SIN INTERVENCIÓN</div>

      {/* Browser notification test */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 9, color: T.text, fontWeight: 700, marginBottom: 6 }}>🔔 Notificación de Navegador</div>
        <div style={{ fontSize: 8, color: T.muted, marginBottom: 10 }}>Funciona sin configuración — aparece en la esquina de tu pantalla.</div>
        <button onClick={testBrowserNotif} style={{
          width: '100%', background: T.accent, color: '#fff', border: 'none',
          borderRadius: 6, padding: '9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
        }}>🧪 Probar ahora</button>
        {notifResult && <div style={{ marginTop: 8, fontSize: 9, color: notifResult.startsWith('✅') ? T.bull : T.danger }}>{notifResult}</div>}
      </div>

      {/* WhatsApp */}
      <div style={{ background: '#25d36611', border: '1px solid #25d36644', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 9, color: '#25d366', fontWeight: 700, marginBottom: 8 }}>📱 WHATSAPP — vía CallMeBot (gratis)</div>
        <div style={{ fontSize: 8, color: T.muted, marginBottom: 10, lineHeight: 1.6 }}>
          1. Agrega <b style={{ color: T.text }}>+34 644 59 62 64</b> a tus contactos de WhatsApp<br/>
          2. Mándale el mensaje: <b style={{ color: T.text }}>I allow callmebot to send me messages</b><br/>
          3. Recibirás tu API key — pégala aquí
        </div>
        <div style={{ marginBottom: 8 }}>
          {label('Número (con código de país, sin +)')}
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="18293420707" style={inputStyle} />
        </div>
        <div>
          {label('CallMeBot API Key')}
          <input value={callmebotKey} onChange={e => setCallmebotKey(e.target.value)} placeholder="123456" style={inputStyle} />
        </div>
      </div>

      {/* ntfy.sh */}
      <div style={{ background: '#7c3aed11', border: '1px solid #7c3aed44', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 9, color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>📲 NTFY — Push al teléfono (GRATIS, sin cuenta)</div>
        <div style={{ fontSize: 8, color: T.muted, marginBottom: 10, lineHeight: 1.7 }}>
          1. Descarga la app <b style={{ color: T.text }}>ntfy</b> (Android/iOS)<br/>
          2. En la app: <b style={{ color: T.text }}>Subscribe to topic</b> → escribe tu tema único<br/>
          3. Pega el mismo tema aquí → listo, recibes notificaciones al instante
        </div>
        {label('Topic único (ej: apex-btc-18293)')}
        <input value={ntfyTopic} onChange={e => setNtfyTopic(e.target.value)} placeholder="apex-btc-18293" style={inputStyle} />
      </div>

      {/* Email */}
      <div style={{ background: T.accent + '11', border: `1px solid ${T.accent}44`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 9, color: T.accent, fontWeight: 700, marginBottom: 8 }}>📧 EMAIL — vía SMTP</div>
        <div style={{ fontSize: 8, color: T.muted, marginBottom: 10, lineHeight: 1.6 }}>
          Agrega en <b style={{ color: T.text }}>.env.local</b>:<br/>
          <code style={{ color: T.text }}>SMTP_USER=tu@gmail.com</code><br/>
          <code style={{ color: T.text }}>SMTP_PASS=tu_app_password</code>
        </div>
        {label('Email destino')}
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" type="email" style={inputStyle} />
      </div>

      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setAuto(a => !a)} style={{
          width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
          background: auto ? '#22c55e' : T.border, position: 'relative', flexShrink: 0,
        }}>
          <div style={{ position: 'absolute', top: 3, left: auto ? 20 : 3, width: 16, height: 16,
            borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
        <div>
          <div style={{ fontSize: 10, color: auto ? '#22c55e' : T.text, fontWeight: auto ? 700 : 400 }}>
            {auto ? '🟢 Auto-alerta ACTIVA' : 'Auto-alerta desactivada'}
          </div>
          <div style={{ fontSize: 8, color: T.muted }}>Dispara automáticamente en señales ALTA sin ningún clic</div>
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} style={{ flex: 2, background: saved ? T.bull : T.accent, color: '#fff', border: 'none',
          borderRadius: 6, padding: '9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700 }}>
          {saved ? '✓ Guardado' : 'Guardar'}
        </button>
        <button onClick={testAlert} disabled={testing || (!phone && !email && !ntfyTopic)} style={{
          flex: 1, background: 'transparent', border: `1px solid ${T.border}`, color: T.textSec,
          borderRadius: 6, padding: '9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10,
          opacity: (!phone && !email) ? 0.4 : 1,
        }}>
          {testing ? '...' : '🧪 Test'}
        </button>
      </div>
      {testResult && <div style={{ fontSize: 9, color: testResult.startsWith('✅') ? T.bull : T.danger }}>{testResult}</div>}
    </div>
  )
}

function PerfCell({ label, val, col }: { label: string; val: string; col?: string }) {
  const T = useTheme()
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: col ?? T.text }}>{val}</div>
    </div>
  )
}

function kzWinRate(sigH: SignalRecord[], kz: string): string {
  const sub = sigH.filter(r => (r.isScalp || r.idea?.tradeType === 'Scalp') && r.killzone === kz && r.pnlR != null)
  if (!sub.length) return '–'
  const wins = sub.filter(r => (r.pnlR ?? 0) > 0).length
  return `${Math.round(wins / sub.length * 100)}% (${sub.length})`
}

function PerformanceTab() {
  const T            = useTheme()
  const sigH         = useApexStore(s => s.signalHistory)
  const tradeH       = useApexStore(s => s.tradeHistory)
  const scalpHistory = useApexStore(s => s.scalpHistory)
  const stats        = calcSignalStats(sigH)
  const wts          = getLearnedWeights(sigH)

  // Scalp history stats from dedicated store
  const scalpClosed  = scalpHistory.filter(s => s.pnl != null)
  const scalpWins2   = scalpClosed.filter(s => (s.pnl ?? 0) > 0)
  const scalpWR2     = scalpClosed.length ? Math.round(scalpWins2.length / scalpClosed.length * 100) : null
  const scalpAvgPnl  = scalpClosed.length
    ? scalpClosed.reduce((sum, s) => sum + (s.pnl ?? 0), 0) / scalpClosed.length
    : null
  const wtEntries = Object.entries(wts)
  const sbStats   = usePerformanceStats()

  // Scalp-specific stats
  const scalpRecs     = sigH.filter(r => r.isScalp || r.idea?.tradeType === 'Scalp')
  const scalpResolved = scalpRecs.filter(r => r.pnlR != null)
  const scalpWins     = scalpResolved.filter(r => (r.pnlR ?? 0) > 0)
  const scalpWR       = scalpResolved.length ? Math.round(scalpWins.length / scalpResolved.length * 100) : null
  const withCVD       = scalpResolved.filter(r => r.cvdSignal)
  const withCVDWins   = withCVD.filter(r => (r.pnlR ?? 0) > 0)
  const withBOS       = scalpResolved.filter(r => r.bosChoch)
  const withBOSWins   = withBOS.filter(r => (r.pnlR ?? 0) > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <PerfCell label="SEÑALES" val={String(stats.total)} />
        <PerfCell label="WIN RATE" val={stats.resolved ? `${Math.round(stats.winRate * 100)}%` : '–'}
          col={stats.winRate >= 0.55 ? T.bull : stats.winRate < 0.4 ? T.danger : T.warn} />
        <PerfCell label="P&L TOTAL" val={stats.resolved ? `${stats.totalPnlR >= 0 ? '+' : ''}${stats.totalPnlR.toFixed(1)}R` : '–'}
          col={stats.totalPnlR >= 0 ? T.bull : T.danger} />
        <PerfCell label="RESUELTAS" val={String(stats.resolved)} />
        <PerfCell label="WINS" val={String(stats.wins)} col={T.bull} />
        <PerfCell label="AVG R" val={stats.resolved ? `${stats.avgPnlR >= 0 ? '+' : ''}${stats.avgPnlR.toFixed(2)}R` : '–'}
          col={stats.avgPnlR >= 0 ? T.bull : T.danger} />
      </div>
      <div>
        <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>SEÑALES EN HISTORIAL ({tradeH.length})</div>
        {sigH.slice(0, 15).map(rec => (
          <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}44`, fontSize: 9 }}>
            <span style={{ color: rec.idea.side === 'LONG' ? T.bull : T.danger }}>{rec.idea.side}</span>
            <span style={{ color: T.textSec }}>{rec.idea.tradeType}</span>
            <span style={{ color: STATUS_COLOR[rec.status] ?? T.muted }}>{STATUS_LABEL[rec.status] ?? rec.status}</span>
            <span style={{ color: rec.pnlR != null ? (rec.pnlR >= 0 ? T.bull : T.danger) : T.muted }}>
              {rec.pnlR != null ? `${rec.pnlR >= 0 ? '+' : ''}${rec.pnlR.toFixed(2)}R` : '—'}
            </span>
            <span style={{ color: T.muted }}>${fmt(rec.idea.price, 0)}</span>
          </div>
        ))}
      </div>
      {wtEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 6 }}>PESOS APRENDIDOS</div>
          {wtEntries.map(([key, w]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
              <span style={{ color: T.textSec }}>{key}</span>
              <span style={{ color: w > 1 ? T.bull : w < 1 ? T.danger : T.muted }}>{w.toFixed(2)}x</span>
            </div>
          ))}
        </div>
      )}

      {/* Scalp-specific stats */}
      {scalpRecs.length > 0 && (
        <div>
          <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>⚡ ESTADÍSTICAS SCALP ({scalpRecs.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
            <PerfCell label="SCALP WR" val={scalpWR != null ? `${scalpWR}%` : '–'} col={scalpWR != null && scalpWR >= 55 ? T.bull : T.warn} />
            <PerfCell label="CON CVD" val={withCVD.length ? `${Math.round(withCVDWins.length / withCVD.length * 100)}%` : '–'} col={T.bull} />
            <PerfCell label="CON BOS" val={withBOS.length ? `${Math.round(withBOSWins.length / withBOS.length * 100)}%` : '–'} col={T.bull} />
          </div>
          <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 6 }}>WIN RATE POR KILLZONE</div>
          {(['London Open', 'NY AM', 'NY PM', 'Asian KZ', 'London Close'] as const).map(kz => (
            <div key={kz} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
              <span style={{ color: T.textSec }}>{kz}</span>
              <span style={{ color: T.muted }}>{kzWinRate(sigH, kz)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Scalp history stats from dedicated scalpHistory store */}
      {scalpHistory.length > 0 && (
        <div>
          <div style={{ fontSize: 7, color: '#fbbf24', letterSpacing: '.1em', marginBottom: 8 }}>⚡ SCALP HISTORY — {scalpHistory.length} trades</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
            <PerfCell label="WIN RATE" val={scalpWR2 != null ? `${scalpWR2}%` : '–'}
              col={scalpWR2 != null ? (scalpWR2 >= 55 ? T.bull : scalpWR2 < 40 ? T.danger : T.warn) : T.muted} />
            <PerfCell label="AVG P&L" val={scalpAvgPnl != null ? `${scalpAvgPnl >= 0 ? '+' : ''}${scalpAvgPnl.toFixed(2)}%` : '–'}
              col={scalpAvgPnl != null ? (scalpAvgPnl >= 0 ? T.bull : T.danger) : T.muted} />
            <PerfCell label="GANADOS" val={`${scalpWins2.length}/${scalpClosed.length}`} col={T.bull} />
          </div>
          {/* Killzone breakdown */}
          {scalpClosed.length >= 3 && (() => {
            const kzs = ['London Open', 'London-NY Overlap', 'NY AM', 'NY PM']
            return (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 7, color: T.muted, marginBottom: 4 }}>WIN RATE POR KILLZONE</div>
                {kzs.map(kz => {
                  const trades = scalpClosed.filter(s => s.killzone?.includes(kz.split(' ')[0]))
                  if (!trades.length) return null
                  const wins = trades.filter(s => (s.pnl ?? 0) > 0).length
                  const wr   = Math.round(wins / trades.length * 100)
                  return (
                    <div key={kz} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.textSec, padding: '2px 0' }}>
                      <span>{kz}</span>
                      <span style={{ color: wr >= 55 ? T.bull : wr < 40 ? T.danger : T.warn }}>{wr}% ({trades.length})</span>
                    </div>
                  )
                })}
                {/* BOS/CHoCH + FVG breakdown */}
                {(() => {
                  const withBos  = scalpClosed.filter(s => !!s.bosChoch)
                  const noBos    = scalpClosed.filter(s => !s.bosChoch)
                  const bosWR    = withBos.length ? Math.round(withBos.filter(s => (s.pnl ?? 0) > 0).length / withBos.length * 100) : null
                  const noBosWR  = noBos.length   ? Math.round(noBos.filter(s => (s.pnl ?? 0) > 0).length / noBos.length * 100)    : null
                  return bosWR != null || noBosWR != null ? (
                    <div style={{ marginTop: 4, borderTop: `1px solid ${T.border}`, paddingTop: 4 }}>
                      <div style={{ fontSize: 7, color: T.muted, marginBottom: 2 }}>BOS/CHoCH CONFLUENCE</div>
                      {bosWR   != null && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.textSec }}><span>Con BOS/CHoCH</span><span style={{ color: bosWR >= 55 ? T.bull : T.warn }}>{bosWR}% ({withBos.length})</span></div>}
                      {noBosWR != null && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.textSec }}><span>Sin BOS/CHoCH</span><span style={{ color: noBosWR >= 55 ? T.bull : T.danger }}>{noBosWR}% ({noBos.length})</span></div>}
                    </div>
                  ) : null
                })()}
              </div>
            )
          })()}

          {scalpHistory.slice(0, 8).map(s => {
            const isLong = s.side === 'LONG'
            const pnl    = s.pnl ?? null
            const STATUS: Record<string, string> = {
              sl_hit: '❌', tp1_hit: '🎯', tp2_hit: '🎯🎯', tp3_hit: '🏆', closed_manual: '✋', breakeven: '🛡️',
            }
            return (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}44`, fontSize: 9 }}>
                <span style={{ color: isLong ? T.bull : T.danger }}>{s.side}</span>
                <span style={{ color: T.muted }}>{new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span style={{ color: T.textSec }}>{STATUS[s.status] ?? s.status}</span>
                <span style={{ color: pnl != null ? (pnl >= 0 ? T.bull : T.danger) : T.muted }}>
                  {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '—'}
                </span>
                <span style={{ color: T.muted }}>{s.qualityLabel}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Agent Learning Summary — computed client-side from signalHistory */}
      {(() => {
        const closed20  = sigH.filter(r => r.pnl != null && r.status !== 'active').slice(0, 20)
        const wr20      = closed20.length > 0 ? closed20.filter(r => (r.pnl ?? 0) > 0).length / closed20.length : null
        const minAdj    = wr20 == null ? 0 : wr20 < 0.40 ? 1 : wr20 > 0.65 ? -1 : 0
        const allClosed = sigH.filter(r => r.pnl != null && r.status !== 'active')
        const allWR     = allClosed.length > 0 ? allClosed.filter(r => (r.pnl ?? 0) > 0).length / allClosed.length : null
        if (allClosed.length === 0) return null
        return (
          <div style={{ padding: 10, border: `1px solid ${T.border}`, borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: T.accent, fontWeight: 700, marginBottom: 8, letterSpacing: '.08em' }}>
              🧠 APRENDIZAJE DEL AGENTE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 8, color: T.textSec }}>
              <div>Total analizadas: <b style={{ color: T.text }}>{allClosed.length}</b></div>
              <div>Win Rate real: <b style={{ color: allWR != null && allWR > 0.5 ? T.bull : T.danger }}>
                {allWR != null ? Math.round(allWR * 100) : 0}%
              </b></div>
              <div>Score mínimo: <b style={{ color: T.text }}>{5 + minAdj}/12</b></div>
              <div>Ajuste reciente: <b style={{ color: minAdj < 0 ? T.bull : minAdj > 0 ? T.danger : T.muted }}>
                {minAdj > 0 ? 'Más estricto ↑' : minAdj < 0 ? 'Más permisivo ↓' : 'Normal'}
              </b></div>
            </div>
            <div style={{ fontSize: 7, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
              El agente ajusta su umbral basado en historial real.
              Pérdidas recientes → más confluencias requeridas. Buenas rachas → umbral reducido.
            </div>
          </div>
        )
      })()}

      {/* Real Supabase stats */}
      {sbStats && (
        <div style={{ padding: 10, border: `1px solid ${T.border}`, borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: T.accent, fontWeight: 700, marginBottom: 8, letterSpacing: '.08em' }}>
            ☁️ ESTADÍSTICAS REALES (SUPABASE)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 6 }}>
            <PerfCell label="TOTAL DB" val={String(sbStats.total)} />
            <PerfCell label="WIN RATE" val={`${sbStats.winRate}%`}
              col={sbStats.winRate >= 55 ? T.bull : sbStats.winRate < 40 ? T.danger : T.warn} />
            <PerfCell label="P&L TOTAL" val={`${sbStats.totalPnl >= 0 ? '+' : ''}${sbStats.totalPnl.toFixed(1)}%`}
              col={sbStats.totalPnl >= 0 ? T.bull : T.danger} />
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 8, color: T.textSec, marginBottom: 10, padding: '4px 0', borderBottom: `1px solid ${T.border}22` }}>
            <span>✅ Wins: <strong style={{ color: T.bull }}>{sbStats.wins}</strong></span>
            <span>❌ Losses: <strong style={{ color: T.danger }}>{sbStats.losses}</strong></span>
            <span>🛡️ B/E: <strong style={{ color: T.warn }}>{sbStats.breakevens ?? 0}</strong></span>
          </div>
          <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 6 }}>POR TIPO</div>
          {sbStats.byType.filter(t => t.total > 0).map(t => (
            <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
              <span style={{ color: T.textSec }}>{t.type}</span>
              <span style={{ color: T.muted }}>{t.total}</span>
              <span style={{ color: t.winRate >= 55 ? T.bull : t.winRate < 40 ? T.danger : T.warn }}>{t.winRate}% WR</span>
              <span style={{ color: t.avgPnl >= 0 ? T.bull : T.danger }}>{t.avgPnl >= 0 ? '+' : ''}{t.avgPnl.toFixed(2)}%</span>
            </div>
          ))}
          {sbStats.byConf.filter(c => c.total > 0).length > 0 && (
            <>
              <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginTop: 8, marginBottom: 6 }}>POR CONFIANZA</div>
              {sbStats.byConf.filter(c => c.total > 0).map(c => (
                <div key={c.conf} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
                  <span style={{ color: T.textSec }}>{c.conf}</span>
                  <span style={{ color: T.muted }}>{c.total} señales</span>
                  <span style={{ color: c.winRate >= 55 ? T.bull : c.winRate < 40 ? T.danger : T.warn }}>{c.winRate}% WR</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Confluence Panel (S4) ─────────────────────────────────────────────────────

function ConfluencePanel({ idea, inds, T, analysisText }: {
  idea:          TradeIdea
  inds:          IndicatorMap
  T:             ReturnType<typeof useTheme>
  analysisText?: string
}) {
  const bullReasons = idea.reasons.filter(r => r.s === 'bull')
  const bearReasons = idea.reasons.filter(r => r.s === 'bear')
  const totalScore  = idea.bull - idea.bear
  const maxScore    = idea.bull + idea.bear || 1
  const bullPct     = Math.round((idea.bull / maxScore) * 100)
  const ind4h       = inds['4h']
  const ind1h       = inds['1h']
  const ind1d       = inds['1d']

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Score summary */}
      <div style={{ ...card, border: `1px solid ${totalScore >= 0 ? T.bull : T.danger}44` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 8, color: T.muted, letterSpacing: '.1em' }}>
            PUNTUACIÓN CONFLUENCIAS — {idea.side} {idea.tradeType}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: totalScore >= 0 ? T.bull : T.danger }}>
            {totalScore >= 0 ? '+' : ''}{totalScore}
          </span>
        </div>
        <div style={{ height: 6, background: T.danger + '44', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${bullPct}%`, background: T.bull, borderRadius: 3, transition: 'width .4s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
          <span style={{ color: T.bull }}>▲ {idea.bull} alcistas</span>
          <span style={{ color: T.muted }}>{idea.confidence}</span>
          <span style={{ color: T.danger }}>▼ {idea.bear} bajistas</span>
        </div>
      </div>

      {/* Live TF snapshot */}
      <div style={card}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>SNAPSHOT INDICADORES EN VIVO</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { tf: '1D', ind: ind1d },
            { tf: '4H', ind: ind4h },
            { tf: '1H', ind: ind1h },
          ].map(({ tf, ind }) => ind && (
            <div key={tf} style={{ background: T.bg, borderRadius: 6, padding: '6px 8px', border: `1px solid ${ind.bias === 'ALCISTA' ? T.bull : ind.bias === 'BAJISTA' ? T.danger : T.border}44` }}>
              <div style={{ fontSize: 7, color: T.muted, marginBottom: 3 }}>{tf}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: ind.bias === 'ALCISTA' ? T.bull : ind.bias === 'BAJISTA' ? T.danger : T.warn }}>{ind.bias}</div>
              <div style={{ fontSize: 8, color: T.textSec }}>RSI {ind.rsi.toFixed(0)} · {ind.score > 0 ? '+' : ''}{ind.score}</div>
            </div>
          ))}
        </div>
        {ind4h && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginTop: 8 }}>
            {[
              { l: 'RSI 4H',   v: ind4h.rsi.toFixed(1),              c: ind4h.rsi > 70 ? T.danger : ind4h.rsi < 30 ? T.bull : T.textSec },
              { l: 'MACD',     v: (ind4h.macd.hist > 0 ? '+' : '') + ind4h.macd.hist.toFixed(2), c: ind4h.macd.hist > 0 ? T.bull : T.danger },
              { l: 'BB %B',    v: (ind4h.bb.pct ?? 50).toFixed(0) + '%', c: (ind4h.bb.pct ?? 50) > 70 ? T.danger : T.textSec },
              { l: 'BB Width', v: (ind4h.bb.width ?? 0).toFixed(2) + '%', c: (ind4h.bb.width ?? 5) < 1.5 ? T.accent : T.textSec },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background: T.bg, borderRadius: 5, padding: '4px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 7, color: T.muted }}>{l}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confluence checklist — bull */}
      {bullReasons.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 8, color: T.bull, letterSpacing: '.1em', marginBottom: 6 }}>▲ ALCISTAS ({bullReasons.length})</div>
          {bullReasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', borderBottom: `1px solid ${T.border}18` }}>
              <span style={{ fontSize: 10, color: T.bull, marginTop: 1 }}>●</span>
              <span style={{ fontSize: 9, color: T.text, lineHeight: 1.6 }}>{r.txt}</span>
            </div>
          ))}
        </div>
      )}

      {/* Confluence checklist — bear */}
      {bearReasons.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 8, color: T.danger, letterSpacing: '.1em', marginBottom: 6 }}>▼ BAJISTAS ({bearReasons.length})</div>
          {bearReasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', borderBottom: `1px solid ${T.border}18` }}>
              <span style={{ fontSize: 10, color: T.danger, marginTop: 1 }}>○</span>
              <span style={{ fontSize: 9, color: T.textSec, lineHeight: 1.6 }}>{r.txt}</span>
            </div>
          ))}
        </div>
      )}

      {/* Analysis text */}
      <div style={card}>
        <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.1em', marginBottom: 6 }}>HIPÓTESIS</div>
        <div style={{ fontSize: 10, color: T.text, lineHeight: 1.8 }}>{analysisText ?? idea.analysis}</div>
      </div>
    </div>
  )
}

// ── Limit Orders card ────────────────────────────────────────────────────────

function LimitOrdersCard({ idea, inds, fvgs, mkt, T }: {
  idea: TradeIdea
  inds: IndicatorMap
  fvgs: Partial<Record<string, FVGResult>>
  mkt:  MarketData
  T:    ReturnType<typeof useTheme>
}) {
  const orders = generateLimitOrders(idea, inds, fvgs, mkt)
  if (!orders.length) return null
  return (
    <div style={{ background: T.card, border: `1px solid ${T.accent}33`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.12em', marginBottom: 8 }}>
        📋 ÓRDENES LÍMITE SUGERIDAS ({orders.length})
      </div>
      {orders.map(o => (
        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.border}22` }}>
          <div style={{ width: 3, height: 24, borderRadius: 2, background: o.side === 'LONG' ? T.bull : T.danger, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text }}>${fmt(o.price, 0)}</div>
            <div style={{ fontSize: 8, color: T.muted }}>{o.reason}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, color: T.bull }}>R:R {o.rr1.toFixed(1)}:1</div>
            <div style={{ fontSize: 7, color: T.muted }}>
              {o.source === 'fvg' ? 'FVG' : o.source === 'fib' ? 'FIB' : 'S/R'} · {o.validMinutes}min
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Historial sub-tab (uses sigH, persisted records) ─────────────────────────

type HFilter = 'todos' | 'active' | 'won' | 'lost' | 'closed'
type HMode   = 'normal' | 'scalp'

function ScalpHistoryRow({ sig }: { sig: ScalpSignal }) {
  const T      = useTheme()
  const isLong = sig.side === 'LONG'
  const sideC  = isLong ? T.bull : T.danger
  const pnl    = sig.pnl ?? null
  const STATUS: Record<string, string> = {
    sl_hit: '❌ SL', tp1_hit: '🎯 TP1', tp2_hit: '🎯🎯 TP2', tp3_hit: '🏆 TP3',
    breakeven: '🛡️ B/E', closed_manual: '✋ Manual', active: '🟡 Activo',
  }
  // Safe price formatter — prevents NaN when numeric fields arrive as undefined/string
  const fmtP = (n: number | undefined | null) => {
    const num = parseFloat(String(n ?? ''))
    return isNaN(num) ? 'N/A' : `$${Math.round(num).toLocaleString()}`
  }
  const score = sig.score != null && !isNaN(sig.score) ? sig.score : '?'
  return (
    <div style={{ background: T.card, border: `1px solid ${sideC}33`, borderRadius: 8, padding: '10px 12px', fontSize: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, color: sideC, fontSize: 10 }}>⚡ SCALP {sig.side}</span>
        <span style={{ color: T.muted }}>{new Date(sig.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span style={{ fontWeight: 700, color: pnl == null ? T.muted : pnl >= 0 ? T.bull : T.danger }}>
          {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '—'}
        </span>
        <span style={{ color: T.textSec }}>{STATUS[sig.status] ?? sig.status}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, color: T.textSec }}>
        <span>📍 {fmtP(sig.entry)}</span>
        <span style={{ color: T.danger }}>SL {fmtP(sig.sl)}</span>
        <span style={{ color: T.bull }}>TP1 {fmtP(sig.tp1)}</span>
        {sig.closePrice != null && <span style={{ color: T.muted }}>Cierre {fmtP(sig.closePrice)}</span>}
      </div>
      <div style={{ color: T.muted }}>{sig.qualityLabel ?? sig.confidence} · {sig.killzone ?? 'Sin KZ'} · {sig.duration ?? ''} · Score {score}/9</div>
    </div>
  )
}

function HistorialTabView({ sigH, hFilter, setHFilter, onClose }: {
  sigH:        SignalRecord[]
  hFilter:     HFilter
  setHFilter:  (f: HFilter) => void
  onClose:     (id: string, price: number, reason: string) => void
}) {
  const T            = useTheme()
  const mkt          = useApexStore(s => s.mkt)
  const scalpHistory = useApexStore(s => s.scalpHistory)
  const [hMode, setHMode] = React.useState<HMode>('normal')

  const activeCount  = sigH.filter(r => r.status === 'active' || r.status === 'pending_confirmation' || r.status === 'tp1_hit' || r.status === 'tp2_hit').length
  const wonCount     = sigH.filter(r => r.status.startsWith('tp')).length
  const lostCount    = sigH.filter(r => r.status === 'sl_hit').length
  const closedCount  = sigH.filter(r => r.status === 'breakeven' || r.status === 'closed_manual').length

  const filtered = sigH
    .filter(r => {
      if (hFilter === 'active')  return r.status === 'active' || r.status === 'pending_confirmation'
      if (hFilter === 'won')     return r.status.startsWith('tp')
      if (hFilter === 'lost')    return r.status === 'sl_hit'
      if (hFilter === 'closed')  return r.status === 'breakeven' || r.status === 'closed_manual'
      return true
    })
    .slice()
    .sort((a, b) => {
      // Active first, then newest first
      const aActive = a.status === 'active' ? 0 : 1
      const bActive = b.status === 'active' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  const FILTERS: { key: HFilter; label: string; count?: number }[] = [
    { key: 'todos',   label: `Todos (${sigH.length})` },
    { key: 'active',  label: `🟡 Abiertos (${activeCount})` },
    { key: 'won',     label: `✅ Ganados (${wonCount})` },
    { key: 'lost',    label: `❌ Perdidos (${lostCount})` },
    { key: 'closed',  label: `🛡️ Cerrados (${closedCount})` },
  ]

  const hasNormal = sigH.length > 0
  const hasScalp  = scalpHistory.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['normal', 'scalp'] as HMode[]).map(m => (
          <button key={m} onClick={() => setHMode(m)} style={{
            flex: 1, padding: '4px 0', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 9, fontWeight: hMode === m ? 700 : 400,
            background: hMode === m ? (m === 'scalp' ? '#fbbf2422' : T.accent + '22') : 'transparent',
            border: `1px solid ${hMode === m ? (m === 'scalp' ? '#fbbf24' : T.accent) : T.border}`,
            color: hMode === m ? (m === 'scalp' ? '#fbbf24' : T.accent) : T.textSec,
          }}>{m === 'normal' ? `📋 Normal (${sigH.length})` : `⚡ Scalp (${scalpHistory.length})`}</button>
        ))}
      </div>

      {hMode === 'scalp' ? (
        hasScalp ? (
          scalpHistory.map(s => <ScalpHistoryRow key={s.id} sig={s} />)
        ) : (
          <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Sin scalps en historial.</div>
        )
      ) : !hasNormal ? (
        <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Sin historial todavía.</div>
      ) : (
        <>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setHFilter(f.key)} style={{
                background: hFilter === f.key ? T.accent + '22' : 'transparent',
                border:     `1px solid ${hFilter === f.key ? T.accent : T.border}`,
                color:      hFilter === f.key ? T.accent : T.textSec,
                padding:    '3px 10px', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 8, whiteSpace: 'nowrap',
              }}>{f.label}</button>
            ))}
          </div>

          {filtered.length === 0
            ? <div style={{ color: T.muted, textAlign: 'center', padding: 20, fontSize: 10 }}>Sin señales en este filtro.</div>
            : filtered.map((rec, i) => (
              <IdeaCard
                key={rec.id}
                idea={rec.idea}
                rec={rec}
                defaultOpen={i === 0 && (rec.status === 'active' || rec.status === 'pending_confirmation')}
                onClose={onClose}
              />
            ))
          }
        </>
      )}
    </div>
  )
}

const TABS = ['Actual', 'Historial', 'Performance', 'Calendario', 'Análisis', 'Alertas'] as const
type SubTab = typeof TABS[number]

function TabBtn({ t, currentTab, onSetTab }: { t: SubTab; currentTab: SubTab; onSetTab: (t: SubTab) => void }) {
  const T = useTheme()
  return (
    <button onClick={() => onSetTab(t)} style={{
      background: currentTab === t ? T.accent + '22' : 'transparent',
      border: `1px solid ${currentTab === t ? T.accent : T.border}`,
      color: currentTab === t ? T.accent : T.textSec,
      padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
      fontFamily: 'inherit', fontSize: 9, letterSpacing: '.08em',
    }}>{t}</button>
  )
}

export default function TradeIdeasPanel() {
  const T              = useTheme()
  const [tab, setTab]  = useState<SubTab>('Actual')
  const [hFilter, setHFilter] = useState<HFilter>('todos')
  const history        = useApexStore(s => s.tradeHistory)
  const tradeIdea      = useApexStore(s => s.tradeIdea)
  const sigH           = useApexStore(s => s.signalHistory)
  const setSignalHistory = useApexStore(s => s.setSignalHistory)
  const calendarSigs   = useMemo(() => sigH.map(s => ({
    id: s.id, side: s.idea.side, tradeType: s.idea.tradeType,
    status: s.status as string, pnl: s.pnl,
    entry: s.idea.price, closePrice: s.exitPrice,
    closeReason: s.closeReason, createdAt: s.createdAt, closedAt: s.closedAt,
  })), [sigH])
  const mkt            = useApexStore(s => s.mkt)
  const inds           = useApexStore(s => s.inds)
  const fvgs           = useApexStore(s => s.fvgs)
  const scalpMode      = useApexStore(s => s.scalpMode)
  const setScalpMode   = useApexStore(s => s.setScalpMode)
  const scalpSignal    = useApexStore(s => s.scalpSignal)         // legacy single (useMarketData compat)
  const scalpSignals   = useApexStore(s => s.scalpSignals)        // authoritative array from Supabase
  const activeScalps   = scalpSignals.filter(s => s.status === 'active')
  const rawKMain       = useApexStore(s => s.rawK)
  const cycleMain      = useApexStore(s => s.cycle)
  const newsMain       = useApexStore(s => s.news)

  const macroInfo = useMemo((): MacroSentiment | null => {
    if (mkt.fg == null) return null
    return analyzeMacroSentiment(
      newsMain ?? [],
      mkt.fg,
      mkt.funding  ?? 0,
      mkt.lsr      ?? 1,
      mkt.change   ?? 0,
      {},
    )
  }, [mkt.fg, mkt.funding, mkt.lsr, mkt.change, newsMain])
  const killzones      = useApexStore(s => s.killzones)
  const vwap           = useApexStore(s => s.vwap)
  const lastAutoAlert  = useRef<string | null>(null)
  const activeKZ       = killzones.find(kz => kz.active)
  // All active signal records (multiple concurrent signals supported)
  const activeRecs  = sigH.filter(r => r.status === 'active' || r.status === 'pending_confirmation' || r.status === 'tp1_hit' || r.status === 'tp2_hit')
  // Fallback single-idea display for ConfluencePanel and LimitOrdersCard
  const activeRec   = activeRecs[0] ?? null
  const displayIdea = activeRec?.idea ?? (history.length ? history[0] : tradeIdea)
  const displayRec  = activeRec

  const analysisTextMain = useMemo(() => {
    if (!displayIdea || !inds) return displayIdea?.analysis ?? ''
    const k4h    = rawKMain?.['4h'] ?? []
    const regime = k4h.length >= 20 ? detectMarketRegime(k4h) : null
    return writeTradeAnalysis({
      idea: displayIdea, inds: inds as IndicatorMap, regime, ew: null,
      mkt: mkt ?? {} as typeof mkt,
      cycle: cycleMain ?? null,
      news: newsMain ?? [],
    })
  }, [displayIdea, mkt?.price, inds, cycleMain])

  function getRec(idea: TradeIdea): SignalRecord | undefined {
    const ts = new Date(idea.ts).getTime()
    return sigH.find(r => Math.abs(new Date(r.createdAt).getTime() - ts) < 5000)
  }

  // Auto-alert: fire via /api/alert (server-side, no popup blocker)
  useEffect(() => {
    if (!history.length) return
    const idea = history[0]
    if (idea.confidence !== 'ALTA') return
    const key = `${new Date(idea.ts).getTime()}_${idea.side}`
    if (key === lastAutoAlert.current) return
    lastAutoAlert.current = key
    try {
      if (localStorage.getItem('apex_auto_alert') !== 'true') return
      const phone        = localStorage.getItem('apex_alert_phone')   ?? ''
      const callmebotKey = localStorage.getItem('apex_callmebot_key') ?? ''
      const ntfyTopic    = localStorage.getItem('apex_ntfy_topic')    ?? ''
      const email        = localStorage.getItem('apex_alert_email')   ?? ''
      if (!phone && !email && !ntfyTopic) return
      fetch('/api/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg: buildAlertMsg(idea),
          phone:        phone        || undefined,
          callmebotKey: callmebotKey || undefined,
          ntfyTopic:    ntfyTopic    || undefined,
          email:        email        || undefined,
        }),
      }).catch(() => {})
    } catch {}
  }, [history])

  function handleClose(id: string, price: number, reason: string) {
    // Read from STORE (not localStorage) — store has all Supabase-loaded signals
    const current = useApexStore.getState().signalHistory
    const updated = closeManualSignal(current, id, price, reason)
    saveSignalHistory(updated)
    // Merge — never replace (keeps any signals not involved in this close)
    setSignalHistory(prev => {
      const merged = [...prev]
      updated.forEach(s => {
        const idx = merged.findIndex(x => x.id === s.id)
        if (idx >= 0) merged[idx] = s
        else merged.unshift(s)
      })
      return merged
    })
    // Persist via server API (service key bypasses RLS — anon key would fail)
    const closed = updated.find(s => s.id === id)
    if (closed) {
      fetch('/api/close-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:          closed.id,
          exitPrice:   closed.exitPrice,
          closeReason: closed.closeReason,
          pnl:         closed.pnl,
          pnlR:        closed.pnlR,
          closedAt:    closed.closedAt,
        }),
      }).catch(() => {})
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Tab bar + mode toggle */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => <TabBtn key={t} t={t} currentTab={tab} onSetTab={setTab} />)}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: T.muted }}>BTC ${fmt(mkt.price, 0)}</span>
      </div>

      {/* Scalp Mode toggle + Auto-close toggle */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {([
          { label: '🎯 Normal', val: false },
          { label: '⚡ Scalp Mode', val: true  },
        ] as { label: string; val: boolean }[]).map(({ label, val }) => (
          <button key={label} onClick={() => setScalpMode(val)} style={{
            flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 10, fontWeight: scalpMode === val ? 700 : 400,
            background: scalpMode === val ? (val ? '#fbbf2422' : T.accent + '22') : 'transparent',
            border: `1px solid ${scalpMode === val ? (val ? '#fbbf24' : T.accent) : T.border}`,
            color: scalpMode === val ? (val ? '#fbbf24' : T.accent) : T.textSec,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'Actual' && (
        scalpMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Active Killzone banner */}
            {activeKZ ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                background: activeKZ.color + '18', border: `1px solid ${activeKZ.color}55`, borderRadius: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: activeKZ.color, boxShadow: `0 0 6px ${activeKZ.color}`, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: activeKZ.color }}>🕐 {activeKZ.name} — Alta probabilidad</div>
                  <div style={{ fontSize: 8, color: T.textSec }}>{activeKZ.desc}</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '6px 12px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
                fontSize: 9, color: T.muted }}>⏰ Fuera de Killzone — probabilidad reducida</div>
            )}

            {/* VWAP relation */}
            {vwap && mkt.price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px',
                background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 9 }}>
                <span style={{ color: T.muted }}>📍 VWAP ${Math.round(vwap.vwap).toLocaleString()}</span>
                <span style={{ color: mkt.price > vwap.vwap ? T.bull : T.danger, fontWeight: 700 }}>
                  {mkt.price > vwap.vwap ? '▲' : '▼'} {(((mkt.price - vwap.vwap) / vwap.vwap) * 100).toFixed(2)}%
                </span>
              </div>
            )}

            {/* Scalp signal cards — render ALL active scalps from Supabase array */}
            {activeScalps.length > 0
              ? activeScalps.map(sig => <ScalpCard key={sig.id} sig={sig} />)
              : scalpSignal
                ? <ScalpCard sig={scalpSignal} />   /* fallback: legacy single signal */
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '32px 20px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 24 }}>⚡</div>
                    <div style={{ fontSize: 11, color: T.textSec }}>
                      Sin scalp activo
                    </div>
                    <div style={{ fontSize: 9, color: T.muted }}>
                      {activeKZ ? 'Agente analizando confluencias…' : 'Esperando Killzone activa'}
                    </div>
                  </div>
                )
            }
          </div>
        ) : activeRecs.length === 0 && displayIdea?.consolidation
          ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 20px',
              background: T.card, border: `1px solid ${T.warn}44`, borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 28 }}>⏳</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.warn, letterSpacing: '.08em' }}>CONSOLIDACIÓN</div>
              <div style={{ fontSize: 10, color: T.textSec }}>Bandas de Bollinger extremadamente comprimidas.</div>
              <div style={{ fontSize: 10, color: T.textSec }}>Esperar breakout con volumen antes de operar.</div>
            </div>
          )
          : activeRecs.length > 0
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Active signals count badge when more than 1 */}
                {activeRecs.length > 0 && (
                  <div style={{ fontSize: 9, color: activeRecs.length > 1 ? T.warn : T.accent,
                    background: (activeRecs.length > 1 ? T.warn : T.accent) + '18',
                    border: `1px solid ${(activeRecs.length > 1 ? T.warn : T.accent)}44`,
                    borderRadius: 6, padding: '4px 10px', textAlign: 'center', letterSpacing: '.08em', fontWeight: 700 }}>
                    {activeRecs.length > 1 ? `⚡ ${activeRecs.length} SEÑALES ACTIVAS` : '● 1 SEÑAL ACTIVA'}
                  </div>
                )}
                {activeRecs.map((rec, i) => (
                  <IdeaCard key={rec.id} idea={rec.idea} rec={rec} defaultOpen={i === 0} onClose={handleClose} />
                ))}
                {activeRec && (
                  <LimitOrdersCard idea={activeRec.idea} inds={inds as IndicatorMap} fvgs={fvgs as Partial<Record<string, FVGResult>>} mkt={mkt} T={T} />
                )}
              </div>
            : <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Analizando confluencias técnicas…</div>
      )}

      {/* ── Macro Sentiment block — always visible on Actual tab ── */}
      {tab === 'Actual' && macroInfo && (
        <div style={{ padding: '10px 12px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 8, color: T.muted, letterSpacing: '.1em' }}>🌍 SENTIMIENTO MACRO</span>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.06em', padding: '2px 8px', borderRadius: 4,
              color: macroInfo.score > 20 ? T.bull : macroInfo.score < -20 ? T.danger : T.warn,
              background: (macroInfo.score > 20 ? T.bull : macroInfo.score < -20 ? T.danger : T.warn) + '22',
            }}>
              {macroInfo.score > 0 ? '+' : ''}{macroInfo.score} {macroInfo.label}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              { k: 'RIESGO', v: macroInfo.riskAppetite, c: macroInfo.riskAppetite === 'RISK_ON' ? T.bull : macroInfo.riskAppetite === 'RISK_OFF' ? T.danger : T.warn },
              { k: 'USD',    v: macroInfo.usdStrength,  c: macroInfo.usdStrength  === 'FUERTE'   ? T.danger : macroInfo.usdStrength === 'DEBIL' ? T.bull : T.muted },
            ].map(({ k, v, c }) => (
              <span key={k} style={{ fontSize: 8, color: c, background: c + '18', border: `1px solid ${c}44`, borderRadius: 3, padding: '1px 6px' }}>
                {k}: {v}
              </span>
            ))}
            <span style={{ fontSize: 8, color: T.muted, marginLeft: 'auto' }}>Confianza: {macroInfo.confidence}%</span>
          </div>
          {macroInfo.topEvents.slice(0, 3).map((ev, i) => (
            <div key={i} style={{ fontSize: 8, color: T.textSec, padding: '2px 0', borderTop: i > 0 ? `1px solid ${T.border}22` : 'none' }}>
              · {ev}
            </div>
          ))}
          <div style={{ fontSize: 8, color: T.muted, marginTop: 6, fontStyle: 'italic' }}>{macroInfo.cryptoSpecific}</div>
          <div style={{ fontSize: 7, color: T.muted, marginTop: 4 }}>{macroInfo.sources.join(' · ')}</div>
        </div>
      )}

      {tab === 'Historial' && <HistorialTabView sigH={sigH} hFilter={hFilter} setHFilter={setHFilter} onClose={handleClose} />}

      {tab === 'Performance' && <PerformanceTab />}
      {tab === 'Calendario' && <PerformanceCalendar signalHistory={calendarSigs} T={T} />}
      {tab === 'Alertas' && <AlertasTab />}

      {tab === 'Análisis' && (
        scalpMode && (activeScalps[0] ?? scalpSignal)
          ? (() => { const sig = activeScalps[0] ?? scalpSignal!; return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: T.card, border: `1px solid #fbbf2444`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>⚡ ANÁLISIS SCALP — {sig.side}</div>
                <pre style={{ fontSize: 10, color: T.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{buildScalpAnalysis(sig)}</pre>
              </div>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 7, color: T.muted, letterSpacing: '.1em', marginBottom: 8 }}>CONFLUENCIAS ({sig.reasons.length})</div>
                {sig.reasons.map((r, i) => (
                  <div key={i} style={{ fontSize: 10, color: sig.side === 'LONG' ? T.bull : T.danger, lineHeight: 1.8 }}>
                    {sig.side === 'LONG' ? '▲' : '▼'} {r}
                  </div>
                ))}
              </div>
            </div>
          ); })()
          : displayIdea
            ? <ConfluencePanel idea={displayIdea} inds={inds as IndicatorMap} T={T} analysisText={analysisTextMain} />
            : <div style={{ color: T.textSec, textAlign: 'center', padding: 40, fontSize: 11 }}>Sin señal activa.</div>
      )}
    </div>
  )
}
