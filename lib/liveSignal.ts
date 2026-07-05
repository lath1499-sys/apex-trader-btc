// APEX — Live P&L calculator for active signals.
// Computes unrealized P&L from current market price, not stale DB value.

export interface RawSignalRow {
  id:                string
  side:              string
  trade_type:        string
  entry:             number
  sl:                number
  tp1:               number
  tp2:               number
  tp3:               number
  status:            string
  created_at:        string
  tp1_banked_pnl?:   number | null
  total_banked_pnl?: number | null
}

export interface LiveSignalState {
  id:              string
  side:            string
  tradeType:       string
  entry:           number
  sl:              number
  tp1:             number
  tp2:             number
  tp3:             number
  status:          string
  currentPrice:    number
  pnlPct:          number
  slDistancePct:   number
  tp1DistancePct:  number
  isNearSL:        boolean
  isNearTP1:       boolean
  direction:       'profit' | 'loss' | 'breakeven'
  openSince:       string
  tp1BankedPnl:    number
  totalBankedPnl:  number
}

type BybitTicker = { result?: { list?: Array<{ lastPrice: string }> } }
type KrakenTicker = { result?: Record<string, { c: [string] }> }

async function fetchBtcSpotPrice(): Promise<number | null> {
  const safe = async <T>(url: string): Promise<T | null> => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
      return r.ok ? (r.json() as Promise<T>) : null
    } catch { return null }
  }

  const [bin, bybit, kraken] = await Promise.all([
    safe<{ price?: string }>('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
    safe<BybitTicker>('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'),
    safe<KrakenTicker>('https://api.kraken.com/0/public/Ticker?pair=XBTUSD'),
  ])

  if (bin?.price) {
    const p = parseFloat(bin.price)
    if (!isNaN(p)) return p
  }
  const bybitRow = bybit?.result?.list?.[0]
  if (bybitRow?.lastPrice) {
    const p = parseFloat(bybitRow.lastPrice)
    if (!isNaN(p)) return p
  }
  const krakenEntry = Object.values(kraken?.result ?? {})[0]
  if (krakenEntry?.c?.[0]) {
    const p = parseFloat(krakenEntry.c[0])
    if (!isNaN(p)) return p
  }
  return null
}

export async function getLiveSignalStates(signals: RawSignalRow[]): Promise<LiveSignalState[]> {
  if (!signals.length) return []
  const price = await fetchBtcSpotPrice()
  if (!price) return []

  return signals.map((sig): LiveSignalState => {
    const isLong       = sig.side === 'LONG'
    const priceDiff    = isLong ? price - sig.entry : sig.entry - price
    const pnlPct       = (priceDiff / sig.entry) * 100
    const slDist       = Math.abs(price - sig.sl)  / price * 100
    const tp1Dist      = Math.abs(price - sig.tp1) / price * 100
    const isNearSL     = slDist  < 1.0
    const isNearTP1    = tp1Dist < 1.0
    const direction: 'profit' | 'loss' | 'breakeven' =
      Math.abs(pnlPct) < 0.05 ? 'breakeven' : pnlPct > 0 ? 'profit' : 'loss'

    const openedMs  = Date.now() - new Date(sig.created_at).getTime()
    const openSince = openedMs < 3_600_000
      ? `${Math.round(openedMs / 60_000)}min`
      : openedMs < 86_400_000
      ? `${(openedMs / 3_600_000).toFixed(1)}h`
      : `${Math.floor(openedMs / 86_400_000)}d`

    return {
      id:             sig.id,
      side:           sig.side,
      tradeType:      sig.trade_type,
      entry:          sig.entry,
      sl:             sig.sl,
      tp1:            sig.tp1,
      tp2:            sig.tp2,
      tp3:            sig.tp3,
      status:         sig.status,
      currentPrice:   price,
      pnlPct:         parseFloat(pnlPct.toFixed(3)),
      slDistancePct:  parseFloat(slDist.toFixed(2)),
      tp1DistancePct: parseFloat(tp1Dist.toFixed(2)),
      isNearSL,
      isNearTP1,
      direction,
      openSince,
      tp1BankedPnl:   sig.tp1_banked_pnl  ?? 0,
      totalBankedPnl: sig.total_banked_pnl ?? 0,
    }
  })
}

export function formatLiveSignal(live: LiveSignalState): string {
  const emoji    = live.side === 'LONG' ? '🟢' : '🔴'
  const pnlEmoji = live.pnlPct > 0 ? '📈' : live.pnlPct < 0 ? '📉' : '➡️'
  const pnlStr   = `${live.pnlPct >= 0 ? '+' : ''}${live.pnlPct.toFixed(2)}%`
  const slWarn   = live.isNearSL  ? '  ⚠️ CERCA DEL SL'  : ''
  const tp1Warn  = live.isNearTP1 ? '  🎯 CERCA DE TP1' : ''
  const banked   = live.tp1BankedPnl > 0
    ? `\n💰 Banqueado en TP1: +${live.tp1BankedPnl.toFixed(2)}%`
    : ''
  const statusLabel =
    live.status === 'tp1_hit' ? '✅ TP1 tocado — SL en breakeven' :
    live.status === 'tp2_hit' ? '✅✅ TP2 tocado — SL en TP1'    :
    'Activa'

  return [
    `${emoji} <b>${live.side} ${live.tradeType}</b> — ${statusLabel}`,
    ``,
    `Entry:  <code>$${Math.round(live.entry).toLocaleString()}</code>`,
    `Precio: <code>$${Math.round(live.currentPrice).toLocaleString()}</code>`,
    `SL:     <code>$${Math.round(live.sl).toLocaleString()}</code>${slWarn}`,
    `TP1:    <code>$${Math.round(live.tp1).toLocaleString()}</code>${tp1Warn}`,
    ``,
    `${pnlEmoji} P&amp;L live: <b>${pnlStr}</b>${banked}`,
    `SL a ${live.slDistancePct.toFixed(2)}% | TP1 a ${live.tp1DistancePct.toFixed(2)}% | Abierto: ${live.openSince}`,
  ].join('\n')
}
