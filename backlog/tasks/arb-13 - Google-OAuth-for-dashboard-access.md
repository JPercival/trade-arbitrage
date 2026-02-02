---
id: ARB-13
title: Google OAuth for dashboard access
status: Done
assignee:
  - '@ros'
created_date: '2026-02-02 18:57'
updated_date: '2026-02-02 20:12'
labels:
  - web
  - auth
dependencies:
  - ARB-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Google Sign-In to protect the dashboard from open internet access.

Same pattern as the deal tracker (passport-google-oauth20 or similar). Single-user: allowlist JP email in env var.

Environment flag (e.g. AUTH_BYPASS=true) skips auth entirely for local dev.

Protect all routes except /api/health (needed for Railway health checks).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Google OAuth login flow works (sign in with Google button)
- [x] #2 Only allowed email(s) can access the dashboard (configurable allowlist)
- [x] #3 All routes except /api/health require authentication
- [x] #4 AUTH_BYPASS=true env flag disables auth for local development
- [x] #5 Session persists across page loads (cookie-based)
- [x] #6 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
