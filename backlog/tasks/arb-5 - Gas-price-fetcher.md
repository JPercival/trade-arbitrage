---
id: ARB-5
title: Gas price fetcher
status: To Do
assignee: []
created_date: '2026-02-02 17:21'
labels:
  - prices
  - rpc
dependencies:
  - ARB-1
  - ARB-3
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fetch live gas prices from each chain via ethers.js + free RPCs.

Used to estimate swap gas costs when ParaSwap gas estimates are unavailable or as a cross-check.

For L2s (Arbitrum, Base), also need to account for L1 data posting costs in gas estimation. ethers.js getFeeData() handles this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fetches current gas price from all configured chains
- [ ] #2 Returns gas price in both gwei and USD (using ETH price from DeFi Llama)
- [ ] #3 Estimates swap cost in USD per chain (gas price × ~200K gas units)
- [ ] #4 Handles RPC errors and timeouts
<!-- AC:END -->
