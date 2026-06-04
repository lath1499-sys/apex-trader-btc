export type Timeframe = '1d' | '4h' | '1h' | '15m'

export type TabName =
  | 'dashboard' | 'chart' | 'cycle' | 'indicators' | 'vpvr'
  | 'orderbook' | 'heatmap' | 'onchain' | 'news'
  | 'tradeideas' | 'backtest' | 'calc' | 'alerts'
  | 'journal' | 'sessions' | 'funding' | 'status'

export type ThemeName = 'terminal' | 'white' | 'midnight' | 'amber' | 'tradingview'

export interface Theme {
  bg: string; card: string; border: string; text: string; textSec: string
  accent: string; danger: string; warn: string; price: string; muted: string
  bull: string; bear: string
}

export interface Kline {
  t: number; o: number; h: number; l: number; c: number; v: number
}

export interface FibLevel {
  level: number; price: number; label: string; isExt: boolean; active: boolean
}

export interface IndicatorResult {
  close: number
  rsi: number
  macd: { line: number; signal: number; hist: number; prev: number }
  bb: { upper: number | null; mid: number | null; lower: number | null; width: number | null; pct: number | null }
  atr: number
  stoch: { k: number | null; d: number | null }
  ema: { e9: number; e21: number; e50: number; e100: number; e200: number }
  fib: FibLevel[]
  vol: { avg: number; last: number; ratio: number; surge: boolean }
  score: number
  bias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL'
  prevRsi: number
  klines: Kline[]
}

export type IndicatorMap = Partial<Record<Timeframe, IndicatorResult>>

export interface MarketData {
  loading: boolean
  price?: number; change?: number; high?: number; low?: number; vol?: number
  funding?: number; mark?: number; index?: number; oi?: number
  lsr?: number; longPct?: number; shortPct?: number
  fg?: number; fgLabel?: string
  bybitPrice?: number; krakenPrice?: number
  ts?: Date
}

export interface RecentBlock {
  height?: number; tx_count?: number; size?: number; timestamp?: number
}

export interface OnChainData {
  hr: number | null; diffAdj: number | null; height: number | null
  mempool: number | undefined; fee: number | undefined
  feeMid: number | undefined; feeHour: number | undefined
  recentBlocks: RecentBlock[]
}

export interface NewsItem {
  title: string; url: string; published_on: number
  source_info: { name: string }; body: string
  tag?: 'bullish' | 'bearish' | 'macro' | 'neutral'
}

export type TradeType = 'Scalp' | 'DayTrade' | 'Swing'

export interface TradeReason { s: 'bull' | 'bear'; txt: string }

export interface TradeIdea {
  side: 'LONG' | 'SHORT'; tradeType: TradeType
  confidence: 'ALTA' | 'MEDIA' | 'BAJA'
  bull: number; bear: number; maxSc: number
  reasons: TradeReason[]; price: number; maxLev: number
  sl: number; tp1: number; tp2: number; tp3: number; ts: Date
  analysis: string
  consolidation?: true
  // Intelligence upgrade fields
  score?: number
  regime?: string
  regimeDescription?: string
  winProbability?: number
  expectedValue?: number
  kellyCriterion?: number
  probabilityCI?: [number, number]
  probabilityFactors?: Array<{ name: string; contribution: number; direction: '+' | '-' }>
  suggestedRiskPct?: number
  ruinProbability?: number
  confluenceScore?:  number
  isCounterTrend?:   boolean
}

export interface AutoAlert {
  lvl: 'danger' | 'good' | 'warn'; icon: string; msg: string; tf: string
}

export interface BTCCycle {
  phase: string; col: string; pct: number; days: number; toNext: number; mvrv: number
}

export interface Session { n: string; s: number; e: number; c: string }

export interface Divergence {
  type: 'bullish' | 'bearish'; ind: string; desc: string
}

export interface OrderBook {
  bids: [string, string][]; asks: [string, string][]
}

export interface VPVRProfile { pl: number; ph: number; vol: number }

export interface VPVRData {
  prof: VPVRProfile[]; poc: VPVRProfile
  vah: number; val: number; maxV: number; mn: number; mx: number
}

export interface BacktestTrade {
  side: 'long' | 'short'; entry: number; atr: number
  exit: number; result: 'sl' | 'tp' | 'open'; pnl: number
}

export interface BacktestStats {
  total: number; wins: number; wr: number; totPnl: number
  avgW: number; avgL: number; mdd: number; pf: number
}

export type StrategyType = 'ema' | 'rsi' | 'bb' | 'macd' | 'stoch' | 'ema_rsi' | 'triple'

export interface Strategy {
  id: string; name: string; type: StrategyType
  p: Record<string, number | boolean>
  stats?: BacktestStats; trades?: BacktestTrade[]
}

export type SignalStatus =
  | 'active' | 'pending_confirmation'
  | 'tp1_hit' | 'tp2_hit' | 'tp3_hit'
  | 'sl_hit' | 'breakeven' | 'closed_manual'

export interface SignalRecord {
  id: string
  createdAt: string          // ISO string
  idea: TradeIdea
  status: SignalStatus
  exitPrice: number | null
  exitTs: string | null      // ISO string
  pnlR: number | null        // P&L in risk units (R)
  pnl: number | null         // P&L in %
  closedAt: string | null
  closeReason: string | null
  // Scalp-specific metadata (optional)
  isScalp?: boolean
  killzone?: string
  cvdSignal?: string
  bosChoch?: string
  vwapRelation?: string
  // Partial TP tracking — signal stays active after TP1/TP2
  tp1Hit?: boolean
  tp2Hit?: boolean
  // One-time NTFY flag — prevents re-firing on every agent run
  ntfySent?: boolean
  // Warning flags — prevent duplicate NTFY spam
  slWarningFired?:    boolean
  expiryWarningFired?: boolean
}

export interface ChatMessage { role: 'user' | 'assistant'; text: string }

export interface ConnectionStatus {
  binanceSpot?: boolean; binanceFut?: boolean; fg?: boolean
  onchain?: boolean; news?: boolean; newsCount?: number
  ts?: Date; [key: string]: boolean | number | Date | undefined
}
