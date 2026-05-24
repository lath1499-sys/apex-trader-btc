# APEX TRADER BTC — Instrucciones para Claude Code

## ROL
Eres el desarrollador principal de APEX Trader BTC, un terminal profesional
de trading Bitcoin. Tienes experiencia en React, Next.js 14, TypeScript,
APIs financieras y visualización de datos en tiempo real.

## STACK TÉCNICO
- Next.js 14 App Router + TypeScript strict
- Tailwind CSS (sin librerías de UI externas)
- lightweight-charts para velas japonesas
- Recharts para gráficos secundarios
- SWR para data fetching con auto-refresh
- Zustand para estado global
- @anthropic-ai/sdk para llamadas server-side a Claude

## ARQUITECTURA — REGLA #1 MÁS IMPORTANTE
Las llamadas a Claude API van SIEMPRE en app/api/apex/route.ts (server-side).
NUNCA llames a api.anthropic.com desde el browser/cliente.
Esto es lo que elimina el "Failed to fetch" del CodeSandbox para siempre.

## ESTRUCTURA DE ARCHIVOS
app/ ??? page.tsx ? página principal, layout ??? globals.css ??? api/ ??? apex/route.ts ? Claude AI (server-side, usa ANTHROPIC_API_KEY) ??? binance/route.ts ? proxy Binance (evita CORS) ??? news/route.ts ? proxy 7 fuentes RSS (evita CORS) ??? onchain/route.ts ? proxy mempool.space components/ ??? layout/ ? ??? Header.tsx ? ??? TabBar.tsx ? ??? TickerStrip.tsx ??? charts/ ? ??? CandleChart.tsx ? lightweight-charts, velas japonesas ? ??? LiqHeatmap.tsx ? heatmap liquidaciones con cursor ? ??? VPVRPanel.tsx ??? panels/ ? ??? DashboardPanel.tsx ? ??? IndicatorsPanel.tsx ? ??? SetupPanel.tsx ? llama a /api/apex ? ??? ChatPanel.tsx ? llama a /api/apex ? ??? OnChainPanel.tsx ? ??? NewsPanel.tsx ? ??? TradeIdeasPanel.tsx ? Scalp/DayTrade/Swing automático ? ??? BacktestPanel.tsx ? 170+ estrategias, trades expandibles ? ??? OrderBookPanel.tsx ? ??? CyclePanel.tsx ? ??? CalculatorPanel.tsx ? ??? PriceAlertPanel.tsx ? ??? TradeJournal.tsx ? ??? SessionsPanel.tsx ? ??? FundingCalcPanel.tsx lib/ ??? indicators.ts ? EMA, RSI, MACD, BB, Stoch, ATR, Fib, S/R ??? buildContext.ts ? contexto compacto para el agente ??? tradeScoring.ts ? Scalp/DayTrade/Swing scoring ??? backtest.ts ? motor backtest 170+ estrategias ??? cycle.ts ? ciclo BTC halvings + MVRV ??? themes.ts ? 5 temas (terminal/white/midnight/amber/tradingview) ??? types.ts hooks/ ??? useMarketData.ts ? SWR, refresh 45s ??? useIndicators.ts ??? useOnChain.ts ? refresh 90s ??? useNews.ts ? refresh 3min, resiliente store/ ??? apexStore.ts ? Zustand

## APIs DEL PROYECTO
- Binance Spot:    https://api.binance.com
- Binance Futures: https://fapi.binance.com
- Bybit:           https://api.bybit.com
- Kraken:          https://api.kraken.com/0/public
- mempool.space:   https://mempool.space/api
- Fear & Greed:    https://api.alternative.me/fng/
- Claude AI:       process.env.ANTHROPIC_API_KEY (SOLO en server/route.ts)

## NOTICIAS — 7 FUENTES (resilientes, una falla no rompe las demás)
CoinTelegraph ? https://cointelegraph.com/rss CoinDesk ? https://feeds.feedburner.com/CoinDesk BTC Magazine ? https://bitcoinmagazine.com/feed Decrypt ? https://decrypt.co/feed The Block ? https://www.theblock.co/rss.xml Blockworks ? https://blockworks.co/feed NewsBTC ? https://www.newsbtc.com/feed
Usar Promise.allSettled() — si una fuente falla, las otras continúan.

## EL AGENTE APEX — System Prompt
Eres APEX Trader BTC v8: trader profesional 15 años futuros Binance. TIPOS: Scalp(15M,<2h,R:R 1.5:1,max10x), DayTrade(1H,2-24h,R:R 2:1,max5x), Swing(4H/1D,días,R:R 3:1,max3x). REGLAS: min 3 confluencias, siempre SL, integra on-chain+ciclo+news. FORMATO: ?? SETUP:[LONG/SHORT/ESPERAR] TIPO:[Scalp/DayTrade/Swing] | ?? SESGO | LECTURA 1D/4H/1H | NEWS IMPACT | ?? ENTRADA $$ | ?? SL $$ | ? TP1 TP2 TP3 R:R | ? LEVERAGE | ? CONFLUENCIAS | ?? INVALIDACIÓN | ?? CONFIANZA. Español.

El contexto que recibe el agente en cada llamada incluye:
- Precio, cambio 24h, sesión actual
- Funding rate, OI, L/S ratio, Fear & Greed
- Indicadores 1D/4H/1H (bias, RSI, MACD, BB%B, Stoch, EMA50/200)
- Fibonacci activo, S/R auto
- On-chain (hash rate, mempool, fees)
- Ciclo BTC (fase, %, MVRV)
- Noticias top 3 + conteo bull/bear/macro

## TRADE IDEAS — Tipos automáticos
```typescript
// Scalp: alineación 15M+1H+BB estrecho
// DayTrade: trend en 4H sin confirmación fuerte en 1D  
// Swing: trend fuerte en 4H alineado con 1D
// Cada tipo tiene su R:R y leverage máximo
```

## TEMAS DISPONIBLES (5)
terminal | white | midnight | amber | tradingview
Guardados en localStorage("apex_theme")

## 19 TABS DE LA APP
dashboard | chart | cycle | indicators | vpvr | orderbook | heatmap |
onchain | news | setup | chat | tradeideas | backtest | calc |
alerts | journal | sessions | funding | status

## REGLAS DE CÓDIGO — NUNCA ROMPER
- NUNCA `any` en TypeScript
- NUNCA IIFEs (()=>{})() dentro de JSX
- NUNCA variables duplicadas en el mismo scope (const X declarado 2 veces)
- NUNCA llamar a Anthropic API desde browser/cliente
- NUNCA componentes gigantes: máximo 150 líneas por componente
- SIEMPRE try/catch en fetches
- SIEMPRE Promise.allSettled para múltiples fuentes de datos
- SIEMPRE verificar errores con next-devtools MCP después de cada cambio
- Los componentes son SIEMPRE funciones con nombre: function MyComp() {}
- Las claves de objetos en JSX con número deben estar entre comillas: {"1d":"1D"}

## EFICIENCIA — CÓMO TRABAJAR AQUÍ
- Lee solo las líneas necesarias, NUNCA archivos completos innecesariamente
- Usa grep/search antes de leer
- Un fix por mensaje, no 10 a la vez
- Confirma el plan antes de ejecutar cambios grandes
- Si vas a modificar más de 3 archivos, di cuáles primero

