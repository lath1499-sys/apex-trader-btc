'use client'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import type { IndicatorMap } from '@/lib/types'
import type { VWAPResult, CVDResult, BOSCHoCHResult, ICTKillzone } from '@/lib/scalpSignals'

const TFS = ['1d', '4h', '1h', '15m'] as const

function fmt1(n: number | null | undefined, dec = 1): string {
  return n != null ? n.toFixed(dec) : '—'
}

function indChecks(inds: IndicatorMap) {
  const i4 = inds['4h']
  return [
    { label: 'RSI',        val: fmt1(i4?.rsi),                                ok: TFS.map(tf => inds[tf]?.rsi != null && (inds[tf]!.rsi) >= 0 && (inds[tf]!.rsi) <= 100) },
    { label: 'MACD hist',  val: fmt1(i4?.macd.hist, 2),                       ok: TFS.map(tf => inds[tf]?.macd.hist != null) },
    { label: 'BB %B',      val: fmt1(i4?.bb.pct, 2),                          ok: TFS.map(tf => inds[tf]?.bb.pct != null) },
    { label: 'BB Width',   val: i4?.bb.width != null ? fmt1(i4.bb.width, 2) + '%' : '—', ok: TFS.map(tf => inds[tf]?.bb.width != null && (inds[tf]!.bb.width ?? 0) > 0) },
    { label: 'ATR',        val: fmt1(i4?.atr, 0),                             ok: TFS.map(tf => (inds[tf]?.atr ?? 0) > 0) },
    { label: 'Stoch RSI',  val: i4?.stoch.k != null ? `K${fmt1(i4.stoch.k)} D${fmt1(i4.stoch.d)}` : '—', ok: TFS.map(tf => inds[tf]?.stoch.k != null) },
    { label: 'EMA 9/21',   val: i4 ? `${fmt1(i4.ema.e9, 0)}/${fmt1(i4.ema.e21, 0)}` : '—', ok: TFS.map(tf => (inds[tf]?.ema.e9 ?? 0) > 0 && (inds[tf]?.ema.e21 ?? 0) > 0) },
    { label: 'EMA 50/200', val: i4 ? `${fmt1(i4.ema.e50, 0)}/${fmt1(i4.ema.e200, 0)}` : '—', ok: TFS.map(tf => (inds[tf]?.ema.e50 ?? 0) > 0 && (inds[tf]?.ema.e200 ?? 0) > 0) },
    { label: 'Fibonacci',  val: i4 ? `${i4.fib.length} lvls` : '—',           ok: TFS.map(tf => (inds[tf]?.fib.length ?? 0) > 0) },
    { label: 'Volumen',    val: i4?.vol.ratio != null ? `×${fmt1(i4.vol.ratio)}` : '—', ok: TFS.map(tf => (inds[tf]?.vol.avg ?? 0) > 0) },
  ]
}

export default function StatusPanel() {
  const T    = useTheme()
  const conn        = useApexStore(s => s.conn)
  const mkt         = useApexStore(s => s.mkt)
  const inds        = useApexStore(s => s.inds)
  const divergences = useApexStore(s => s.divergences)
  const scalpMode   = useApexStore(s => s.scalpMode)
  const vwap        = useApexStore(s => s.vwap) as VWAPResult | null
  const cvdData     = useApexStore(s => s.cvdData) as CVDResult | null
  const bosChoch    = useApexStore(s => s.bosChoch) as BOSCHoCHResult
  const killzones   = useApexStore(s => s.killzones) as ICTKillzone[]
  const rawK        = useApexStore(s => s.rawK)

  const checks: { label: string; ok: boolean; detail: string }[] = [
    { label: 'Binance Spot/Futures', ok: !!conn.binanceFut,  detail: conn.binanceFut ? 'Conectado · precio en vivo' : 'Sin conexión — reintentando...' },
    { label: 'Datos On-Chain',       ok: !!conn.onchain,     detail: conn.onchain ? 'mempool.space OK' : 'Esperando datos on-chain...' },
    { label: 'Noticias RSS',         ok: !!conn.news,        detail: conn.news ? `${conn.newsCount ?? 0} artículos cargados` : 'Cargando fuentes RSS...' },
    { label: 'Fear & Greed Index',   ok: !!conn.fg,          detail: conn.fg ? 'alternative.me OK' : 'Esperando índice F&G...' },
  ]
  const allOk      = checks.every(c => c.ok)
  const indRows    = indChecks(inds)
  const hasInds    = Object.keys(inds).length > 0
  const indAllOk   = hasInds && indRows.every(r => r.ok.every(Boolean))

  const now       = Date.now()
  const ageMs     = mkt.ts ? now - new Date(mkt.ts).getTime() : Infinity
  const freshness = ageMs < 90_000 ? 'LIVE' : ageMs < 300_000 ? 'STALE' : 'ERROR'
  const freshColor = freshness === 'LIVE' ? T.bull : freshness === 'STALE' ? T.warn : T.danger

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Overall status */}
      <div style={{ background: T.card, border: `2px solid ${allOk && indAllOk ? T.bull : T.warn}44`, borderRadius: 10, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{allOk && indAllOk ? '✅' : '⚡'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: allOk && indAllOk ? T.bull : T.warn }}>
          {allOk && indAllOk ? 'SISTEMA OPERACIONAL' : 'INICIALIZANDO...'}
        </div>
        <div style={{ fontSize: 10, color: T.textSec, marginTop: 4 }}>
          {checks.filter(c => c.ok).length}/{checks.length} servicios · {hasInds ? `${indRows.filter(r => r.ok.every(Boolean)).length}/${indRows.length} indicadores` : 'indicadores cargando'}
        </div>
      </div>

      {/* Connection checks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {checks.map(c => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: T.card, border: `1px solid ${c.ok ? T.bull + '33' : T.warn + '33'}`, borderRadius: 7 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.ok ? T.bull : T.warn, boxShadow: `0 0 6px ${c.ok ? T.bull : T.warn}`, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.text, marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 9, color: T.textSec }}>{c.detail}</div>
            </div>
            <span style={{ fontSize: 9, color: c.ok ? T.bull : T.warn, fontWeight: 700 }}>{c.ok ? 'OK' : '...'}</span>
          </div>
        ))}
      </div>

      {/* Indicator health */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ flex: 1, fontSize: 9, color: T.muted, letterSpacing: '.14em' }}>SALUD DE INDICADORES</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: freshColor, letterSpacing: '.1em',
            background: freshColor + '22', borderRadius: 4, padding: '1px 6px' }}>
            {freshness === 'LIVE' ? '● LIVE' : freshness === 'STALE' ? '⚠ STALE' : '✕ ERROR'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, fontSize: 8, color: T.muted, marginBottom: 6, paddingRight: 4 }}>
          {TFS.map(tf => <span key={tf}>{tf.toUpperCase()}</span>)}
        </div>
        {!hasInds ? (
          <div style={{ fontSize: 10, color: T.warn, textAlign: 'center', padding: '8px 0' }}>Esperando datos de velas...</div>
        ) : indRows.map(row => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}22` }}>
            <span style={{ flex: 1, fontSize: 9, color: T.textSec }}>{row.label}</span>
            <span style={{ fontSize: 8, color: T.muted, fontFamily: 'monospace', marginRight: 10, minWidth: 56, textAlign: 'right' }}>{row.val}</span>
            <div style={{ display: 'flex', gap: 14, paddingRight: 4 }}>
              {row.ok.map((ok, i) => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? T.bull : T.danger, boxShadow: `0 0 4px ${ok ? T.bull : T.danger}` }} />
              ))}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ flex: 1, fontSize: 9, color: T.textSec }}>Divergencias RSI</span>
          <span style={{ fontSize: 9, color: divergences.length > 0 ? T.warn : T.bull }}>
            {divergences.length > 0 ? `${divergences.length} detectada${divergences.length > 1 ? 's' : ''}` : 'Sin divergencias'}
          </span>
        </div>
      </div>

      {/* Market data snapshot */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>ÚLTIMA ACTUALIZACIÓN DE DATOS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 9 }}>
          {([
            ['Precio',   mkt.price   ? '$' + mkt.price.toLocaleString() : '—'],
            ['Funding',  mkt.funding != null ? (mkt.funding > 0 ? '+' : '') + mkt.funding.toFixed(4) + '%' : '—'],
            ['OI',       mkt.oi      ? mkt.oi.toFixed(0) + ' BTC' : '—'],
            ['F&G',      mkt.fg != null ? mkt.fg + ' – ' + (mkt.fgLabel ?? '') : '—'],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ color: T.muted }}>{l}</span>
              <span style={{ color: T.text, fontFamily: 'monospace' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scalp data sources ─────────────────────────────────────────── */}
      <ScalpSourcesCard T={T} scalpMode={scalpMode} vwap={vwap} cvdData={cvdData}
        bosChoch={bosChoch} killzones={killzones} rawK={rawK} />

      <div style={{ fontSize: 8, color: T.muted, textAlign: 'center' }}>
        APEX Trader BTC · Datos: Binance + mempool.space + Bybit + Kraken
      </div>
    </div>
  )
}

// ── Scalp sources sub-component (keeps StatusPanel under 150 lines) ──────────

interface ScalpProps {
  T: ReturnType<typeof useTheme>
  scalpMode: boolean
  vwap: VWAPResult | null
  cvdData: CVDResult | null
  bosChoch: BOSCHoCHResult
  killzones: ICTKillzone[]
  rawK: Partial<Record<string, import('@/lib/types').Kline[]>>
}

function ScalpSourcesCard({ T, scalpMode, vwap, cvdData, bosChoch, killzones, rawK }: ScalpProps) {
  const klines1m  = rawK['1m'] ?? []
  const lastK1m   = klines1m[klines1m.length - 1]
  const k1mAge    = lastK1m ? Date.now() - lastK1m.t : Infinity
  const k1mOk     = k1mAge < 120_000

  const activeKZ  = killzones.find(kz => kz.active)
  const lastDelta = cvdData?.delta[cvdData.delta.length - 1] ?? null
  const lastBos   = bosChoch?.bos[bosChoch.bos.length - 1]
  const lastChoch = bosChoch?.choch[bosChoch.choch.length - 1]
  const lastSmc   = lastChoch ?? lastBos

  const rows: { label: string; ok: boolean; detail: string }[] = [
    {
      label:  '1M Klines',
      ok:     k1mOk,
      detail: k1mOk
        ? `${klines1m.length} velas · hace ${Math.round(k1mAge / 1000)}s`
        : klines1m.length === 0 ? 'Sin datos — activar Scalp Mode' : `Desactualizado (${Math.round(k1mAge / 60000)}m)`,
    },
    {
      label:  'VWAP',
      ok:     vwap != null,
      detail: vwap ? `$${vwap.vwap.toFixed(0)} · ±1σ $${vwap.upper1.toFixed(0)} / $${vwap.lower1.toFixed(0)}` : 'Sin datos',
    },
    {
      label:  'CVD',
      ok:     cvdData != null,
      detail: lastDelta != null
        ? `Último delta: ${lastDelta >= 0 ? '+' : ''}${lastDelta.toFixed(2)}`
        : 'Sin datos',
    },
    {
      label:  'ICT Killzone',
      ok:     killzones.length > 0,
      detail: activeKZ ? `Activa: ${activeKZ.name}` : 'Ninguna activa ahora',
    },
    {
      label:  'BOS / CHoCH',
      ok:     (bosChoch?.bos.length ?? 0) > 0 || (bosChoch?.choch.length ?? 0) > 0,
      detail: lastSmc
        ? `${lastSmc === lastChoch ? 'CHoCH' : 'BOS'} ${lastSmc.type} @ $${lastSmc.price.toFixed(0)}`
        : 'Sin estructura detectada',
    },
    {
      label:  'Scalp Mode',
      ok:     scalpMode,
      detail: scalpMode ? 'ON · refresh cada 10s' : 'OFF · refresh cada 45s',
    },
  ]

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 9, color: T.muted, letterSpacing: '.14em', marginBottom: 10 }}>⚡ SCALP — FUENTES DE DATOS</div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${T.border}22` }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: r.ok ? T.bull : T.danger,
            boxShadow: `0 0 4px ${r.ok ? T.bull : T.danger}` }} />
          <span style={{ width: 90, fontSize: 9, color: T.textSec, flexShrink: 0 }}>{r.label}</span>
          <span style={{ flex: 1, fontSize: 8, color: T.muted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: r.ok ? T.bull : T.danger }}>{r.ok ? 'OK' : '—'}</span>
        </div>
      ))}
    </div>
  )
}
