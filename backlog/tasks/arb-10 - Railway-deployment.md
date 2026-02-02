---
id: ARB-10
title: Railway deployment
status: To Do
assignee: []
created_date: '2026-02-02 17:21'
labels:
  - deploy
dependencies:
  - ARB-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deploy to Railway (hobby tier). Single service running monitor + web server.

Needs:
- Procfile or Railway config
- Volume mount for SQLite persistence
- Environment variables configured
- Health check configured
- Auto-deploy from GitHub (set up remote first)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App deploys to Railway and starts successfully
- [ ] #2 SQLite database persists across deploys (volume mount)
- [ ] #3 Environment variables configured in Railway dashboard
- [ ] #4 Health check endpoint is monitored
- [ ] #5 Dashboard accessible via Railway URL
<!-- AC:END -->
