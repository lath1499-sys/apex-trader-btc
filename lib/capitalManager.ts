// APEX — Capital Management System
// Tracks available balance, deployed capital, monthly P&L, and trade limits.
// Balance is configured manually in the UI (no Binance API key required).

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
  riskPerTradePct:       number   // 0-1, e.g. 0.05
  monthlyProfitTarget:   number   // USD, e.g. 500
  maxDrawdownPct:        number   // 0-1, e.g. 0.15
}

export interface CapitalState {
  availableBalance:    number
  deployedCapital:     number
  freeCapital:         number
  monthlyStartBalance: number
  monthlyPnl:          number
  monthlyPnlPct:       number
  targetReached:       boolean
  drawdownTriggered:   boolean
  canOpenNewTrade:     boolean
  maxPositionSize:     number
  reason:              string
}

export const DEFAULT_CAPITAL_CONFIG: CapitalConfig = {
  maxCapitalDeployedPct: 0.70,
  maxPerTradePct:        0.30,
  riskPerTradePct:       0.05,
  monthlyProfitTarget:   500,
  maxDrawdownPct:        0.15,
}

export async function getCapitalState(config: CapitalConfig = DEFAULT_CAPITAL_CONFIG): Promise<CapitalState> {
  const sb = getServerSb()

  // 1. Read stored balance from Supabase config
  let monthlyStartBalance = 0
  let storedMonthlyTarget = config.monthlyProfitTarget
  if (sb) {
    const { data: cfg } = await Promise.resolve(
      sb.from('apex_capital_config')
        .select('monthly_start_balance, monthly_profit_target, max_capital_deployed_pct, max_per_trade_pct, risk_per_trade_pct, max_drawdown_pct')
        .eq('id', 'default')
        .single()
    ).catch(() => ({ data: null })) as { data: Record<string, number> | null }
    if (cfg) {
      monthlyStartBalance = cfg.monthly_start_balance  ?? 0
      storedMonthlyTarget = cfg.monthly_profit_target  ?? config.monthlyProfitTarget
      config = {
        maxCapitalDeployedPct: cfg.max_capital_deployed_pct ?? config.maxCapitalDeployedPct,
        maxPerTradePct:        cfg.max_per_trade_pct        ?? config.maxPerTradePct,
        riskPerTradePct:       cfg.risk_per_trade_pct       ?? config.riskPerTradePct,
        monthlyProfitTarget:   storedMonthlyTarget,
        maxDrawdownPct:        cfg.max_drawdown_pct         ?? config.maxDrawdownPct,
      }
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

  // 4. Compute current balance
  const availableBalance = monthlyStartBalance > 0
    ? monthlyStartBalance + monthlyPnl
    : 1000  // fallback: $1000 if not configured
  const freeCapital     = Math.max(0, availableBalance - deployedCapital)
  const monthlyPnlPct   = monthlyStartBalance > 0
    ? (monthlyPnl / monthlyStartBalance) * 100
    : 0

  // 5. Limits
  const maxDeployable   = availableBalance * config.maxCapitalDeployedPct
  const remainingRoom   = Math.max(0, maxDeployable - deployedCapital)
  const maxPerTrade     = availableBalance * config.maxPerTradePct
  const maxPositionSize = Math.min(remainingRoom, maxPerTrade)

  // 6. Stop conditions
  const targetReached      = monthlyPnl >= config.monthlyProfitTarget
  const drawdownTriggered  = monthlyStartBalance > 0 && monthlyPnl < -(monthlyStartBalance * config.maxDrawdownPct)

  let canOpenNewTrade = true
  let reason = 'OK'

  if (targetReached) {
    canOpenNewTrade = false
    reason = `Target mensual alcanzado (+$${monthlyPnl.toFixed(0)}). Pausa hasta el próximo mes.`
  } else if (drawdownTriggered) {
    canOpenNewTrade = false
    reason = `Drawdown máximo activado (-$${Math.abs(monthlyPnl).toFixed(0)}). Pausa de trading.`
  } else if (maxPositionSize < 50 && monthlyStartBalance > 0) {
    canOpenNewTrade = false
    reason = `Capital libre insuficiente ($${maxPositionSize.toFixed(0)} < $50 mínimo).`
  }

  return {
    availableBalance,
    deployedCapital,
    freeCapital,
    monthlyStartBalance,
    monthlyPnl,
    monthlyPnlPct,
    targetReached,
    drawdownTriggered,
    canOpenNewTrade,
    maxPositionSize,
    reason,
  }
}

export async function resetMonthlyTracking(balanceOverride?: number): Promise<void> {
  const sb = getServerSb()
  if (!sb) return

  // Use override if provided, else keep current stored balance
  let balance = balanceOverride
  if (balance == null) {
    const { data: cfg } = await Promise.resolve(
      sb.from('apex_capital_config').select('monthly_start_balance').eq('id', 'default').single()
    ).catch(() => ({ data: null })) as { data: { monthly_start_balance: number } | null }
    balance = cfg?.monthly_start_balance ?? 1000
  }

  await sb.from('apex_capital_config').upsert({
    id:                   'default',
    monthly_start_balance: balance,
    month_reset_at:       new Date().toISOString(),
    updated_at:           new Date().toISOString(),
  })
  console.log(`[CAPITAL] Monthly reset — start balance: $${balance?.toFixed(2)}`)
}
