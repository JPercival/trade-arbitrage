---
id: ARB-6
title: Price monitor service
status: Done
assignee:
  - '@ros'
created_date: '2026-02-02 17:21'
updated_date: '2026-02-02 19:51'
labels:
  - engine
dependencies:
  - ARB-2
  - ARB-3
  - ARB-4
  - ARB-5
references:
  - ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Main polling loop that orchestrates the two-tier price strategy.

Every POLL_INTERVAL_MS:
1. Fetch all prices via DeFi Llama (Tier 1)
2. Store prices in DB
3. Compare same token across chains → detect gross spreads
4. If gross spread > MIN_GROSS_SPREAD_PCT → trigger ParaSwap quotes (Tier 2)
5. Hand off to spread detection engine

Should be resilient: catch errors per-cycle, log failures, keep running. Emit events or call callbacks for spread detection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Polls DeFi Llama at configured interval
- [x] #2 Stores all price snapshots in DB each cycle
- [x] #3 Compares prices cross-chain and identifies gross spreads
- [x] #4 Triggers ParaSwap quotes only when gross spread exceeds threshold
- [x] #5 Resilient to individual cycle failures (logs error, continues)
- [x] #6 Logs cycle stats (prices fetched, spreads detected, errors)
- [x] #7 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
