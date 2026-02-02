# Cross-Chain Arbitrage Paper Trader

## What Is This?

A paper-trading system that monitors real cryptocurrency prices across multiple blockchains, detects cross-chain pricing inefficiencies, simulates trades, and tracks what the P&L *would* have been — all without risking real money.

The goal: **validate whether cross-chain arbitrage is a viable income stream before deploying real capital.**

---

## The Thesis

The same token (e.g., ETH) trades at slightly different prices on different blockchains (Ethereum, Arbitrum, Base, etc.) because each chain has independent liquidity pools with their own supply/demand dynamics. Bridges between chains are slow enough that these price differences persist for minutes to hours — sometimes longer during volatile markets.

By pre-positioning capital on multiple chains and trading simultaneously when spreads appear, a solo operator can capture these pricing inefficiencies. Unlike same-chain DEX arbitrage (where you're competing against MEV bots at millisecond speeds), cross-chain arb operates on a timescale of seconds to minutes — accessible to a well-built Node.js bot on a standard VPS.

### Why Cross-Chain?

- **Non-atomic = less competition.** MEV searchers focus on riskless, atomic same-chain arbs. Cross-chain involves real execution risk, which scares them off. That risk is our moat.
- **Speed requirements are human-scale.** Seconds to minutes, not microseconds. A Node.js bot running on Railway can compete.
- **Infrastructure is improving but still imperfect.** Bridges are slow, expensive, and sometimes break. As long as cross-chain infrastructure is imperfect, pricing inefficiencies persist.
- **No account limiting.** Unlike sports betting, DeFi protocols don't ban you for being profitable. It's permissionless.
- **Legal from anywhere.** No geographic restrictions. No sportsbook accounts. No prediction market geoblocking.

---

## How It Works

### The Real Strategy (Phase 2 — future, after validation)

Pre-position ~$50K each in stablecoins across 3+ chains. When ETH is cheaper on Chain A than Chain B:

1. Buy ETH on Chain A (swap USDC → ETH)
2. Sell ETH on Chain B (swap ETH → USDC)
3. Pocket the spread minus gas and fees
4. Rebalance capital across chains periodically via bridges

### This Project: The Paper Trader (Phase 1)

Read-only monitoring and simulation. No wallets, no capital, no real trades.

1. **Monitor** real prices across chains every 10-30 seconds
2. **Detect** when the same pair is priced differently across chains
3. **Simulate** what a trade would have returned (including gas, fees, slippage)
4. **Log** everything to a database for analysis
5. **Alert** via Telegram when interesting spreads appear
6. **Dashboard** showing live spreads, simulated P&L, and analytics

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           Price Monitor Service               │
│  Polls every 10-30 seconds per chain          │
│  Chains: Ethereum, Arbitrum, Base             │
│  Pairs: ETH/USDC, WBTC/USDC, configurable    │
│  Source: 1inch API quotes + ethers.js RPCs    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         Spread Detection Engine               │
│  Compare same pair across all chain combos    │
│  Calculate net spread after gas + fees        │
│  Filter: net spread > configurable threshold  │
│  Track: duration, depth, frequency            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│       Simulated Execution Engine              │
│  Get realistic swap quotes (both sides)       │
│  Estimate gas costs from live gas prices      │
│  Calculate slippage at multiple trade sizes   │
│  Log: simulated P&L per opportunity           │
└──────────────┬───────────┬──────────────────┘
               │           │
               ▼           ▼
        ┌──────────┐ ┌──────────────┐
        │ SQLite   │ │ Telegram Bot │
        │ Database │ │ Alerts       │
        └────┬─────┘ └──────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│          Express Web Dashboard                │
│  Live cross-chain spreads                     │
│  Simulated trade log with P&L                 │
│  Cumulative profit chart                      │
│  Analytics: arbs/day, avg spread, best pairs  │
│  Chain-pair heatmap                           │
└─────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| Runtime | Node.js | Consistent with other projects |
| Price Data | 1inch Swap API (free) | Realistic quotes including routing, gas, slippage |
| Chain Access | ethers.js + free RPCs | Alchemy free tier (300M CU/mo) |
| Database | SQLite (better-sqlite3) | Simple, portable, proven |
| Web UI | Express + EJS | Fast to build, same pattern as deal tracker |
| Charts | Chart.js | Lightweight, no build step |
| Alerts | Telegram Bot API | Direct HTTP, no library needed |
| Hosting | Railway | Free tier sufficient, auto-deploy |

---

## Data Model

### prices
Raw price snapshots from each chain, polled every 10-30 seconds.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| timestamp | INTEGER | Unix timestamp ms |
| chain | TEXT | 'ethereum', 'arbitrum', 'base' |
| pair | TEXT | 'ETH/USDC', 'WBTC/USDC' |
| price | REAL | Best available swap price (per unit) |
| liquidity_usd | REAL | Approximate available depth |
| gas_price_gwei | REAL | Current gas price on this chain |

### spreads
Detected cross-chain spread opportunities.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| detected_at | INTEGER | When first detected |
| closed_at | INTEGER | When spread closed (NULL if open) |
| pair | TEXT | Trading pair |
| buy_chain | TEXT | Cheaper chain |
| sell_chain | TEXT | More expensive chain |
| buy_price | REAL | Price on buy chain |
| sell_price | REAL | Price on sell chain |
| gross_spread_pct | REAL | Raw price difference % |
| net_spread_pct | REAL | After estimated gas + fees |
| duration_seconds | INTEGER | How long it persisted |

### sim_trades
Simulated trade executions.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| spread_id | INTEGER FK | References spreads.id |
| timestamp | INTEGER | When simulation ran |
| pair | TEXT | Trading pair |
| buy_chain | TEXT | Chain bought on |
| sell_chain | TEXT | Chain sold on |
| trade_size_usd | REAL | Simulated position size |
| tokens_bought | REAL | Tokens received on buy side |
| usd_received | REAL | USD received on sell side |
| gas_cost_buy | REAL | Estimated gas on buy chain |
| gas_cost_sell | REAL | Estimated gas on sell chain |
| net_profit_usd | REAL | Simulated profit after all costs |
| profit_pct | REAL | Return on trade size |

### daily_stats
Aggregated daily summary for quick dashboard display.

| Column | Type | Description |
|---|---|---|
| date | TEXT PK | YYYY-MM-DD |
| total_spreads | INTEGER | All spreads detected |
| actionable_spreads | INTEGER | Spreads above threshold |
| sim_trades | INTEGER | Simulated executions |
| total_sim_profit | REAL | Cumulative simulated P&L |
| avg_spread_pct | REAL | Mean net spread |
| best_spread_pct | REAL | Largest spread seen |
| most_active_pair | TEXT | Highest frequency pair |
| most_active_route | TEXT | e.g., 'arbitrum→base' |

---

## Configuration

```env
# === Chains ===
CHAINS=ethereum,arbitrum,base

# === RPC Endpoints (free tiers) ===
RPC_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# === Pairs ===
PAIRS=ETH/USDC,WBTC/USDC

# === Monitoring ===
POLL_INTERVAL_MS=15000
PRICE_HISTORY_DAYS=30

# === Detection Thresholds ===
MIN_GROSS_SPREAD_PCT=0.05
MIN_NET_SPREAD_PCT=0.02

# === Simulation ===
SIM_TRADE_SIZES=5000,10000,20000,50000
SIM_SLIPPAGE_TOLERANCE_PCT=0.5

# === Alerts (Telegram) ===
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ALERT_MIN_SPREAD_PCT=0.15
ALERT_COOLDOWN_SECONDS=300

# === Web Dashboard ===
PORT=3000
```

---

## Success Scenarios

### 🟢 Strong Signal — "Ship it"
- **10+ actionable spreads per day** averaging >0.15% net after fees
- Spreads persist for **>30 seconds** (executable with a bot)
- Simulated P&L shows **>$100/day** on $50K simulated capital
- Clear patterns: specific pairs/chains/times are consistently profitable
- **Projected annual return: $30-50K+ on $150K capital**
- **Action:** Build Phase 2 (real execution engine), deploy capital

### 🟡 Moderate Signal — "Keep watching"
- **3-10 actionable spreads per day** at 0.05-0.15% net
- Some spreads close too fast to execute reliably
- Simulated P&L: **$20-100/day** on $50K capital
- Profitable but marginal after realistic friction
- **Projected annual return: $10-30K on $150K capital**
- **Action:** Optimize detection speed, expand to more chains/pairs, add Solana, run for another month

### 🔴 Weak Signal — "Not worth it"
- **<3 actionable spreads per day** or average net spread <0.05%
- Most spreads close within seconds (speed-competitive, not complexity-competitive)
- Simulated P&L: **<$20/day** or negative after gas estimates
- The market is too efficient for this approach
- **Action:** Pivot. Either (a) add flash loan arb capabilities for same-chain complex arbs, (b) focus on event-driven only (monitor for depegs/volatility spikes rather than steady-state arbing), or (c) shelve and redirect effort to other income strategies

### 🔥 Spike Scenario — "Jackpot events"
- Normal days match Moderate or Strong signal
- But during market volatility events (stablecoin depegs, liquidation cascades, bridge outages), spreads explode to **1-5%+** lasting hours
- A single volatile day generates **$1,000-10,000** in simulated profits
- **Action:** This validates the "most money during chaos" thesis. Optimize the bot to be always-on and ready for these events, even if quiet-day profits are modest

---

## Phases

### Phase 1: Paper Trader (THIS PROJECT)
- Monitor real prices, detect spreads, simulate trades
- Zero capital at risk
- Duration: 2-4 weeks of data collection
- Cost: $0-5/month (free API tiers + Railway)
- Deliverable: Data-driven go/no-go decision

### Phase 2: Micro Live Trading (if Phase 1 shows Strong/Moderate signal)
- Deploy $5-10K real capital across 2-3 chains
- Execute real arbs at small size
- Validate: execution works, P&L matches simulation, no operational surprises
- Duration: 4-8 weeks
- Cost: $5-10K (recoverable capital) + gas

### Phase 3: Scale (if Phase 2 validates)
- Deploy $50-150K across 3-5 chains
- Full automation with monitoring and alerting
- Add more pairs, more chains, optimization
- Target: $50-150K annual gross profit

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Free API rate limits | Multiple RPC providers, fallback logic, efficient polling |
| 1inch API changes/deprecation | Abstract price source behind interface, easy to swap |
| Price data staleness | Timestamp checks, discard quotes older than threshold |
| Railway free tier limits | Lightweight design, SQLite not Postgres, minimal memory |
| False positives (arbs that aren't real) | Validate with multiple quote sources, realistic slippage modeling |
| Data gets too big | Prune price history older than configurable retention, aggregate into daily_stats |

---

## Out of Scope (Phase 1)

- Real wallet integration or transaction signing
- Actual trade execution
- Bridge/rebalancing logic
- Smart contract deployment
- Multi-user support
- Authentication

These are all Phase 2+ concerns. Phase 1 is read-only, data-collection, and analysis.

---

## Key Questions This Project Answers

1. Are there enough actionable cross-chain spreads to be worth trading?
2. How large are they and how long do they persist?
3. Which chain/pair combinations are most profitable?
4. What trade size maximizes profit vs. slippage?
5. What does the simulated P&L look like over 2-4 weeks?
6. Is this a viable income stream, or is the market too efficient?

**If the data says yes → build the real thing.**
**If the data says no → we saved $150K and learned something.**
