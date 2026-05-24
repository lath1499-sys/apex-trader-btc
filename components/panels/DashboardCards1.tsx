'use client'
import useSWR from 'swr'
import { useRef } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { fmt, fmtB } from '@/lib/buildContext'

const fetcher = (u: string) => fetch(u).then(r => r.json())

function fmtM(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  return `$${(n / 1e6).toFixed(1)}M`
}

// ─── 1a: Dominance ───────────────────────────────────────────────────────────
export function DominanceCard() {
  const T = useTheme()
  const { data } = useSWR('/api/coingecko', fetcher, { refreshInterval: 120_000, revalidateOnFocus: false })
  const d = data as { totalUSD: number | null; btcPct: number | null; btcUSD: number | null; total2USD: number | null } | undefined

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }
  const fmtT = (n: number | null | undefined) => n ? `$${(n / 1e12).toFixed(2)}T` : '—'

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>🌐 DOMINANCIA Y CORRELACIONES</div>
      {[
        ['BTC Dom.', d?.btcPct != null ? `${d.btcPct.toFixed(1)}%` : '—', d?.btcPct != null && d.btcPct > 55 ? T.bull : T.warn],
        ['Market Cap Total', fmtT(d?.totalUSD), T.textSec],
        ['BTC Market Cap',   fmtT(d?.btcUSD), T.accent],
        ['Altcoin (Total2)', fmtT(d?.total2USD), T.textSec],
        ['BTC/ETH Corr.', 'Alta (histórica)', T.warn],
        ['DXY / BTC', 'Inversa', T.textSec],
      ].map(([l, v, c]) => (
        <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span style={{ color: T.muted }}>{l}</span>
          <span style={{ color: c as string, fontFamily: 'monospace', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── 1b: Capital Flow ────────────────────────────────────────────────────────
export function CapitalFlowCard() {
  const T = useTheme()
  const mkt = useApexStore(s => s.mkt)
  const prevOIRef = useRef<number | null>(null)
  const prevPriceRef = useRef<number | null>(null)

  const currOI = mkt.oi ?? null
  const currPrice = mkt.price ?? null
  const prevOI = prevOIRef.current
  const prevPrice = prevPriceRef.current

  // Update previous values on each render (simple 2-snapshot tracker)
  if (currOI && currOI !== prevOI) {
    if (prevOIRef.current !== null) { /* already set, keep old */ }
    else { prevOIRef.current = currOI; prevPriceRef.current = currPrice }
  }

  const oiChange = currOI && prevOI && currOI !== prevOI ? currOI - prevOI : null
  const oiChangePct = oiChange && prevOI ? (oiChange / prevOI) * 100 : null
  const priceUp = currPrice && prevPrice ? currPrice > prevPrice : null

  let interp = '—'
  if (oiChange !== null && priceUp !== null) {
    if (oiChange > 0 && priceUp)  interp = '🟢 OI↑+P↑ = longs abriendo'
    if (oiChange > 0 && !priceUp) interp = '🔴 OI↑+P↓ = shorts abriendo'
    if (oiChange < 0 && priceUp)  interp = '⚠️ OI↓+P↑ = shorts cerrando'
    if (oiChange < 0 && !priceUp) interp = '🔴 OI↓+P↓ = longs liquidando'
  }

  const volRatio = mkt.vol ? (mkt.vol / 1e9).toFixed(2) : null
  const volColor = mkt.vol && mkt.vol > 50_000 ? T.warn : T.textSec
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>💰 FLUJO DE CAPITAL</div>
      <div style={{ fontSize: 9, marginBottom: 4 }}>
        <span style={{ color: T.muted }}>OI Change: </span>
        <span style={{ color: oiChange != null && oiChange > 0 ? T.bull : T.danger, fontFamily: 'monospace' }}>
          {oiChange != null ? `${oiChange > 0 ? '+' : ''}${fmt(oiChange, 0)} BTC (${oiChangePct?.toFixed(2)}%)` : 'Esperando 2do refresh...'}
        </span>
      </div>
      <div style={{ fontSize: 9, color: T.textSec, marginBottom: 6, fontStyle: 'italic' }}>{interp}</div>
      <div style={{ fontSize: 9, marginBottom: 4 }}>
        <span style={{ color: T.muted }}>Vol 24H: </span>
        <span style={{ color: volColor, fontFamily: 'monospace' }}>{volRatio ? `$${volRatio}B` : '—'}</span>
      </div>
      {mkt.vol && mkt.vol > 100_000 && (
        <div style={{ fontSize: 9, color: T.warn, marginTop: 4 }}>🐋 Whale activity detected — vol elevado</div>
      )}
    </div>
  )
}

// ─── 1c: Spread Multi-Exchange ───────────────────────────────────────────────
export function SpreadCard() {
  const T = useTheme()
  const mkt = useApexStore(s => s.mkt)
  const base = mkt.price ?? 0
  const bybit  = mkt.bybitPrice  ?? null
  const kraken = mkt.krakenPrice ?? null
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const diffColor = (diff: number) => diff < 0 ? T.bull : diff > 0 ? T.danger : T.textSec

  const spreads = [
    { ex: 'Binance', price: base, diff: 0 },
    { ex: 'Bybit',   price: bybit,  diff: bybit  ? bybit  - base : null },
    { ex: 'Kraken',  price: kraken, diff: kraken ? kraken - base : null },
  ]
  const diffs = spreads.filter(s => s.diff !== null).map(s => Math.abs(s.diff!))
  const maxSpread = diffs.length ? Math.max(...diffs) : 0
  const arbPct = base > 0 ? (maxSpread / base * 100).toFixed(3) : '—'

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>📡 SPREAD MULTI-EXCHANGE</div>
      {spreads.map(({ ex, price, diff }) => (
        <div key={ex} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span style={{ color: T.muted, width: 56 }}>{ex}</span>
          <span style={{ color: T.text, fontFamily: 'monospace' }}>${price ? Math.round(price).toLocaleString() : '—'}</span>
          {diff !== null && diff !== 0
            ? <span style={{ color: diffColor(diff), fontSize: 8, fontFamily: 'monospace' }}>{diff > 0 ? '+' : ''}{diff.toFixed(0)}</span>
            : <span style={{ fontSize: 8, color: T.muted }}>ref</span>}
        </div>
      ))}
      <div style={{ marginTop: 6, fontSize: 8, color: T.muted }}>
        Max spread: ${maxSpread.toFixed(0)} — Arbitraje: {arbPct}% <span style={{ color: T.textSec }}>(info only)</span>
      </div>
    </div>
  )
}

// ─── 1d: OI Analysis ────────────────────────────────────────────────────────
export function OIAnalysisCard() {
  const T = useTheme()
  const mkt = useApexStore(s => s.mkt)
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const oiBTC  = mkt.oi ?? null
  const oiUSD  = oiBTC && mkt.price ? oiBTC * mkt.price : null
  const mcap   = oiUSD && mkt.price ? oiUSD / (mkt.price * 21_000_000) * 100 : null

  let badge = '', badgeColor = T.textSec
  if (oiUSD) {
    if (oiUSD > 15e9) { badge = '⚠️ Mercado muy apalancado'; badgeColor = T.danger }
    else { badge = '✅ Apalancamiento normal'; badgeColor = T.bull }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>📊 OPEN INTEREST ANÁLISIS</div>
      {[
        ['OI Total BTC', oiBTC ? `${fmt(oiBTC, 0)} BTC` : '—'],
        ['OI Total USD', oiUSD ? fmtB(oiUSD) : '—'],
        ['OI / Sup. máx.', mcap ? `${mcap.toFixed(4)}%` : '—'],
        ['L/S Ratio', mkt.lsr ? fmt(mkt.lsr, 2) : '—'],
      ].map(([l, v]) => (
        <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '3px 0', borderBottom: `1px solid ${T.border}22` }}>
          <span style={{ color: T.muted }}>{l}</span>
          <span style={{ color: T.text, fontFamily: 'monospace' }}>{v}</span>
        </div>
      ))}
      {badge && <div style={{ marginTop: 8, fontSize: 9, color: badgeColor, fontWeight: 700 }}>{badge}</div>}
    </div>
  )
}

// ─── 1e: Liquidations ────────────────────────────────────────────────────────
interface LiqData { ok: boolean; longLiq: number; shortLiq: number; biggestVal: number; biggestSide: string; biggestTime: number }

export function LiquidationsCard() {
  const T = useTheme()
  const { data } = useSWR<LiqData>('/api/liquidations', fetcher, { refreshInterval: 30_000, revalidateOnFocus: false })
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }

  const total   = data ? data.longLiq + data.shortLiq : 0
  const longPct = total > 0 && data ? (data.longLiq / total) * 100 : 50
  const shortPct = 100 - longPct

  return (
    <div style={card}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>💥 LIQUIDACIONES RECIENTES</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 6 }}>
        <span style={{ color: T.muted }}>Total ~50 órdenes:</span>
        <span style={{ color: T.text, fontFamily: 'monospace' }}>{data?.ok ? fmtM(total) : '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 9, marginBottom: 6 }}>
        <span style={{ color: T.bull }}>🟢 Longs: {data?.ok ? fmtM(data.longLiq) : '—'}</span>
        <span style={{ color: T.danger }}>🔴 Shorts: {data?.ok ? fmtM(data.shortLiq) : '—'}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', background: T.danger, marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${longPct}%`, background: T.bull }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: T.muted, marginBottom: 8 }}>
        <span>Longs {longPct.toFixed(0)}%</span><span>Shorts {shortPct.toFixed(0)}%</span>
      </div>
      {data?.ok && data.biggestVal > 0 && (
        <div style={{ fontSize: 8, color: T.warn }}>
          Mayor: {fmtM(data.biggestVal)} ({data.biggestSide}) · {data.biggestTime ? new Date(data.biggestTime).toLocaleTimeString() : ''}
        </div>
      )}
      {!data?.ok && <div style={{ fontSize: 9, color: T.muted }}>Cargando liquidaciones...</div>}
    </div>
  )
}
