# Playwright E2E Tests — Local Authenticated Setup

## Quick start (unauthenticated tests)

Unauthenticated tests run without any credentials:

```sh
npx playwright test
```

## Authenticated tests

Authenticated tests require credentials in a local env file.

### 1. Create `.env.playwright.local`

Create `/Users/odemir/Development/2025-11/identuum/identuum-ui/.env.playwright.local`
(or the equivalent path relative to `identuum-ui/`).

**This file is gitignored by `.env*.local` — never commit it.**

Required env vars (fill in values from your local `identuum-idp-setup` output):

```
# Site-admin credentials
IDENTUUM_TEST_SITE_ADMIN_EMAIL=site_admin@system.local
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=<from identuum-idp-setup output>
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=<from identuum-idp-setup output>

# Legacy aliases (kept for backward compatibility — same values as above)
IDENTUUM_TEST_EMAIL=site_admin@system.local
IDENTUUM_TEST_PASSWORD=<same as SITE_ADMIN_PASSWORD>
IDENTUUM_TEST_TOTP_SECRET=<same as SITE_ADMIN_TOTP_SECRET>

# Dedicated org_admin test account
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<org_admin email>
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=<org_admin password>
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=<org_admin TOTP secret>
```

The site_admin credentials come from running the setup helper:

```sh
docker compose -f deployment/docker-compose.local.yml \
  --profile setup run --rm -T identuum-idp-setup
```

The org_admin account must be created manually once (see **Fixture accounts** below).

### 2. Load the env file

`playwright.config.ts` loads `.env.playwright.local` automatically before tests run.
Shell-provided env vars always take precedence over the file.

No manual `source` is needed.

### 3. Run authenticated tests

```sh
npx playwright test e2e/site-admin-organizations.spec.ts \
                   e2e/site-admin-audit.spec.ts \
                   e2e/org-admin-smoke.spec.ts \
                   --workers=1
```

**`--workers=1` is required.** TOTP replay protection rejects concurrent logins that use
the same 30-second code. Running with multiple workers causes intermittent auth failures.

Expected baseline: **32 passed, 0 skipped**.

---

## Fixture accounts

### site_admin

`site_admin@system.local` is the system admin created by `identuum-idp-setup`. Reset
credentials at any time by re-running the setup helper with `--force`.

### org_admin

`IDENTUUM_TEST_ORG_ADMIN_*` targets a dedicated org_admin account in a test organization.
This account must be created once and its credentials stored in `.env.playwright.local`.

The account was set up using the site_admin API to create a test organization and generate
an invitation, which was then claimed to establish the account.

---

## `can_assign_admin=true` fixture

Two conditional site-admin org tests require at least one organization in the
`has_admin=true / can_assign_admin=true` state (expired pending invitation).

`e2e/helpers/fixture-expired-org.ts` maintains this state automatically before those
tests run. It is called from the `beforeAll` in `site-admin-organizations.spec.ts`.

**Important limitations:**

- **Local-only.** The fixture uses `psql` to expire `activation_token_expires_at` directly
  in the local PostgreSQL instance. No production-safe API endpoint exists for this.
- **Credentials**: `idp_user` / `idp_local_password` from `docker-compose.local.yml` —
  public dev-only values, not secrets.
- **Do not copy the psql mutation pattern** into broader tests or production code.
- Idempotent: the fixture is safe to run repeatedly. It skips if state is already correct.

If the fixture org needs resetting (e.g., after the test account claimed its invitation),
delete the `expired-admin@playwright-expired.local` user row and re-run the test suite.

---

## TOTP replay protection and per-account cooldown

The login helper (`e2e/helpers/login.ts`) includes two layers of TOTP replay protection:

**1. Proactive per-account cooldown** (primary, no failures expected):

`loginAsSiteAdmin` and `loginAsOrgAdmin` track the last successful TOTP login time for
each account (keyed by email) in a module-level map. Before submitting a TOTP code, if
the same account completed a login within the last 32 seconds, the helper automatically
waits until a new TOTP window is safe.

Under `--workers=1`, this map persists across spec-file `beforeAll` calls in the same
Playwright worker process. This means back-to-back combined suite runs work reliably
without manual `sleep` — the helper adds a short automatic wait when needed.

**2. Reactive retry** (fallback, adds ~30s if triggered):

If a code is rejected despite the cooldown (e.g., leftover replay from a previous
process), the helper waits for the next 30-second window and retries once.

**Expected behaviour:**
- Single combined run: may add up to ~32s overhead when the site_admin account is
  reused across spec files (e.g., `site-admin-organizations` then `site-admin-audit`).
- Immediate back-to-back combined runs: first run sets the cooldown; second run waits
  automatically — no `sleep 35` needed.
- Different accounts (site_admin vs org_admin): no interference — cooldowns are keyed
  per email and do not affect each other.

`--workers=1` is still required to prevent parallel logins from exhausting TOTP codes
within the same window.

---

## Session stability

The Next.js UI server can become unstable after heavy concurrent test loads (visible as
500 errors on site-admin routes). Restart the UI container to recover:

```sh
docker compose -f deployment/docker-compose.local.yml restart identuum-ui
```

---

## CI

Authenticated tests self-skip when `IDENTUUM_TEST_PASSWORD` (or the `SITE_ADMIN_*`
equivalent) is absent. Unauthenticated route-redirect tests always run.
