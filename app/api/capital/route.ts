import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCapitalState, DEFAULT_CAPITAL_CONFIG } from '@/lib/capitalManager'

function getServerSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  try {
    const sb = getServerSb()
    let config = null
    if (sb) {
      const { data } = await Promise.resolve(
        sb.from('apex_capital_config').select('*').eq('id', 'default').single()
      ).catch(() => ({ data: null })) as { data: Record<string, number> | null }
      config = data
    }

    const cfgForState = {
      maxCapitalDeployedPct: config?.max_capital_deployed_pct ?? DEFAULT_CAPITAL_CONFIG.maxCapitalDeployedPct,
      maxPerTradePct:        config?.max_per_trade_pct        ?? DEFAULT_CAPITAL_CONFIG.maxPerTradePct,
    }

    const state = await getCapitalState(cfgForState).catch(() => null)

    return NextResponse.json({
      config: config ? {
        maxCapitalDeployedPct: Math.round((config.max_capital_deployed_pct ?? 0.70) * 100),
        maxPerTradePct:        Math.round((config.max_per_trade_pct        ?? 0.30) * 100),
        riskPerTradePct:       Math.round((config.risk_per_trade_pct       ?? 0.05) * 100),
        monthlyProfitTarget:   config.monthly_profit_target ?? 500,
        maxDrawdownPct:        Math.round((config.max_drawdown_pct         ?? 0.15) * 100),
        monthlyStartBalance:   config.monthly_start_balance ?? 0,
      } : null,
      state,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      maxCapitalDeployedPct?: number
      maxPerTradePct?:        number
      riskPerTradePct?:       number
      monthlyProfitTarget?:   number
      maxDrawdownPct?:        number
      monthlyStartBalance?:   number
    }

    const sb = getServerSb()
    if (!sb) return NextResponse.json({ error: 'DB not configured' }, { status: 503 })

    await sb.from('apex_capital_config').upsert({
      id:                      'default',
      ...(body.maxCapitalDeployedPct != null && { max_capital_deployed_pct: body.maxCapitalDeployedPct / 100 }),
      ...(body.maxPerTradePct        != null && { max_per_trade_pct:        body.maxPerTradePct        / 100 }),
      ...(body.riskPerTradePct       != null && { risk_per_trade_pct:       body.riskPerTradePct       / 100 }),
      ...(body.monthlyProfitTarget   != null && { monthly_profit_target:    body.monthlyProfitTarget }),
      ...(body.maxDrawdownPct        != null && { max_drawdown_pct:         body.maxDrawdownPct        / 100 }),
      ...(body.monthlyStartBalance   != null && { monthly_start_balance:    body.monthlyStartBalance }),
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
