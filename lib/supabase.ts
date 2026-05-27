// APEX — Supabase Persistence Layer
// Replaces fragile localStorage with permanent cloud storage.
// History survives across devices, browsers, and cache clears.
//
// Setup:
//   1. Create project at supabase.com
//   2. Run the SQL schema (see README or Supabase dashboard SQL editor)
//   3. Add env vars to .env.local AND Vercel dashboard:
//      NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
//      NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
//
// Falls back to localStorage when env vars are missing (local dev without Supabase).

import { createClient } from '@supabase/supabase-js'
import type { SignalRecord } from './types'

// ── Supabase SQL schema (run in Supabase dashboard → SQL Editor) ─────────────
// See: /docs/supabase-schema.sql  (or paste directly in Supabase SQL editor)
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase:       any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabaseServer: any = null

// ── Browser client — uses NEXT_PUBLIC_ vars (baked into the client bundle) ───
// Supports new-format keys (sb_publishable_...) via auth options
export function getSupabase() {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    _supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
    return _supabase
  } catch {
    return null
  }
}

// ── Server-only client — uses service key (never exposed to the browser) ─────
export function getSupabaseServer() {
  if (_supabaseServer) return _supabaseServer
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  try {
    _supabaseServer = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return _supabaseServer
  } catch {
    return null
  }
}

export function transformSignal(s: Record<string, unknown>): SignalRecord {
  return {
    id:          String(s.id),
    createdAt:   String(s.created_at),
    status:      String(s.status) as SignalRecord['status'],
    exitPrice:   (s.exit_price as number | null) ?? null,
    exitTs:      (s.closed_at as string | null) ?? null,
    pnl:         (s.pnl as number | null) ?? null,
    pnlR:        (s.pnl_r as number | null) ?? null,
    closedAt:    (s.closed_at as string | null) ?? null,
    closeReason: (s.close_reason as string | null) ?? null,
    idea: {
      side:       String(s.side) as 'LONG' | 'SHORT',
      tradeType:  String(s.trade_type) as 'Scalp' | 'DayTrade' | 'Swing',
      confidence: String(s.confidence) as 'ALTA' | 'MEDIA' | 'BAJA',
      price:      Number(s.entry),
      sl:         Number(s.sl),
      tp1:        Number(s.tp1),
      tp2:        Number(s.tp2),
      tp3:        Number(s.tp3),
      maxLev:     Number(s.max_lev ?? 5),
      bull: 0, bear: 0, maxSc: 12,
      reasons:    (s.reasons as Array<{ s: 'bull' | 'bear'; txt: string }>) ?? [],
      analysis:   '',
      ts:         new Date(String(s.created_at)),
    },
  }
}

// ── Signal CRUD ─────────────────────────────────────────────────────────────
// getDb(): server routes get the service-key client; browser gets the anon client
function getDb() { return getSupabaseServer() ?? getSupabase() }

export async function saveSignalToCloud(signal: SignalRecord): Promise<void> {
  const sb = getDb()
  if (!sb) return  // fallback to localStorage only

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('apex_signals') as any).upsert({
    id:           signal.id,
    side:         signal.idea.side,
    trade_type:   signal.idea.tradeType,
    entry:        signal.idea.price,
    sl:           signal.idea.sl,
    tp1:          signal.idea.tp1,
    tp2:          signal.idea.tp2,
    tp3:          signal.idea.tp3,
    confidence:   signal.idea.confidence,
    score:        (signal.idea as { score?: number }).score ?? null,
    status:       signal.status,
    pnl:          signal.pnl ?? null,
    pnl_r:        signal.pnlR ?? null,
    closed_at:    signal.closedAt ?? null,
    exit_price:   signal.exitPrice ?? null,
    close_reason: signal.closeReason ?? null,
    reasons:      signal.idea.reasons ?? [],
    created_at:   signal.createdAt,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'id' })

  if (error) console.error('[Supabase] saveSignal error:', error.message)
}

export async function loadSignalsFromCloud(): Promise<SignalRecord[] | null> {
  const sb = getDb()
  if (!sb) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('apex_signals') as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[Supabase] loadSignals error:', error.message)
    return null
  }

  return (data ?? []).map((s: Record<string, unknown>) => transformSignal(s))
}

export async function saveMarketSnapshot(data: {
  price: number; regime?: string; bias4h?: string; bias1h?: string
  rsi4h?: number; macd4h?: number; funding?: number; fg?: number
  lsr?: number; oi?: number; elliott4h?: string; analysis30m?: string
}): Promise<void> {
  const sb = getDb()
  if (!sb) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('apex_market_snapshots') as any).insert({
    price:        data.price,
    regime:       data.regime ?? null,
    bias_4h:      data.bias4h ?? null,
    bias_1h:      data.bias1h ?? null,
    rsi_4h:       data.rsi4h ?? null,
    macd_4h:      data.macd4h ?? null,
    funding:      data.funding ?? null,
    fg:           data.fg ?? null,
    lsr:          data.lsr ?? null,
    oi:           data.oi ?? null,
    elliott_4h:   data.elliott4h ?? null,
    analysis_30m: data.analysis30m ?? null,
  })
}

export function isSupabaseConfigured(): boolean {
  return !!getSupabase()
}
