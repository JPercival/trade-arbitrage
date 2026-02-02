---
id: ARB-1
title: Project setup and config
status: To Do
assignee: []
created_date: '2026-02-02 17:20'
labels:
  - setup
dependencies: []
references:
  - ARCHITECTURE.md
  - .env.example
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Initialize package.json, install dependencies, create directory structure, and build the config loader.

Dependencies: express, ejs, better-sqlite3, ethers, chart.js, dotenv
Free RPCs: eth.llamarpc.com, arb1.arbitrum.io/rpc, mainnet.base.org

Config loader reads .env and exports chain configs, token addresses, pairs, thresholds, and all settings. Token address registry is hardcoded (WETH, USDC, WBTC per chain). See ARCHITECTURE.md for full token address table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 package.json with all dependencies
- [ ] #2 Directory structure matches ARCHITECTURE.md
- [ ] #3 Config loader exports chain configs, token addresses, pairs, thresholds
- [ ] #4 .env.example is accurate and documented
- [ ] #5 npm install runs clean, npm start doesn't crash
<!-- AC:END -->
