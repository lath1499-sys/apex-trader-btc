import type { MarketData, IndicatorMap, OnChainData, BTCCycle, NewsItem, AutoAlert } from './types'
import { getSession } from './cycle'

export function fmt(n: number | null | undefined, d = 2): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function fmtB(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${fmt(n)}`
}

export const TFS = ['1d', '4h', '1h', '15m'] as const
export const TF_LABELS: Record<string, string> = { '1d': '1D', '4h': '4H', '1h': '1H', '15m': '15M' }
export const TF_LIMITS: Record<string, number> = { '1d': 300, '4h': 300, '1h': 150, '15m': 150 }

export function buildContext(
  mkt: MarketData,
  inds: IndicatorMap,
  onchain: OnChainData | null,
  cycle: BTCCycle | null,
  news: NewsItem[],
): string {
  const i4 = inds['4h'], i1 = inds['1h'], i1d = inds['1d']
  function fi(i: typeof i4): string {
    if (!i) return 'N/A'
    const macdDir = i.macd.hist > 0 ? '↑' : '↓'
    const ema50Dir = mkt.price && mkt.price > i.ema.e50 ? '↑' : '↓'
    const ema200Dir = mkt.price && mkt.price > i.ema.e200 ? '↑' : '↓'
    const squeeze = i.bb.width != null && i.bb.width < 1.5 ? 'SQZ' : ''
    return `${i.bias}(${i.score}/9)RSI:${fmt(i.rsi, 0)}MACD:${macdDir}BB%B:${fmt(i.bb.pct, 0)}${squeeze}SK:${fmt(i.stoch.k, 0)}EMA50:${ema50Dir}EMA200:${ema200Dir}`
  }
  const nf = i4?.fib?.find(f => f.active)
  const lines = [
    `BTC:$${fmt(mkt.price, 0)} ${(mkt.change ?? 0) >= 0 ? '+' : ''}${fmt(mkt.change)}% Sesión:${getSession().n}`,
    `Funding:${mkt.funding != null ? (mkt.funding > 0 ? '+' : '') + fmt(mkt.funding, 4) + '%' : 'N/A'} OI:${mkt.oi ? fmtB(mkt.oi * (mkt.price ?? 0)) : 'N/A'} L/S:${mkt.lsr ? fmt(mkt.lsr, 2) : 'N/A'} F&G:${mkt.fg ?? '-'}/100`,
    `1D:${fi(i1d)} 4H:${fi(i4)} 1H:${fi(i1)}`,
    `FibActivo:${nf ? nf.label + '$' + fmt(nf.price, 0) : 'ninguno'}`,
    `OnChain:HR:${onchain?.hr ? onchain.hr + 'EH' : 'N/A'} Mem:${onchain?.mempool ?? '-'}tx Fee:${onchain?.fee ?? '-'}sat`,
    `Ciclo:${cycle?.phase ?? 'N/A'} ${cycle?.pct?.toFixed(0) ?? '-'}% MVRV:${cycle?.mvrv?.toFixed(1) ?? '-'}`,
  ]
  if (news.length) {
    const bull = news.filter(n => n.tag === 'bullish').length
    const bear = news.filter(n => n.tag === 'bearish').length
    const macro = news.filter(n => n.tag === 'macro').length
    const top3 = news.slice(0, 3).map(n => n.title?.slice(0, 60)).join(' | ')
    lines.push(`News:Bull:${bull} Bear:${bear} Macro:${macro} | ${top3}`)
  }
  return lines.join('\n')
}

export function getAutoAlerts(mkt: MarketData, inds: IndicatorMap): AutoAlert[] {
  const a: AutoAlert[] = []
  const push = (lvl: AutoAlert['lvl'], icon: string, msg: string, tf: string) =>
    a.push({ lvl, icon, msg, tf })

  if (mkt.funding != null && mkt.funding > 0.05)  push('danger', '🔴', `Funding +${fmt(mkt.funding, 4)}% — Longs sobreextendidos`, 'DERIV')
  if (mkt.funding != null && mkt.funding < -0.02) push('good',   '🟢', `Funding ${fmt(mkt.funding, 4)}% — Favorable longs`, 'DERIV')
  if (mkt.lsr != null && mkt.lsr > 1.7)           push('danger', '⚠️', `L/S ${fmt(mkt.lsr, 2)} — Exceso longs`, 'DERIV')
  if (mkt.lsr != null && mkt.lsr < 0.6)           push('good',   '⚠️', `L/S ${fmt(mkt.lsr, 2)} — Posible squeeze`, 'DERIV')
  if (mkt.fg != null && mkt.fg < 20)              push('good',   '😱', `Miedo Extremo ${mkt.fg}/100`, 'SENT')
  if (mkt.fg != null && mkt.fg > 80)              push('danger', '🤑', `Codicia Extrema ${mkt.fg}/100`, 'SENT')

  for (const tf of TFS) {
    const i = inds[tf]
    if (!i) continue
    const L = TF_LABELS[tf]
    if (i.rsi >= 72)                              push('danger', '📊', `RSI ${fmt(i.rsi, 0)} Sobrecompra ${L}`, L)
    if (i.rsi <= 28)                              push('good',   '📊', `RSI ${fmt(i.rsi, 0)} Sobreventa ${L}`, L)
    if (i.bb.width != null && i.bb.width < 1.3)  push('warn',   '⚡', `BB Squeeze ${L} — Breakout próximo`, L)
    if (i.macd.hist > 0 && i.macd.prev <= 0)     push('good',   '📈', `MACD cruzó alcista ${L}`, L)
    if (i.macd.hist < 0 && i.macd.prev >= 0)     push('danger', '📉', `MACD cruzó bajista ${L}`, L)
    if (i.stoch.k != null && i.stoch.k > 85)     push('danger', '⚡', `StochRSI K=${fmt(i.stoch.k, 0)} OB ${L}`, L)
    if (i.stoch.k != null && i.stoch.k < 15)     push('good',   '⚡', `StochRSI K=${fmt(i.stoch.k, 0)} OS ${L}`, L)
    if (i.vol.surge)                              push('warn',   '📊', `Vol spike ${fmt(i.vol.ratio, 1)}x en ${L}`, L)
  }
  return a
}
