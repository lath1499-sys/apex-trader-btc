'use client'
import { useEffect, useRef, useState } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { ColorType, createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi, LineStyle, SeriesMarker, Time } from 'lightweight-charts'
import type { Timeframe } from '@/lib/types'
import { ema, calcAutoSR } from '@/lib/indicators'
import { calcVWAPSeries, calcCVD, detectBOSCHoCH, getICTKillzones } from '@/lib/scalpSignals'
import { detectCandlePatterns } from '@/lib/candlePatterns'

const TF_LABELS: Record<string, string> = { '1d': '1D', '4h': '4H', '1h': '1H', '15m': '15M', '5m': '5M', '3m': '3M', '1m': '1M' }

function loadBool(key: string, def: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? def : v !== 'false' } catch { return def }
}
const EMA_CFG = [
  { period: 9,   color: '#3b82f6', label: 'EMA9'   },
  { period: 21,  color: '#22c55e', label: 'EMA21'  },
  { period: 50,  color: '#f97316', label: 'EMA50'  },
  { period: 200, color: '#ef4444', label: 'EMA200' },
]

export default function CandleChart() {
  const T             = useTheme()
  const rawK          = useApexStore(s => s.rawK)
  const chartTf       = useApexStore(s => s.chartTf)
  const setChartTf    = useApexStore(s => s.setChartTf)
  const fvgs          = useApexStore(s => s.fvgs)
  const liquidity     = useApexStore(s => s.liquidity)
  const elliottWaves  = useApexStore(s => s.elliottWaves)
  const tradeIdea     = useApexStore(s => s.tradeIdea)
  const signalHistory = useApexStore(s => s.signalHistory)
  const scalpSignal   = useApexStore(s => s.scalpSignal)

  const [showSignals,   setShowSignals]   = useState(() => loadBool('apex_show_signals', true))
  const [showVwap,      setShowVwap]      = useState(() => loadBool('apex_show_vwap', true))
  const [showCvd,       setShowCvd]       = useState(() => loadBool('apex_show_cvd', true))
  const [showBosChoch,  setShowBosChoch]  = useState(() => loadBool('apex_show_boschoch', true))
  const [showKillzones, setShowKillzones] = useState(() => loadBool('apex_show_kz', true))
  const [showOte,       setShowOte]       = useState(() => loadBool('apex_show_ote', false))

  function tog(key: string, val: boolean, setter: (v: boolean) => void) {
    setter(val); try { localStorage.setItem(key, String(val)) } catch {}
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 340,
      layout: { background: { type: ColorType.Solid, color: T.card }, textColor: T.textSec },
      grid:   { vertLines: { color: T.border + '44' }, horzLines: { color: T.border + '44' } },
      crosshair: { mode: 1 },
      timeScale: { borderColor: T.border, timeVisible: true },
      rightPriceScale: { borderColor: T.border },
    })
    chartRef.current = chart
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, 340)
    })
    ro.observe(containerRef.current)
    return () => { chart.remove(); ro.disconnect() }
  }, [T])

  useEffect(() => {
    const chart  = chartRef.current
    const klines = rawK[chartTf as Timeframe]
    if (!chart || !klines?.length) return

    try { chart.panes()[0]?.getSeries().forEach(s => chart.removeSeries(s)) } catch { /* noop */ }

    const toTime = (ms: number) => Math.floor(ms / 1000) as unknown as import('lightweight-charts').Time
    const times  = klines.map(k => toTime(k.t))
    const closes = klines.map(k => k.c)
    const LS = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 } as const

    // Candles
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: T.bull, downColor: T.bear,
      borderUpColor: T.bull, borderDownColor: T.bear,
      wickUpColor: T.bull, wickDownColor: T.bear,
    })
    candles.setData(klines.map((k, i) => ({ time: times[i], open: k.o, high: k.h, low: k.l, close: k.c })))

    // Volume histogram (bottom 15% of pane)
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    vol.setData(klines.map((k, i) => ({ time: times[i], value: k.v, color: k.c >= k.o ? '#22c55e28' : '#ef444428' })))

    // EMAs
    for (const cfg of EMA_CFG) {
      if (klines.length < cfg.period) continue
      const vals = ema(closes, cfg.period)
      const s = chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(vals.map((v, i) => ({ time: times[i], value: v })).filter(p => p.value > 0))
    }

    // Trend line (linear regression last 50)
    const sl = klines.slice(-Math.min(50, klines.length))
    const nn = sl.length
    let sX = 0, sY = 0, sXY = 0, sX2 = 0
    for (let i = 0; i < nn; i++) { sX += i; sY += sl[i].c; sXY += i * sl[i].c; sX2 += i * i }
    const slope = (nn * sXY - sX * sY) / (nn * sX2 - sX * sX)
    const intercept = (sY - slope * sX) / nn
    const trend = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, priceLineVisible: false, lastValueVisible: false })
    trend.setData(sl.map((k, i) => ({ time: toTime(k.t), value: intercept + slope * i })))

    // S/R levels
    const { res, sup } = calcAutoSR(klines.map(k => k.h), klines.map(k => k.l), closes)
    res.forEach(p => candles.createPriceLine({ price: p, color: T.danger + 'aa', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'R' }))
    sup.forEach(p => candles.createPriceLine({ price: p, color: T.bull  + 'aa', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'S' }))

    // FVG zones (top + bottom boundary lines)
    const fvgResult = fvgs[chartTf]
    if (fvgResult) {
      fvgResult.bullish.slice(0, 3).forEach(f => {
        candles.createPriceLine({ price: f.top,    color: '#22c55e99', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, title: 'FVG↑' })
        candles.createPriceLine({ price: f.bottom, color: '#22c55e55', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, title: '' })
      })
      fvgResult.bearish.slice(0, 3).forEach(f => {
        candles.createPriceLine({ price: f.top,    color: '#ef444499', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, title: 'FVG↓' })
        candles.createPriceLine({ price: f.bottom, color: '#ef444455', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, title: '' })
      })
    }

    // Liquidity levels (4H / 1H only)
    if (liquidity && (chartTf === '4h' || chartTf === '1h')) {
      liquidity.buySideLiquidity.slice(0, 3).forEach(l =>
        candles.createPriceLine({ price: l.price, color: '#22d3ee', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'BSL' })
      )
      liquidity.sellSideLiquidity.slice(0, 3).forEach(l =>
        candles.createPriceLine({ price: l.price, color: '#f97316', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'SSL' })
      )
    }

    // Elliott Wave key price levels
    const ew = elliottWaves[chartTf]
    if (ew && ew.wave !== 'unclear' && ew.confidence !== 'low') {
      const ewC = ew.direction === 'bullish' ? '#22c55ecc' : '#ef4444cc'
      ew.points.forEach(pt => candles.createPriceLine({ price: pt.price, color: ewC, lineWidth: 1, lineStyle: LS.LargeDashed as LineStyle, axisLabelVisible: true, title: pt.label }))
      if (ew.nextTarget) candles.createPriceLine({ price: ew.nextTarget, color: '#fbbf24aa', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, title: `${ew.currentWave}→` })
    }

    // Active trade idea entry / SL / TPs
    if (tradeIdea) {
      candles.createPriceLine({ price: tradeIdea.price, color: '#fbbf24',  lineWidth: 2, lineStyle: LS.Solid as LineStyle, axisLabelVisible: true, title: `▶ ${tradeIdea.side}` })
      candles.createPriceLine({ price: tradeIdea.sl,    color: T.bear,     lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'SL' })
      candles.createPriceLine({ price: tradeIdea.tp1,   color: T.bull,     lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'TP1' })
      candles.createPriceLine({ price: tradeIdea.tp2,   color: T.bull,     lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'TP2' })
      candles.createPriceLine({ price: tradeIdea.tp3,   color: T.bull,     lineWidth: 1, lineStyle: LS.Solid as LineStyle, axisLabelVisible: true, title: 'TP3' })
    }

    // Persisted active signals — visible even after page reload before tradeIdea recalculates
    if (showSignals) {
      const sigColors = ['#a78bfa', '#60a5fa', '#f97316', '#ffd700']
      const activeRecs = signalHistory.filter(r =>
        (r.status === 'active' || r.status === 'pending_confirmation') &&
        r.idea?.tradeType !== 'Scalp' &&
        (!tradeIdea || Math.abs(r.idea.price - tradeIdea.price) > 1)
      )
      activeRecs.forEach((rec, idx) => {
        const col    = sigColors[idx % sigColors.length]
        const idea   = rec.idea
        const isLong = idea.side === 'LONG'
        candles.createPriceLine({ price: idea.price, color: col,         lineWidth: 2, lineStyle: LS.Solid  as LineStyle, axisLabelVisible: true, title: `${isLong ? '▲' : '▼'} ${idea.side}` })
        candles.createPriceLine({ price: idea.sl,    color: '#ff475799', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'SL' })
        candles.createPriceLine({ price: idea.tp1,   color: '#22c55e88', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'TP1' })
        candles.createPriceLine({ price: idea.tp2,   color: '#22c55eaa', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'TP2' })
        candles.createPriceLine({ price: idea.tp3,   color: '#22c55ecc', lineWidth: 1, lineStyle: LS.Solid  as LineStyle, axisLabelVisible: true, title: 'TP3' })
      })

      // Scalp signals — cyan, dashed, smaller labels
      const activeScalps = signalHistory.filter(r =>
        (r.status === 'active' || r.status === 'pending_confirmation') &&
        r.idea?.tradeType === 'Scalp'
      )
      activeScalps.forEach(rec => {
        const idea   = rec.idea
        const isLong = idea.side === 'LONG'
        candles.createPriceLine({ price: idea.price, color: '#22d3ee',   lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: `⚡${isLong ? '▲' : '▼'} SCALP` })
        candles.createPriceLine({ price: idea.sl,    color: '#f87171aa', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'S-SL' })
        candles.createPriceLine({ price: idea.tp1,   color: '#6ee7b7aa', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'S-TP1' })
        candles.createPriceLine({ price: idea.tp2,   color: '#6ee7b7cc', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'S-TP2' })
      })
    }

    // Signal history markers (last 20 closed, no expired)
    if (showSignals && signalHistory.length) {
      const closed = signalHistory
        .filter(r => r.status !== 'active' && r.status !== 'pending_confirmation' && r.status !== 'expired')
        .slice(0, 20)
      const markers: SeriesMarker<Time>[] = []
      const closest = (ms: number) => klines.reduce((b, k) => Math.abs(k.t - ms) < Math.abs(b.t - ms) ? k : b)
      for (const rec of closed) {
        const isLong  = rec.idea.side === 'LONG'
        const isWin   = rec.status !== 'sl_hit'
        const entryMs = new Date(rec.createdAt).getTime()
        markers.push({
          time:     toTime(closest(entryMs).t),
          position: isLong ? 'belowBar' : 'aboveBar',
          color:    '#fbbf24',
          shape:    isLong ? 'arrowUp' : 'arrowDown',
          text:     rec.idea.side[0],
          size:     1,
        })
        if (rec.exitTs) {
          const exitMs = new Date(rec.exitTs).getTime()
          markers.push({
            time:     toTime(closest(exitMs).t),
            position: isLong ? 'aboveBar' : 'belowBar',
            color:    isWin ? '#22c55e' : '#ef4444',
            shape:    'circle',
            text:     rec.pnlR != null ? `${rec.pnlR > 0 ? '+' : ''}${rec.pnlR.toFixed(1)}R` : '',
            size:     1,
          })
        }
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number))
      try {
        // lightweight-charts v5: setMarkers may be on a separate markers primitive
        const sm = (candles as unknown as { setMarkers?: (m: SeriesMarker<Time>[]) => void }).setMarkers
        if (sm) sm.call(candles, markers)
      } catch { /* v5 compat */ }
    }

    // ── VWAP + Bands ──────────────────────────────────────────────────────────
    if (showVwap) {
      const vwapSeries = calcVWAPSeries(klines)
      if (vwapSeries.length === klines.length) {
        const vwapLine = chart.addSeries(LineSeries, { color: '#FFD700', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'VWAP' })
        vwapLine.setData(vwapSeries.map((p, i) => ({ time: times[i], value: p.vwap })))
        const bandCfg = [
          { key: 'upper1' as const, color: '#FFD70066', dash: true },
          { key: 'upper2' as const, color: '#FFD700aa', dash: false },
          { key: 'lower1' as const, color: '#FFD70066', dash: true },
          { key: 'lower2' as const, color: '#FFD700aa', dash: false },
        ]
        for (const bc of bandCfg) {
          const s = chart.addSeries(LineSeries, { color: bc.color, lineWidth: 1, lineStyle: (bc.dash ? LS.Dashed : LS.Dotted) as LineStyle, priceLineVisible: false, lastValueVisible: false })
          s.setData(vwapSeries.map((p, i) => ({ time: times[i], value: p[bc.key] })))
        }
      }
    }

    // ── CVD histogram (bottom sub-panel) ─────────────────────────────────────
    if (showCvd) {
      const cvd = calcCVD(klines)
      const cvdSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'cvd', priceLineVisible: false, lastValueVisible: false, title: 'CVD',
        color: '#22c55e44',
      })
      chart.priceScale('cvd').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, borderVisible: false })
      cvdSeries.setData(cvd.delta.map((d, i) => ({
        time:  times[i],
        value: d,
        color: d >= 0 ? '#22c55e88' : '#ef444488',
      })))
    }

    // ── BOS / CHoCH markers ───────────────────────────────────────────────────
    if (showBosChoch && klines.length >= 10) {
      const bc = detectBOSCHoCH(klines)
      const bcMarkers: SeriesMarker<Time>[] = []
      for (const bos of bc.bos) {
        if (bos.bar < klines.length) bcMarkers.push({
          time: times[bos.bar] ?? times[times.length - 1],
          position: bos.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: bos.type === 'bullish' ? '#22c55e' : '#ef4444',
          shape: bos.type === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: bos.type === 'bullish' ? 'BOS↑' : 'BOS↓', size: 1,
        })
      }
      for (const ch of bc.choch) {
        if (ch.bar < klines.length) bcMarkers.push({
          time: times[ch.bar] ?? times[times.length - 1],
          position: ch.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: ch.type === 'bullish' ? '#00d084' : '#f97316',
          shape: 'square',
          text: ch.type === 'bullish' ? 'CHoCH↑' : 'CHoCH↓', size: 2,
        })
      }
      if (bcMarkers.length) {
        bcMarkers.sort((a, b) => (a.time as number) - (b.time as number))
        try {
          const sm = (candles as unknown as { setMarkers?: (m: SeriesMarker<Time>[]) => void }).setMarkers
          if (sm) sm.call(candles, bcMarkers)
        } catch { /* v5 compat */ }
      }
    }

    // ── OTE Zone (61.8–78.6% retracement) ────────────────────────────────────
    if (showOte && klines.length >= 20) {
      const recent = klines.slice(-50)
      const swingH = Math.max(...recent.map(k => k.h))
      const swingL = Math.min(...recent.map(k => k.l))
      const range  = swingH - swingL
      const oteTop = swingH - range * 0.618
      const oteBot = swingH - range * 0.786
      candles.createPriceLine({ price: oteTop, color: '#a78bfacc', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'OTE 61.8%' })
      candles.createPriceLine({ price: oteBot, color: '#a78bfa88', lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'OTE 78.6%' })
      candles.createPriceLine({ price: (oteTop + oteBot) / 2, color: '#a78bfa55', lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: false, title: '' })
    }

    // ── Scalp signal entry/SL/TPs (when scalpSignal active) ──────────────────
    if (scalpSignal && (chartTf === '15m' || chartTf === '1m' || chartTf === '3m' || chartTf === '5m')) {
      candles.createPriceLine({ price: scalpSignal.entry, color: '#ffd700', lineWidth: 2, lineStyle: LS.Solid as LineStyle, axisLabelVisible: true, title: `⚡${scalpSignal.side}` })
      candles.createPriceLine({ price: scalpSignal.sl,   color: T.danger,  lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'SL' })
      candles.createPriceLine({ price: scalpSignal.tp1,  color: T.bull,    lineWidth: 1, lineStyle: LS.Dashed as LineStyle, axisLabelVisible: true, title: 'TP1' })
      candles.createPriceLine({ price: scalpSignal.tp2,  color: T.bull,    lineWidth: 1, lineStyle: LS.Dotted as LineStyle, axisLabelVisible: true, title: 'TP2' })
    }

    // ── Candlestick pattern markers (Steve Nison) ─────────────────────────────
    const candlePatterns = detectCandlePatterns(klines, 30)
    if (candlePatterns.length) {
      const patternMarkers: SeriesMarker<Time>[] = candlePatterns.map(p => {
        const isBullPat = p.pattern.type === 'bullish'
        const isBearPat = p.pattern.type === 'bearish'
        const isStrong  = p.pattern.strength === 3
        const idx = Math.min(p.endBar, klines.length - 1)
        const isKicker  = p.pattern.name.includes('Kicker')
        const isStar    = p.pattern.name.includes('Star')
        return {
          time:     toTime(klines[idx].t),
          position: isBullPat ? 'belowBar' : isBearPat ? 'aboveBar' : 'aboveBar',
          color:    isBullPat ? (isStrong ? '#00ff88' : '#22c55e')
                  : isBearPat ? (isStrong ? '#ff4444' : '#ef4444')
                  : '#fbbf24',
          shape:    isKicker || isStar ? 'square' : isBullPat ? 'arrowUp' : 'arrowDown',
          text:     p.pattern.name.split(' ').slice(0, 2).join(' '),
          size:     isStrong ? 2 : 1,
        }
      })
      patternMarkers.sort((a, b) => (a.time as number) - (b.time as number))
      try {
        const sm = (candles as unknown as { setMarkers?: (m: SeriesMarker<Time>[]) => void }).setMarkers
        if (sm) sm.call(candles, patternMarkers)
      } catch { /* v5 compat */ }
    }

    chart.timeScale().fitContent()
  }, [rawK, chartTf, T, fvgs, liquidity, elliottWaves, tradeIdea, showSignals, signalHistory,
      showVwap, showCvd, showBosChoch, showOte, scalpSignal])

  const kzNow  = getICTKillzones().find(kz => kz.active)

  return (
    <div>
      {/* TF selector row */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(TF_LABELS).map(([tf, label]) => (
          <button key={tf} onClick={() => setChartTf(tf)} style={{
            background: chartTf === tf ? T.accent + '33' : 'transparent',
            border: `1px solid ${chartTf === tf ? T.accent : T.border}`,
            color: chartTf === tf ? T.accent : T.textSec,
            padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 9, letterSpacing: '.1em',
          }}>{label}</button>
        ))}
        <span style={{ fontSize: 8, color: T.textSec, marginLeft: 'auto' }}>
          {elliottWaves[chartTf]?.wave !== 'unclear' && elliottWaves[chartTf]?.confidence !== 'low'
            ? `EW ${elliottWaves[chartTf]?.currentWave} ${elliottWaves[chartTf]?.direction}` : ''}
        </span>
        <button onClick={() => tog('apex_show_signals', !showSignals, setShowSignals)} style={{
          background: showSignals ? T.accent + '22' : 'transparent',
          border: `1px solid ${showSignals ? T.accent : T.border}`,
          color: showSignals ? T.accent : T.textSec,
          padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9,
        }}>📍 {showSignals ? 'ON' : 'OFF'}</button>
      </div>

      {/* Scalp overlay toggles */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {([
          ['apex_show_vwap',     showVwap,      setShowVwap,      'VWAP',     '#FFD700'],
          ['apex_show_cvd',      showCvd,       setShowCvd,       'CVD',      '#22c55e'],
          ['apex_show_boschoch', showBosChoch,  setShowBosChoch,  'BOS/CHoCH','#00d084'],
          ['apex_show_kz',       showKillzones, setShowKillzones, 'KZ',       '#7b9fff'],
          ['apex_show_ote',      showOte,       setShowOte,       'OTE',      '#a78bfa'],
        ] as [string, boolean, (v: boolean) => void, string, string][]).map(([k, val, fn, lbl, col]) => (
          <button key={k} onClick={() => tog(k, !val, fn)} style={{
            background: val ? col + '22' : 'transparent',
            border: `1px solid ${val ? col : T.border}`,
            color: val ? col : T.muted,
            padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 8,
          }}>{lbl}</button>
        ))}
      </div>

      {/* Active killzone banner */}
      {showKillzones && kzNow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 10px',
          background: kzNow.color + '18', border: `1px solid ${kzNow.color}44`, borderRadius: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: kzNow.color, boxShadow: `0 0 4px ${kzNow.color}` }} />
          <span style={{ fontSize: 9, color: kzNow.color, fontWeight: 700 }}>{kzNow.name}</span>
          <span style={{ fontSize: 8, color: T.textSec }}>{kzNow.desc}</span>
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {EMA_CFG.map(cfg => (
          <div key={cfg.period} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 16, height: 2, background: cfg.color }} />
            <span style={{ fontSize: 8, color: T.textSec }}>{cfg.label}</span>
          </div>
        ))}
        {[
          { c: '#a78bfa', dashed: true, lbl: 'Tend' },
          { c: '#FFD700', dashed: false, lbl: 'VWAP' },
          { c: '#22d3ee', dashed: false, lbl: 'BSL'  },
          { c: '#f97316', dashed: false, lbl: 'SSL'  },
          { c: '#22c55e88', dashed: false, lbl: 'FVG↑' },
          { c: '#ef444488', dashed: false, lbl: 'FVG↓' },
        ].map(({ c, dashed, lbl }) => (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 16, height: dashed ? 0 : 2, background: dashed ? 'none' : c, borderTop: dashed ? `2px dashed ${c}` : 'none' }} />
            <span style={{ fontSize: 8, color: T.textSec }}>{lbl}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
