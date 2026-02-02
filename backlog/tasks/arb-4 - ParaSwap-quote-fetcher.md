---
id: ARB-4
title: ParaSwap quote fetcher
status: To Do
assignee: []
created_date: '2026-02-02 17:20'
labels:
  - prices
  - api
dependencies:
  - ARB-1
references:
  - ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 2 price source. Gets realistic swap quotes from ParaSwap DEX aggregator.

Endpoint: https://api.paraswap.io/prices?srcToken=...&destToken=...&amount=...&network=...&side=SELL
Free, no auth. Returns best route, dest amount, gas cost USD, routing details.

Used only when Tier 1 (DeFi Llama) detects a spread worth investigating. Fires quotes for both legs of the arb (buy side + sell side).

Network IDs: Ethereum=1, Arbitrum=42161, Base=8453
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fetches swap quote for a given token pair, amount, and chain
- [ ] #2 Parses response into execution price, gas cost, and route info
- [ ] #3 Handles both legs: USDC→token (buy) and token→USDC (sell)
- [ ] #4 Handles errors, timeouts, and rate limiting gracefully
- [ ] #5 Calculates effective price per token after all routing
<!-- AC:END -->
