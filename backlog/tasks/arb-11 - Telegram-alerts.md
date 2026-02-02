---
id: ARB-11
title: Telegram alerts
status: To Do
assignee: []
created_date: '2026-02-02 17:21'
labels:
  - alerts
  - deferred
dependencies:
  - ARB-7
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Send Telegram notifications when spreads exceed ALERT_MIN_SPREAD_PCT.

Direct HTTP to Telegram Bot API (no library needed). Include:
- Pair, chains, gross/net spread %
- Estimated profit at default trade size
- Cooldown to avoid spam (ALERT_COOLDOWN_SECONDS)

Deferred — add when we have data worth alerting on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sends Telegram message when spread exceeds alert threshold
- [ ] #2 Message includes pair, chains, spread %, estimated profit
- [ ] #3 Cooldown prevents duplicate alerts within configured window
- [ ] #4 Graceful failure if bot token not configured (skip alerts, don't crash)
<!-- AC:END -->
