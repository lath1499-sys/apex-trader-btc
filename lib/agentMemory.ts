// APEX — Agent Memory & Opinion Change Tracker
// Persists the agent's last known bias in Supabase.
// When the bias flips (LONG→SHORT, SHORT→NEUTRAL, etc.) it generates a
// human-readable explanation that gets prepended to the new signal's analysis.

import type { TradeIdea, IndicatorMap } from './types'
import type { RegimeAnalysis }          from './marketRegime'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentState {
  id:                   string       // always 'current' (singleton row)
  lastBias:             string       // 'LONG' | 'SHORT' | 'NEUTRAL'
  lastTradeType:        string | null
  lastConfidence:       string | null
  lastPrice:            number
  lastScore:            number
  changeReason:         string | null
  updatedAt:            string
  lastAnalysisAt:       string | null  // ISO — last 30min market update
  lastDeepAnalysisAt:   string | null  // ISO — last 4H deep analysis
  lastLevelAlerts:      Record<string, number>  // price→epochMs last alert
}

// ── Persistent trader thesis — set by user, respected by every agent run ─────

export interface WatchingLevel {
  price:  number
  reason: string
  action: 'SHORT_ENTRY' | 'LONG_ENTRY' | 'EXIT' | 'ALERT'
}

export interface AgentMemory {
  id:                 string   // always 'current'
  currentThesis:      string | null
  currentBias:        string | null
  thesisSetAt:        string | null
  thesisInvalidation: string | null
  watchingLevels:     WatchingLevel[]
  netDirectionalBias: string | null
  updatedAt:          string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any

// ─────────────────────────────────────────────────────────────────────────────
// Supabase helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function loadAgentState(sb: SbClient): Promise<AgentState | null> {
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from('apex_agent_state')
      .select('*')
      .eq('id', 'current')
      .maybeSingle()
    if (error || !data) return null
    return {
      id:                   data.id,
      lastBias:             data.last_bias             ?? 'NEUTRAL',
      lastTradeType:        data.last_trade_type       ?? null,
      lastConfidence:       data.last_confidence       ?? null,
      lastPrice:            data.last_price            ?? 0,
      lastScore:            data.last_score            ?? 0,
      changeReason:         data.change_reason         ?? null,
      updatedAt:            data.updated_at            ?? new Date().toISOString(),
      lastAnalysisAt:       data.last_analysis_at      ?? null,
      lastDeepAnalysisAt:   data.last_deep_analysis_at ?? null,
      lastLevelAlerts:      (data.last_level_alerts as Record<string, number> | null) ?? {},
    }
  } catch { return null }
}

export async function loadAgentMemory(sb: SbClient): Promise<AgentMemory | null> {
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from('apex_agent_memory')
      .select('*')
      .eq('id', 'current')
      .maybeSingle()
    if (error || !data) return null
    return {
      id:                 String(data.id),
      currentThesis:      (data.current_thesis      as string | null) ?? null,
      currentBias:        (data.current_bias        as string | null) ?? null,
      thesisSetAt:        (data.thesis_set_at       as string | null) ?? null,
      thesisInvalidation: (data.thesis_invalidation as string | null) ?? null,
      watchingLevels:     Array.isArray(data.watching_levels) ? (data.watching_levels as WatchingLevel[]) : [],
      netDirectionalBias: (data.net_directional_bias as string | null) ?? null,
      updatedAt:          (data.updated_at          as string | null) ?? new Date().toISOString(),
    }
  } catch { return null }
}

export async function saveAgentState(sb: SbClient, state: AgentState): Promise<void> {
  if (!sb) return
  try {
    await sb.from('apex_agent_state').upsert({
      id:                    state.id,
      last_bias:             state.lastBias,
      last_trade_type:       state.lastTradeType,
      last_confidence:       state.lastConfidence,
      last_price:            state.lastPrice,
      last_score:            state.lastScore,
      change_reason:         state.changeReason,
      updated_at:            new Date().toISOString(),
      last_analysis_at:      state.lastAnalysisAt      ?? null,
      last_deep_analysis_at: state.lastDeepAnalysisAt  ?? null,
      last_level_alerts:     state.lastLevelAlerts     ?? {},
    })
  } catch { /* non-critical */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Opinion change detection
// Returns null if bias didn't change, or a string explanation if it did.
// ─────────────────────────────────────────────────────────────────────────────

export function detectOpinionChange(
  prev:    AgentState | null,
  newBias: string,          // 'LONG' | 'SHORT' | 'NEUTRAL'
  newIdea: TradeIdea | null,
  inds:    IndicatorMap,
  regime:  RegimeAnalysis | null,
): string | null {
  if (!prev) return null
  // No change — same bias or both NEUTRAL
  if (prev.lastBias === newBias) return null
  // Ignore NEUTRAL→NEUTRAL transitions
  if (prev.lastBias === 'NEUTRAL' && newBias === 'NEUTRAL') return null

  return buildChangeExplanation(prev, newBias, newIdea, inds, regime)
}

// ─────────────────────────────────────────────────────────────────────────────
// Explanation builder — generates analyst-quality prose
// ─────────────────────────────────────────────────────────────────────────────

function buildChangeExplanation(
  prev:    AgentState,
  newBias: string,
  newIdea: TradeIdea | null,
  inds:    IndicatorMap,
  regime:  RegimeAnalysis | null,
): string {
  const i4  = inds['4h']
  const i1d = inds['1d']
  const i1  = inds['1h']

  const priceDiff = newIdea && prev.lastPrice > 0
    ? ((newIdea.price - prev.lastPrice) / prev.lastPrice * 100)
    : null

  const lines: string[] = [
    `━━━ 🔄 APEX CAMBIÓ DE OPINIÓN ━━━`,
    ``,
    `Sesgo anterior: ${prev.lastBias}${prev.lastTradeType ? ` (${prev.lastTradeType})` : ''} | Confianza: ${prev.lastConfidence ?? 'N/A'}`,
    `Nuevo sesgo:    ${newBias}${newIdea ? ` (${newIdea.tradeType}) | Confianza: ${newIdea.confidence}` : ''}`,
    ``,
  ]

  // Price movement context
  if (priceDiff !== null) {
    const dir = priceDiff >= 0 ? 'subió' : 'bajó'
    lines.push(`Precio ${dir} ${Math.abs(priceDiff).toFixed(2)}% desde el último análisis ($${Math.round(prev.lastPrice).toLocaleString()})`)
  }

  // Indicator context
  if (i1d) lines.push(`1D: ${i1d.bias} (${i1d.score}/9) — RSI ${i1d.rsi?.toFixed(0) ?? '?'}`)
  if (i4)  lines.push(`4H: ${i4.bias} (${i4.score}/9) — RSI ${i4.rsi?.toFixed(0) ?? '?'}, MACD hist ${i4.macd.hist > 0 ? 'positivo' : 'negativo'}`)
  if (i1)  lines.push(`1H: ${i1.bias} (${i1.score}/9) — RSI ${i1.rsi?.toFixed(0) ?? '?'}`)

  if (regime) {
    lines.push(`Régimen: ${regime.description} (ADX ${regime.adx})`)
  }

  lines.push(``)

  // Directional narrative
  if (prev.lastBias === 'LONG' && newBias === 'SHORT') {
    lines.push(`⚠️ Reversión de sesgo: estructura alcista perdida.`)
    if (i4 && i4.bias === 'BAJISTA') lines.push(`4H confirmó tendencia bajista con score ${i4.score}/9.`)
    if (i1d && i1d.bias === 'BAJISTA') lines.push(`1D también bearish — alineación multi-TF hacia cortos.`)
  } else if (prev.lastBias === 'SHORT' && newBias === 'LONG') {
    lines.push(`✅ Reversión de sesgo: estructura bajista rota.`)
    if (i4 && i4.bias === 'ALCISTA') lines.push(`4H confirmó impulso alcista con score ${i4.score}/9.`)
    if (i1d && i1d.bias === 'ALCISTA') lines.push(`1D también bullish — alineación multi-TF recuperada.`)
  } else if (newBias === 'NEUTRAL') {
    lines.push(`⏸️ Sin confluencias suficientes — mercado en consolidación, esperando claridad.`)
    if (regime?.adx && regime.adx < 20) lines.push(`ADX ${regime.adx} confirma mercado sin tendencia definida.`)
  } else if (prev.lastBias === 'NEUTRAL') {
    const dir = newBias === 'LONG' ? 'alcista' : 'bajista'
    lines.push(`🚀 Sesgo ${dir} emergiendo tras período de consolidación.`)
    if (i4) lines.push(`4H ${i4.bias} con confluencias suficientes para activar señal.`)
  }

  return lines.join('\n')
}
