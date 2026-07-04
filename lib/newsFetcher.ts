// APEX — BTC News Fetcher
// 15+ free sources: RSS feeds, public APIs, on-chain signals.
// No API keys required. 8-min cache. Promise.allSettled — one failure = continue.

const NEWS_CACHE_TTL = 8 * 60 * 1000   // 8 minutes
let newsCache: NewsSnapshot | null = null
let newsCachedAt = 0

export interface NewsItem {
  title:       string
  url:         string
  source:      string
  category:    'news' | 'onchain' | 'macro' | 'social' | 'whale'
  publishedAt: string
  ageMinutes:  number
  sentiment:   'bullish' | 'bearish' | 'neutral'
  impact:      'critical' | 'high' | 'medium' | 'low'
  summary:     string
  tags:        string[]
}

export interface NewsSnapshot {
  items:          NewsItem[]
  sentiment:      { bullish: number; bearish: number; neutral: number }
  sentimentScore: number    // 0-100, 50 = neutral
  criticalAlerts: NewsItem[]
  fetchedAt:      string
  sourcesHit:     string[]
  sourcesFailed:  string[]
}

// ─── RSS FEED LIST ────────────────────────────────────────
interface FeedDef { url: string; source: string; category: NewsItem['category'] }

const RSS_FEEDS: FeedDef[] = [
  { url: 'https://cointelegraph.com/rss/tag/bitcoin',        source: 'CoinTelegraph',   category: 'news' },
  { url: 'https://coindesk.com/arc/outboundfeeds/rss/',       source: 'CoinDesk',        category: 'news' },
  { url: 'https://decrypt.co/feed',                           source: 'Decrypt',         category: 'news' },
  { url: 'https://theblock.co/rss.xml',                       source: 'The Block',       category: 'news' },
  { url: 'https://news.bitcoin.com/feed',                     source: 'Bitcoin.com',     category: 'news' },
  { url: 'https://bitcoinist.com/feed',                       source: 'Bitcoinist',      category: 'news' },
  { url: 'https://cryptoslate.com/feed',                      source: 'CryptoSlate',     category: 'news' },
  { url: 'https://cryptopotato.com/feed',                     source: 'CryptoPotato',    category: 'news' },
  { url: 'https://ambcrypto.com/feed',                        source: 'AMBCrypto',       category: 'news' },
  { url: 'https://bitcoinmagazine.com/.rss/full',             source: 'Bitcoin Magazine', category: 'news' },
  { url: 'https://finance.yahoo.com/rss/topstories',          source: 'Yahoo Finance',   category: 'macro' },
]

// ─── RSS XML PARSER ───────────────────────────────────────
function parseRSSXML(xml: string, sourceName: string, category: NewsItem['category'], limit = 5): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi
  const matches   = Array.from(xml.matchAll(itemRegex)).slice(0, limit)

  for (const match of matches) {
    const content = match[1]

    const titleMatch = content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    const rawTitle   = (titleMatch?.[1] ?? '').trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    if (!rawTitle || rawTitle.length < 10) continue

    const linkMatch = content.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>|<link\s+[^>]*href="([^"]+)"/i)
    const url       = ((linkMatch?.[1] ?? linkMatch?.[2] ?? '').trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''))

    const dateMatch   = content.match(/<pubDate>(.*?)<\/pubDate>|<published>(.*?)<\/published>|<updated>(.*?)<\/updated>/i)
    const rawDate     = dateMatch?.[1] ?? dateMatch?.[2] ?? dateMatch?.[3] ?? ''
    let   publishedAt = new Date().toISOString()
    let   ageMinutes  = 0

    if (rawDate) {
      const parsed = new Date(rawDate)
      if (!isNaN(parsed.getTime())) {
        publishedAt = parsed.toISOString()
        ageMinutes  = Math.floor((Date.now() - parsed.getTime()) / 60_000)
        if (ageMinutes > 360) continue  // skip articles older than 6 hours
      }
    }

    const lower     = rawTitle.toLowerCase()
    const tags      = extractTags(lower)
    const sentiment = detectSentiment(lower, tags)
    const impact    = detectImpact(lower, tags)

    const btcKeywords = ['bitcoin', 'btc', 'crypto', 'blockchain', 'fed', 'cpi', 'etf', 'sec', 'whale', 'exchange', 'binance', 'coinbase', 'inflation', 'halving']
    if (!btcKeywords.some(k => lower.includes(k))) continue

    items.push({ title: rawTitle, url, source: sourceName, category, publishedAt, ageMinutes, sentiment, impact, summary: rawTitle, tags })
  }
  return items
}

// ─── FREE API DATA SOURCES ────────────────────────────────
async function fetchFearGreedItem(): Promise<NewsItem[]> {
  try {
    const res  = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ value: string; value_classification: string }> }
    const cur  = data.data?.[0]
    if (!cur) return []
    const fng     = parseInt(cur.value)
    const label   = cur.value_classification
    const sent: NewsItem['sentiment'] = fng < 30 ? 'bearish' : fng > 70 ? 'bullish' : 'neutral'
    const imp: NewsItem['impact']     = (fng < 20 || fng > 80) ? 'high' : 'medium'
    return [{
      title: `Fear & Greed Index: ${fng}/100 — ${label}`,
      url: 'https://alternative.me/crypto/fear-and-greed-index/', source: 'Alternative.me',
      category: 'social', publishedAt: new Date().toISOString(), ageMinutes: 0,
      sentiment: sent, impact: imp,
      summary: `Sentimiento del mercado: ${fng}/100 (${label})`, tags: ['sentiment'],
    }]
  } catch { return [] }
}

async function fetchBinanceFundingItem(): Promise<NewsItem[]> {
  try {
    const res  = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = await res.json() as { lastFundingRate?: string }
    const rate = parseFloat(data.lastFundingRate ?? '0') * 100
    if (Math.abs(rate) < 0.04) return []
    const sent: NewsItem['sentiment'] = rate > 0.05 ? 'bearish' : rate < -0.05 ? 'bullish' : 'neutral'
    const imp: NewsItem['impact']     = Math.abs(rate) > 0.1 ? 'high' : 'medium'
    return [{
      title: `Funding Rate BTC: ${rate.toFixed(4)}% — ${rate > 0 ? 'longs pagando (bajista)' : 'shorts pagando (alcista)'}`,
      url: 'https://www.binance.com/futures/BTCUSDT', source: 'Binance Futures',
      category: 'onchain', publishedAt: new Date().toISOString(), ageMinutes: 0,
      sentiment: sent, impact: imp,
      summary: `Funding ${rate > 0 ? 'positivo' : 'negativo'} — presión ${rate > 0 ? 'bajista' : 'alcista'}`, tags: ['funding', 'derivatives'],
    }]
  } catch { return [] }
}

async function fetchCryptoCompareNews(): Promise<NewsItem[]> {
  try {
    const res  = await fetch(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC&sortOrder=latest',
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const data = await res.json() as { Data?: Array<{ title: string; url: string; source: string; published_on: number; body?: string; tags?: string }> }
    return (data.Data ?? [])
      .filter(item => {
        const age = Date.now() - item.published_on * 1000
        return age < 4 * 60 * 60 * 1000
      })
      .slice(0, 8)
      .map(item => {
        const lower    = item.title.toLowerCase()
        const tags     = extractTags(lower)
        const sentiment = detectSentiment(lower, tags)
        const impact    = detectImpact(lower, tags)
        return {
          title: item.title, url: item.url, source: item.source,
          category: 'news' as const,
          publishedAt: new Date(item.published_on * 1000).toISOString(),
          ageMinutes:  Math.floor((Date.now() - item.published_on * 1000) / 60_000),
          sentiment, impact, summary: item.title, tags,
        }
      })
  } catch { return [] }
}

// ─── SENTIMENT & IMPACT DETECTION ────────────────────────
function detectSentiment(text: string, tags: string[]): NewsItem['sentiment'] {
  const bullish = ['surge', 'pump', 'rally', 'bull', 'rise', 'gain', 'recovery', 'inflow', 'breakout', 'support', 'adoption', 'ath', 'outflow']
  const bearish  = ['crash', 'dump', 'bear', 'fall', 'drop', 'loss', 'sell', 'ban', 'hack', 'exploit', 'liquidat', 'regulation', 'warning', 'correction', 'breakdown', 'inflow.*exchange']
  const combined = text + ' ' + tags.join(' ')
  const bull = bullish.filter(k => new RegExp(k).test(combined)).length
  const bear = bearish.filter(k => new RegExp(k).test(combined)).length
  if (bear > bull) return 'bearish'
  if (bull > bear) return 'bullish'
  return 'neutral'
}

function detectImpact(text: string, tags: string[]): NewsItem['impact'] {
  const critical = ['hack', 'exploit', 'crash.*%', 'sec.*bitcoin', 'ban.*bitcoin', 'etf.*approved', 'emergency']
  const high     = ['whale', 'billion', 'blackrock', 'fidelity', 'federal.*reserve', 'cpi', 'rate.*decision', 'regulation', 'liquidat', 'etf']
  const medium   = ['institutional', 'adoption', 'upgrade', 'partnership']
  const combined = text + ' ' + tags.join(' ')
  if (critical.some(k => new RegExp(k).test(combined))) return 'critical'
  if (high.some(k => new RegExp(k).test(combined)))     return 'high'
  if (medium.some(k => new RegExp(k).test(combined)))   return 'medium'
  return 'low'
}

function extractTags(text: string): string[] {
  const tagMap: Record<string, string> = {
    whale:       'whale',
    exchange:    'exchange',
    etf:         'etf',
    sec:         'regulation',
    fed:         'macro',
    cpi:         'macro',
    inflation:   'macro',
    blackrock:   'institutional',
    liquidat:    'liquidations',
    funding:     'derivatives',
    hack:        'security',
    halving:     'supply',
  }
  return Object.entries(tagMap)
    .filter(([k]) => new RegExp(k).test(text))
    .map(([, v]) => v)
}

// ─── MAIN FETCH FUNCTION ──────────────────────────────────
export async function fetchBTCNews(): Promise<NewsSnapshot> {
  if (newsCache && Date.now() - newsCachedAt < NEWS_CACHE_TTL) return newsCache

  const sourcesHit:    string[] = []
  const sourcesFailed: string[] = []
  let   allItems:      NewsItem[] = []

  // RSS feeds in parallel
  const rssResults = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const xml   = await res.text()
      const items = parseRSSXML(xml, feed.source, feed.category, 5)
      if (items.length) sourcesHit.push(feed.source)
      return items
    })
  )

  RSS_FEEDS.forEach((feed, i) => {
    const r = rssResults[i]
    if (r.status === 'fulfilled') allItems.push(...r.value)
    else sourcesFailed.push(`${feed.source}: ${(r.reason as Error).message}`)
  })

  // Free API sources in parallel
  const [fngR, fundingR, ccR] = await Promise.allSettled([
    fetchFearGreedItem(),
    fetchBinanceFundingItem(),
    fetchCryptoCompareNews(),
  ])

  const apiNames = ['Alternative.me', 'Binance Futures', 'CryptoCompare']
  const apiResults = [fngR, fundingR, ccR]
  apiResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) {
      allItems.push(...r.value)
      if (!sourcesHit.includes(apiNames[i])) sourcesHit.push(apiNames[i])
    } else if (r.status === 'rejected') {
      sourcesFailed.push(apiNames[i])
    }
  })

  // Deduplicate by title prefix
  const seen    = new Set<string>()
  const deduped = allItems.filter(item => {
    const key = item.title.slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort: critical → high → medium → low, then by age
  const scoreMap: Record<NewsItem['impact'], number> = { critical: 4, high: 3, medium: 2, low: 1 }
  const sorted = deduped.sort((a, b) => {
    const impDiff = scoreMap[b.impact] - scoreMap[a.impact]
    return impDiff !== 0 ? impDiff : a.ageMinutes - b.ageMinutes
  })

  const sentiment = sorted.reduce(
    (acc, item) => { acc[item.sentiment]++; return acc },
    { bullish: 0, bearish: 0, neutral: 0 }
  )
  const total         = sentiment.bullish + sentiment.bearish + sentiment.neutral
  const sentimentScore = total > 0 ? Math.round((sentiment.bullish / total) * 100) : 50

  const snapshot: NewsSnapshot = {
    items:          sorted.slice(0, 20),
    sentiment,
    sentimentScore,
    criticalAlerts: sorted.filter(n => n.impact === 'critical'),
    fetchedAt:      new Date().toISOString(),
    sourcesHit,
    sourcesFailed,
  }

  newsCache    = snapshot
  newsCachedAt = Date.now()
  console.log(`[NEWS] ${sorted.length} items from ${sourcesHit.length} sources. Sentiment: ${sentimentScore}/100`)
  return snapshot
}

// ─── FORMAT FOR AI PROMPT ────────────────────────────────
export function formatNewsForPrompt(snapshot: NewsSnapshot): string {
  const { items, sentimentScore, criticalAlerts } = snapshot
  if (!items.length) return 'Sin noticias BTC recientes disponibles.'

  const lines: string[] = []

  if (criticalAlerts.length) {
    lines.push('🚨 ALERTAS CRÍTICAS:')
    criticalAlerts.slice(0, 2).forEach(n => {
      const sent = n.sentiment === 'bullish' ? '📈' : n.sentiment === 'bearish' ? '📉' : '📰'
      lines.push(`  ${sent} [${n.source}] ${n.title}`)
    })
    lines.push('')
  }

  const highItems = items.filter(n => n.impact === 'high').slice(0, 4)
  if (highItems.length) {
    lines.push('📰 Noticias de alto impacto:')
    highItems.forEach(n => {
      const sent = n.sentiment === 'bullish' ? '📈' : n.sentiment === 'bearish' ? '📉' : '📰'
      lines.push(`  ${sent} ${n.title.slice(0, 90)} [${n.source}]`)
    })
  }

  const medItems = items.filter(n => n.impact === 'medium' && n.ageMinutes < 120).slice(0, 3)
  if (medItems.length) {
    lines.push('📋 Recientes:')
    medItems.forEach(n => lines.push(`  • ${n.title.slice(0, 80)} [${n.source}]`))
  }

  lines.push(`📊 Sentimiento noticias: ${sentimentScore}/100 (${snapshot.sentiment.bullish} alcistas / ${snapshot.sentiment.bearish} bajistas) | ${snapshot.sourcesHit.length} fuentes activas`)
  return lines.join('\n')
}

// ─── FORMAT FOR TELEGRAM /news COMMAND ───────────────────
export function formatNewsForTelegram(snapshot: NewsSnapshot): string {
  const { items, sentimentScore, criticalAlerts, sourcesHit } = snapshot
  const timeStr = new Date().toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit' })

  let msg = `📰 <b>Noticias BTC — ${timeStr}</b>\n`
  msg    += `📊 Sentimiento: <b>${sentimentScore}/100</b> | ${sourcesHit.length} fuentes\n\n`

  if (criticalAlerts.length) {
    msg += `🚨 <b>ALERTAS CRÍTICAS:</b>\n`
    criticalAlerts.slice(0, 2).forEach(n => {
      const sent = n.sentiment === 'bullish' ? '📈' : '📉'
      const link = n.url ? ` <a href="${n.url}">🔗</a>` : ''
      msg += `${sent} <b>${n.source}</b>\n${n.title.slice(0, 80)}${link}\n\n`
    })
  }

  const byCategory: Record<string, { emoji: string; label: string; items: NewsItem[] }> = {
    onchain: { emoji: '⛓️', label: 'On-Chain',   items: [] },
    macro:   { emoji: '🏦', label: 'Macro',       items: [] },
    news:    { emoji: '📰', label: 'Noticias',    items: [] },
    social:  { emoji: '👥', label: 'Sentimiento', items: [] },
    whale:   { emoji: '🐋', label: 'Ballenas',    items: [] },
  }

  items.filter(n => n.impact !== 'low' && n.ageMinutes < 240).forEach(n => {
    const cat = n.category
    if (byCategory[cat]) byCategory[cat].items.push(n)
  })

  for (const [, group] of Object.entries(byCategory)) {
    if (!group.items.length) continue
    msg += `${group.emoji} <b>${group.label}:</b>\n`
    group.items.slice(0, 3).forEach(n => {
      const sent   = n.sentiment === 'bullish' ? '📈' : n.sentiment === 'bearish' ? '📉' : '📰'
      const ageStr = n.ageMinutes < 60 ? `${n.ageMinutes}m` : `${Math.floor(n.ageMinutes / 60)}h`
      const link   = n.url ? ` <a href="${n.url}">🔗</a>` : ''
      msg += `${sent} ${n.title.slice(0, 70)}${n.title.length > 70 ? '…' : ''} [${ageStr}]${link}\n`
    })
    msg += '\n'
  }

  return msg
}
