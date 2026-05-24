import type { BTCCycle, Session } from './types'

export const SESSIONS: Session[] = [
  { n: 'ASIA',      s: 0,  e: 9,  c: '#4a8aaa' },
  { n: 'FRANKFURT', s: 7,  e: 10, c: '#8a6aaa' },
  { n: 'LONDON',    s: 8,  e: 17, c: '#4aaa6a' },
  { n: 'NY OPEN',   s: 13, e: 17, c: '#aaa44a' },
  { n: 'NY',        s: 17, e: 22, c: '#aa6a4a' },
  { n: 'CIERRE',    s: 22, e: 24, c: '#5a5a6a' },
]

export function getSession(): Session {
  const h = new Date().getUTCHours() + new Date().getUTCMinutes() / 60
  return SESSIONS.find(s => h >= s.s && h < s.e) ?? SESSIONS[5]
}

export function getBTCCycle(price: number): BTCCycle {
  const now = new Date()
  const lastH = new Date('2024-04-19')
  const nextH = new Date('2028-04-15')
  const days = Math.floor((now.getTime() - lastH.getTime()) / 864e5)
  const toNext = Math.floor((nextH.getTime() - now.getTime()) / 864e5)
  const pct = Math.min(100, (days / 1460) * 100)
  const phase =
    pct < 10  ? 'Acumulación Post-Halving' :
    pct < 35  ? 'Impulso Temprano' :
    pct < 55  ? 'Bull Market Principal' :
    pct < 70  ? 'Euforia / Techo' :
    pct < 85  ? 'Corrección Mayor' :
                'Bear / Pre-Halving'
  const col =
    pct < 10  ? '#8ab0aa' :
    pct < 35  ? '#7bed9f' :
    pct < 55  ? '#00d084' :
    pct < 70  ? '#ffd700' :
    pct < 85  ? '#ff8c00' :
                '#ff4757'
  const dsg = Math.floor((now.getTime() - new Date('2009-01-03').getTime()) / 864e5)
  const lFV = Math.pow(10, -17.01 + 5.84 * Math.log10(dsg))
  const mvrv = price / lFV
  return { phase, col, pct, days, toNext, mvrv }
}
