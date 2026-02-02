---
id: ARB-2
title: SQLite database layer
status: To Do
assignee: []
created_date: '2026-02-02 17:20'
labels:
  - database
dependencies:
  - ARB-1
references:
  - VISION.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the SQLite database with better-sqlite3. Schema from VISION.md: prices, spreads, sim_trades, daily_stats tables.

Include:
- Schema creation/migration on startup
- Indexes on (chain, pair, timestamp), (pair, detected_at), (spread_id)
- Query helpers for inserts and common lookups
- Data retention pruning (configurable PRICE_HISTORY_DAYS)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All four tables created with correct schema
- [ ] #2 Indexes on key query patterns
- [ ] #3 Insert helpers for prices, spreads, sim_trades
- [ ] #4 Query helpers for latest prices, open spreads, trade history
- [ ] #5 Retention pruning deletes prices older than PRICE_HISTORY_DAYS
- [ ] #6 DB file created in data/ directory (gitignored)
<!-- AC:END -->
