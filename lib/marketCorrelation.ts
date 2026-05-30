// APEX — Global Markets Correlation
// Fetches SPX, DXY, and Gold data from Yahoo Finance v8 (free, no key needed)
// Used to detect risk-off / risk-on environments and adjust BTC signal generation.

export interface GlobalMarkets {
  spx:    { price: number; change1h: number; change1d: number; trend: 'up' | 'down' | 'flat' }
  dxy:    { value: number; change1d: number; strength: 'FUERTE' | 'DEBIL' | 'NEUTRAL' }
  gold:   { price: number; change1d: number }
  riskOff: boolean   // stocks fall + DXY rises → bad for BTC
  riskOn:  boolean   // stocks rise + DXY falls → good for BTC
  btcCorrelation: string
  signalImpact: 'BLOCK_LONGS' | 'BLOCK_SHORTS' | 'NEUTRAL' | 'BOOST_LONGS' | 'BOOST_SHORTS'
}

interface YahooQuote {
  close: (number | null)[]
}

interface YahooChartResult {
  indicators?: { quote?: YahooQuote[] }
}

interface YahooResponse {
  chart?: { result?: YahooChartResult[] }
}

function parseSymbol(r: PromiseSettledResult<YahooResponse>): {
  price: number; change1h: number; change1d: number
} | null {
  if (r.status !== 'fulfilled') return null
  const chart = r.value?.chart?.result?.[0]
  if (!chart) return null
  const closes = chart.indicators?.quote?.[0]?.close ?? []
  const valid  = closes.filter((c): c is number => c != null)
  if (!valid.length) return null
  const last   = valid[valid.length - 1]
  const prev1h = valid[valid.length - 2] ?? last
  const prev1d = valid[valid.length - 25] ?? valid[0]
  return {
    price:    last,
    change1h: prev1h ? (last - prev1h) / prev1h * 100 : 0,
    change1d: prev1d ? (last - prev1d) / prev1d * 100 : 0,
  }
}

export async function fetchGlobalMarkets(): Promise<GlobalMarkets | null> {
  try {
    const symbols = ['^GSPC', 'DX-Y.NYB', 'GC=F']
    const settled = await Promise.allSettled(
      symbols.map(s =>
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1h&range=2d`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }).then(r => r.json() as Promise<YahooResponse>)
      )
    )

    const spxRaw  = parseSymbol(settled[0])
    const dxyRaw  = parseSymbol(settled[1])
    const goldRaw = parseSymbol(settled[2])

    if (!spxRaw || !dxyRaw) return null

    const spxTrend: 'up' | 'down' | 'flat' =
      spxRaw.change1h > 0.3 ? 'up' : spxRaw.change1h < -0.3 ? 'down' : 'flat'

    const dxyStrength: 'FUERTE' | 'DEBIL' | 'NEUTRAL' =
      dxyRaw.change1d > 0.3 ? 'FUERTE' : dxyRaw.change1d < -0.3 ? 'DEBIL' : 'NEUTRAL'

    const spx  = { price: spxRaw.price,  change1h: spxRaw.change1h, change1d: spxRaw.change1d, trend: spxTrend }
    const dxy  = { value: dxyRaw.price,  change1d: dxyRaw.change1d, strength: dxyStrength }
    const gold = { price: goldRaw?.price ?? 0, change1d: goldRaw?.change1d ?? 0 }

    // Risk-off: stocks falling + DXY rising → bearish for BTC
    const riskOff = spx.change1h < -0.5 && dxy.change1d > 0.2
    // Risk-on: stocks rising + DXY falling → bullish for BTC
    const riskOn  = spx.change1h > 0.5  && dxy.change1d < -0.2

    let signalImpact: GlobalMarkets['signalImpact'] = 'NEUTRAL'
    let btcCorrelation = ''

    if (riskOff && spx.change1h < -1) {
      signalImpact    = 'BLOCK_LONGS'
      btcCorrelation  = `SPX cayendo ${spx.change1h.toFixed(2)}% en 1H + DXY fuerte — risk-off, evitar longs en BTC`
    } else if (riskOff) {
      signalImpact    = 'BOOST_SHORTS'
      btcCorrelation  = `SPX bajista + DXY subiendo — presión bajista en BTC`
    } else if (riskOn && spx.change1h > 1) {
      signalImpact    = 'BOOST_LONGS'
      btcCorrelation  = `SPX subiendo ${spx.change1h.toFixed(2)}% + DXY débil — risk-on, favorable para longs BTC`
    } else if (riskOn) {
      signalImpact    = 'BOOST_LONGS'
      btcCorrelation  = `Entorno risk-on — correlación positiva con acciones`
    } else if (dxy.strength === 'FUERTE') {
      signalImpact    = 'BOOST_SHORTS'
      btcCorrelation  = `DXY fuerte (correlación inversa con BTC) — presión bajista`
    } else {
      btcCorrelation  = `Mercados globales neutrales — señales técnicas predominan`
    }

    return { spx, dxy, gold, riskOff, riskOn, btcCorrelation, signalImpact }
  } catch {
    return null
  }
}
