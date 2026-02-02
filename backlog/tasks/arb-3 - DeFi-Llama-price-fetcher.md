---
id: ARB-3
title: DeFi Llama price fetcher
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
Tier 1 price source. Polls DeFi Llama for aggregated token prices across chains.

Endpoint: https://coins.llama.fi/prices/current/{chain}:{address},...
Batch all tokens across all chains in a single request.
Returns price, decimals, symbol, timestamp, confidence per token.

Should handle: rate limits, timeouts, stale data detection (reject quotes older than threshold).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fetches prices for all configured tokens across all chains in one call
- [ ] #2 Parses response into normalized price objects (chain, pair, price, timestamp)
- [ ] #3 Handles errors gracefully (timeout, 429, malformed response)
- [ ] #4 Rejects stale prices (timestamp older than configurable threshold)
- [ ] #5 Stores prices in the prices table via db layer
<!-- AC:END -->
