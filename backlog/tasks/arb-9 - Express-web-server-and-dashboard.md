---
id: ARB-9
title: Express web server and dashboard
status: Done
assignee:
  - '@ros'
created_date: '2026-02-02 17:21'
updated_date: '2026-02-02 20:12'
labels:
  - web
  - dashboard
dependencies:
  - ARB-2
  - ARB-7
references:
  - ARCHITECTURE.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Express + EJS web dashboard. Start with a single-page dashboard that shows everything useful.

Pages:
- Dashboard (/) — live prices per chain, current spreads, recent sim trades, summary stats
- Trades (/trades) — full simulated trade log, filterable
- Analytics (/analytics) — Chart.js charts: cumulative P&L, arbs/day, spread distribution, chain-pair heatmap

API endpoints for JSON data (see ARCHITECTURE.md).
Health check endpoint at /api/health.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Express server starts on configured PORT
- [x] #2 Dashboard page shows current prices, open spreads, recent trades, summary stats
- [x] #3 Trades page shows paginated sim_trade log with filters
- [x] #4 Analytics page has cumulative P&L chart and arbs/day trend
- [x] #5 API endpoints return JSON for all dashboard data
- [x] #6 Health check endpoint returns monitor status and last poll time
- [x] #7 Responsive layout that works on desktop and mobile
- [x] #8 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
