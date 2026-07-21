// APEX — Macro snapshot: live market APIs + Supabase-persisted overrides
// Slow-changing values (CPI, Fed, M2, ETF flows) live in apex_macro_overrides.
// Fast-changing values (DXY, S&P, Gold, Fear&Greed, BTC.D) fetched live.
// 6-hour in-memory cache per warm Vercel instance.

import { createClient } from '@supabase/supabase-js'

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export interface MacroSnapshot {
  cpi_yoy:           number
  core_cpi_yoy:      number
  fed_rate:          number
  fed_next_meeting:  string
  dxy:               number
  sp500_change:      number
  gold_price:        number
  m2_growth:         number
  us10y_yield:       number
  btc_dominance:     number
  total_crypto_mcap: number
  fear_greed:        number
  etf_flow_7d:       number
  etf_flow_asof:     string | null
  source_note:       string
  fetchedAt:         string
}

// Known-good defaults — overridden by Supabase overrides and live APIs
const DEFAULTS: MacroSnapshot = {
  cpi_yoy:           4.2,
  core_cpi_yoy:      2.9,
  fed_rate:          3.63,
  fed_next_meeting:  'Jul 29-30, 2026',
  dxy:               100,
  sp500_change:      0,
  gold_price:        2350,
  m2_growth:         4.7,
  us10y_yield:       4.5,
  btc_dominance:     55,
  total_crypto_mcap: 2000,
  fear_greed:        50,
  etf_flow_7d:       -596,
  etf_flow_asof:     null,
  source_note:       'CPI: BLS May 2026 | Fed: FOMC Jun 2026',
  fetchedAt:         new Date().toISOString(),
}

let macroCache: MacroSnapshot | null = null
let cachedAt = 0
const CACHE_TTL = 6 * 60 * 60 * 1000  // 6 hours

type YahooResp = { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number } }> } }
type CGResp    = { data?: { market_cap_percentage?: { btc?: number }; total_market_cap?: { usd?: number } } }
type FGResp    = { data?: Array<{ value: string }> }
type FredResp  = { observations?: Array<{ date: string; value: string }> }

async function fetchFred(seriesId: string, pctChangeYoy: boolean): Promise<{ value: number; asOf: string } | null> {
  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) return null
  try {
    const units = pctChangeYoy ? '&units=pc1' : ''
    const r = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1${units}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!r.ok) return null
    const d = await r.json() as FredResp
    const obs = d.observations?.[0]
    const v = obs?.value ? parseFloat(obs.value) : NaN
    return !isNaN(v) && obs?.date ? { value: v, asOf: obs.date } : null
  } catch { return null }
}

export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  if (macroCache && Date.now() - cachedAt < CACHE_TTL) return macroCache

  const merged: MacroSnapshot = { ...DEFAULTS, fetchedAt: new Date().toISOString() }

  // 1. Supabase overrides — manual values for fields with no live source (etf_flow_7d).
  // CPI/Core CPI/Fed Rate/M2 below are live via FRED and take priority when they succeed.
  try {
    const sb = getSb()
    if (sb) {
      const { data } = await Promise.resolve(
        sb.from('apex_macro_overrides').select('key, value, source, updated_at')
      ).catch(() => ({ data: null })) as { data: Array<{ key: string; value: number; source: string; updated_at: string }> | null }
      const validKeys = new Set<string>(Object.keys(merged))
      for (const o of data ?? []) {
        if (validKeys.has(o.key)) (merged as unknown as Record<string, number | string>)[o.key] = o.value
      }
      const etfOverride = (data ?? []).find(o => o.key === 'etf_flow_7d')
      if (etfOverride) merged.etf_flow_asof = etfOverride.updated_at
      const srcNote = (data ?? [])
        .filter(o => o.source && o.source !== 'manual')
        .slice(0, 3)
        .map(o => `${o.key}: ${o.source}`)
        .join(' | ')
      if (srcNote) merged.source_note = srcNote
    }
  } catch { /* noop */ }

  // 2. Live market APIs — all optional, failures use defaults
  const [fgRes, cgRes, dxyRes, spxRes, goldRes, t10yRes, cpiRes, coreCpiRes, fedRes, m2Res] = await Promise.allSettled([
    fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<FGResp>)
      .then(d => ({ fear_greed: parseInt(d.data?.[0]?.value ?? '50') })),

    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) })
      .then(r => r.json() as Promise<CGResp>)
      .then(d => ({
        btc_dominance:     parseFloat((d.data?.market_cap_percentage?.btc ?? 55).toFixed(1)),
        total_crypto_mcap: Math.round((d.data?.total_market_cap?.usd ?? 0) / 1e9),
      })),

    // DXY — Stooq (works from Vercel; Yahoo is blocked)
    fetch('https://stooq.com/q/l/?s=dx.f&f=sd2t2ohlcv&h&e=csv', { signal: AbortSignal.timeout(6000) })
      .then(r => r.text())
      .then(txt => {
        const cols = txt.trim().split('\n')[1]?.split(',') ?? []
        const c = parseFloat(cols[4] ?? '0')
        return { dxy: c > 50 ? parseFloat(c.toFixed(2)) : 100 }
      }),

    // S&P 500 — Stooq
    fetch('https://stooq.com/q/l/?s=^spx&f=sd2t2ohlcv&h&e=csv', { signal: AbortSignal.timeout(6000) })
      .then(r => r.text())
      .then(txt => {
        const cols = txt.trim().split('\n')[1]?.split(',') ?? []
        const c = parseFloat(cols[4] ?? '0'), o = parseFloat(cols[3] ?? '0')
        return { sp500_change: c > 0 && o > 0 ? parseFloat(((c - o) / o * 100).toFixed(2)) : NaN }
      }),

    // Gold — gold-api.com (Stooq's gc.f/xauusd/xau tickers all 404 now — endpoint gone)
    fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(6000) })
      .then(r => r.json() as Promise<{ price?: number }>)
      .then(d => {
        const c = d.price ?? 0
        return { gold_price: c > 500 ? Math.round(c) : 2350 }
      }),

    // US 10Y — Stooq
    fetch('https://stooq.com/q/l/?s=10ys.b&f=sd2t2ohlcv&h&e=csv', { signal: AbortSignal.timeout(6000) })
      .then(r => r.text())
      .then(txt => {
        const cols = txt.trim().split('\n')[1]?.split(',') ?? []
        const c = parseFloat(cols[4] ?? '0')
        return { us10y_yield: c > 0 ? parseFloat(c.toFixed(2)) : 4.5 }
      }),

    // CPI YoY — FRED (BLS series, released monthly)
    fetchFred('CPIAUCSL', true),
    // Core CPI YoY — FRED
    fetchFred('CPILFESL', true),
    // Fed Funds Rate (effective) — FRED
    fetchFred('FEDFUNDS', false),
    // M2 YoY growth — FRED
    fetchFred('M2SL', true),
  ])

  for (const r of [fgRes, cgRes, dxyRes, spxRes, goldRes, t10yRes]) {
    if (r.status === 'fulfilled') Object.assign(merged, r.value)
  }

  const fredNotes: string[] = []
  if (cpiRes.status === 'fulfilled' && cpiRes.value) {
    merged.cpi_yoy = parseFloat(cpiRes.value.value.toFixed(2))
    fredNotes.push(`CPI: FRED ${cpiRes.value.asOf}`)
  }
  if (coreCpiRes.status === 'fulfilled' && coreCpiRes.value) {
    merged.core_cpi_yoy = parseFloat(coreCpiRes.value.value.toFixed(2))
  }
  if (fedRes.status === 'fulfilled' && fedRes.value) {
    merged.fed_rate = parseFloat(fedRes.value.value.toFixed(2))
    fredNotes.push(`Fed: FRED ${fedRes.value.asOf}`)
  }
  if (m2Res.status === 'fulfilled' && m2Res.value) {
    merged.m2_growth = parseFloat(m2Res.value.value.toFixed(2))
  }
  if (fredNotes.length) merged.source_note = fredNotes.join(' | ')

  console.log(`[MACRO] CPI ${merged.cpi_yoy}% | Core ${merged.core_cpi_yoy}% | Fed ${merged.fed_rate}% | M2 ${merged.m2_growth}% | ETF ${merged.etf_flow_7d}M (asOf ${merged.etf_flow_asof ?? '?'}) | F&G ${merged.fear_greed} | BTC.D ${merged.btc_dominance}% | DXY ${merged.dxy} | source: ${merged.source_note} | fgRes:${fgRes.status} cgRes:${cgRes.status}`)

  macroCache = merged
  cachedAt = Date.now()
  return merged
}

export async function updateMacroOverride(key: string, value: number, source = 'manual_telegram'): Promise<boolean> {
  const sb = getSb()
  if (!sb) return false
  await Promise.resolve(
    sb.from('apex_macro_overrides').upsert({ key, value, source, updated_at: new Date().toISOString() })
  ).catch(() => {})
  macroCache = null  // invalidate cache so next call re-fetches
  return true
}

export function formatMacroForPrompt(m: MacroSnapshot): string {
  const cpiStatus = m.cpi_yoy > 4.0
    ? `🔴 ALTO — la Fed no puede recortar pronto`
    : m.cpi_yoy > 2.5 ? `🟡 ELEVADO` : `🟢 CONTROLADO`
  const dxyLabel  = m.dxy > 102 ? 'FUERTE (headwind BTC)' : m.dxy > 99 ? 'NEUTRAL' : 'DÉBIL (tailwind BTC)'
  const yieldNote = m.us10y_yield > 4.5 ? 'ALTO — costo de oportunidad contra BTC' : 'moderado'

  // No hay API pública gratis de flujo ETF en vivo — este valor se carga a mano
  // vía /macro update. Si tiene más de 10 días, se lo marcamos a Claude como
  // dato viejo en vez de dejar que lo cite como si fuera de esta semana.
  const etfAgeDays = m.etf_flow_asof
    ? Math.floor((Date.now() - new Date(m.etf_flow_asof).getTime()) / 86_400_000)
    : null
  const etfStale   = etfAgeDays !== null && etfAgeDays > 10
  const etfWindow  = etfStale ? `última cifra conocida, hace ${etfAgeDays}d — NO la trates como dato de esta semana` : '7D'
  const etfNote    = m.etf_flow_7d < -200
    ? `🔴 OUTFLOWS $${Math.abs(m.etf_flow_7d)}M (${etfWindow}) — institucional reduciendo exposición`
    : m.etf_flow_7d > 200
    ? `🟢 INFLOWS $${m.etf_flow_7d}M (${etfWindow}) — demanda institucional activa`
    : `⚪ Flujos ETF neutros (${etfWindow}: ${m.etf_flow_7d >= 0 ? '+' : ''}$${m.etf_flow_7d}M)`

  return [
    `MACRO REAL (fuente: ${m.source_note}):`,
    `• CPI YoY: ${m.cpi_yoy}% ${cpiStatus} | Core: ${m.core_cpi_yoy}%`,
    `• Fed Rate: ${m.fed_rate}% (HOLD) | Próxima reunión FOMC: ${m.fed_next_meeting}`,
    `• US 10Y Treasury: ${m.us10y_yield}% (${yieldNote})`,
    `• DXY: ${m.dxy} — ${dxyLabel} | S&P 500: ${m.sp500_change >= 0 ? '+' : ''}${m.sp500_change}% hoy`,
    `• Oro: $${m.gold_price.toLocaleString()} | BTC Dominance: ${m.btc_dominance}%`,
    `• Total Crypto MktCap: $${m.total_crypto_mcap}B | Fear&Greed: ${m.fear_greed}/100`,
    `• ${etfNote}`,
  ].join('\n')
}
