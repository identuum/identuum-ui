# Local authenticated Playwright fixtures

How the identuum-ui Playwright suite obtains authenticated credentials. There
are two modes; all paths below are relative to this repository's root
(`identuum-ui/`).

> **History.** Before THE-RELEASED-CONTRACT this document was a runbook for a
> pre-split monolith harness (a `/app/identuum` CLI, an `/e2e-auth` bind mount,
> `make local-restart`, machine-specific absolute paths). That harness is
> retired. The dynamic mode now builds fixtures against the PUBLISHED
> `identuum-idp-oss` appliance over its HTTP API — no sibling checkout, no bind
> mount, no absolute paths.

## Dynamic fixture mode (recommended)

Opt in with `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true`. `e2e/global-setup.ts` then:

1. Brings up the published appliance via `e2e/docker-compose.e2e.yml` (the
   `ghcr.io/identuum/identuum-idp-oss:v0.3.0` image plus a volume-less
   Postgres), unless a saved envelope is still valid — in which case it is
   reused and nothing is rebuilt.
2. Builds the fixtures against the released API (`e2e/helpers/appliance-fixture.ts`):
   setup → site_admin TOTP enrolment → org → org_admin → org_user, plus the
   seeded sample entities (public + confidential OAuth clients, an API
   resource, a service account).
3. Writes the envelope to `e2e/.auth/e2e-org-admin-fixture.json` (mode `0600`,
   gitignored via `e2e/.auth/`).

`e2e/helpers/login.ts` consumes it through `loadSiteAdminFixture()` /
`loadOrgAdminFixture()`. `e2e/global-teardown.ts` PRESERVES the envelope so
credentials stay stable across runs; a rebuild happens only when the envelope
is absent or its site_admin can no longer authenticate.

Run authenticated specs with `--workers=1` (TOTP replay protection rejects
concurrent logins sharing a 30-second code). See `e2e/README.md` for the
copy-paste commands.

**Never `cat`, paste, screenshot, or print the envelope contents** — it holds
generated passwords and captured TOTP secrets.

## Durable env mode (fallback; the only path for site_admin outside dynamic mode)

Long-lived credentials in `.env.playwright.idp-oss.local` at the repository
root (gitignored by `.env*.local` — never commit):

```
IDENTUUM_TEST_SITE_ADMIN_EMAIL=...
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=...
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=...
IDENTUUM_TEST_ORG_ADMIN_EMAIL=...
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=...
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=...   # optional; omit when MFA not enrolled
```

Authenticated specs self-skip when the required credentials are absent from
both the dynamic envelope and these env vars.
