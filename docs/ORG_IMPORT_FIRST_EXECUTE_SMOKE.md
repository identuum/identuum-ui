# Org Import / Link — First Controlled Execute Smoke (Runbook)

This runbook walks an operator through running the first controlled
organization-only import/link execute against the local AG backend, using
`scripts/smoke-org-import-execute.mjs`.

The harness defaults to **dry-run only**. The execute path is double-gated
behind a CLI flag and a confirmation env var. The harness reads no files
(no `dev.env.local`, no `.env`, no credential files), contains no fallback
credentials, and never logs cookies, bearer tokens, passwords, TOTP
secrets, license payloads, signatures, or raw response bodies. The TOTP
code generated internally for IDP MFA is also never logged.

## Scope

- Organization-only. The harness, the UI it mirrors, and the AG backend it
  calls never touch users, org admins, passwords, MFA, role bindings,
  reviewers, auditors, sessions, tokens, or credentials.
- Exactly one execute call per invocation. No retry, no bulk, no
  "import all" path.

## Prerequisites

- Local AG and IDP backends running and healthy at the default ports
  (override with `IDENTUUM_AG_URL` / `IDENTUUM_IDP_URL` /
  `IDENTUUM_AG_IDENTITY_URL` if needed).
- A safe disposable/test/demo/local/sandbox organization on the IDP side
  that is *not* already linked to an AG organization. The harness will
  refuse to proceed otherwise.
- Operator credentials for the IDP site_admin account AND for an AG
  operator account.

## Primary workflow — explicit env file (preferred)

The harness reads an env file ONLY when you pass `--env-file <path>`
explicitly. There is no automatic discovery: `.env`, `.env.local`,
`dev.env.local`, and similar files are never sourced by the harness. The
operator is in full control over which file is loaded and when.

Create a local env file (already covered by `.gitignore` —
`.smoke-org-import.env` and `*.smoke.env` are excluded):

```sh
# from this repository's root (identuum-ui/)

cat > .smoke-org-import.env <<'EOF'
# IDP site_admin login
IDENTUUM_SITE_ADMIN_EMAIL=site_admin@system.local
IDENTUUM_SITE_ADMIN_PASSWORD=replace-me
# Only consumed if IDP returns mfa_required=true. The harness generates
# the current TOTP code internally (HMAC-SHA1, RFC 6238); the secret and
# the generated code are never logged.
IDENTUUM_SITE_ADMIN_TOTP_SECRET=replace-me
# Aliases (used as fallback when the SITE_ADMIN names are unset). These match
# the env names written by identuum-idp/scripts/bootstrap-admin.sh into
# identuum-idp/dev.env.local, so an existing IDP bootstrap file can be reused
# directly without renaming:
#   IDENTUUM_TEST_ADMIN_EMAIL    -> IDENTUUM_SITE_ADMIN_EMAIL
#   IDENTUUM_TEST_ADMIN_PASSWORD -> IDENTUUM_SITE_ADMIN_PASSWORD
#   IDENTUUM_TEST_MFA_SECRET     -> IDENTUUM_SITE_ADMIN_TOTP_SECRET

# AG operator login (preferred when AG bearer token is not supplied)
IDENTUUM_AG_OPERATOR_EMAIL=replace-me
IDENTUUM_AG_OPERATOR_PASSWORD=replace-me

# Alternative to AG email/password — operator bearer token. If both this
# and AG email/password are set, this takes precedence on the AG side.
# IDENTUUM_AG_OPERATOR_TOKEN=...

# Optional URL overrides (defaults are local-dev ports)
# IDENTUUM_IDP_URL=http://127.0.0.1:7113
# IDENTUUM_AG_URL=http://127.0.0.1:7215
# IDENTUUM_AG_IDENTITY_URL=http://127.0.0.1:7214
EOF

# Dry-run only (default — no mutation, no execute):
node scripts/smoke-org-import-execute.mjs -- --env-file ./.smoke-org-import.env
```

The `--` separator before `--env-file` is required on Node 20.6+ because
Node has its own `--env-file` CLI flag that would otherwise consume our
script's flag. The `--` is the standard POSIX end-of-options marker:
everything after it goes to the script.

The harness will:

1. Probe public component endpoints on IDP+AG.
2. Resolve auth: log in to IDP (with MFA if required), log in to AG.
3. Fetch IDP+AG export-candidates with the resolved auth.
4. Pick at most one safe candidate (priorities below).
5. POST `dry_run=true` to AG `/api/v1/organizations/import-from-idp`.
6. Print a redacted summary and exit `0`.

When you are done, delete the env file (it is gitignored but still
local material):

```sh
rm -f .smoke-org-import.env
```

### Execute exactly one (gated)

To proceed to a single `dry_run=false` call, **both** of the following
must be set:

```sh
IDENTUUM_CONFIRM_ORG_ONLY=organization_only \
  node scripts/smoke-org-import-execute.mjs \
    -- --env-file ./.smoke-org-import.env --execute-one
```

If either gate is missing the harness exits with code `2` and does not
issue the execute request. The `IDENTUUM_CONFIRM_ORG_ONLY` variable is
required to be exactly the literal string `organization_only` (matching
the same constant the AG server action checks).

When both are set the harness re-runs the dry-run (idempotent), then
sends exactly one `dry_run=false` POST and verifies the post-state by
re-fetching AG export-candidates.

## Env-file safety contract

- `--env-file <path>` is the ONLY way the harness reads any file.
- The path must be supplied verbatim by the operator. The harness performs
  no discovery, no parent-directory walk, no dotenv default loading.
- The parser supports `KEY=value`, `KEY="value"`, `KEY='value'`, blank
  lines, and `# comments`. It does NOT support command substitution,
  shell expressions, `${VAR}` interpolation, or escape sequences. Any
  malformed line aborts with exit `2`; only the line number is logged —
  never the value or key.
- Process environment values always WIN. Any key set in your real shell
  via `export` overrides the same key in the env file. This lets you
  rotate a single value quickly without editing the file.
- The startup log prints only `env file: PROVIDED (<basename>)` or
  `env file: NOT PROVIDED`. The file path is never logged in full and
  no value from the file is ever printed.
- The harness reads the file via `node:fs` `readFileSync` exactly once
  per invocation. The contents are held in memory and discarded when
  the process exits.

## Env precedence

Per key, in order:

1. `process.env[KEY]` when non-empty — your real shell wins.
2. `<env-file>[KEY]` when `--env-file` was supplied.
3. Typed default (URL constants) or empty string.

## Auth-mode precedence

The harness resolves auth per side independently:

1. **Manual override** — if `IDENTUUM_IDP_AUTH_HEADER` (or
   `IDENTUUM_AG_AUTH_HEADER`) is set, that side uses the verbatim header
   line and does NOT attempt automated login.
2. **Automated login** — when the manual override is absent, the harness
   uses the IDP site_admin login flow (`POST /api/v1/auth/login` +
   `POST /api/v1/auth/login/mfa` when required) and the AG operator
   login flow (`POST <AG identity URL>/login`).
3. **AG bearer fallback** — `IDENTUUM_AG_OPERATOR_TOKEN`, if set, is
   used as the AG `Authorization: Bearer <token>` header. Chosen when
   present even if AG email/password are also exported.
4. **Missing auth** — clear blocker, exit `2`, no network mutation.

The harness logs only the *mode* chosen for each side (`manual`,
`automated-login`, `operator-token`) and a YES/NO indicator that the
acquired session is ready. It never logs cookie values, bearer values,
passwords, or TOTP codes.

## Manual auth-header mode (fallback only)

If automated login is not viable (e.g. you already have a browser
session you want to reuse), the manual mode still works:

```sh
read -s IDENTUUM_IDP_AUTH_HEADER  # paste: Cookie: access_token=<value>
export IDENTUUM_IDP_AUTH_HEADER
read -s IDENTUUM_AG_AUTH_HEADER   # paste: Authorization: Bearer <jwt>
export IDENTUUM_AG_AUTH_HEADER
node scripts/smoke-org-import-execute.mjs
```

This path is **not** the primary workflow. Prefer automated login.

## Selection priority — disposable-only by default

Automatic selection is **disposable-only**. A candidate qualifies as
disposable when its IDP name OR slug matches (case-insensitive) one of:

```
test  demo  local  sandbox  smoke  disposable  tmp  scratch
dev   qa    playwright  recovery  fixture  e2e  staging  throwaway
```

Examples allowed automatically:
- Playwright Expired Recovery Org
- Playwright Test Org
- Local Smoke Org
- Demo Org / Sandbox Org / Test Org / QA Org / Dev Org / Scratch Org

Examples NOT allowed automatically (even when otherwise eligible):
- Vestel Inc.
- Acme Corp.
- Globex
- Any `Inc / LLC / Ltd / GmbH / SA / SAS / BV / AG / Oy / AB / AŞ / AS /
  Company / Corp / Corporation / Enterprise / Holdings / Group` style
  name UNLESS it also carries a disposable marker like
  `Test / Demo / Sandbox / Smoke / Dev / QA / Playwright / Recovery`.

Why: company-looking organisation names are almost never real test
fixtures. Allowing them by default risks landing an automated execute
against a real-looking tenant.

Priority order (no "any eligible" fallback):

1. Disposable IDP candidate with NO matching AG org → `create_ag_organization`.
2. Disposable IDP candidate whose matched AG org is UNLINKED → `link_existing_ag_organization`.
3. Otherwise: stop with `no disposable safe IDP candidate found`. No
   request is sent.

The harness will *never*:
- Select the system organization (`00000000-0000-0000-0000-000000000001`).
- Select a candidate whose name matches the production-hint regex
  (includes legal-entity suffixes like Inc/LLC/Ltd/GmbH/Corp).
- Select a link-existing target whose AG org is already linked (the
  backend has its own pre-flight + SQL safety net for this; the harness
  refuses earlier so the request is never sent).

### Explicit local override (advanced)

When a local developer must exercise a specific non-disposable IDP
organisation (for example, a customer-named test tenant that lacks the
disposable markers), set:

```sh
IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID=<exact-IDP-UUID>
```

This is an **ID-only** override. There is no name-based or slug-based
override path — operators must paste the exact IDP UUID. The override:

- still refuses the system organization
- still refuses link-existing when the matched AG org is already linked
- still requires the dry-run preview to return `status=planned`
- still requires `--execute-one` AND
  `IDENTUUM_CONFIRM_ORG_ONLY=organization_only` for any `dry_run=false`
- still executes at most one row; no bulk; no retry

**Do NOT use the override for real customer or production
organisations.** This is a local-developer convenience; it does not turn
off the dry-run/execute gates and it does not change the audit
behaviour, but a careless invocation could still create or link an
organisation against the local backend. Treat it like `--execute-one`:
read what you're about to send first.

Invalid override values exit `2` without making any network call.

## Exit codes

- `0` — completed successfully (dry-run-only or execute path).
- `1` — unexpected runtime error during a planned step.
- `2` — missing required env var or flag combination (operator action needed).
- `3` — no safe candidate available for the smoke (stops without mutation).
- `4` — dry-run did not return a planned status (stops without mutation).
- `5` — post-execute verification failed (mutation already happened, do not retry).
- `6` — automated login failed (credentials rejected or backend unreachable);
  the harness prints the safe status code only, never the credentials.

## Safe output guarantees

The harness prints only safe metadata. Organization IDs are redacted to
the first 8 characters followed by a Unicode ellipsis (`…`).

- HTTP status
- organization count
- redacted ID
- name
- slug
- status
- source_component
- link_status
- redacted linked_idp_organization_id
- action / status / message summaries
- run-mode metadata (which env vars are *set*, which flag is *present* —
  the fact of being set, never the value)
- auth mode per side (`manual`, `automated-login`, `operator-token`)

The harness scans every authenticated response body for forbidden field
names (users, admins, passwords, mfa, tokens, license, signature,
ciphertext, etc., 27 names total) and logs a single line per response
indicating whether all were absent.

## What the harness does NOT do

- It does not read `dev.env.local`, `.env`, `~/.netrc`, or any credential
  file.
- It does not contain fallback or default credentials.
- It does not include any auth bypass or feature flag that weakens
  authentication.
- It does not log cookies, bearer tokens, passwords, TOTP secrets
  (including the TOTP code it generates internally), license payloads,
  signatures, ciphertext, request/response headers, or raw response
  bodies.
- It does not bulk-import, retry, or chain multiple executes.
- It does not write to disk.

## Cleanup

After a successful execute (or anywhere you want to drop the session):

```sh
unset IDENTUUM_SITE_ADMIN_EMAIL IDENTUUM_SITE_ADMIN_PASSWORD \
      IDENTUUM_SITE_ADMIN_TOTP_SECRET \
      IDENTUUM_AG_OPERATOR_EMAIL IDENTUUM_AG_OPERATOR_PASSWORD \
      IDENTUUM_AG_OPERATOR_TOKEN \
      IDENTUUM_IDP_AUTH_HEADER IDENTUUM_AG_AUTH_HEADER \
      IDENTUUM_CONFIRM_ORG_ONLY
```

Close the shell tab if you used `read -s`.
