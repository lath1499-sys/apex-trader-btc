import { NextResponse } from 'next/server'
import type { NewsItem } from '@/lib/types'

const NEWS_SOURCES = [
  { name: 'CoinTelegraph', url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fcointelegraph.com%2Frss&count=12' },
  { name: 'CoinDesk',      url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffeeds.feedburner.com%2FCoinDesk&count=10' },
  { name: 'BTC Magazine',  url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fbitcoinmagazine.com%2Ffeed&count=8' },
  { name: 'Decrypt',       url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fdecrypt.co%2Ffeed&count=8' },
  { name: 'The Block',     url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.theblock.co%2Frss.xml&count=8' },
  { name: 'Blockworks',    url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fblockworks.co%2Ffeed&count=6' },
  { name: 'NewsBTC',       url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.newsbtc.com%2Ffeed&count=6' },
] as const

interface RssItem {
  title?: string
  link?: string
  pubDate?: string
  description?: string
  content?: string
}

interface RssResponse {
  items?: RssItem[]
}

const KEYWORDS = {
  macro: ['fed','rate','inflation','cpi','fomc','treasury','dollar','dxy','gdp','recession','etf','sec','regulation','powell','interest','fiscal','bonds'],
  bullish: ['bullish','surge','rally','ath','adoption','institutional','approval','buy','accumulate','record','rise','soar','pump','inflows','breakout'],
  bearish: ['bearish','crash','dump','sell','ban','hack','lawsuit','fear','correction','drop','fall','plunge','sink','loss','outflows'],
}

function tagNews(title: string, body: string): NewsItem['tag'] {
  const text = (title + ' ' + body).toLowerCase()
  if (KEYWORDS.macro.some(k => text.includes(k)))    return 'macro'
  if (KEYWORDS.bullish.some(k => text.includes(k)))  return 'bullish'
  if (KEYWORDS.bearish.some(k => text.includes(k)))  return 'bearish'
  return 'neutral'
}

export async function GET() {
  try {
    const fetches = NEWS_SOURCES.map(src =>
      fetch(src.url, { next: { revalidate: 0 } })
        .then(r => r.json() as Promise<RssResponse>)
        .then(d => ({ ok: true, data: d, name: src.name }))
        .catch(() => ({ ok: false, data: null as RssResponse | null, name: src.name }))
    )

    const results = await Promise.allSettled(fetches)
    const all: NewsItem[] = []
    let successCount = 0

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const { ok, data, name } = result.value
      if (!ok || !data || !Array.isArray(data.items)) continue
      successCount++
      for (const item of data.items) {
        const title = item.title ?? ''
        const body  = item.description ?? item.content ?? ''
        all.push({
          title,
          url: item.link ?? '#',
          published_on: Math.floor(new Date(item.pubDate ?? Date.now()).getTime() / 1000),
          source_info: { name },
          body,
          tag: tagNews(title, body),
        })
      }
    }

    const seen = new Set<string>()
    const deduped = all.filter(n => {
      const key = n.title.slice(0, 40)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    deduped.sort((a, b) => b.published_on - a.published_on)

    return NextResponse.json({
      items: deduped.slice(0, 50),
      successCount,
      total: deduped.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
