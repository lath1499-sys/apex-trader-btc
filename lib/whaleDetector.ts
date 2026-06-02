/**
 * Whale Movement Detector — V2 Section 4
 *
 * Sources (no API keys required):
 *   Primary  : Blockchair — largest mempool transactions by value
 *   Secondary: mempool.space — recent confirmed block large txns
 *
 * Signal logic:
 *   distribution  (output_count > 20, large value) → coins leaving exchange  → BULLISH
 *   consolidation (output_count ≤ 2,  large value) → cold-wallet / deposit   → BEARISH
 *   mixed / many large txns                                                   → HIGH alert
 */

const BLOCKCHAIR = 'https://api.blockchair.com/bitcoin'
const MEMPOOL    = 'https://mempool.space/api'

const WHALE_BTC    = 100   // >= 100 BTC  → notable
const HIGH_BTC     = 500   // >= 500 BTC  → HIGH magnitude
const CRITICAL_BTC = 1_000 // >= 1000 BTC → CRITICAL
const SAT          = 1e8   // satoshis per BTC

// ─── Types ───────────────────────────────────────────────────────────────────

interface BlockchairRow {
  hash:         string
  time:         string
  value:        number   // satoshis
  output_count: number
  input_count:  number
  fee:          number
}

interface BlockchairResp {
  data: BlockchairRow[]
  context: { code: number }
}

interface MempoolTx {
  txid:  string
  fee:   number
  vsize: number
  value: number  // satoshis (sum of outputs)
  vin:  { prevout?: { value?: number } }[]
  vout: { value: number }[]
}

export interface WhaleAlert {
  detected:          boolean
  magnitude:         'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NONE'
  description:       string              // Spanish sentence for NTFY/agent
  largeTxCount:      number              // unconfirmed whale txns
  totalBTCInFlight:  number             // sum of whale txns
  topTxBTC:          number              // largest single tx
  distribution:      boolean             // fan-out → possible exchange outflow
  consolidation:     boolean             // fan-in  → possible exchange deposit
  exchangeFlowSignal:'BEARISH' | 'BULLISH' | 'NEUTRAL'
  btcImpact:         string              // one-line market impact hint
  source:            'blockchair' | 'mempool' | 'unavailable'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7_000),
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

function fmtBTC(btc: number): string {
  return btc >= 1_000 ? `${(btc / 1_000).toFixed(1)}k BTC` : `${Math.round(btc)} BTC`
}

function buildDescription(
  topTxBTC: number,
  totalBTCInFlight: number,
  largeTxCount: number,
  distribution: boolean,
  consolidation: boolean,
): string {
  const flow = distribution
    ? '(posible salida de exchange — señal alcista)'
    : consolidation
    ? '(posible depósito a exchange o cold-wallet — señal bajista)'
    : ''
  if (topTxBTC >= CRITICAL_BTC)
    return `🐋 BALLENA CRÍTICA: tx de ${fmtBTC(topTxBTC)} en mempool ${flow}`
  if (totalBTCInFlight >= HIGH_BTC)
    return `🐋 Alta actividad de ballenas: ${largeTxCount} txs · ${fmtBTC(totalBTCInFlight)} total ${flow}`
  if (largeTxCount >= 3)
    return `🐋 Actividad de ballenas moderada: ${largeTxCount} txs ≥ ${WHALE_BTC} BTC en mempool`
  return `🐋 Ballena detectada: tx de ${fmtBTC(topTxBTC)} pendiente ${flow}`
}

// ─── Main: Blockchair mempool (primary) ──────────────────────────────────────

async function fromBlockchair(): Promise<WhaleAlert | null> {
  const data = await safeFetch<BlockchairResp>(
    `${BLOCKCHAIR}/mempool/transactions?s=value(desc)&limit=25`,
  )
  if (!data?.data?.length) return null

  const whaleTxs = data.data.filter(tx => tx.value / SAT >= WHALE_BTC)
  if (!whaleTxs.length) {
    return {
      detected: false, magnitude: 'NONE',
      description: 'Sin actividad de ballenas en mempool',
      largeTxCount: 0, totalBTCInFlight: 0, topTxBTC: 0,
      distribution: false, consolidation: false,
      exchangeFlowSignal: 'NEUTRAL',
      btcImpact: 'Sin impacto significativo de ballenas',
      source: 'blockchair',
    }
  }

  const topTxBTC         = whaleTxs[0].value / SAT
  const totalBTCInFlight = whaleTxs.reduce((a, t) => a + t.value / SAT, 0)
  const largeTxCount     = whaleTxs.length

  // Fan-out = many outputs → exchange withdrawal/distribution
  const distribution  = whaleTxs.some(t => t.output_count > 20)
  // Fan-in = single output, large value → cold wallet consolidation / exchange deposit
  const consolidation = whaleTxs.some(t => t.output_count <= 2 && t.value / SAT >= HIGH_BTC)

  const exchangeFlowSignal: WhaleAlert['exchangeFlowSignal'] =
    distribution && !consolidation ? 'BULLISH' :
    consolidation && !distribution ? 'BEARISH' : 'NEUTRAL'

  const magnitude: WhaleAlert['magnitude'] =
    topTxBTC >= CRITICAL_BTC           ? 'CRITICAL' :
    topTxBTC >= HIGH_BTC ||
      totalBTCInFlight >= HIGH_BTC * 4 ? 'HIGH'     :
    largeTxCount >= 3                  ? 'MEDIUM'   : 'NONE'

  const btcImpact =
    exchangeFlowSignal === 'BULLISH' ? 'Salida de exchanges — posible presión alcista'  :
    exchangeFlowSignal === 'BEARISH' ? 'Entrada a exchanges — posible presión vendedora' :
    magnitude === 'CRITICAL'         ? 'Movimiento enorme — volatilidad inminente'       :
                                       'Actividad de ballenas — monitorear precio'

  return {
    detected: true,
    magnitude,
    description: buildDescription(topTxBTC, totalBTCInFlight, largeTxCount, distribution, consolidation),
    largeTxCount,
    totalBTCInFlight,
    topTxBTC,
    distribution,
    consolidation,
    exchangeFlowSignal,
    btcImpact,
    source: 'blockchair',
  }
}

// ─── Fallback: mempool.space last block ───────────────────────────────────────

async function fromMempoolSpace(): Promise<WhaleAlert | null> {
  // Get last block hash
  const blocks = await safeFetch<{ id: string }[]>(`${MEMPOOL}/v1/blocks`)
  if (!blocks?.length) return null
  const hash = blocks[0].id

  // Get first page of txns (25 txns, roughly sorted by fee but includes large ones)
  const txs = await safeFetch<MempoolTx[]>(`${MEMPOOL}/v1/block/${hash}/txs/0`)
  if (!txs?.length) return null

  const whaleTxs = txs.filter(tx => {
    const totalOut = tx.vout.reduce((a, o) => a + (o.value ?? 0), 0)
    return totalOut / SAT >= WHALE_BTC
  })

  if (!whaleTxs.length) {
    return {
      detected: false, magnitude: 'NONE',
      description: 'Sin transacciones de ballenas en último bloque',
      largeTxCount: 0, totalBTCInFlight: 0, topTxBTC: 0,
      distribution: false, consolidation: false,
      exchangeFlowSignal: 'NEUTRAL',
      btcImpact: 'Sin impacto de ballenas detectado',
      source: 'mempool',
    }
  }

  const sorted = [...whaleTxs].sort((a, b) => {
    const va = b.vout.reduce((s, o) => s + (o.value ?? 0), 0)
    const vb = a.vout.reduce((s, o) => s + (o.value ?? 0), 0)
    return va - vb
  })

  const topTx           = sorted[0]
  const topTxBTC        = topTx.vout.reduce((a, o) => a + (o.value ?? 0), 0) / SAT
  const totalBTCInFlight = whaleTxs.reduce(
    (a, t) => a + t.vout.reduce((s, o) => s + (o.value ?? 0), 0) / SAT, 0,
  )
  const largeTxCount = whaleTxs.length
  const distribution  = whaleTxs.some(t => t.vout.length > 20)
  const consolidation = whaleTxs.some(
    t => t.vout.length <= 2 && t.vout.reduce((a, o) => a + (o.value ?? 0), 0) / SAT >= HIGH_BTC,
  )

  const exchangeFlowSignal: WhaleAlert['exchangeFlowSignal'] =
    distribution && !consolidation ? 'BULLISH' :
    consolidation && !distribution ? 'BEARISH' : 'NEUTRAL'

  const magnitude: WhaleAlert['magnitude'] =
    topTxBTC >= CRITICAL_BTC ? 'CRITICAL' :
    topTxBTC >= HIGH_BTC     ? 'HIGH'     :
    largeTxCount >= 3        ? 'MEDIUM'   : 'NONE'

  return {
    detected: true,
    magnitude,
    description: buildDescription(topTxBTC, totalBTCInFlight, largeTxCount, distribution, consolidation),
    largeTxCount, totalBTCInFlight, topTxBTC,
    distribution, consolidation, exchangeFlowSignal,
    btcImpact:
      exchangeFlowSignal === 'BULLISH' ? 'Salida de exchanges — posible presión alcista'   :
      exchangeFlowSignal === 'BEARISH' ? 'Entrada a exchanges — posible presión vendedora'  :
                                         'Actividad de ballenas — monitorear',
    source: 'mempool',
  }
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function fetchWhaleAlert(): Promise<WhaleAlert | null> {
  try {
    // Primary: Blockchair (most complete — mempool view)
    const primary = await fromBlockchair()
    if (primary) return primary

    // Fallback: mempool.space last block
    const fallback = await fromMempoolSpace()
    return fallback
  } catch {
    return null
  }
}
