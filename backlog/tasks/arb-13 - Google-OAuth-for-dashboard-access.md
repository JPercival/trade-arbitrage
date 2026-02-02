---
id: ARB-13
title: Google OAuth for dashboard access
status: To Do
assignee: []
created_date: '2026-02-02 18:57'
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
- [ ] #1 Google OAuth login flow works (sign in with Google button)
- [ ] #2 Only allowed email(s) can access the dashboard (configurable allowlist)
- [ ] #3 All routes except /api/health require authentication
- [ ] #4 AUTH_BYPASS=true env flag disables auth for local development
- [ ] #5 Session persists across page loads (cookie-based)
- [ ] #6 100% test coverage for all new code (unit tests with vitest or similar)
<!-- AC:END -->
