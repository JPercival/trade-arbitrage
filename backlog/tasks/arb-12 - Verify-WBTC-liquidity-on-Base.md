---
id: ARB-12
title: Verify WBTC liquidity on Base
status: To Do
assignee: []
created_date: '2026-02-02 17:22'
labels:
  - research
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before adding WBTC/USDC as a tracked pair on Base, verify there is sufficient liquidity.

Check DexScreener or DeFi Llama for WBTC pools on Base. If liquidity is thin (<$1M TVL), drop WBTC/USDC on Base from the pair config and document why.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 WBTC/USDC liquidity on Base checked via DexScreener or DeFi Llama
- [ ] #2 Decision documented: include or exclude WBTC/USDC on Base
- [ ] #3 Config updated if pair is dropped
<!-- AC:END -->
