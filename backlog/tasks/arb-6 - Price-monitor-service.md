---
id: ARB-6
title: Price monitor service
status: To Do
assignee: []
created_date: '2026-02-02 17:21'
updated_date: '2026-02-02 18:12'
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
- [ ] #1 Polls DeFi Llama at configured interval
- [ ] #2 Stores all price snapshots in DB each cycle
- [ ] #3 Compares prices cross-chain and identifies gross spreads
- [ ] #4 Triggers ParaSwap quotes only when gross spread exceeds threshold
- [ ] #5 Resilient to individual cycle failures (logs error, continues)
- [ ] #6 Logs cycle stats (prices fetched, spreads detected, errors)
- [ ] #7 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
