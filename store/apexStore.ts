import { create } from 'zustand'
import type {
  MarketData, IndicatorMap, OnChainData, NewsItem, AutoAlert,
  BTCCycle, OrderBook, TradeIdea, Divergence, ChatMessage,
  ConnectionStatus, TabName, ThemeName, SignalRecord,
} from '@/lib/types'
import type { Kline } from '@/lib/types'
import type { ElliottWaveResult } from '@/lib/elliottWaves'
import type { FVGResult } from '@/lib/fvg'
import type { LiquidityResult } from '@/lib/liquidity'
import type { ScalpSignal, VWAPResult, CVDResult, ICTKillzone, BOSCHoCHResult } from '@/lib/scalpSignals'

type RawKlines = Partial<Record<string, Kline[]>>

interface ApexState {
  // Theme
  themeName: ThemeName
  setThemeName: (name: ThemeName) => void

  // Navigation
  tab: TabName
  setTab: (tab: TabName) => void
  chartTf: string
  setChartTf: (tf: string) => void

  // Market data
  mkt: MarketData
  setMkt: (mkt: MarketData) => void
  rawK: RawKlines
  setRawK: (rawK: RawKlines) => void
  inds: IndicatorMap
  setInds: (inds: IndicatorMap) => void
  orderBook: OrderBook | null
  setOrderBook: (ob: OrderBook | null) => void

  // Derived data
  onchain: OnChainData | null
  setOnchain: (data: OnChainData | null) => void
  news: NewsItem[]
  setNews: (news: NewsItem[]) => void
  cycle: BTCCycle | null
  setCycle: (cycle: BTCCycle | null) => void
  alerts: AutoAlert[]
  setAlerts: (alerts: AutoAlert[]) => void
  tradeIdea: TradeIdea | null
  setTradeIdea: (idea: TradeIdea | null) => void
  tradeHistory: TradeIdea[]
  pushTradeIdea: (idea: TradeIdea) => void
  divergences: Divergence[]
  setDivergences: (divs: Divergence[]) => void
  elliottWaves: Partial<Record<string, ElliottWaveResult>>
  setElliottWaves: (ew: Partial<Record<string, ElliottWaveResult>>) => void
  fvgs: Partial<Record<string, FVGResult>>
  setFvgs: (fvgs: Partial<Record<string, FVGResult>>) => void
  liquidity: LiquidityResult | null
  setLiquidity: (liq: LiquidityResult) => void
  conn: ConnectionStatus
  setConn: (patch: Partial<ConnectionStatus>) => void
  biasMeta: Partial<Record<string, { changedAt: number | null; prevBias: string | null }>>
  setBiasMeta: (meta: Partial<Record<string, { changedAt: number | null; prevBias: string | null }>>) => void

  // Signal history with P&L tracking
  signalHistory: SignalRecord[]
  setSignalHistory: (recs: SignalRecord[] | ((prev: SignalRecord[]) => SignalRecord[])) => void

  // Chat history (read-only display, no longer editable via UI)
  chatMessages: ChatMessage[]
  addChatMessage: (msg: ChatMessage) => void

  // Notifications
  notifPerm: NotificationPermission
  setNotifPerm: (p: NotificationPermission) => void

  // Scalp mode
  scalpMode: boolean
  setScalpMode: (v: boolean) => void
  scalpSignal: ScalpSignal | null
  setScalpSignal: (s: ScalpSignal | null) => void
  scalpHistory: ScalpSignal[]
  pushScalpHistory: (s: ScalpSignal) => void
  clearScalpHistory: () => void
  vwap: VWAPResult | null
  setVwap: (v: VWAPResult | null) => void
  cvdData: CVDResult | null
  setCvdData: (v: CVDResult | null) => void
  bosChoch: BOSCHoCHResult
  setBosChoch: (v: BOSCHoCHResult) => void
  killzones: ICTKillzone[]
  setKillzones: (v: ICTKillzone[]) => void
}

export const useApexStore = create<ApexState>((set) => ({
  themeName: 'terminal',
  setThemeName: (themeName) => set({ themeName }),

  tab: 'dashboard',
  setTab: (tab) => set({ tab }),
  chartTf: '4h',
  setChartTf: (chartTf) => set({ chartTf }),

  mkt: { loading: true },
  setMkt: (mkt) => set({ mkt }),
  rawK: {},
  setRawK: (rawK) => set({ rawK }),
  inds: {},
  setInds: (inds) => set({ inds }),
  orderBook: null,
  setOrderBook: (orderBook) => set({ orderBook }),

  onchain: null,
  setOnchain: (onchain) => set({ onchain }),
  news: [],
  setNews: (news) => set({ news }),
  cycle: null,
  setCycle: (cycle) => set({ cycle }),
  alerts: [],
  setAlerts: (alerts) => set({ alerts }),
  tradeIdea: null,
  setTradeIdea: (tradeIdea) => set({ tradeIdea }),
  tradeHistory: [],
  pushTradeIdea: (idea) => set((s) => ({
    tradeIdea: idea,
    tradeHistory: [idea, ...s.tradeHistory].slice(0, 50),
  })),
  divergences: [],
  setDivergences: (divergences) => set({ divergences }),
  elliottWaves: {},
  setElliottWaves: (elliottWaves) => set({ elliottWaves }),
  fvgs: {},
  setFvgs: (fvgs) => set({ fvgs }),
  liquidity: null,
  setLiquidity: (liquidity) => set({ liquidity }),
  conn: {},
  setConn: (patch) => set((s) => ({ conn: { ...s.conn, ...patch } })),
  biasMeta: {},
  setBiasMeta: (biasMeta) => set({ biasMeta }),

  signalHistory: [],
  setSignalHistory: (arg) => set(state => ({
    signalHistory: typeof arg === 'function' ? arg(state.signalHistory) : arg,
  })),

  chatMessages: [],
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

  notifPerm: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  setNotifPerm: (notifPerm) => set({ notifPerm }),

  scalpMode: false,
  setScalpMode: (scalpMode) => set({ scalpMode }),
  scalpSignal: null,
  setScalpSignal: (scalpSignal) => set({ scalpSignal }),
  scalpHistory: (() => {
    try { return JSON.parse(localStorage.getItem('apex_scalp_history') ?? '[]') as ScalpSignal[] }
    catch { return [] }
  })(),
  pushScalpHistory: (s) => set(st => {
    // Deduplicate by id, keep latest 50
    const next = [s, ...st.scalpHistory.filter(x => x.id !== s.id)].slice(0, 50)
    try { localStorage.setItem('apex_scalp_history', JSON.stringify(next)) } catch {}
    return { scalpHistory: next }
  }),
  clearScalpHistory: () => {
    try { localStorage.removeItem('apex_scalp_history') } catch {}
    set({ scalpHistory: [] })
  },
  vwap: null,
  setVwap: (vwap) => set({ vwap }),
  cvdData: null,
  setCvdData: (cvdData) => set({ cvdData }),
  bosChoch: { bos: [], choch: [] },
  setBosChoch: (bosChoch) => set({ bosChoch }),
  killzones: [],
  setKillzones: (killzones) => set({ killzones }),
}))
