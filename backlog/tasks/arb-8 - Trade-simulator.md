---
id: ARB-8
title: Trade simulator
status: Done
assignee:
  - '@ros'
created_date: '2026-02-02 17:21'
updated_date: '2026-02-02 19:51'
labels:
  - engine
dependencies:
  - ARB-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an actionable spread is detected, simulate trades at multiple sizes.

For each SIM_TRADE_SIZE:
1. Get ParaSwap buy quote: USDC → token on buy_chain at trade_size
2. Get ParaSwap sell quote: token → USDC on sell_chain for tokens received
3. Calculate: gas_buy + gas_sell + net_profit = usd_received - trade_size - gas
4. Log sim_trade to DB

This shows how slippage scales with size — critical for deciding real trade sizes later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Simulates trades at all configured SIM_TRADE_SIZES
- [x] #2 Gets real ParaSwap quotes for both legs at each size
- [x] #3 Calculates net profit including gas costs on both chains
- [x] #4 Stores sim_trade records in DB with full breakdown
- [x] #5 Handles quote failures gracefully (log error, skip that size)
- [x] #6 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
