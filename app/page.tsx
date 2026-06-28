'use client'
import { useEffect } from 'react'
import { useApexStore } from '@/store/apexStore'
import { useTheme } from '@/hooks/useTheme'
import { useMarketData } from '@/hooks/useMarketData'
import { useIndicators } from '@/hooks/useIndicators'
import { useSignalHistory } from '@/hooks/useSignalHistory'
import { useOnChain } from '@/hooks/useOnChain'
import { useNews } from '@/hooks/useNews'
import type { TabName, ThemeName } from '@/lib/types'

import Header        from '@/components/layout/Header'
import TabBar        from '@/components/layout/TabBar'
import TickerStrip   from '@/components/layout/TickerStrip'

import CandleChart   from '@/components/charts/CandleChart'
import LiqHeatmap    from '@/components/charts/LiqHeatmap'
import VPVRPanel     from '@/components/charts/VPVRPanel'

import DashboardPanel   from '@/components/panels/DashboardPanel'
import IndicatorsPanel  from '@/components/panels/IndicatorsPanel'
import OnChainPanel     from '@/components/panels/OnChainPanel'
import NewsPanel        from '@/components/panels/NewsPanel'
import TradeIdeasPanel  from '@/components/panels/TradeIdeasPanel'
import CyclePanel       from '@/components/panels/CyclePanel'
import OrderBookPanel   from '@/components/panels/OrderBookPanel'
import BacktestPanel    from '@/components/panels/BacktestPanel'
import CalculatorPanel      from '@/components/panels/CalculatorPanel'
import CompoundCalculator   from '@/components/panels/CompoundCalculator'
import PriceAlertPanel  from '@/components/panels/PriceAlertPanel'
import TradeJournal     from '@/components/panels/TradeJournal'
import SessionsPanel    from '@/components/panels/SessionsPanel'
import FundingCalcPanel from '@/components/panels/FundingCalcPanel'
import StatusPanel      from '@/components/panels/StatusPanel'
import CapitalSettings  from '@/components/panels/CapitalSettings'
import LeverageSettings from '@/components/panels/LeverageSettings'

function CapitalSettingsWithTheme() {
  const T = useTheme()
  return <CapitalSettings T={T as unknown as Record<string, string>} />
}

function LeverageSettingsWithTheme() {
  const T = useTheme()
  return <LeverageSettings T={T as unknown as Record<string, string>} />
}

function TabContent({ tab }: { tab: TabName }) {
  switch (tab) {
    case 'dashboard':  return <DashboardPanel />
    case 'chart':      return <CandleChart />
    case 'heatmap':    return <LiqHeatmap />
    case 'vpvr':       return <VPVRPanel />
    case 'indicators': return <IndicatorsPanel />
    case 'onchain':    return <OnChainPanel />
    case 'news':       return <NewsPanel />
    case 'tradeideas': return <TradeIdeasPanel />
    case 'cycle':      return <CyclePanel />
    case 'orderbook':  return <OrderBookPanel />
    case 'backtest':   return <BacktestPanel />
    case 'calc':       return <CalculatorPanel />
    case 'compound':   return <CompoundCalculator />
    case 'alerts':     return <PriceAlertPanel />
    case 'journal':    return <TradeJournal />
    case 'sessions':   return <SessionsPanel />
    case 'funding':    return <FundingCalcPanel />
    case 'capital':    return <CapitalSettingsWithTheme />
    case 'leverage':   return <LeverageSettingsWithTheme />
    case 'status':     return <StatusPanel />
    default:           return null
  }
}

export default function Page() {
  const T         = useTheme()
  const tab       = useApexStore(s => s.tab)
  const setTheme  = useApexStore(s => s.setThemeName)

  useMarketData()
  useIndicators()
  useSignalHistory()
  useOnChain()
  useNews()

  useEffect(() => {
    try {
      const saved = localStorage.getItem('apex_theme') as ThemeName | null
      if (saved) setTheme(saved)
    } catch { /* SSR guard */ }
  }, [setTheme])

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: 'inherit' }}>
      <Header />
      <TickerStrip />
      <TabBar />
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '16px 12px 40px' }}>
        <TabContent tab={tab} />
      </main>
    </div>
  )
}
