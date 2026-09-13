'use client'
import { useEffect, useState } from 'react'
import { useTheme } from '@/hooks/useTheme'

interface BinanceBalance {
  asset:            string
  availableBalance: string
  crossUnPnl:       string
}

interface BinancePosition {
  symbol:           string
  positionAmt:      string
  entryPrice:       string
  unRealizedProfit: string
  leverage:         string
}

interface AccountResponse {
  configured: boolean
  env:        'testnet' | 'mainnet'
  balances?:  BinanceBalance[]
  positions?: BinancePosition[]
  errors?:    string[]
}

export default function BinanceAccountPanel() {
  const T = useTheme()
  const [data, setData]       = useState<AccountResponse | null>(null)
  const [failed, setFailed]   = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      fetch('/api/binance/account')
        .then(r => r.json() as Promise<AccountResponse>)
        .then(d => { if (alive) { setData(d); setFailed(false) } })
        .catch(() => { if (alive) setFailed(true) })
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  if (!data && !failed) return null

  if (failed) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 14, fontSize: 11, color: T.danger }}>
        No se pudo consultar /api/binance/account.
      </div>
    )
  }

  if (data && !data.configured) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 14, fontSize: 11, color: T.textSec }}>
        Binance no configurado — agrega <code style={{ color: T.text }}>BINANCE_API_KEY</code> / <code style={{ color: T.text }}>BINANCE_API_SECRET</code> en las variables de entorno.
      </div>
    )
  }

  const usdt      = data?.balances?.find(b => b.asset === 'USDT')
  const positions = (data?.positions ?? []).filter(p => parseFloat(p.positionAmt) !== 0)
  const isTestnet = data?.env === 'testnet'

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>Balance real en Binance</span>
        <span style={{
          fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: isTestnet ? T.warn + '33' : T.bull + '33',
          color:      isTestnet ? T.warn : T.bull,
        }}>
          {isTestnet ? 'TESTNET' : 'MAINNET'}
        </span>
      </div>

      {usdt ? (
        <div style={{ display: 'flex', gap: 16, marginBottom: positions.length ? 10 : 0 }}>
          <div>
            <div style={{ fontSize: 8, color: T.textSec }}>DISPONIBLE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>${parseFloat(usdt.availableBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: T.textSec }}>PNL NO REALIZADO</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: parseFloat(usdt.crossUnPnl) >= 0 ? T.bull : T.bear }}>
              {parseFloat(usdt.crossUnPnl) >= 0 ? '+' : ''}${parseFloat(usdt.crossUnPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: T.textSec }}>Sin balance USDT.</div>
      )}

      {positions.length > 0 && (
        <div style={{ fontSize: 9, color: T.textSec }}>
          {positions.map(p => (
            <div key={p.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: `1px solid ${T.border}` }}>
              <span style={{ color: T.text }}>{p.symbol} {parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'} {p.leverage}x</span>
              <span style={{ color: parseFloat(p.unRealizedProfit) >= 0 ? T.bull : T.bear }}>
                {parseFloat(p.unRealizedProfit) >= 0 ? '+' : ''}${parseFloat(p.unRealizedProfit).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      )}

      {(data?.errors?.length ?? 0) > 0 && (
        <div style={{ fontSize: 9, color: T.danger, marginTop: 8 }}>{data?.errors?.join(' | ')}</div>
      )}
    </div>
  )
}
