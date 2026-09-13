// Signed Binance Futures REST client — Fase A: solo lectura de balance y
// posiciones reales. A propósito no exporta NINGUNA función que coloque,
// modifique o cancele una orden (eso es Fase B, todavía no implementada).
// Requiere runtime 'nodejs' en cualquier ruta que lo use, por el HMAC nativo.

import { createHmac } from 'crypto'

const TESTNET_BASE = 'https://testnet.binancefuture.com'
const MAINNET_BASE = 'https://fapi.binance.com'
const RECV_WINDOW  = 8000

export type BinanceEnv = 'testnet' | 'mainnet'

export function binanceEnvLabel(): BinanceEnv {
  return process.env.BINANCE_ENV === 'mainnet' ? 'mainnet' : 'testnet'
}

export function isBinanceConfigured(): boolean {
  return Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET)
}

function baseUrl(): string {
  return binanceEnvLabel() === 'mainnet' ? MAINNET_BASE : TESTNET_BASE
}

function sign(query: string): string {
  const secret = process.env.BINANCE_API_SECRET ?? ''
  return createHmac('sha256', secret).update(query).digest('hex')
}

async function signedGet<T>(path: string): Promise<T> {
  const apiKey = process.env.BINANCE_API_KEY
  if (!apiKey || !process.env.BINANCE_API_SECRET) {
    throw new Error('BINANCE_API_KEY/BINANCE_API_SECRET no configuradas')
  }

  const query = `timestamp=${Date.now()}&recvWindow=${RECV_WINDOW}`
  const signature = sign(query)
  const url = `${baseUrl()}${path}?${query}&signature=${signature}`

  const res = await fetch(url, {
    headers: { 'X-MBX-APIKEY': apiKey },
    signal:  AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Binance ${res.status} en ${path}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface BinanceFuturesBalance {
  asset:            string
  balance:          string
  availableBalance: string
  crossUnPnl:       string
}

export interface BinanceFuturesPosition {
  symbol:           string
  positionAmt:      string
  entryPrice:       string
  unRealizedProfit: string
  leverage:         string
}

export async function getFuturesBalance(): Promise<BinanceFuturesBalance[]> {
  return signedGet<BinanceFuturesBalance[]>('/fapi/v2/balance')
}

export async function getFuturesPositions(): Promise<BinanceFuturesPosition[]> {
  return signedGet<BinanceFuturesPosition[]>('/fapi/v2/positionRisk')
}
