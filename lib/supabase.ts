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
  const reasons = (s.reasons as Array<{ s: 'bull' | 'bear'; txt: string }>) ?? []
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
    // Persisted flags — prevent duplicate NTFY on each agent run
    tp1Hit:              Boolean(s.tp1_hit),
    tp2Hit:              Boolean(s.tp2_hit),
    slWarningFired:      Boolean(s.sl_warning_fired),
    expiryWarningFired:  Boolean(s.expiry_warning_fired),
    ntfySent:            Boolean(s.ntfy_sent),
    // Stop management state — prevents re-firing NTFY after agent restarts
    breakevenSet:        Boolean(s.breakeven_set),
    trailing2Set:        Boolean(s.trailing2_set),
    trailingActive:      Boolean(s.trailing_active),
    // Partial close tracking
    tp1ClosePct:      (s.tp1_close_pct     as number | null) ?? 40,
    tp2ClosePct:      (s.tp2_close_pct     as number | null) ?? 35,
    tp3ClosePct:      (s.tp3_close_pct     as number | null) ?? 25,
    tp1BankedPnl:     (s.tp1_banked_pnl   as number | null) ?? 0,
    tp2BankedPnl:     (s.tp2_banked_pnl   as number | null) ?? 0,
    totalBankedPnl:   (s.total_banked_pnl  as number | null) ?? 0,
    remainingSizePct: (s.remaining_size_pct as number | null) ?? 100,
    tp1RR:            (s.tp1_rr            as number | null) ?? 0,
    tp2RR:            (s.tp2_rr            as number | null) ?? 0,
    tp3RR:            (s.tp3_rr            as number | null) ?? 0,
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
      bull:    reasons.filter(r => r.s === 'bull').length,
      bear:    reasons.filter(r => r.s === 'bear').length,
      maxSc:   12,
      reasons,
      analysis:   '',
      ts:         new Date(String(s.created_at)),
    },
  }
}

// ── Signal CRUD ─────────────────────────────────────────────────────────────
function getDb() {
  // Server-side: prefer service key (bypasses RLS)
  if (typeof window === 'undefined') return getSupabaseServer() ?? getSupabase()
  // Browser: anon key only — service key is not available client-side
  return getSupabase()
}

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
    reasons:               signal.idea.reasons ?? [],
    created_at:            signal.createdAt,
    updated_at:            new Date().toISOString(),
    // Persisted flags — must survive agent restarts to prevent NTFY spam
    tp1_hit:               signal.tp1Hit              ?? false,
    tp2_hit:               signal.tp2Hit              ?? false,
    sl_warning_fired:      signal.slWarningFired       ?? false,
    expiry_warning_fired:  signal.expiryWarningFired   ?? false,
    ntfy_sent:             signal.ntfySent             ?? false,
    // Stop management state
    breakeven_set:         signal.breakevenSet         ?? false,
    trailing2_set:         signal.trailing2Set         ?? false,
    trailing_active:       signal.trailingActive       ?? false,
    // Partial close tracking
    tp1_close_pct:         signal.tp1ClosePct          ?? null,
    tp2_close_pct:         signal.tp2ClosePct          ?? null,
    tp3_close_pct:         signal.tp3ClosePct          ?? null,
    tp1_banked_pnl:        signal.tp1BankedPnl         ?? null,
    tp2_banked_pnl:        signal.tp2BankedPnl         ?? null,
    total_banked_pnl:      signal.totalBankedPnl       ?? null,
    remaining_size_pct:    signal.remainingSizePct      ?? null,
    tp1_rr:                signal.tp1RR                ?? null,
    tp2_rr:                signal.tp2RR                ?? null,
    tp3_rr:                signal.tp3RR                ?? null,
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
