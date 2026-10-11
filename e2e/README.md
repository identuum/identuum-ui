# Playwright E2E Tests — Local Authenticated Setup

## Quick start (unauthenticated tests)

Unauthenticated tests run without any credentials:

```sh
npx playwright test
```

## Recommended: dynamic fixture mode (released appliance)

**For authenticated Playwright tests, prefer dynamic fixture mode.** It stands
up the PUBLISHED `identuum-idp-oss` appliance on a throwaway database and mints
a disposable org + site_admin + org_admin + org_user against its HTTP API — the
same surface a customer's appliance exposes. No sibling monolith checkout, no
`make local-restart`, and no `.env.playwright.idp-oss.local` edits for the fixture
slots: credentials are generated per run (or reused when still valid) and written
to a gitignored local envelope the login helper consumes automatically.

### Prerequisites

Docker with Compose (v2 `docker compose` or legacy `docker-compose`) and the
Playwright browser:

```sh
pnpm e2e:install
```

Everything else is automatic — `e2e/global-setup.ts` brings up
`e2e/docker-compose.e2e.yml` as Compose project `identuum-ui-e2e` (the
published image + a Postgres with no declared volume) and builds the
fixtures. Credentials are stable across runs: a saved envelope whose
site_admin still authenticates is reused; only an absent or invalid one
triggers a new appliance. Every Compose command names the project with `-p`,
the resolved config is checked first (project `identuum-ui-e2e` alone, no
external or `identuum-idp-oss*` network or volume), and an existing
`identuum-ui-e2e` stack that would have to be removed is a refusal naming the
command an operator may run — the harness never removes it by assumption.

### Run (from this repository root)

```sh
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

1. `e2e/global-setup.ts` brings up the published appliance via
   `e2e/docker-compose.e2e.yml` (unless a saved envelope is still valid,
   in which case it reuses it), then builds the fixtures against the
   released HTTP API — setup → site_admin TOTP enrolment → org →
   org_admin → org_user — and writes the JSON envelope under
   `identuum-ui/e2e/.auth/` at mode `0600`.
2. `e2e/helpers/login.ts` reads the envelope via `loadSiteAdminFixture()`
   / `loadOrgAdminFixture()` and uses the generated credentials for every
   authenticated spec.
3. `e2e/global-teardown.ts` tears down ONLY an appliance this run started
   (plain `docker compose -p identuum-ui-e2e down`, never `down -v`) and then
   removes its envelope; a reused appliance and its envelope are kept, and
   `IDENTUUM_E2E_KEEP_APPLIANCE=true` keeps even an owned one. It records the
   run-end timestamp either way.

   **Storage truth:** the postgres image declares `VOLUME /var/lib/postgresql`
   and the compose file mounts nothing there, so its data sits in an
   anonymous volume. Plain `down` removes the containers and the network but
   leaves that anonymous volume: the next `up` starts on fresh storage, and
   the old data stays orphaned until an operator removes it. The harness adds
   no volume deletion.

Under `make e2e-full` / `make e2e-quick` the dev-loop phases run
OUTER-OWNED (`IDENTUUM_E2E_FIXTURE_OWNER=outer`): the outer runner
(`e2e-full/scripts/full-run.sh`, project `scratch-e2e`) provisions the
appliance and the envelope, global setup must reuse them or refuse, and global
teardown makes no Compose call and keeps the envelope — the runner removes
what it created once, on exit.

The runner first takes an exclusive invocation claim, an atomic `mkdir` of
`/tmp/identuum-harness.lock` (holding its pid; one fixed path per machine,
whatever `TMPDIR` says), and keeps it through its teardown; if the claim
already exists it refuses and changes nothing. The claim is shared with
identuum-idp-oss's `make devseed-live` and `make openid-conformance`, so no
two harness runs share a host port. A claim kept by a refused teardown holds
the run's record, `manifest.json` (see below). Remove a left-behind claim only
after confirming no harness run is active and the resources its record names
are gone.

The harness supports exactly one setup: the Docker engine of this computer,
reached through a unix socket on this computer. Right after taking the claim
it refuses, before any other Docker command, a `DOCKER_HOST` that is not a
`unix:///` socket, and a Docker context (`DOCKER_CONTEXT` or the current one)
whose endpoint is not one, such as `tcp://` or `ssh://`; every later Docker
command of the run, the nested `oss-up` included, is pinned to the checked
endpoint. Before the claim it also refuses a `COMPOSE_CMD` that is not
exactly `docker compose` (from the environment, a `make e2e-full
COMPOSE_CMD=...` command line, or `make -e`): an option such as `--host`,
`-H`, `--context` or `-c` in it would start the appliance on another engine.
The nested `make oss-up` gets `COMPOSE_CMD='docker compose'` on its own
command line, with `MAKEFLAGS`, `MAKEOVERRIDES`, `MFLAGS` and `MAKEFILES`
cleared, and checks the binding below again before it builds or starts.

The claim keeps out a second run that sees the same `/tmp`. A run with
another `/tmp` (a container sharing the Docker socket, another mount
namespace) is kept out by the daemon mutex: before it lists or starts
anything, the run creates a stopped container named
`identuum-harness-lock-engine` on the checked engine, and Docker refuses a
second container of that name; the mutex carries the run's project and
ports as labels. identuum-idp-oss's `make devseed-live` and
`make openid-conformance` take the same mutex. The container is made from the distroless image that
identuum-idp-oss's `deployment/Dockerfile.local` pins
(`gcr.io/distroless/static-debian12@sha256:d75cdd72...`); the run never pulls
it, and when it is missing the run refuses and prints the `docker pull`
command. It is never started, and it is removed by its ID at the end. When a
run is killed, the container stays and the next run refuses, naming it:
check that no e2e-full, e2e-quick, devseed-live or openid-conformance run is
active, inspect it
(`docker container inspect identuum-harness-lock-engine`, labels
`io.identuum.harness.*`). Removing it is a manual owner decision. The run also records the
engine's ID (`docker info`) and checks it before every later Docker command;
if another engine answers, the run stops all Docker commands, is red, and
leaves the mutex in place. These checks do not prove where a unix socket
leads: a socket forwarded from another computer can answer with a stable ID,
and an engine switched inside one Docker command is not seen.

Before it creates anything it refuses leftovers of project `scratch-e2e`
(and prints, for each labelled one, the command that removes it by its own
name; never a project-level `down --volumes`). Every volume and network it
creates is named with a random id of this invocation appended to the name
the resolved Compose config gives it
(`scratch-e2e_postgres-idp-oss-data-v18_<id>`, `scratch-e2e_default_<id>`),
so an ordinary stack or another run does not create the same name by
accident; those names are listed
UNFILTERED, and one that already exists, whatever its labels, is a refusal
(no removal command is offered for it). The resolved Compose config is
refused, too, unless its services are exactly the appliance's three, none is
privileged or in the host's network, PID or IPC namespace, none mounts a
folder of this computer, every published port is one the run reserved on
`127.0.0.1`, the built image is named for the project and no network alias
takes a protected name. Those names, all proven absent, are
the run's inventory. Every service, volume and network it starts carries a
label with the same id (`io.identuum.harness.invocation`, from a generated
overlay), and right after the start the runner records what carries that
label: containers and networks by ID, volumes by name and creation time,
with a public projection, `manifest.json` in the claim (the engine's ID and
endpoint, project, invocation, ports, the mutex's ID and every recorded
resource), rewritten whole after each step.
On exit the teardown removes exactly those, each by ID after rechecking its
identity and label, a volume only under a name carrying the invocation id,
and runs no project-level `down`. Docker removes a volume by name with no
check of its identity, so a volume replaced under a shared name between the
last check and the removal would be removed; the run's own name keeps an
ordinary stack's volume out of reach. One case is not caught: another Docker
user that copies the run's exact volume name and puts a volume of their own
under it in that interval has it removed, and the run is not red. Neither the
claim nor the mutex stops a Docker user outside these harnesses. Anything of
the project, or holding one of its
names, that is not in that record (a foreign container of the same project,
a volume replaced under the same name, a recorded volume without the id in
its name, a container of someone else attached to the run's network or using
its volume) is found BEFORE the first removal, and then nothing at all is
removed — not the run's own resources either: the teardown prints
`TEARDOWN REFUSED` naming it, the run is red, and the claim, the mutex and
the record stay. After the removals every recorded resource is checked gone;
a failed removal or one still present is red and keeps them too. The
refusal prints read-only inspection commands (`docker inspect`,
`docker network inspect`, `docker volume inspect`) for what it found and
never a removal command. Removal of those resources, the mutex and the
claim directory is a manual owner decision.

### Security

- `e2e/.auth/` is gitignored (entry in `identuum-ui/.gitignore`). The
  fixture envelope written there must never be committed.
- The envelope contains generated passwords + captured TOTP secrets.
  **Never `cat`, paste, screenshot, or otherwise print its contents.**
- Setting `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE` to any value other than
  the literal string `"true"` is a no-op; durable env mode is
  preserved unchanged.

---

## Authenticated tests (durable env mode — fallback)

Durable env mode is the fallback path for org_admin authentication and
the only supported path for `site_admin` authentication. It uses
long-lived credentials kept in `.env.playwright.idp-oss.local`.

> **Staleness warning:** an appliance-side credential reset invalidates
> these values in place. In particular `recover-site-admin` (see
> identuum-idp-oss `docs/OPERATOR-GUIDE.md` → "Reset the site_admin
> password" → "What this invalidates") rewrites the password AND wipes
> the MFA enrolment — `IDENTUUM_TEST_SITE_ADMIN_PASSWORD` and
> `IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET` are both wrong the moment it
> returns, and the new TOTP seed is shown once, at the forced
> re-enrolment on the next login. Update this file before the next
> Playwright run, or site_admin specs fail (and repeated wrong attempts
> can trip the login lockout).

### 1. Create `.env.playwright.idp-oss.local`

Create `.env.playwright.idp-oss.local` at this repository's root
(`identuum-ui/.env.playwright.idp-oss.local`).

**This file is gitignored by `.env*.local` — never commit it.** The same
applies to its CE-overlay sibling, `.env.playwright.idp-ce.local`. Neither
file's contents should be read or printed (by a person or an agent working
in this repository) outside of the test harness actually consuming it —
both hold long-lived, real credentials, not fixtures.

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

`playwright.config.ts` loads `.env.playwright.idp-oss.local` automatically before tests run.
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

Expected baseline (last stated before OSS-MINT-GUARD-2, not re-measured):
**28 passed, 0 skipped**. Since then the two `can_assign_admin` conditional
tests self-skip outside the e2e-full harness (see the fixture section below).

---

## Fixture accounts

### site_admin

`site_admin@system.local` is the system admin created by `identuum-idp-setup`. Reset
credentials at any time by re-running the setup helper with `--force`.

### org_admin

`IDENTUUM_TEST_ORG_ADMIN_*` targets a dedicated org_admin account in a test organization.
This account must be created once and its credentials stored in `.env.playwright.idp-oss.local`.

The account was set up using the site_admin API to create a test organization and generate
an invitation, which was then claimed to establish the account.

---

## `can_assign_admin=true` fixture

Two site-admin org tests require at least one organization in the
`has_admin=true / can_assign_admin=true` state (expired pending invitation).

`e2e/helpers/fixture-expired-org.ts` builds this state from the `beforeAll` in
`site-admin-organizations.spec.ts`, and ONLY inside the e2e-full harness's own
scratch appliance (OSS-MINT-GUARD-2):

- It runs only when the dev-loop phase is outer-owned
  (`IDENTUUM_E2E_FIXTURE_OWNER=outer`, set by `e2e-full/scripts/full-run.sh`
  for `make e2e-full`) and the harness project is `scratch-e2e`. Anywhere
  else the spec does not attempt it and the two conditional tests self-skip;
  called directly without that context, the helper refuses before any
  process, query or HTTP request.
- Its one SQL time-warp runs inside that project's postgres container:
  `docker compose -p scratch-e2e -f ../identuum-idp-oss/deployment/docker-compose.dev.yml
  -f e2e-full/compose.mail-sink.yml --profile app exec -T postgres-idp-oss psql ...`
  (argv, no shell, the container's own socket — no host psql, no host port,
  no password). Its HTTP calls use the harness's own bases
  (`IDENTUUM_E2E_BASE_URL`, `IDENTUUM_E2E_FULL_IDP_BASE`), and only when each
  is `http://localhost` or `http://127.0.0.1` on the port the runner selected
  and carried (`IDENTUUM_E2E_FULL_UI_PORT`, `IDENTUUM_E2E_FULL_APP_PORT`;
  never 5513, 7104, 7113 or 7114). Any other host, scheme, userinfo or port is
  a refusal before any process or request.
- Under the harness a refusal or provisioning failure fails the spec's
  `beforeAll`; it is not treated as an unavailable fixture.

### How it works

1. `ensureExpiredPendingOrgFixture(siteAdminCtx)` checks the harness context.
2. A scratch SQL query reads the state of `expired-admin@playwright-expired.local`.
3. If the user doesn't exist, it creates the org+user via the IdP API (through
   the harness UI's `/api/idp` proxy) and then expires the
   `activation_token_expires_at` with scratch SQL.
4. If the user is already in the `expired-pending` state, nothing is done.
5. If the user is in an `active` or `valid-pending` state, scratch SQL resets it.

**Important limitations:**

- **Scratch-only.** No production-safe API endpoint exists for the expiry, so
  the fixture mutates only the disposable `scratch-e2e` appliance, which the
  harness destroys at the end of the run.
- **No local or development database.** There is no repair or setup procedure
  against a local stack: never point `psql` at a development database
  (5432, 5513 or any other) for this fixture.
- **Do not copy the SQL mutation pattern** into broader tests or production code.
- Idempotent within a run: it skips if the state is already correct.

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
IDENTUUM_TEST_SITE_ADMIN_PASSWORD=<set in .env.playwright.idp-oss.local>
IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET=<set in .env.playwright.idp-oss.local>
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
   project is independent of the standing `identuum-ui` dev
   container on `:7104` (renamed from `identuum-ui-app` on
   2026-06-15; the standing container may still hold the old name
   until the next `make dev-rebuild`) and never touches it.
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

---

## OSS vs CE runtime contract for Playwright specs

The IDP backend on `127.0.0.1:7113` can be one of two distinct
runtimes, and the two are NOT interchangeable for these specs:

- **OSS scaffold (`identuum-idp-oss`, `--gin-serve` mode)** — exposes
  only `GET /system/info`, `/health`, `/metrics`,
  `/.well-known/openid-configuration`, `/.well-known/jwks.json`. No
  auth, no `/authorize`, no `/token`, no login form, no MFA, no
  sessions, no admin UI, no setup/upgrade wizards. Operator-run
  commands are `--bootstrap` and `--recover-site-admin`. There is
  **no `--setup` flag** in the OSS binary; setup is performed via
  `--bootstrap` against a target DSN.
- **CE appliance (`identuum-idp-ce`, `--serve` mode)** — the full
  product: setup wizard, license, login, MFA, sessions, admin
  license page, OSS-to-CE upgrade wizard, backup automation,
  org-admin/site-admin/AG UI. Operator-run setup is `--setup`
  (`--plain` for headless), and `--recover-admin` is the supported
  non-destructive admin reset. The CE binary at `/app/identuum-idp`
  inside the container.

### Which spec needs which runtime

| Spec | Required runtime | Notes |
|------|------------------|-------|
| `oss-contract.spec.ts` | OSS scaffold (`identuum-idp-oss`) | Positive + negative pins on the OSS contract; passes against CE too because CE is a superset. |
| `health-and-redirects.spec.ts` | Either | Touches only `/health` and UI route shapes. |
| `platform-status.spec.ts` | Either | Touches `/api/runtime` and `/platform-status`; works on both. |
| `login.spec.ts` | **CE only** | Drives full email → password → TOTP login. |
| `account-settings.spec.ts` | **CE only** | Requires authenticated `site_admin` session. |
| `passkey-flow.spec.ts` | **CE only** | CDP virtual authenticator drives WebAuthn ceremony. |
| `dashboard.spec.ts` | **CE only** | Authenticated `org_user` /dashboard surface. |
| `claim.spec.ts` | **CE only** | Org-admin invitation/claim flow. |
| `setup-wizard.spec.ts` | **CE only** | First-run setup wizard against `identuum-idp-ce` data volume. |
| `upgrade-backup.spec.ts` | mocked (no real backend) | Pure browser-level fetch interception; backend can be down. |
| `upgrade-backup-live.spec.ts` | **CE only** (throwaway) | Brought up by `verify-live-upgrade-backup`. |
| `org-admin*.spec.ts` | **CE only** | Authenticated `org_admin`. |
| `site-admin-*.spec.ts` | **CE only** | Authenticated `site_admin` against full admin UI. |

The source-invariant pin at
`src/__tests__/oss-ce-runtime-target-source-invariants.test.ts`
enforces that every spec listed above is documented as requiring
the right runtime; future drift will fail a fast vitest assertion
rather than a slow Playwright timeout against the wrong backend.

### Convenience make targets

| Command | Use case |
|---------|----------|
| `make verify-ui-oss-contract` | Run only `e2e/oss-contract.spec.ts` against `IDENTUUM_IDP_BASE_URL` (default `http://localhost:7113`). Safe against an OSS `--gin-serve` runtime; does NOT require credentials. |
| `make verify-ui-ce-auth` | Run every other Playwright spec (excludes `oss-contract.spec.ts`). Requires a CE appliance on the IDP backend. Authenticated specs self-skip if `IDENTUUM_TEST_SITE_ADMIN_PASSWORD` and friends are unset. |
| `make verify-live-upgrade-backup` | Stand up a throwaway CE backend on ports 7129/7130, run `upgrade-backup-live.spec.ts`, always tear down. |

Pointing `verify-ui-ce-auth` at an OSS scaffold runtime is a
documented anti-pattern — auth-required specs will fail at the
TOTP/login step because OSS has no `/authorize` or `/token`. The
"Invalid credentials" failure mode observed in earlier post-commit
verification slices (C4 / C3 / C6) is the symptom of exactly this
mismatch.
