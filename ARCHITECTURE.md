# ARCHITECTURE.md — Technical Perspective

*How this thing actually works. Updated as we learn.*

---

## Price Source Strategy

Two-tier approach — screen cheaply, quote precisely.

### Tier 1: DeFi Llama (Screening)
- **What:** Aggregated token prices per chain, updated frequently
- **Endpoint:** `https://coins.llama.fi/prices/current/{chain}:{address},...`
- **Cost:** Free, no auth, generous rate limits
- **Use:** Poll every 15s. Cheap way to detect gross spreads across chains.
- **Limitation:** Aggregated oracle prices, not executable swap prices

### Tier 2: ParaSwap (Execution Quotes)
- **What:** Full DEX aggregator swap quotes with routing, gas, slippage
- **Endpoint:** `https://api.paraswap.io/prices?srcToken=...&destToken=...&amount=...&network=...&side=SELL`
- **Cost:** Free, no auth
- **Use:** Only when Tier 1 detects a spread worth investigating. Gets us realistic execution prices.
- **Why not 1inch:** Requires API key now (401 without auth). ParaSwap is equivalent quality, free.

### Flow
```
Every 15s:
  DeFi Llama → prices for all tokens on all chains
  ↓
  Compare same token across chains
  ↓
  Gross spread > MIN_GROSS_SPREAD_PCT?
    → No: log price, move on
    → Yes: fire ParaSwap quotes for both legs
           ↓
           Calculate net spread (after swap fees + gas)
           ↓
           Net spread > MIN_NET_SPREAD_PCT?
             → Log spread, simulate trades at multiple sizes
```

This saves rate limit budget — ParaSwap only fires when there's something worth investigating.

---

## Chains & Tokens

### Chains (free public RPCs)
| Chain | RPC | Chain ID | Gas Profile |
|---|---|---|---|
| Ethereum | https://eth.llamarpc.com | 1 | $5-20/swap (expensive) |
| Arbitrum | https://arb1.arbitrum.io/rpc | 42161 | $0.01-0.50/swap (cheap) |
| Base | https://mainnet.base.org | 8453 | $0.01-0.10/swap (cheapest) |

**L2 priority:** Arbitrum↔Base arbs are the sweet spot — cheap gas on both sides means lower minimum viable spread. Ethereum legs included for data completeness but flagged as high-friction.

### Token Addresses
| Token | Ethereum | Arbitrum | Base |
|---|---|---|---|
| WETH | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 | 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 | 0x4200000000000000000000000000000000000006 |
| USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| WBTC | 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 | 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f | TBD — verify liquidity |

**Note:** USDC addresses are **native USDC** (Circle-issued) on each chain, not bridged. This matters — bridged USDC.e has different addresses and sometimes different pricing.

---

## Fee Model

Every simulated trade accounts for:

1. **Swap fees** — baked into ParaSwap quotes (DEX pool fees are part of the routing)
2. **Gas costs** — estimated from live `eth_gasPrice` on each chain × ~200K gas units per swap
3. **Slippage** — ParaSwap quotes include routing-aware slippage for the requested amount

### Minimum Viable Spread
- **L2↔L2 (Arbitrum↔Base):** ~0.10% gross (swap fees dominate, gas negligible)
- **L1↔L2 (Ethereum↔Arbitrum/Base):** ~0.15-0.30% gross (L1 gas adds $5-20)

---

## Project Structure

```
trade-arbitrage/
├── src/
│   ├── config.js              # .env loader, token registry, chain config
│   ├── db.js                  # SQLite schema, migrations, query helpers
│   ├── prices/
│   │   ├── defillama.js       # Tier 1: aggregated price fetcher
│   │   ├── paraswap.js        # Tier 2: swap quote fetcher
│   │   └── gas.js             # Live gas price per chain
│   ├── engine/
│   │   ├── monitor.js         # Main polling loop (orchestrates everything)
│   │   ├── spreads.js         # Spread detection + net calculation
│   │   └── simulator.js       # Simulated trade execution at multiple sizes
│   ├── web/
│   │   ├── server.js          # Express app setup
│   │   ├── routes.js          # Page routes + API endpoints
│   │   └── views/
│   │       ├── layout.ejs     # Shared layout
│   │       ├── dashboard.ejs  # Live spreads + summary stats
│   │       ├── trades.ejs     # Simulated trade log
│   │       └── analytics.ejs  # Charts, heatmap, cumulative P&L
│   └── index.js               # Entry point — starts monitor + web server
├── data/                      # SQLite DB file (gitignored)
├── backlog/                   # Task tracking (backlog CLI)
├── VISION.md                  # Product perspective (what & why)
├── ARCHITECTURE.md            # Technical perspective (how)
├── CLAUDE.md                  # Agent instructions
├── AGENTS.md                  # Agent instructions
├── README.md
├── .env.example
├── .gitignore
└── package.json
```

---

## Database

SQLite via better-sqlite3. Synchronous, fast, no server.

Schema as defined in VISION.md (prices, spreads, sim_trades, daily_stats). Key addition:

- **Indexes:** `prices(chain, pair, timestamp)`, `spreads(pair, detected_at)`, `sim_trades(spread_id)`
- **Retention:** Configurable via `PRICE_HISTORY_DAYS`. Prune on startup + daily.
- **daily_stats:** Aggregated on each new spread detection, not via cron. Keeps it simple.

---

## Dashboard

Express + EJS + Chart.js. Same proven pattern as the deal tracker.

### Pages
1. **Dashboard (/)** — Live spread status, current prices per chain, recent spreads, summary stats
2. **Trades (/trades)** — Simulated trade log, filterable by pair/chain/date, P&L per trade
3. **Analytics (/analytics)** — Cumulative P&L chart, arbs/day trend, spread distribution, chain-pair heatmap, best times of day

### API Endpoints
- `GET /api/prices/current` — latest price per chain/pair
- `GET /api/spreads?status=open|closed&pair=...` — spread list
- `GET /api/trades?from=...&to=...` — simulated trade log
- `GET /api/stats/daily?days=30` — daily aggregates for charts
- `GET /api/stats/summary` — overall summary (total arbs, avg spread, best pair, etc.)

---

## Deployment

Railway. Hobby tier ($5/mo). Single service running both the monitor and web server.

- **Procfile:** `web: node src/index.js`
- **SQLite persists** via Railway volume mount
- **Health check:** `GET /api/health` returns monitor status + last poll time
- **No auth needed** (Phase 1 — single user, not public)

---

## What's Deferred

| Feature | Status | Notes |
|---|---|---|
| Telegram alerts | Backlogged | Add when we have data worth alerting on |
| WBTC/USDC on Base | Verify first | May have insufficient liquidity |
| Alchemy fallback RPCs | Nice-to-have | Only if free RPCs are unreliable |
| Real execution (Phase 2) | Future | Depends on paper trader results |
| Authentication | Future | Not needed for personal tool |
