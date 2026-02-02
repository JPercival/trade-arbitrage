---
id: ARB-7
title: Spread detection engine
status: To Do
assignee: []
created_date: '2026-02-02 17:21'
labels:
  - engine
dependencies:
  - ARB-6
references:
  - VISION.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Core logic: given prices from both tiers, detect actionable cross-chain spreads.

For each token, compare all chain pairs (Arb↔Base, Eth↔Arb, Eth↔Base).
Calculate:
- Gross spread % (raw price difference)
- Net spread % (after swap fees from ParaSwap + gas costs)
- Identify buy chain (cheaper) and sell chain (more expensive)

Track spread lifecycle:
- Open: first detected above threshold
- Update: spread changes while still open
- Close: spread drops below threshold
- Duration: how long it persisted

Weight L2↔L2 spreads (flag Ethereum legs as high-friction).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Compares all chain combinations for each token
- [ ] #2 Calculates gross and net spread percentages correctly
- [ ] #3 Creates spread record in DB when net spread exceeds MIN_NET_SPREAD_PCT
- [ ] #4 Tracks spread lifecycle (open → update → close with duration)
- [ ] #5 Flags Ethereum-leg spreads as high-friction in the spread record
- [ ] #6 Updates daily_stats aggregates on each new spread
<!-- AC:END -->
