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
  source_note:       'CPI: BLS May 2026 | Fed: FOMC Jun 2026',
  fetchedAt:         new Date().toISOString(),
}

let macroCache: MacroSnapshot | null = null
let cachedAt = 0
const CACHE_TTL = 6 * 60 * 60 * 1000  // 6 hours

type YahooResp = { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number } }> } }
type CGResp    = { data?: { market_cap_percentage?: { btc?: number }; total_market_cap?: { usd?: number } } }
type FGResp    = { data?: Array<{ value: string }> }

export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  if (macroCache && Date.now() - cachedAt < CACHE_TTL) return macroCache

  const merged: MacroSnapshot = { ...DEFAULTS, fetchedAt: new Date().toISOString() }

  // 1. Supabase overrides — highest priority (manually set via Telegram /macro update)
  try {
    const sb = getSb()
    if (sb) {
      const { data } = await Promise.resolve(
        sb.from('apex_macro_overrides').select('key, value, source')
      ).catch(() => ({ data: null })) as { data: Array<{ key: string; value: number; source: string }> | null }
      const validKeys = new Set<string>(Object.keys(merged))
      for (const o of data ?? []) {
        if (validKeys.has(o.key)) (merged as unknown as Record<string, number | string>)[o.key] = o.value
      }
      const srcNote = (data ?? [])
        .filter(o => o.source && o.source !== 'manual')
        .slice(0, 3)
        .map(o => `${o.key}: ${o.source}`)
        .join(' | ')
      if (srcNote) merged.source_note = srcNote
    }
  } catch { /* noop */ }

  // 2. Live market APIs — all optional, failures use defaults
  const [fgRes, cgRes, dxyRes, spxRes, goldRes, t10yRes] = await Promise.allSettled([
    fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<FGResp>)
      .then(d => ({ fear_greed: parseInt(d.data?.[0]?.value ?? '50') })),

    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) })
      .then(r => r.json() as Promise<CGResp>)
      .then(d => ({
        btc_dominance:     parseFloat((d.data?.market_cap_percentage?.btc ?? 55).toFixed(1)),
        total_crypto_mcap: Math.round((d.data?.total_market_cap?.usd ?? 0) / 1e9),
      })),

    fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=1d', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<YahooResp>)
      .then(d => ({ dxy: parseFloat((d.chart?.result?.[0]?.meta?.regularMarketPrice ?? 100).toFixed(2)) })),

    fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<YahooResp>)
      .then(d => ({ sp500_change: parseFloat((d.chart?.result?.[0]?.meta?.regularMarketChangePercent ?? 0).toFixed(2)) })),

    fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<YahooResp>)
      .then(d => ({ gold_price: Math.round(d.chart?.result?.[0]?.meta?.regularMarketPrice ?? 2000) })),

    fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1d', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<YahooResp>)
      .then(d => ({ us10y_yield: parseFloat((d.chart?.result?.[0]?.meta?.regularMarketPrice ?? 4.5).toFixed(2)) })),
  ])

  for (const r of [fgRes, cgRes, dxyRes, spxRes, goldRes, t10yRes]) {
    if (r.status === 'fulfilled') Object.assign(merged, r.value)
  }

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
  const etfNote   = m.etf_flow_7d < -200
    ? `🔴 OUTFLOWS $${Math.abs(m.etf_flow_7d)}M (7D) — institucional reduciendo exposición`
    : m.etf_flow_7d > 200
    ? `🟢 INFLOWS $${m.etf_flow_7d}M (7D) — demanda institucional activa`
    : `⚪ Flujos ETF neutros (7D: ${m.etf_flow_7d >= 0 ? '+' : ''}$${m.etf_flow_7d}M)`

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
