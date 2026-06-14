# Playwright E2E Tests — Local Authenticated Setup

## Quick start (unauthenticated tests)

Unauthenticated tests run without any credentials:

```sh
npx playwright test
```

## Recommended: dynamic org-admin fixture mode

**For non-destructive org-admin Playwright tests, prefer dynamic fixture
mode.** It provisions a disposable org + org_admin pair before the run
and hard-purges it after. No `.env.playwright.local` edits are required
for the org_admin slot; the IDP CLI generates a fresh password + TOTP
secret per run and writes them to a gitignored local file the login
helper consumes automatically.

### Before the first dynamic run after pulling changes

Rebuild + restart the local IDP so the new CLI binary, migration,
compose bind mount, and env gate are all live:

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-idp
make local-restart
curl -s http://localhost:7113/health
```

### Run

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-ui

IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test e2e/org-admin-smoke.spec.ts --workers=1

IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test e2e/org-admin.spec.ts --workers=1

IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test e2e/org-admin-settings.spec.ts --workers=1
```

`--workers=1` is required (TOTP replay protection rejects concurrent
logins with the same 30-second code).

### What happens automatically

1. `e2e/global-setup.ts` runs preflight diagnostics inside the IDP
   container (`/app/identuum`, `/e2e-auth`, env gates, bind-mount
   probe). On any failure the error message names the exact fix.
2. `globalSetup` shells out to the IDP CLI to create the disposable
   fixture; the JSON envelope appears briefly under
   `identuum-ui/e2e/.auth/` with mode `0600`.
3. `e2e/helpers/login.ts` reads the file via `loadOrgAdminFixture()` and
   uses the generated credentials for every authenticated org_admin spec.
4. `e2e/global-teardown.ts` shells out to the IDP CLI to hard-purge the
   fixture organization (cascading every FK child row including
   `audit_events`) and unlinks the host file.

### Security

- `e2e/.auth/` is gitignored (entry in `identuum-ui/.gitignore`). The
  fixture JSON written there must never be committed.
- The fixture JSON contains a generated org_admin password + TOTP
  secret while tests run. **Never `cat`, paste, screenshot, or
  otherwise print its contents.** `globalTeardown` removes it after a
  successful run.
- Setting `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE` to any value other than
  the literal string `"true"` is a no-op; durable env mode is
  preserved unchanged.

### Detailed runbook

Full prerequisites, preflight troubleshooting matrix, cleanup
commands, audit-cascade contract, and recovery procedures live at
[`docs/LOCAL_ORG_ADMIN_PLAYWRIGHT_FIXTURE.md`](../docs/LOCAL_ORG_ADMIN_PLAYWRIGHT_FIXTURE.md)
(Section 9). Use that document whenever a preflight check fails or the
fixture file appears to be orphaned.

---

## Authenticated tests (durable env mode — fallback)

Durable env mode is the fallback path for org_admin authentication and
the only supported path for `site_admin` authentication. It uses
long-lived credentials kept in `.env.playwright.local`.

### 1. Create `.env.playwright.local`

Create `/Users/odemir/Development/2025-11/identuum/identuum-ui/.env.playwright.local`
(or the equivalent path relative to `identuum-ui/`).

**This file is gitignored by `.env*.local` — never commit it.**

Required env vars (fill in values from your local `identuum-idp-setup` output):

```
# Site-admin credentials (canonical names — these are the ONLY names read)
IDENTUUM_TEST_SITE_ADMIN_EMAIL=site_admin@system.local
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=<from identuum-idp-setup output>
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=<from identuum-idp-setup output>

# Dedicated org_admin test account
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<org_admin email>
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=<org_admin password>
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=<org_admin TOTP secret>
```

> **Migration note:** Legacy `IDENTUUM_TEST_EMAIL` / `IDENTUUM_TEST_PASSWORD` /
> `IDENTUUM_TEST_TOTP_SECRET` are no longer read. If you still have them in your
> local env file, rename them to the canonical `IDENTUUM_TEST_SITE_ADMIN_*`
> names. The mismatch between legacy and canonical sets is what caused
> `e2e/login.spec.ts` to use stale credentials while helper-based specs used
> the refreshed set.

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

Expected baseline: **28 passed, 0 skipped**.

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

Two site-admin org tests require at least one organization in the
`has_admin=true / can_assign_admin=true` state (expired pending invitation).

`e2e/helpers/fixture-expired-org.ts` maintains this state automatically before those
tests run. It is called from the `beforeAll` in `site-admin-organizations.spec.ts`.

### How it works

1. `ensureExpiredPendingOrgFixture(siteAdminCtx)` is called in `beforeAll`.
2. A `psql` query checks the state of `expired-admin@playwright-expired.local`.
3. If the user doesn't exist, it creates the org+user via the IdP API and then
   immediately expires the `activation_token_expires_at` via `psql`.
4. If the user is already in the `expired-pending` state, nothing is done.
5. If the user is in an `active` or `valid-pending` state, `psql` resets it.

### After a backend rebuild

A backend rebuild does not affect PostgreSQL data. The fixture org persists across
rebuilds. After any rebuild, the test suite should run with **28 passed, 0 skipped**.

**Important limitations:**

- **Local-only.** The fixture uses `psql` to expire `activation_token_expires_at` directly
  in the local PostgreSQL instance. No production-safe API endpoint exists for this.
- **Credentials**: `idp_user` / `idp_local_password` from `docker-compose.local.yml` —
  public dev-only values, not secrets.
- **Do not copy the psql mutation pattern** into broader tests or production code.
- Idempotent: the fixture is safe to run repeatedly. It skips if state is already correct.

### Fixture repair

If the fixture tests skip after a rebuild, the likely cause is the backend returning
`can_assign_admin=false` (e.g., after a backend regression). The DB state can be
verified with:

```sh
PGPASSWORD=idp_local_password psql -h localhost -p 5432 -U idp_user -d identuum_idp \
  -t -A -c "SELECT email_verified, activation_token_expires_at < NOW() FROM users \
  WHERE email = 'expired-admin@playwright-expired.local';"
```

Expected output: `f|t` (email_verified=false, token expired).

If the output is correct but tests still skip, the backend may not be returning
`can_assign_admin` in the API response. Check `types/organization_types.go` for the
`CanAssignAdmin` field and `HandleListOrganizations` for the
`CountVerifiedOrgAdminsByOrganizations` call.

If the user row is gone (e.g., after `DROP TABLE` or volume reset), simply re-run
the combined test suite — `ensureExpiredPendingOrgFixture` will recreate it.

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

## Destructive recovery spec — separate from dynamic mode

`e2e/site-admin-admin-recovery.spec.ts` covers the site_admin →
org_admin MFA-reset recovery flow. It is **destructive**: it clears
`mfa_enabled` + `mfa_secret` on a real org_admin row and revokes that
row's active sessions. **It is intentionally NOT wired to the dynamic
disposable fixture.**

To run it you must set ALL of:

```
IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=<set in .env.playwright.local>
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=<set in .env.playwright.local>
IDENTUUM_TEST_ORG_ID=<concrete fixture org UUID, NOT the all-zero placeholder>
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<concrete fixture org_admin email, NOT admin@example.org>
```

(Variable NAMES only — no values in this README.)

The spec's `requireConcreteDestructiveRecoveryTarget()` helper refuses
to run if `IDENTUUM_TEST_ORG_ID` is the all-zero placeholder or if
`IDENTUUM_TEST_ORG_ADMIN_EMAIL` is the neutral `admin@example.org`
placeholder. The refusal happens BEFORE any page interaction or HTTP
call to the IDP.

**Do not run this spec casually.** It is regression coverage for the
recovery flow, not a substitute for dynamic mode or durable env mode.

---

## CI

Authenticated tests self-skip when `IDENTUUM_TEST_SITE_ADMIN_PASSWORD` /
`IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET` are absent. Unauthenticated
route-redirect tests always run. Dynamic-mode org_admin tests also
self-skip when `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE` is unset — the
default-skip path is preserved for CI.

---

## Opt-in live-backend regression — `/upgrade` wizard backup flow

`e2e/upgrade-backup-live.spec.ts` drives the OSS-to-CE `/upgrade`
wizard backup affordance against a real source-build CE backend, an
OSS-shaped throwaway Postgres database, real `pg_dump`-driven
backups, real prune, real apply, real restart, and the post-apply
transition to first-run setup. The spec is gated on
`IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1` and self-skips otherwise, so
the standard `pnpm e2e` run stays fast and deterministic.

### Single-command runner

The recommended invocation:

```sh
make verify-live-upgrade-backup
# equivalent:
pnpm e2e:upgrade-backup-live
```

Both forms wrap `e2e/scripts/run-upgrade-backup-live.sh`. The runner:

1. Brings up a throwaway Compose project named
   `idp-ce-upgrade-backup-playwright-20260617` on host ports
   `7129` (IDP) and `7130` (UI). Postgres is internal-only. The
   project is independent of the standing `identuum-ui-app` dev
   container on `:7114` and never touches it.
2. Seeds the OSS-shape schema into the throwaway Postgres BEFORE
   the IDP first-boot probe runs.
3. Captures the one-time upgrade token to a mode-0600 file under
   `${SMOKE_DIR}` (default `/tmp/idp-ce-upgrade-backup-playwright-20260617`).
   The token VALUE never appears in stdout.
4. Runs the Playwright spec in headless Chromium.
5. ALWAYS tears the throwaway project down via the wrapper's
   `trap EXIT INT TERM HUP` — even on failure, on Ctrl-C, or on a
   hung step. Teardown zero-fills the upgrade-token file with
   `dd if=/dev/zero` before unlinking it.

The runner exits with the Playwright exit code on success; on
failure, the trap still runs teardown and the script exits with
the propagated Playwright exit code so `make verify-live-upgrade-backup`
fails the same way a normal `playwright test` invocation would.

### Prerequisites

- The sibling `identuum-idp-ce/` source tree (or set
  `IDENTUUM_CE_REPO=<path>` to point elsewhere).
- Docker Compose with BuildKit support.
- `curl` and `psql` (`psql` is consumed inside the throwaway
  Postgres container; no local install required).

### What is opt-in vs default

| Surface | Default behaviour | Opt-in behaviour |
|---------|------------------|------------------|
| `make verify` | runs biome + tsc + vitest only | unchanged |
| `pnpm e2e` (standard Playwright run) | runs every spec; `e2e/upgrade-backup-live.spec.ts` SKIPS cleanly | unchanged |
| `make verify-live-upgrade-backup` | not invoked | brings up the throwaway stack, runs the live spec, always tears down |
| `pnpm e2e:upgrade-backup-live` | not invoked | same as above |

The live runner deliberately does NOT integrate with default
`verify` or `e2e` so that the standing dev workflow stays fast.

### Security posture

- The upgrade-token plaintext, the DB password, and backup body
  bytes are NEVER printed by the harness, the wrapper, or the
  spec. The captured token lives only inside the mode-0600
  scratch file and is zero-filled before unlink.
- The throwaway stack is fully isolated by a unique Compose
  project name + scratch directory + named volumes.
- No `git add`, `git commit`, `git push`, `workflow_dispatch`,
  image publish, or repo/GHCR visibility change is performed by
  any wrapper script.

For the source-of-truth wire contract this spec exercises, see
[[wiki/repos/identuum-idp-ce]] §"OSS-to-CE upgrade wizard backup
retention & pruning (complete — 2026-06-17)" and the prior live
smoke entry. For the platform-level ledger see
[[wiki/platform/idp-appliance-install-ux]] §4.
