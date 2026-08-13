# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

APEX Trader BTC is a Next.js 16 (App Router) + TypeScript Bitcoin trading terminal with two halves that share the same `lib/` code:

1. **Interactive terminal UI** — a client-rendered dashboard (20 tabs) for charting, indicators, backtesting, journaling, etc. State lives in a Zustand store, data comes in via SWR hooks polling internal API-proxy routes.
2. **Autonomous trading agent** — a headless backend, triggered every 1–30 min by the GitHub Actions workflow `.github/workflows/agent.yml` hitting `app/api/agent/*` routes on the deployed Vercel URL. It uses Claude to generate/manage trade signals, persists everything to Supabase, and is controlled/monitored entirely through a Telegram bot (`app/api/telegram/route.ts`) plus `ntfy.sh` push notifications. There is no client UI for controlling the agent — Telegram commands are the control plane.

These two halves are decoupled: the UI reads Supabase-backed signal history for display, but does not drive the agent's decisions.

## Commands

```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint (eslint-config-next core-web-vitals + typescript)
```

There is no test suite (no test runner in `package.json`) — do not invent test commands. Type-check with `tsc --noEmit` if needed; there's no dedicated `npm run typecheck` script. `next.config.ts` has no custom config.

## Environment variables

The app degrades gracefully when these are missing (falls back to `localStorage` or skips the feature), but the agent backend requires most of them to function:

- `ANTHROPIC_API_KEY` — Claude calls (decision-making, briefs, chat)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser Supabase client
- `SUPABASE_SERVICE_KEY` — server-only Supabase client (bypasses RLS), used by every `app/api/agent/*` and `app/api/telegram/*` route
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — the bot is the agent's control/notification channel
- `CRON_SECRET` — bearer token required by every `app/api/agent/*` route (GitHub Actions sends `Authorization: Bearer $CRON_SECRET`)
- `NTFY_TOPIC` — optional push notifications, parallel to Telegram
- `FRED_API_KEY` — macro indicators (CPI, Fed rate, etc.)
- `LUNARCRUSH_API_KEY` — social sentiment (optional, nullable on failure)
- `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT` — `app/api/alert/route.ts` email alerts
- `NEXT_PUBLIC_APP_URL` — used by Telegram handlers to fire-and-forget calls back into `/api/agent/*` (defaults to the hardcoded Vercel URL if unset)

## Architecture — Rule #1

Claude API calls are **always server-side**. Never call `api.anthropic.com` from a client component. Every Claude call lives in either an `app/api/*/route.ts` handler or a `lib/*.ts` module imported by one:
- `lib/aiDecisionMaker.ts` — signal generation, called from `app/api/agent/decide/route.ts`
- `lib/agentVoice.ts` — market briefs, called from `app/api/agent/brief/route.ts`
- `lib/apexChat.ts` — free-text Telegram chat, called from `app/api/telegram/route.ts`
- `app/api/apex/route.ts` — the legacy client-facing chat/vision endpoint (image + text setup requests)

## The autonomous agent — how it actually runs

`app/api/agent/` has five decoupled endpoints, each bearer-authed with `CRON_SECRET` and wrapped in `withLock()` (`lib/runLock.ts`, a Supabase-row distributed lock with a TTL) so overlapping cron triggers never double-process:

| Route | Cadence (GitHub Actions) | Job |
|---|---|---|
| `monitor/route.ts` | every 1 min | SL/TP price checks only — no Claude call, must finish <15s. The sole authority for closing a signal on price. |
| `decide/route.ts` | every 5 min | Full context pipeline → `askClaudeForDecision()` → opens/closes signals. Auto-pauses the agent (writes `apex_agent_state.is_paused`) on 3+ SL hits or -5% daily P&L. |
| `evaluate/route.ts` | every 10 min | Time-based trade management: breakeven/trailing SL via `lib/stopManagement.ts`. Expiry is intentionally handled only by `monitor` to avoid double-close. |
| `brief/route.ts` | :00 and :30 hourly | Standalone Telegram market brief via `lib/agentVoice.ts`, independent of signal generation so a long Claude call never blocks it. Has its own 26-min cooldown gate. |
| `health/route.ts` | on-demand (Status tab UI) | Read-only telemetry: brief success rate, decision log, lock state, daily P&L. No auth required — no secrets in the payload. |

`decide`'s context pipeline (in call order) is worth knowing before touching it: klines (1D/4H/1H/15M, Binance→Bybit→Kraken fallback) → indicators (`lib/indicators.ts`) → regime (`lib/marketRegime.ts`) → FVG/liquidity (`lib/fvg.ts`, `lib/liquidity.ts`) → Elliott Waves (`lib/elliottWaves.ts`) → ABCD harmonics (`lib/harmonicPatterns.ts`) → macro/Fed (`lib/macroEconomics.ts`) → global markets (`lib/marketCorrelation.ts`) → social sentiment (`lib/socialSentiment.ts`) → whale alerts (`lib/whaleDetector.ts`) → options/IV (`lib/deribitFetch.ts`) → news (`lib/newsFetcher.ts`) → closed-trade performance stats. Every field `aiDecisionMaker`'s prompt template expects should be populated here rather than reaching Claude as `"?"`/`N/A`.

**Signal lifecycle** (`SignalStatus` in `lib/types.ts`): `active` → `tp1_hit` (banks partial P&L, SL moves to breakeven) → `tp2_hit` (SL moves to TP1 floor) → `tp3_hit` | `sl_hit` | `breakeven` | `closed_manual`. Partial-close percentages and banked P&L are tracked per-signal (`tp1BankedPnl`, `remainingSizePct`, etc.) so a restart never re-fires a notification for an event that already happened — `ntfySent`/`*WarningFired`/`*Set` boolean flags on `SignalRecord` exist purely to make notification side effects idempotent across cron restarts.

Deployment cron is **not** Vercel Cron — `vercel.json` is empty. Scheduling is entirely `.github/workflows/agent.yml` (`* * * * *`, minute-modulo checks inside each job) making HTTP calls to the deployed app.

## Telegram bot as control plane

`app/api/telegram/route.ts` is the webhook target. Slash commands (`/status`, `/pause`, `/resume`, `/forcecheck`, `/fix sl|be|tp1|tp2|tp3 [id]`, `/leverage`, `/locks`, `/macro update <key> <value>`, etc. — see the `/help` handler for the full, current list) drive the agent directly; any non-slash message is routed to `chatWithAPEX()` (`lib/apexChat.ts`) for free-form Claude chat with full account/market context, which can also return a structured `action` (`PAUSE`/`RESUME`/`CLOSE_ALL`/`MOVE_SL`) executed by `executeChatAction()`. Only `TELEGRAM_CHAT_ID` is authorized; all other chat IDs are rejected.

## Persistence — Supabase tables

All server-side reads/writes go through `getSupabaseServer()` (`lib/supabase.ts`, service key, bypasses RLS); the browser uses `getSupabase()` (anon key). Both fall back to `null` (and callers fall back to `localStorage` or skip) when env vars are absent — never assume Supabase is configured. Key tables (schema not versioned in-repo; see inline `CREATE TABLE` comments in `lib/runLock.ts` for an example):

- `apex_signals` — the signal/trade ledger (see `transformSignal()` in `lib/supabase.ts` for the DB↔`SignalRecord` mapping)
- `apex_agent_state` (single row, `id='current'`) — pause state, last bias/confidence, last known price, brief cooldown timestamp
- `apex_capital_config` (single row, `id='default'`) — monthly start balance, drawdown stage inputs
- `apex_leverage_config` — per-trade-type leverage/SL ranges, editable from the Leverage tab or `/leverage`
- `apex_run_locks` — one row per job type (`monitor`/`decide`/`evaluate`/`brief`), see `lib/runLock.ts`
- `apex_brief_history` — every brief AND every `decide` run is logged here (`focus='DECIDE_LOG'` distinguishes decision-log rows from actual Telegram briefs)
- `apex_chat_history`, `apex_agent_memory` — Telegram free-chat log and agent long-term memory (`lib/apexChat.ts`, `lib/agentMemory.ts`)
- `apex_macro_overrides` — manual overrides via `/macro update`, layered over `FRED_API_KEY` data in `lib/macroData.ts`

## Naming gotcha: two "capital" modules

`lib/capitalManager.ts` and `lib/capitalManagement.ts` are **not duplicates** — they solve different problems and both are live:
- `lib/capitalManager.ts` — the 3-stage drawdown system (`getCapitalState()`, `DEFAULT_CAPITAL_CONFIG`): normal (5% risk) → survival (2% risk, -15% drawdown) → hard stop (-20% drawdown, no new trades). Used by the agent and most Telegram commands.
- `lib/capitalManagement.ts` — Kelly-criterion position sizing math (`calcPositionSize()`, `DEFAULT_CONFIG`). Used by `TradeIdeasPanel` and signal generation for suggested position size, independent of the drawdown stage.

Don't "consolidate" these without checking both call sites — they're intentionally separate concerns despite the similar names.

## Resilience conventions (already established, follow them)

- **Price/kline fetching always falls back**: Binance → Bybit → Kraken, in that priority order, because Binance IPs are blocked on Vercel infra. See `lib/marketFetch.ts` and the inline `getBtcPrice()` in `monitor`/`evaluate` routes for the pattern.
- **Multi-source fetches use `Promise.allSettled`**, never `Promise.all`, so one failing news/macro/sentiment source doesn't blank out the rest (`lib/newsFetcher.ts` has 15+ independent sources — 11 RSS feeds plus API sources).
- **External DB/network calls are wrapped in `.catch(() => ({ data: null }))`** (or similar) rather than propagating — this codebase treats Supabase/Telegram/ntfy failures as non-fatal by default; the caller decides whether to alert on it.

## Legacy file

`apex-trader-v8-final.jsx` at the repo root is a frozen single-file CodeSandbox prototype (pre-Next.js-migration). It calls `api.anthropic.com` directly from the client — the exact anti-pattern this codebase now forbids. It is not imported anywhere in `app/` or `components/` and is not part of the build. Don't use it as a reference for current conventions; it predates the Supabase/agent/Telegram architecture entirely.

## UI structure

`store/apexStore.ts` (Zustand) holds all client state; `app/page.tsx` renders `Header` / `TickerStrip` / `TabBar` and switches over `TabName` (`lib/types.ts`) to one of 20 panel components in `components/panels/`. Data-fetching hooks (`hooks/useMarketData.ts` 45s refresh, `hooks/useOnChain.ts` 90s, `hooks/useNews.ts` 3min, `hooks/useSignalHistory.ts`) populate the store via SWR against the `app/api/*` proxy routes — proxies exist to dodge browser CORS on Binance/Bybit/mempool.space/RSS, not to hide credentials (those routes carry no secrets). There's no chat or setup panel in the current UI — that surface moved entirely to the Telegram bot.

## Code rules — never break

- No `any` in TypeScript.
- No IIFEs `(() => {})()` inside JSX.
- No duplicate `const` bindings in the same scope.
- Never call Anthropic's API from a browser/client component.
- Keep components under ~150 lines; split large panels rather than growing them (note: several existing panels like `TradeIdeasPanel.tsx` already exceed this significantly — don't use them as precedent for new code).
- Always wrap `fetch` calls in `try/catch`.
- Always use `Promise.allSettled` when hitting multiple independent data sources.
- Components are named function declarations: `function MyComp() {}`, not arrow-function consts.
- Numeric-looking object keys in JSX must be quoted: `{"1d": "1D"}`.
