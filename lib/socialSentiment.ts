// APEX — LunarCrush Social Sentiment
// Fetches BTC social metrics (galaxy score, alt rank, sentiment %) from
// LunarCrush v4 API and converts them into a trading signal.
//
// Requires: LUNARCRUSH_API_KEY in .env.local / Vercel env vars
// Free tier: 10 calls/minute — called once per agent run (every 5–15 min) ✓

const BASE = 'https://lunarcrush.com/api4/public'
const TIMEOUT_MS = 8_000

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialSentiment {
  galaxyScore:      number   // 0–100  (higher = more positive social energy)
  altRank:          number   // 1–N    (lower = BTC dominating social vs mkt cap)
  socialVolume24h:  number   // raw social post/mention count
  socialDominance:  number   // % of all crypto social volume that is BTC
  bullishPercent:   number   // 0–100
  bearishPercent:   number   // 0–100
  sentimentScore:   number   // -100 to +100 (derived from bullish%)
  signal:           'BULLISH' | 'BEARISH' | 'NEUTRAL'
  btcImpact:        string   // human-readable summary
  source:           'lunarcrush' | 'unavailable'
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSocialSentiment(): Promise<SocialSentiment | null> {
  const key = process.env.LUNARCRUSH_API_KEY
  if (!key) return null

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    const res = await fetch(`${BASE}/coins/btc/v1`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: { revalidate: 300 } as any,   // cache 5 min on Vercel edge
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(`[APEX Social] LunarCrush ${res.status}: ${res.statusText}`)
      return null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as { data?: Record<string, any> }
    const d    = json?.data
    if (!d) return null

    // Field names differ slightly between v4 response variants — handle both
    const galaxyScore     = Number(d.galaxy_score     ?? d.galaxyScore     ?? 50)
    const altRank         = Number(d.alt_rank         ?? d.altRank         ?? 50)
    const socialVolume24h = Number(d.social_volume    ?? d.social_volume_24h ?? d.socialVolume24h ?? 0)
    const socialDominance = Number(d.social_dominance ?? d.socialDominance ?? 0)

    // LunarCrush v4 returns `sentiment` as bullish % (0–100)
    const rawSentiment  = Number(d.sentiment ?? 50)
    const bullishPercent = Math.min(100, Math.max(0, rawSentiment))
    const bearishPercent = 100 - bullishPercent
    // Normalise to -100…+100 (50% bullish = 0)
    const sentimentScore = Math.round((bullishPercent - 50) * 2)

    const signal: SocialSentiment['signal'] =
      galaxyScore >= 65 && sentimentScore > 20  ? 'BULLISH' :
      galaxyScore <= 35 || sentimentScore < -20 ? 'BEARISH' :
      'NEUTRAL'

    const btcImpact = buildImpact(galaxyScore, altRank, sentimentScore, socialDominance)

    return {
      galaxyScore, altRank, socialVolume24h, socialDominance,
      bullishPercent, bearishPercent, sentimentScore,
      signal, btcImpact, source: 'lunarcrush',
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      console.warn('[APEX Social] fetch error:', err)
    }
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable impact string
// ─────────────────────────────────────────────────────────────────────────────

function buildImpact(
  gs: number, ar: number, sentiment: number, dom: number,
): string {
  const gsPart = gs >= 65 ? `Galaxy Score ${gs}/100 — alta energía social (alcista)`
    : gs <= 35              ? `Galaxy Score ${gs}/100 — energía social baja (bajista)`
    :                         `Galaxy Score ${gs}/100 — sentimiento neutro`

  const sentPart = sentiment > 30  ? `sentimiento ${Math.abs(sentiment)}% alcista`
    : sentiment < -30               ? `sentimiento ${Math.abs(sentiment)}% bajista`
    :                                 `sentimiento equilibrado`

  const domPart = dom > 30 ? `BTC domina ${dom.toFixed(1)}% del volumen social cripto`
    : dom < 15               ? `BTC con baja dominancia social (${dom.toFixed(1)}%)`
    :                          `dominancia social BTC normal (${dom.toFixed(1)}%)`

  const arPart = ar <= 10 ? ` · Alt Rank #${ar} (muy alta actividad relativa)`
    : ar <= 30              ? ` · Alt Rank #${ar}`
    :                         ''

  return `${gsPart} · ${sentPart} · ${domPart}${arPart}`
}
