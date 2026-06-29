# Local org_admin Playwright fixture — restore runbook

This is an operator runbook for restoring the local org_admin Playwright
login fixture when the authenticated `/org-admin/*` Playwright tests start
self-skipping.

It is local-only documentation. It contains no secret values, no
fixture-specific identifiers, and no real customer/company names. Every
example uses neutral placeholders (`admin@example.org`, `example.org`,
`Example Organization`, `<ORG_ADMIN_USER_ID>`).

It preserves the org-admin MFA enforcement: the goal is to re-establish
both the password and the TOTP secret in the local env file, not to
bypass MFA.

---

## Recommended path for non-destructive org-admin Playwright

**For routine local runs of the non-destructive org-admin specs, prefer
dynamic mode. It does not require any `.env.playwright.idp-oss.local` setup.**

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-ui
IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test e2e/org-admin-smoke.spec.ts --workers=1
```

Dynamic mode provisions a disposable org + org_admin pair before the run
and hard-purges it after. No env file edits, no shared fixture state.
Full setup walkthrough in **Section 9**.

Use durable mode (Sections 1–8) only when you specifically need a
long-lived org_admin row whose password + TOTP secret live in
`.env.playwright.idp-oss.local`. Use neither for `e2e/site-admin-admin-recovery.spec.ts` —
that spec is destructive and intentionally isolated; see Section 9k.

---

## 1. Why org_admin Playwright tests skip

`e2e/helpers/login.ts` exports `skipOrgAdminTests` and every authenticated
org_admin spec checks it before running:

```ts
export const skipOrgAdminTests = !ORG_ADMIN_EMAIL || !ORG_ADMIN_PASSWORD;
```

If **either** `IDENTUUM_TEST_ORG_ADMIN_EMAIL` or
`IDENTUUM_TEST_ORG_ADMIN_PASSWORD` is missing from
`.env.playwright.idp-oss.local`, every org_admin test silently self-skips and the
suite reports green via skips — exactly the false-positive this runbook
prevents.

`IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` is **optional** as far as the
helper is concerned, but it is **required in practice** whenever the
target org_admin row has `mfa_enabled=true`. Without it, the login flow
gets stuck on the TOTP verification screen.

The login helper also caches a session at
`/tmp/identuum-org-admin-session.json` for 10 minutes. A cached session
from a prior run can succeed even when env values are stale, then expire
mid-suite and leave the operator confused about why later runs fail.

---

## 2. Verify non-secret local state

Before changing anything, confirm what is actually broken. Run these
read-only checks. They print booleans and presence flags only.

### 2a. Service health

```sh
curl -s http://localhost:7113/health
curl -s http://localhost:7104/api/health
```

Both should report `status: healthy` / `status: ok`. If either fails, the
problem is the local stack, not the fixture.

### 2b. Org-admin DB state (safe SELECT)

This pattern returns booleans (`mfa_enabled`, `has_secret`,
`email_verified`, etc.) without exposing the password hash, the MFA
secret, the recovery codes, or the session table. Replace
`admin@example.org` with the actual fixture email when running locally.

```sh
docker exec identuum-idp-postgres psql -U idp_user -d identuum_idp -c "
  select id,
         email,
         role,
         banned,
         (deleted_at is null) as alive,
         mfa_enabled,
         (mfa_secret is not null) as has_secret,
         email_verified,
         organization_id,
         requires_password_change,
         last_login_at
    from users
   where email = 'admin@example.org';
"
```

Healthy fixture row:

```
role            = org_admin
banned          = f
alive           = t
mfa_enabled     = t      (or f if you intentionally cleared it)
has_secret      = t      (must match mfa_enabled)
email_verified  = t
requires_password_change = f
```

**Do not run this query against the password_hash, mfa_secret, or
mfa_recovery_codes columns.** They contain credential material. The
boolean predicates above are sufficient for a fixture health check.

### 2c. Env-key presence (no values)

```sh
grep -E "^IDENTUUM_TEST_ORG_ADMIN_[A-Z_]+=" .env.playwright.idp-oss.local \
  | sed 's/=.*$/=<redacted>/'
```

Expected key set (presence only):

```
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<redacted>
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=<redacted>
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=<redacted>
```

If `IDENTUUM_TEST_ORG_ADMIN_PASSWORD` or
`IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` is missing, that is the symptom
this runbook fixes.

### 2d. Cached Playwright session file

```sh
ls -la /tmp/identuum-org-admin-session.json 2>/dev/null
```

If the file is older than ~15 minutes, it will no longer satisfy the
helper's 10-minute reuse window. Delete it before re-running so the test
exercises a fresh login (see section 6).

---

## 3. Restore the password (supported flow)

Two supported paths are available. Prefer (3a). Use (3b) only when the
account password is unknown and cannot be retrieved from a local secret
store.

### 3a. Operator already has the password

If the original password was stored in 1Password / a system keychain /
any local secret store, just paste it into `.env.playwright.idp-oss.local` (see
section 5) and skip to section 4.

### 3b. Rotate the password as site_admin (supported REST endpoint)

1. Sign in to the local stack at `http://localhost:7104/login` as
   `site_admin` (canonical email `site_admin@system.local`).
2. From an authenticated session, issue:

   ```sh
   curl -X PUT "http://localhost:7113/api/v1/users/<ORG_ADMIN_USER_ID>" \
     -H "Content-Type: application/json" \
     -b "<session cookies from your browser>" \
     -d '{"password": "<NEW_STRONG_PASSWORD>"}'
   ```

   - `<ORG_ADMIN_USER_ID>` is the UUID returned by the SELECT in section
     2b.
   - `<NEW_STRONG_PASSWORD>` is operator-chosen. Do not paste it into a
     PR description, chat transcript, screenshot, or this runbook.
   - The route is implemented at
     `internal/handlers/handler_user.go` (`HandleUpdateUser`) and the
     password field is wired through `service.UpdateUserOptions.Password`.
     site_admin holds the required `ScopeUsersUpdate`.

3. Audit emits the user-update event. The password is rotated in-place;
   admin@example.org's row ID, organization membership, role, and
   `mfa_enabled` are unchanged.

> **Do not paste the new password into this conversation, into any
> public-facing markdown, or into a committed test fixture.** It belongs
> only in your local secret store and in `.env.playwright.idp-oss.local` (which
> is gitignored by `.env*.local`).

---

## 4. Restore TOTP / preserve MFA (do NOT bypass)

Org-admin MFA enforcement is a load-bearing UI guard (UI-FEATURES.md
Section 6). The correct repair restores the TOTP fixture; it does not
disable MFA on the org_admin row, on the organization's `mfa_policy`, or
on the layout guard.

### 4a. If `mfa_enabled=true` and the operator has the TOTP secret

Paste it into `IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` (section 5) and
proceed to validation. No reset required.

### 4b. If `mfa_enabled=true` but the TOTP secret is lost

This is the canonical "lost authenticator" recovery flow.

1. Sign in as site_admin (as above).
2. Issue the documented reset:

   ```sh
   curl -X POST "http://localhost:7113/api/v1/users/<ORG_ADMIN_USER_ID>/recovery/reset-mfa" \
     -H "Content-Type: application/json" \
     -b "<session cookies from your browser>"
   ```

   This clears `mfa_enabled` and `mfa_secret` on the target row, revokes
   the target's live sessions, and emits `AuditOrgAdminMFAReset`. It is
   the documented exception to the Blind Sovereign Bunker policy
   (`internal/handlers/handler_org_admin_recovery.go`).

3. Sign in to the local UI as the fixture org_admin (the new password
   from section 3b will work). The login flow detects
   `mfa_enrollment_required` and routes you into the in-page TOTP
   enrollment surface at `/account/settings?reason=mfa_required`.
4. Complete enrollment. **The TOTP secret is shown exactly once on the
   enrollment page.** Capture it manually into your local secret store
   immediately — there is no second chance to read it later.
5. Verify the secret works by completing the enrollment confirmation
   step in the UI.
6. Paste the secret into `IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` (section
   5).

The post-recovery row state should be `mfa_enabled=t`, `has_secret=t` —
MFA is fully restored, the layout guard is unchanged, and Playwright now
has the secret material it needs.

### 4c. If `mfa_enabled=false` is acceptable

Possible only when the organization's `mfa_policy=optional` AND the
specs you intend to run do not rely on TOTP being present. This is
**discouraged** because the org-admin layout guard
(`src/app/org-admin/layout.tsx`) still redirects users without
`mfa_enabled=true` to `/account/settings?reason=mfa_required`. The
result is that the spec login lands on the account-settings page
instead of `/org-admin/*` and the spec fails with a misleading "no
heading found" assertion.

Prefer (4b) — restoring enrollment — over (4c).

---

## 5. Update local env values (variable names only)

Edit `.env.playwright.idp-oss.local` so it contains, at minimum:

```
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<fixture org_admin email>
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=<from secret store or section 3>
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=<from secret store or section 4>
```

- The file is gitignored by `.env*.local` in `identuum-ui/.gitignore`.
  Never commit it.
- Do not include real values in code review, screenshots, terminal
  pastes, or commit messages.
- Shell-provided env vars take precedence over the file
  (`playwright.config.ts:9–25`). If a stale shell export shadows the
  file, `unset IDENTUUM_TEST_ORG_ADMIN_PASSWORD` before running the
  suite.

---

## 6. Clear the stale Playwright session cache

The login helper caches cookies for 10 minutes. If the previous run used
a stale env, the cached cookies may still be present and confuse the
next run. Purge them before re-validating:

```sh
rm -f /tmp/identuum-org-admin-session.json
```

(The `/tmp/identuum-totp-cooldown.json` file is a non-secret replay
guard — leave it alone unless you also rotated the TOTP secret. If you
rotated, it is safe to delete that file too.)

---

## 7. Validate

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-ui
npx playwright test e2e/org-admin-smoke.spec.ts --workers=1
npx playwright test e2e/org-admin.spec.ts --workers=1
```

Use `--workers=1` because TOTP replay protection rejects concurrent
logins that generate the same 30-second code.

If both runs complete with zero skipped org_admin tests, the fixture is
restored.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| All org_admin tests report "skipped" with the message `Set IDENTUUM_TEST_ORG_ADMIN_PASSWORD ...` | `IDENTUUM_TEST_ORG_ADMIN_EMAIL` or `IDENTUUM_TEST_ORG_ADMIN_PASSWORD` missing | Section 5 |
| Login completes but the spec lands on `/account/settings?reason=mfa_required` and asserts fail | `mfa_enabled=true` on the row but `IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` missing or wrong | Section 4 |
| TOTP code rejected on first try, then accepted on retry | Replay protection — the 30-second window had already been used | Wait one window, or accept the helper's built-in retry |
| TOTP code rejected on every try | `IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET` does not match the row's `mfa_secret` (e.g. you rotated MFA but did not update the env) | Re-do section 4 and re-paste the freshly captured secret |
| First test passes, second test hangs at login | Cached session expired mid-suite | Section 6 |
| "Could not resolve your organization" red banner during a settings test | DB row `organization_id` is NULL or points at a deleted org | Inspect via section 2b; if the fixture organization was deleted, restore from a snapshot or rebuild it via site_admin |

---

## 9. Dynamic mode — disposable fixture via the IDP CLI (automatic)

Sections 1–8 describe **durable mode**: a long-lived org_admin row whose
password + TOTP secret live in `.env.playwright.idp-oss.local`. Dynamic mode is a
different choice: create a fresh disposable org + org_admin pair just for
the test run, then hard-purge it afterward. Use dynamic mode when the
fixture identity should not survive a `git pull` or a teammate's local
re-spin of the stack.

As of 2026-05-30 the orchestration is **automatic**: a bind mount in
`deployment/docker-compose.local.yml` exposes `identuum-ui/e2e/.auth/`
to the IDP container as `/e2e-auth`, and Playwright's `globalSetup` /
`globalTeardown` shell out to the IDP fixture CLI before/after the run.
Manual `docker cp` rituals are no longer required.

### 9a. Prerequisites

The compose file already sets the required IDP env vars:

```
IDENTUUM_IDP_INSECURE_DEV_MODE: "true"
IDENTUUM_E2E_FIXTURE_CLI_ENABLED: "true"
```

The compose volumes block already mounts:

```
- ${IDENTUUM_UI_E2E_AUTH_DIR:-../../identuum-ui/e2e/.auth}:/e2e-auth:rw
```

After pulling the new compose, restart the IDP container so the env +
bind mount take effect:

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-idp
make local-restart
curl -s http://localhost:7113/health
```

If a contributor checks out the repos at a non-default location they
can override the host path via `IDENTUUM_UI_E2E_AUTH_DIR` in their
shell before invoking `make local-restart`.

### 9b. Run Playwright in dynamic mode

```sh
cd /Users/odemir/Development/2025-11/identuum/identuum-ui
rm -f /tmp/identuum-org-admin-session.json   # purge stale cached cookies
IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test e2e/org-admin-smoke.spec.ts --workers=1
```

What happens automatically:

1. `globalSetup` detects `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true` and
   runs preflight diagnostics (see Section 9e). On any failure the
   error message names the exact fix command.
2. `globalSetup` creates `identuum-ui/e2e/.auth/` with mode `0700` and
   shells out to `docker compose ... exec -T identuum-idp /app/identuum
   --e2e-create-org-admin-fixture --output /e2e-auth/e2e-org-admin-fixture.json`.
3. The IDP CLI writes the JSON envelope through the bind mount, mode
   `0600`. The file appears briefly under `identuum-ui/e2e/.auth/`.
4. `e2e/helpers/login.ts` reads the file via `loadOrgAdminFixture()`
   and uses the generated org_admin credentials for every authenticated
   spec.
5. After the run, `globalTeardown` shells out to `... --e2e-purge-org-fixture
   --fixture-file /e2e-auth/e2e-org-admin-fixture.json --confirm-e2e-purge`.
6. The IDP CLI hard-deletes the fixture organization (cascading every FK
   child row including `audit_events`) and unlinks the host file.

After a successful run:
- `e2e/.auth/e2e-org-admin-fixture.json` should be absent (`test ! -f`
  exits 0).
- `SELECT count(*) FROM organizations WHERE e2e_fixture_marker IS NOT NULL`
  should return `0`.

### 9c. Recommended specs for dynamic mode

These specs have been verified end-to-end under
`IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true`:

```sh
npx playwright test e2e/org-admin-smoke.spec.ts --workers=1
npx playwright test e2e/org-admin.spec.ts --workers=1
npx playwright test e2e/org-admin-settings.spec.ts --workers=1
```

All three are non-destructive (render-and-assert; no form submission,
no DB writes against the fixture beyond the implicit login session
table row). `--workers=1` is required because TOTP replay protection
rejects concurrent logins with the same 30-second code.

### 9d. Override the fixture path

You can override the host path the loader inspects:

```sh
IDENTUUM_E2E_FIXTURE_FILE=/some/other/path.json \
IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
  npx playwright test ...
```

If you change the host path, make sure the compose bind mount on the
IDP side maps the matching directory into `/e2e-auth`.

### 9e. Preflight troubleshooting

`globalSetup` runs a preflight inside the IDP container before invoking
the fixture CLI. Each check throws a clear non-secret diagnostic naming
the exact fix step:

| Preflight error | Cause | Fix |
| --- | --- | --- |
| `Dynamic fixture preflight failed: /app/identuum was not found in the IDP container.` | IDP container is running a pre-CLI build (binary missing) OR docker compose cannot address the service. | `cd /Users/odemir/Development/2025-11/identuum/identuum-idp && make local-restart` |
| `Dynamic fixture preflight failed: /e2e-auth is not mounted in the IDP container.` | Compose bind mount is missing (e.g. the local-only compose change was not yet pulled, or the container was started before the compose file added it). | `cd /Users/odemir/Development/2025-11/identuum/identuum-idp && make local-restart` |
| `Dynamic fixture preflight failed: /e2e-auth exists in the IDP container but is not writable.` | Bind-mount target permissions are wrong on the host (e.g. operator ran `docker compose up` as root once). | Inspect host permissions on `identuum-ui/e2e/.auth` OR rerun `make local-restart`. |
| `Dynamic fixture preflight failed: IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true is not present in the IDP container.` | The fixture-CLI env gate was not set when the container was started. | `cd /Users/odemir/Development/2025-11/identuum/identuum-idp && make local-restart` (the compose env block already declares it; restart picks it up). |
| `Dynamic fixture preflight failed: neither IDENTUUM_IDP_INSECURE_DEV_MODE=true nor IDENTUUM_IDP_INSECURE_MFA_BYPASS=true is present in the IDP container.` | Local insecure-mode gate is missing (these gate the fixture CLI by appconfig contract). | `make local-restart` from `identuum-idp` (the compose env block already declares `IDENTUUM_IDP_INSECURE_DEV_MODE=true`). |
| `Dynamic fixture preflight failed: /e2e-auth is not connected to the UI e2e/.auth directory.` | Bind mount source path resolves to a different host directory than `identuum-ui/e2e/.auth` (e.g. non-default workspace layout). | Set `IDENTUUM_UI_E2E_AUTH_DIR=<absolute host path>` in your shell BEFORE `make local-restart`. |

If a preflight check fails, no IDP CLI invocation happens. No
organization is created. No DB row is touched. The fix is always either
`make local-restart` from `identuum-idp` or correcting the bind-mount
source path; never editing `.env.playwright.idp-oss.local`.

### 9f. Cleanup commands

Verify a clean state after a successful run, and recover from a stuck
state if a run aborted partway:

```sh
# 1. Confirm the host fixture file is gone.
test ! -f /Users/odemir/Development/2025-11/identuum/identuum-ui/e2e/.auth/e2e-org-admin-fixture.json \
  && echo "host fixture file removed: yes"

# 2. Confirm the DB has zero fixture-marker rows.
docker exec identuum-idp-postgres psql -U idp_user -d identuum_idp -tAc \
  "select count(*) from organizations where e2e_fixture_marker is not null;"
# Expected: 0

# 3. If a stuck file remains on the host but the DB shows zero rows, the
#    file is orphaned; remove it.
rm -f /Users/odemir/Development/2025-11/identuum/identuum-ui/e2e/.auth/e2e-org-admin-fixture.json

# 4. If the DB shows a non-zero count but the file is gone, an aborted
#    teardown left a stuck row. Purge it manually:
docker exec identuum-idp-postgres psql -U idp_user -d identuum_idp -c \
  "DELETE FROM organizations WHERE e2e_fixture_marker = 'identuum-e2e-fixture-v1';"
# This cascades through every FK→organizations(id) child row.
```

NEVER paste the fixture JSON, the generated password, or the TOTP secret
into a chat / commit / screenshot. The file is mode `0600` for a reason.

### 9g. Durable env-vars mode (fallback)

Sections 1–8 above describe durable mode, which uses three env vars in
`.env.playwright.idp-oss.local`:

```
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<a long-lived org_admin email>
IDENTUUM_TEST_ORG_ADMIN_PASSWORD=<their password>
IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET=<their TOTP secret>
```

(Variable NAMES only — no values in this runbook.)

Durable mode is useful when:
- You want to manually inspect the same org_admin state across several
  test invocations.
- You are debugging a scenario that requires a specific persistent row
  the fixture CLI cannot generate.

For normal local non-destructive org-admin tests, **prefer dynamic
mode** (Section 9b). The login helper auto-detects which source is
present: dynamic fixture file wins; durable env vars are the fallback.

### 9h. Failure recovery (legacy section)

The preflight added in Section 9e replaces most of the operator-facing
diagnostics that previously surfaced as opaque "IDP CLI failed" errors.
A few residual cases remain:

- **Teardown fails?** The host fixture file is intentionally left in
  place so the operator can inspect / re-run. The exact manual purge
  command is printed on stderr by the teardown failure path:
  ```sh
  docker compose -f /Users/odemir/Development/2025-11/identuum/identuum-idp/deployment/docker-compose.local.yml \
    exec -T identuum-idp /app/identuum --e2e-purge-org-fixture \
    --fixture-file /e2e-auth/e2e-org-admin-fixture.json --confirm-e2e-purge
  ```
- **Fixture cannot be re-created after a failed teardown?** `globalSetup`
  attempts to purge any stale host fixture file first; if that purge
  also fails it raises an error before re-creating, so the DB and the
  host file never disagree silently.
- **Fixture is older than 6h?** The purge CLI refuses with
  `ErrE2EFixtureTooOld`. Use Section 9f step 4 to purge manually, then
  start a fresh dynamic run.

### 9i. Audit cascade behavior

The purge uses `DELETE FROM organizations WHERE id = $1 AND
e2e_fixture_marker = 'identuum-e2e-fixture-v1'`, which cascades through
every FK→organizations(id) child row including `audit_events`
(`actor_organization_id ON DELETE CASCADE`). Subject-side audit rows
where the fixture user appears only as `audit_events.subject_id` survive
with a dangling UUID — acceptable per the IDP foundation task's audit
contract.

### 9j. What automatic mode does NOT do

- It does not affect durable mode. Setting
  `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE` to anything other than the literal
  string `"true"` is a no-op — `globalSetup`/`globalTeardown` behave
  exactly as before, and `loadOrgAdminFixture()` will return null if no
  fixture file is present.
- It does not weaken any safety gate. The IDP CLI still requires
  `IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true` + `INSECURE_DEV_MODE=true`,
  refuses non-local DB hosts, refuses non-fixture markers, and enforces
  the reserved-prefix matrix.
- It does not run unless explicitly opted in. CI / production / any
  shell without `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true` is unaffected.

### 9k. Destructive recovery spec — intentionally NOT dynamic

`e2e/site-admin-admin-recovery.spec.ts` covers the site_admin → org_admin
MFA-reset recovery flow. It is **destructive**: it clears `mfa_enabled`
and `mfa_secret` on a real org_admin row and revokes that row's active
sessions. It is intentionally separate from dynamic mode.

To run it you must set ALL of:

```
IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=<set in .env.playwright.idp-oss.local>
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=<set in .env.playwright.idp-oss.local>
IDENTUUM_TEST_ORG_ID=<concrete fixture org UUID, NOT the all-zero placeholder>
IDENTUUM_TEST_ORG_ADMIN_EMAIL=<concrete fixture org_admin email, NOT admin@example.org>
```

The spec's `requireConcreteDestructiveRecoveryTarget()` helper refuses
to run if `IDENTUUM_TEST_ORG_ID` is the all-zero placeholder or if
`IDENTUUM_TEST_ORG_ADMIN_EMAIL` is the neutral `admin@example.org`
placeholder. The refusal happens BEFORE any page interaction or HTTP
call to the IDP.

**Do not run this spec casually.** Its purpose is to regression-cover
the recovery flow; it is not a substitute for either dynamic or durable
mode. It does not consume the disposable fixture and would refuse to
do so even if it tried (the dynamic fixture's org_admin row is fresh
per-run, and the destructive spec's value-equality refusals are
independent of the dynamic-mode `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE`
toggle).

### 9l. Security notes

- **`identuum-ui/e2e/.auth/` is gitignored** (`e2e/.auth/` entry in
  `identuum-ui/.gitignore`). The fixture JSON written there must
  never be committed.
- **The fixture JSON contains the generated org_admin password and
  TOTP secret** while tests run. File mode is `0600`. The
  `globalTeardown` step removes it after success; on failure it is
  intentionally left in place so the operator can inspect.
- **Never `cat`, paste, or print the fixture JSON** — including into
  screenshots, chat, PR descriptions, or commit messages.
- **The preflight does not read or print env values.** Every env-presence
  check inside the IDP container uses `sh -c 'test "$VAR" = "true"'` —
  exit code only. A regression that switched to `printenv`/`env` would
  be caught by `src/__tests__/e2e-dynamic-fixture-orchestration.test.ts`.
- **The IDP CLI's purge SQL requires both the org id AND the
  fixture-marker column to match.** Production organizations have
  `e2e_fixture_marker IS NULL` and cannot be hard-deleted via this
  path, even if the org id were correct.

---

## What this runbook deliberately does NOT do

- It does not weaken the org-admin MFA layout guard.
- It does not alter the `mfa_policy` of the fixture organization.
- It does not patch `e2e/helpers/login.ts` to short-circuit the TOTP
  step.
- It does not add an `E2E_DISABLE_MFA` flag, an environment seam, or
  any other bypass. Adding one would erode the regression-coverage
  value of the layered MFA tests in UI-FEATURES.md Sections 4, 5, 6,
  and 6c.
- It does not mutate the database directly. Every supported step routes
  through an existing audited REST endpoint or through the UI itself.
