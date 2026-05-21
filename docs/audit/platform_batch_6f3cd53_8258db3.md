# UI Platform Batch Note — 6f3cd53 + 8258db3

## Why this note exists

Both 6f3cd53 and 8258db3 were pushed to `main` on 2026-05-21. Each commit is broader
than its title strictly describes. This note records the full scope for future
contributors and release-note authors.

This doc follows the same convention as identuum-idp's
`docs/audit/platform_batch_e69f5f7.md`.

---

## Commit 6f3cd53 — "ui: show runtime component availability status"

### Intended scope (as described)

- Server-side `discoverRuntime()` calling each backend's `GET /api/v1/component`
- `computePlatformMode()` — 7 modes: `full-platform`, `identity-only`,
  `agent-governance-only`, `degraded-idp-unavailable`, `degraded-ag-unavailable`,
  `misconfigured`, `unconfigured`
- `/platform-status` SSR page — `ModeBadge` + per-backend `BackendCard`
- `/api/runtime` route — returns `RuntimeState` JSON for external consumers
- `/api/status` route — lightweight health probe
- Unit tests: all 7 mode permutations, all discovery error paths (756 vitest tests)
- Playwright tests: `e2e/platform-status.spec.ts` (13 tests)

### Also included in same commit

- AG auth routes: `/api/ag-auth/login`, `/api/ag-auth/providers`
- Org-link plan/write routes: `/api/org-link/plan`, `/api/org-link/organizations/[ag_org_id]/link`
- Site-admin org-link page + actions
- Org-link client library: `ag-org-link-write-client.ts`, `org-link-types.ts`, `org-link-utils.ts`
- AG org client: `ag-org-client.ts`
- AG auth providers client: `ag-auth-providers.ts`
- Navigation mode library: `navigation-mode.ts`
- Mock infrastructure: `src/__mocks__/next-headers.ts`, `server-only.ts`
- Unit tests: `ag-auth-providers.test.ts`, `ag-org-client.test.ts`,
  `ag-org-link-write-client.test.ts`, `navigation-mode.test.ts`, `runtime-config.test.ts`
- Vitest config: `vitest.config.ts`

---

## Commit 8258db3 — "ui: add AG admin feature batch — agents, HITL, revocations, audit, sessions, org-link import"

### Feature areas

**AG admin pages (new)**
- Agent list, detail, create, edit: `/ag-admin/(authed)/agents/*`
- Session detail: `/ag-admin/(authed)/sessions/[id]/page.tsx`
- HITL detail: `/ag-admin/(authed)/hitl/[id]/page.tsx`
- Revocations list: `/ag-admin/(authed)/revocations/page.tsx`
- Audit log: `/ag-admin/(authed)/audit/page.tsx`
- AG admin login layout: `ag-admin/login/layout.tsx`

**AG admin pages (modified)**
- Dashboard, sessions list, HITL queue, MCP page, layout/nav, login page

**Org-link import**
- `/api/org-link/import/route.ts` — server action for importing AG orgs

**Account settings**
- `account/layout.tsx`, `settings/page.tsx`, `sessions-section.tsx`

**Org-admin**
- Users list/detail/invite/actions, settings page, audit page, `org-profile-form.tsx`

**Shared UI infrastructure**
- `audit-filter-panel.tsx`, `audit-identity-cell.tsx`, `setup-link-panel.tsx`
- `audit-event-types.ts`, `idp-admin-client.ts`

**Tests (new)**
- 13 vitest spec files: `ag-agent-*.test.ts`, `ag-hitl*.test.ts`, `ag-audit.test.ts`,
  `ag-dashboard.test.ts`, `ag-detail-pages.test.ts`, `ag-list-controls.test.ts`,
  `ag-login-layout.test.ts`, `ag-mcp.test.ts`, `ag-revocations.test.ts`,
  `ag-session-revocation.test.ts`, `import-all-batch.test.ts`
- Playwright helpers and spec updates: `e2e/README.md`, `global-setup.ts`,
  `fixture-expired-org.ts`, `login.ts`, `org-admin-smoke.spec.ts`,
  `site-admin-organizations.spec.ts`

---

## Validation performed (2026-05-21)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — no type errors |
| `pnpm test` (vitest) | PASS — 756/756 tests, 20 files |
| `npx next build` | PASS — all routes compiled |
| `pnpm playwright test` (run 1) | 60/60 PASS |
| `pnpm playwright test` (run 2) | PASS — 60/60 PASS (15.5s), no flake |
| `GET /api/health` (live stack) | `{"status":"ok","configured":true}` |
| `GET /api/runtime` (live stack) | mode: `full-platform` |

### Known test flake

`e2e/site-admin-audit.spec.ts` had a TOTP timing collision in earlier runs (documented
in project memory under `project_playwright_stabilization.md` and
`project_e2e_adaptive_enforcement_bypass.md`). The IDP compose file now includes
`IDENTUUM_IDP_E2E_DISABLE_ADAPTIVE_ENFORCEMENT: "true"` (added in IDP commit e69f5f7).
The latest Playwright run (60/60) did not exhibit the failure.

---

## UUID/ID audit

No `Math.random()` or `crypto.randomUUID()` used for persistent domain IDs. Two
occurrences of `00000000-0000-0000-0000-000000000000` are sentinel comparisons for
system-org detection, not generated values.

---

## Decision

Both commits accepted as broad UI platform batches. History not rewritten. Future
commits should be more granular.
