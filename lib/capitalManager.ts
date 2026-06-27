// APEX — Capital Management System
// Dynamic monthly target (15% of start balance) + 3-stage drawdown management.

import { createClient } from '@supabase/supabase-js'

function getServerSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export interface CapitalConfig {
  maxCapitalDeployedPct: number   // 0-1, e.g. 0.70
  maxPerTradePct:        number   // 0-1, e.g. 0.30
}

export interface CapitalState {
  availableBalance:    number
  deployedCapital:     number
  freeCapital:         number
  monthlyStartBalance: number
  monthlyPnl:          number
  monthlyPnlPct:       number
  monthlyProfitTarget: number   // 15% of start balance
  targetReached:       boolean
  drawdownStage:       1 | 2 | 3  // 1=normal, 2=survival, 3=hard stop
  drawdownPct:         number      // negative = loss
  effectiveRiskPct:    number      // 0.05 or 0.02 or 0
  canOpenNewTrade:     boolean
  maxPositionSize:     number
  reason:              string
}

export const DEFAULT_CAPITAL_CONFIG: CapitalConfig = {
  maxCapitalDeployedPct: 0.70,
  maxPerTradePct:        0.30,
}

const WARNING_PCT   = -15   // enter survival mode (5% → 2% risk)
const HARD_STOP_PCT = -20   // full trading pause
const RECOVERY_PCT  =   0   // from survival back to normal

export async function getCapitalState(
  config: CapitalConfig = DEFAULT_CAPITAL_CONFIG,
  ntfyTopic?: string,
): Promise<CapitalState> {
  const sb = getServerSb()

  // 1. Read stored config from Supabase
  let monthlyStartBalance = 0
  let maxCapitalDeployedPct = config.maxCapitalDeployedPct
  let maxPerTradePct        = config.maxPerTradePct

  if (sb) {
    const { data: cfg } = await Promise.resolve(
      sb.from('apex_capital_config')
        .select('monthly_start_balance, max_capital_deployed_pct, max_per_trade_pct')
        .eq('id', 'default')
        .single()
    ).catch(() => ({ data: null })) as { data: Record<string, number> | null }
    if (cfg) {
      monthlyStartBalance   = cfg.monthly_start_balance   ?? 0
      maxCapitalDeployedPct = cfg.max_capital_deployed_pct ?? config.maxCapitalDeployedPct
      maxPerTradePct        = cfg.max_per_trade_pct        ?? config.maxPerTradePct
    }
  }

  // 2. Monthly realized P&L from closed signals this month
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  let monthlyPnl = 0
  if (sb) {
    const { data: monthlyClosed } = await Promise.resolve(
      sb.from('apex_signals')
        .select('pnl, notional_usdt, leverage')
        .in('status', ['sl_hit', 'tp3_hit', 'closed_manual', 'breakeven'])
        .gte('closed_at', monthStart.toISOString())
    ).catch(() => ({ data: null })) as { data: Array<{ pnl: number | null; notional_usdt: number | null; leverage: number | null }> | null }

    monthlyPnl = (monthlyClosed ?? []).reduce((sum: number, s) => {
      const margin = s.notional_usdt != null && s.leverage != null
        ? s.notional_usdt / Math.max(1, s.leverage)
        : 100
      return sum + margin * (s.pnl ?? 0) / 100
    }, 0)
  }

  // 3. Active trades capital deployed
  let deployedCapital = 0
  if (sb) {
    const { data: activeSignals } = await Promise.resolve(
      sb.from('apex_signals')
        .select('notional_usdt, leverage')
        .in('status', ['active', 'tp1_hit', 'tp2_hit'])
    ).catch(() => ({ data: null })) as { data: Array<{ notional_usdt: number | null; leverage: number | null }> | null }

    deployedCapital = (activeSignals ?? []).reduce((sum: number, s) => {
      const margin = s.notional_usdt != null && s.leverage != null
        ? s.notional_usdt / Math.max(1, s.leverage)
        : 0
      return sum + margin
    }, 0)
  }

  // 4. Balance + dynamic target (15% of start balance)
  const availableBalance    = monthlyStartBalance > 0 ? monthlyStartBalance + monthlyPnl : 1000
  const freeCapital         = Math.max(0, availableBalance - deployedCapital)
  const drawdownPct         = monthlyStartBalance > 0 ? (monthlyPnl / monthlyStartBalance) * 100 : 0
  const monthlyProfitTarget = monthlyStartBalance * 0.15

  // 5. Capital limits
  const maxDeployable   = availableBalance * maxCapitalDeployedPct
  const remainingRoom   = Math.max(0, maxDeployable - deployedCapital)
  const maxPerTrade     = availableBalance * maxPerTradePct
  const maxPositionSize = Math.min(remainingRoom, maxPerTrade)

  // 6. Monthly target check
  const targetReached = monthlyStartBalance > 0 && monthlyPnl >= monthlyProfitTarget

  // 7. 3-stage drawdown system
  let drawdownStage: 1 | 2 | 3
  let effectiveRiskPct: number
  let canOpenNewTrade = true
  let reason = 'Normal'

  if (drawdownPct <= HARD_STOP_PCT) {
    drawdownStage    = 3
    effectiveRiskPct = 0
    canOpenNewTrade  = false
    reason = `Hard stop: drawdown ${drawdownPct.toFixed(1)}% superó -20%. Sin trades hasta el próximo mes.`
  } else if (drawdownPct <= WARNING_PCT) {
    drawdownStage    = 2
    effectiveRiskPct = 0.02
    reason = `Survival mode: drawdown ${drawdownPct.toFixed(1)}%. Riesgo reducido a 2% por trade.`
  } else {
    drawdownStage    = 1
    effectiveRiskPct = 0.05
  }

  // Recovery: if in survival and PnL recovers to >= 0 → back to normal
  if (drawdownStage === 2 && drawdownPct >= RECOVERY_PCT) {
    drawdownStage    = 1
    effectiveRiskPct = 0.05
    reason = 'Recuperado a BE — riesgo restaurado a 5%'
  }

  // Monthly target overrides canOpenNewTrade
  if (targetReached) {
    canOpenNewTrade = false
    reason = `Target mensual alcanzado (+$${monthlyPnl.toFixed(0)}). Pausa hasta el próximo mes.`
  }

  // Insufficient capital
  if (canOpenNewTrade && maxPositionSize < 50 && monthlyStartBalance > 0) {
    canOpenNewTrade = false
    reason = `Capital insuficiente ($${maxPositionSize.toFixed(0)} disponible, mínimo $50).`
  }

  // 8. Persist drawdown stage change to Supabase + NTFY alert
  if (sb) {
    const { data: currentCfg } = await Promise.resolve(
      sb.from('apex_capital_config').select('drawdown_stage').eq('id', 'default').single()
    ).catch(() => ({ data: null })) as { data: { drawdown_stage: number } | null }

    if (currentCfg && currentCfg.drawdown_stage !== drawdownStage) {
      await Promise.resolve(
        sb.from('apex_capital_config').update({
          drawdown_stage:             drawdownStage,
          risk_per_trade_pct:         effectiveRiskPct,
          drawdown_stage_updated_at:  new Date().toISOString(),
          updated_at:                 new Date().toISOString(),
        }).eq('id', 'default')
      ).catch(() => {})

      console.log(`[CAPITAL] Stage: ${currentCfg.drawdown_stage} → ${drawdownStage} | risk: ${(effectiveRiskPct * 100).toFixed(0)}%`)

      if (ntfyTopic) {
        const msgs: Record<number, string> = {
          1: `✅ APEX — Riesgo restaurado al 5%\nDrawdown recuperado. Trading normal reanudado.`,
          2: `⚠️ APEX — SURVIVAL MODE\nDrawdown: ${drawdownPct.toFixed(1)}%\nRiesgo reducido a 2% hasta recuperar BE o llegar a -20%.`,
          3: `🛑 APEX — TRADING PAUSADO\nDrawdown: ${drawdownPct.toFixed(1)}% superó el -20%.\nSin trades hasta el próximo mes.`,
        }
        await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: 'POST',
          headers: {
            Title:    `APEX Capital Stage ${drawdownStage}`,
            Priority: drawdownStage === 3 ? '5' : '4',
          },
          body: msgs[drawdownStage] ?? '',
        }).catch(() => {})
      }
    }
  }

  return {
    availableBalance,
    deployedCapital,
    freeCapital,
    monthlyStartBalance,
    monthlyPnl,
    monthlyPnlPct: drawdownPct,
    monthlyProfitTarget,
    targetReached,
    drawdownStage,
    drawdownPct,
    effectiveRiskPct,
    canOpenNewTrade,
    maxPositionSize,
    reason,
  }
}

export async function resetMonthlyTracking(balanceOverride?: number): Promise<void> {
  const sb = getServerSb()
  if (!sb) return

  let balance = balanceOverride
  if (balance == null) {
    const { data: cfg } = await Promise.resolve(
      sb.from('apex_capital_config').select('monthly_start_balance').eq('id', 'default').single()
    ).catch(() => ({ data: null })) as { data: { monthly_start_balance: number } | null }
    balance = cfg?.monthly_start_balance ?? 1000
  }

  const monthlyTarget = balance * 0.15
  await Promise.resolve(sb.from('apex_capital_config').upsert({
    id:                   'default',
    monthly_start_balance: balance,
    monthly_target_pct:   0.15,
    drawdown_stage:       1,
    risk_per_trade_pct:   0.05,
    month_reset_at:       new Date().toISOString(),
    updated_at:           new Date().toISOString(),
  })).catch(() => {})

  console.log(`[CAPITAL] Monthly reset — balance: $${balance.toFixed(2)} | target: $${monthlyTarget.toFixed(2)} (15%)`)
}
