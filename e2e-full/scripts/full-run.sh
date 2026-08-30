#!/usr/bin/env bash
# full-run.sh — the e2e-full disposable harness (THE-DISPOSABLE-HARNESS, 2026-08-28).
#
# DESTROYS AND REBUILDS its own environment on every run:
#   1. fast-clean   — stops the OSS dev stack and DELETES its postgres volume
#   2. oss-up       — rebuilds the image from the working tree and starts it
#   3. dev-smoke    — refuses a stale binary (build_commit must match the tree)
#   4. oss-bootstrap— creates the site_admin with a RUN-LOCAL random password
#   5. playwright   — runs the e2e-full project, SERIAL BY PHYSICS
#                     (--workers=1: TOTP replay protection rejects concurrent
#                     logins minting the same 30-second code)
#   6. fast-clean   — teardown: stack down, volume gone, no harness residue
#
# NEVER wire this into make verify, wiki make check, or CI: step 1 eats the
# local OSS dev database by design. The Playwright project it runs is not
# even registered unless IDENTUUM_E2E_FULL=1 (set below and nowhere else).
#
# The run-local password is generated here, exported to the bootstrap and to
# the spec via the environment, and never printed.
set -euo pipefail

UI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
IDP_DIR=$(cd "$UI_DIR/../identuum-idp-oss" && pwd)

echo "e2e-full: DESTROYING the OSS dev stack (down --volumes, app profile included)"
# NOT `make fast-clean`: that recipe omits `--profile app`, so it deletes
# postgres and the volume but LEAVES the profiled app container serving
# (measured: a 6.4s "run" where a stale app answered the health probe
# instantly and bootstrap then hit a freshly re-created empty postgres).
# Recorded as an idp-oss follow-up; the repo is read-only for this slice.
# Same compose file, same flags, plus the profile — the app dies too.
docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app down --volumes

echo "e2e-full: rebuilding + starting the appliance (oss-up, INSECURE_DEV_MODE)"
# TEST-ONLY rate-limit escape hatch (idp-oss internal/runtime/insecure_dev_mode.go,
# INSECURE-DEV-MODE-1): the harness drives hundreds of same-IP logins; without
# this the LoginRiskService lockout (5 failures / 15min, answering
# invalid_credentials by design) can wedge the whole dev-loop suite — measured
# 2026-08-29 as a login stall at the password step. Disables server-side rate
# limiting ONLY (HTTP limiter classes + login lockout); auth/MFA/session
# validation are untouched. Scoped to THIS harness's appliance via the compose
# env passthrough; the flag defaults OFF everywhere else.
export IDENTUUM_IDP_INSECURE_DEV_MODE=true
# The harness dev-loop UI serves on a DEDICATED port (distinct from the
# operator's standing :7104 dev server). Declared here — before the appliance
# starts — because the appliance must allow this origin for WebAuthn: the RP
# origin allowlist otherwise defaults to http://localhost:7104 and every
# passkey attestation from the harness UI is refused (measured 2026-08-29).
E2E_UI_PORT=7108
# Force the suite's ONE authoritative base URL (shell env outranks the
# operator's gitignored .env.playwright file, which loadEnvFile never lets
# overwrite an already-set var). Without this, an operator file pinning
# IDENTUUM_E2E_BASE_URL (e.g. :7114) silently wins over IDENTUUM_E2E_PORT —
# measured 2026-08-29 as a passkey finish 400: the ceremony ran from :7114
# while the appliance allowlisted :7108. Port, baseURL, and the appliance's
# WebAuthn origin all derive from this one value.
export IDENTUUM_E2E_BASE_URL="http://localhost:${E2E_UI_PORT}"
export IDENTUUM_IDP_UI_PUBLIC_BASE_URL="http://localhost:${E2E_UI_PORT}"
make -C "$IDP_DIR" oss-up

echo "e2e-full: waiting for the appliance to serve"
for i in $(seq 1 60); do
	if curl -fsS --max-time 2 http://127.0.0.1:7113/health >/dev/null 2>&1; then
		break
	fi
	if [ "$i" -eq 60 ]; then
		echo "e2e-full: appliance never became healthy" >&2
		exit 1
	fi
	sleep 2
done

echo "e2e-full: dev-smoke (stale-binary refusal)"
make -C "$IDP_DIR" dev-smoke

# ── THE-WITNESSED-COVERAGE: every suite phase runs as a gate-witness STEP, so
# GATE-RUN.e2e-full.txt carries per-phase exits plus "check OK:" evidence lines
# derived from each run's OWN Playwright JSON report (pw-phase.sh) and, for
# route coverage, from the provisioned run's traces (coverage-from-run.mjs).
# The record is GITIGNORED for the same reason as GATE-RUN.ci.txt — a harness
# run must not stale the committed verify record's digest — and stays
# re-checkable on demand: `bash scripts/gate-witness.sh check . GATE-RUN.e2e-full.txt`.
#
# THE-UI-PROVISIONER phases inside the plan: after the API suite, seed real
# identities and run the dev-loop e2e/ suite against THIS appliance. The
# dev-loop suite navigates the UI, so it runs the "chromium" project WITHOUT
# IDENTUUM_E2E_FULL=1 (that flag omits the webServer) — a fresh `next dev` on
# the dedicated dev-loop port starts and the isolated config points it at the
# appliance on :7113. Everything here is reached ONLY through this harness; a
# plain `pnpm e2e` never runs any of it, and the dev loop is not slowed.
# --workers=1 throughout for TOTP replay physics.
E2E_UI_CFG="$UI_DIR/e2e/.auth/ui-runtime.provisioner.json"
FIXTURE_FILE="$UI_DIR/e2e/.auth/e2e-org-admin-fixture.json"
export E2E_UI_CFG FIXTURE_FILE
mkdir -p "$(dirname "$E2E_UI_CFG")"
# Non-secret runtime config: point the dev-loop UI at the running appliance.
# Pretty-printed (2-space) because repo-wide biome format-checks this dir.
cat >"$E2E_UI_CFG" <<EOF
{
  "configured": true,
  "ui_origin": "http://localhost:${E2E_UI_PORT}",
  "idp": { "enabled": true, "public_base_url": "http://127.0.0.1:7113" },
  "ag": { "enabled": false, "public_base_url": "" }
}
EOF

cd "$UI_DIR"

# The API suite is browser-less; the dev-loop suite drives a real browser, so
# ensure the Chromium binary exists (idempotent — a no-op once installed).
# Environment prep, not a witnessed phase.
echo "e2e-full: ensuring the Chromium browser is installed for the dev-loop suite"
pnpm exec playwright install chromium >/dev/null 2>&1 || pnpm exec playwright install chromium

# THE-ROLE-CENSUS: every api() call in every phase appends one observation
# (method, path, role-from-the-bearer's-own-claims, status) to this run-local
# JSONL; the role-matrix step collapses them against the docgen endpoint
# golden and enforces the committed (endpoint, role) matrix. Truncated per
# run — observations are this run's, never carried forward.
export IDENTUUM_E2E_MATRIX_LOG="$UI_DIR/e2e/.auth/role-matrix-observations.jsonl"
mkdir -p "$UI_DIR/e2e/.auth"
: >"$IDENTUUM_E2E_MATRIX_LOG"

# CREDENTIAL ISOLATION (measured failure, 2026-08-29): playwright.config.ts
# auto-loads the operator's gitignored .env.playwright.idp-oss.local, whose
# IDENTUUM_TEST_* credentials belong to the operator's DEV stack — not this
# fresh appliance. Left inherited, the "plain" baseline logs in with a wrong
# password 18+ times, the LoginRiskService account counter (5 failures/15min)
# locks site_admin, lockout answers invalid_credentials by design (LOCKOUT-1),
# and every later login stalls at the password step. loadEnvFile never
# overwrites an ALREADY-SET env var, so exporting them EMPTY here makes the
# baseline honestly skip (skipAuthTests=true) and the provisioned run take its
# credentials from the envelope alone (which outranks env vars in login.ts).
export IDENTUUM_TEST_SITE_ADMIN_EMAIL="" IDENTUUM_TEST_SITE_ADMIN_PASSWORD="" \
	IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET="" IDENTUUM_TEST_ORG_ADMIN_EMAIL="" \
	IDENTUUM_TEST_ORG_ADMIN_PASSWORD="" IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET="" \
	IDENTUUM_TEST_ORG_USER_EMAIL="" IDENTUUM_TEST_ORG_USER_PASSWORD="" \
	IDENTUUM_TEST_ORG_USER_TOTP_SECRET="" IDENTUUM_TEST_ORG_ID=""

RECORD="GATE-RUN.e2e-full.txt"
GW="scripts/gate-witness.sh"

# The plan is fixed at init; the optional MEASURE baseline joins it only when
# requested, so an absent baseline is a declared subtraction, never INCOMPLETE.
PLAN=(fresh-appliance api-suite)
[ "${IDENTUUM_E2E_MEASURE:-}" = "1" ] && PLAN+=(plain-baseline)
PLAN+=(provisioner static-rows-sweep static-rows role-matrix devloop-provisioned skip-ceiling coverage admin-reset)
bash "$GW" init "$RECORD" "identuum-ui make e2e-full" "${PLAN[@]}"

rc=0

# ── THE-FRESH-APPLIANCE-PHASE: the appliance is STILL setup_required here
# (oss-up brought it up fresh; the bootstrap runs AFTER this phase) — the one
# window where / routes to first-run setup and /setup renders the wizard
# shell. The phase is assert-only: setup completion stays with the single
# CLI bootstrap below (UI-PROVISIONER-1 pins exactly one such path), so the
# stack is never left half-built and no second setup path exists. Traces go
# to a dedicated output dir because every later Playwright invocation wipes
# the default test-results/ — coverage needs these traces at the end.
echo "e2e-full: fresh-appliance phase (setup_required window: / and /setup)"
bash "$GW" step "$RECORD" 'fresh-appliance=IDENTUUM_E2E_FRESH_PHASE=1 IDENTUUM_E2E_PORT='"$E2E_UI_PORT"' IDENTUUM_UI_CONFIG_FILE="$E2E_UI_CFG" IDENTUUM_IDP_BASE_URL=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh fresh-appliance e2e/.auth/pw-fresh.json -- --project=chromium --workers=1 --trace on --output=e2e/.auth/fresh-results e2e/fresh-appliance.spec.ts' || rc=1

echo "e2e-full: bootstrapping site_admin (run-local password, never printed)"
# Prefix satisfies the strict bootstrap policy (upper+lower+digit+special);
# the entropy is the random hex tail.
IDENTUUM_IDP_BOOTSTRAP_PASSWORD="E2eFull!$(openssl rand -hex 16)"
export IDENTUUM_IDP_BOOTSTRAP_PASSWORD
# NOT `make oss-bootstrap`: that target wraps the call in `sh -c` and the
# runtime image ships no shell (measured: OCI exec "sh": executable file not
# found — recorded as an idp-oss follow-up; the repo is read-only for this
# slice). Same binary, same argv, no shell: the DSN is read host-side from
# the running container's env and passed as a plain argument. It is a local
# dev DSN and is never printed.
OSS_DB_DSN=$(docker inspect identuum-idp-oss \
	--format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^IDENTUUM_IDP_OSS_DB=//p')
if [ -z "$OSS_DB_DSN" ]; then
	echo "e2e-full: could not resolve the container's DB DSN" >&2
	exit 1
fi
(cd "$IDP_DIR" && docker compose -f deployment/docker-compose.dev.yml --profile app \
	exec -T -e IDENTUUM_IDP_BOOTSTRAP_PASSWORD app \
	/app/identuum-idp bootstrap "$OSS_DB_DSN")

echo "e2e-full: API suite (oss-full)"
bash "$GW" step "$RECORD" 'api-suite=IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" IDENTUUM_E2E_FULL_IDP_BASE=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh api-suite e2e/.auth/pw-api-suite.json -- --project=oss-full --workers=1' || rc=1

# MEASUREMENT baseline (opt-in via IDENTUUM_E2E_MEASURE=1): the SAME dev-loop
# suite BEFORE provisioning — no envelope, no dynamic-fixture, no inherited
# credentials — so the credential-gated specs self-skip. The honest "plain"
# number, measured in this run, never carried forward.
if [ "${IDENTUUM_E2E_MEASURE:-}" = "1" ]; then
	echo "e2e-full: MEASURE baseline — dev-loop suite PLAIN (unprovisioned)"
	bash "$GW" step "$RECORD" 'plain-baseline=rm -f "$FIXTURE_FILE" && IDENTUUM_E2E_PORT='"$E2E_UI_PORT"' IDENTUUM_UI_CONFIG_FILE="$E2E_UI_CFG" IDENTUUM_IDP_BASE_URL=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh plain-baseline e2e/.auth/pw-plain.json -- --project=chromium --workers=1' || rc=1
fi

# Provision the dev-loop fixture from the ALREADY-bootstrapped site_admin (the
# API suite above enrolled its MFA; the provisioner reuses that captured
# secret — no second bootstrap path). Writes e2e/.auth/e2e-org-admin-fixture.json.
# THE-DISPOSABLE-IDENTITIES: run-local passwords for the DISPOSABLE recovery
# org's identities (a TOTP-enrolled org_admin the MFA-reset ceremony may
# reset, and a no-MFA "rotate" org_user the password-rotate ceremony may
# rotate). Generated here, passed by env, never printed; mutating them stales
# nothing the rest of the suite logs in with.
IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD="E2eRec!$(openssl rand -hex 16)"
IDENTUUM_OSS_TEST_USER_PASSWORD="E2eRot!$(openssl rand -hex 16)"
IDENTUUM_OSS_TEST_USER_EMAIL="rotate@e2e-recovery.test"
export IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD IDENTUUM_OSS_TEST_USER_PASSWORD IDENTUUM_OSS_TEST_USER_EMAIL

echo "e2e-full: provisioning the dev-loop fixture (opt-in specs light up)"
bash "$GW" step "$RECORD" 'provisioner=IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_PROVISION=1 IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD="$IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD" IDENTUUM_OSS_TEST_USER_PASSWORD="$IDENTUUM_OSS_TEST_USER_PASSWORD" IDENTUUM_E2E_FULL_IDP_BASE=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh provisioner e2e/.auth/pw-provisioner.json -- --project=oss-full --workers=1 provision-fixture' || rc=1

# FAIL LOUD if the provisioner did not seal the envelope: without it,
# global-setup's rebuild path would try to stand up ITS OWN appliance
# (docker-compose.e2e.yml) on the same :7113 the harness appliance holds —
# measured 2026-08-29 as a port-bind error after a silent fall-through. The
# record is left un-finalized: the unrun planned steps read INCOMPLETE, which
# is the truth.
if [ ! -f "$FIXTURE_FILE" ]; then
	echo "e2e-full: provisioner did not write the fixture envelope — aborting the dev-loop run" >&2
	docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app down --volumes
	exit 1
fi

# THE-ADMIN-RESET needs the tenant credentials AFTER the dev-loop suite,
# whose global teardown deletes the envelope (removeLocalFixtureFiles — "no
# trace left"). Keep a run-local copy for the last phase; same directory,
# same gitignore, same 0600, gone with the run like the original.
ADMIN_RESET_ENVELOPE="$UI_DIR/e2e/.auth/admin-reset-envelope.json"
cp "$FIXTURE_FILE" "$ADMIN_RESET_ENVELOPE"
chmod 600 "$ADMIN_RESET_ENVELOPE"

# THE-PROBES-THAT-STAY: re-assert, EVERY run, the status + shape each of the
# census's 23 formerly-static-only rows measured when probed live — as its own
# witnessed phase (needs the org_admin envelope, so it follows the
# provisioner). The follow-up step enforces the committed row set + floor from
# the phase's OWN JSON report, so a skipped or deleted row test reads STATIC
# ROWS DRIFT, never green. Mutation note: [ROW 21] really rotates the fixture
# org_admin's recovery codes — confined to this disposable appliance (torn
# down at run end; no harness login uses recovery codes).
echo "e2e-full: static census rows sweep (the probes that stay)"
bash "$GW" step "$RECORD" 'static-rows-sweep=IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_STATIC_ROWS=1 IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" IDENTUUM_E2E_FULL_IDP_BASE=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh static-rows-sweep e2e/.auth/pw-static-rows.json -- --project=oss-full --workers=1 static-rows-sweep' || rc=1

echo "e2e-full: enforcing the static-rows committed set + floor"
bash "$GW" step "$RECORD" 'static-rows=node e2e-full/scripts/static-rows-from-run.mjs e2e/.auth/pw-static-rows.json' || rc=1

# THE-ROLE-CENSUS: collapse this run's api() observations into the
# (endpoint, role) matrix and enforce the committed set + floor. The
# measurement WINDOW is fixed by this step's position: the API-driving
# phases (fresh-appliance through static-rows). The dev-loop suite runs
# AFTER this step, so its api() calls fall outside the window every run —
# by design, stated honestly; UI-side coverage has its own floor
# (coverage-from-run.mjs). The window is identical for the bootstrap run
# and every enforcing run, so the matrix compares like with like.
echo "e2e-full: enforcing the (endpoint, role) coverage matrix"
bash "$GW" step "$RECORD" 'role-matrix=node e2e-full/scripts/role-matrix-from-run.mjs e2e/.auth/role-matrix-observations.jsonl' || rc=1

# Run the dev-loop suite PROVISIONED: the envelope is present and
# dynamic-fixture mode is on, so global-setup's fast path REUSES this running
# appliance (it validates the envelope's site_admin against :7113 and skips
# any down/up) instead of standing up a second stack. --trace on feeds the
# coverage phase: route coverage is derived from what the run actually did.
# THE-SKIPPED-THIRTY-TWO: the orgs-CRUD ceremony (create -> edit -> soft-delete,
# try/finally self-cleaning) is safe on THIS disposable appliance and the
# dynamic fixture provides an MFA-enrolled site_admin, so it runs here
# (IDENTUUM_E2E_ORGS_CRUD=1). A leak on failure dies with the appliance.
echo "e2e-full: dev-loop suite PROVISIONED (the previously-dark specs now light)"
bash "$GW" step "$RECORD" 'devloop-provisioned=IDENTUUM_E2E_ORGS_CRUD=1 IDENTUUM_E2E_OSS_CHANGE_PASSWORD=1 IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true IDENTUUM_OSS_TEST_USER_EMAIL="$IDENTUUM_OSS_TEST_USER_EMAIL" IDENTUUM_OSS_TEST_USER_PASSWORD="$IDENTUUM_OSS_TEST_USER_PASSWORD" IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD="$IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD" IDENTUUM_E2E_PORT='"$E2E_UI_PORT"' IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true IDENTUUM_IDP_BASE_URL=http://127.0.0.1:7113 IDENTUUM_UI_CONFIG_FILE="$E2E_UI_CFG" bash e2e-full/scripts/pw-phase.sh devloop-provisioned e2e/.auth/pw-devloop.json -- --project=chromium --workers=1 --trace on' || rc=1

# THE-DISPOSABLE-IDENTITIES: the devloop skip count gets a CEILING, exactly
# like the coverage floor — a new skip must be a deliberate commit, never
# silent creep. Enforced from the phase's OWN report.
echo "e2e-full: enforcing the devloop skip ceiling"
bash "$GW" step "$RECORD" 'skip-ceiling=node e2e-full/scripts/skip-ceiling-from-run.mjs e2e/.auth/pw-devloop.json' || rc=1

# Route coverage, derived from THE RUN: the inventory is scanned from
# src/app/**/page.tsx and the reached set from the traces of tests the JSON
# report marks passed. No hand-maintained list anywhere.
echo "e2e-full: deriving route coverage from the provisioned run"
bash "$GW" step "$RECORD" 'coverage=node e2e-full/scripts/coverage-from-run.mjs "$IDENTUUM_E2E_BASE_URL" e2e/.auth/pw-devloop.json e2e/.auth/pw-fresh.json' || rc=1

# THE-ADMIN-RESET (T-R2a): the LAST phase, because it rotates site_admin's
# credentials — nothing after it may depend on them. Proves TEST-spec R2's
# "admin reset without customer data loss" live on the populated appliance:
# recover-site-admin via the product CLI (run-local password, generated
# below, never printed), old password refused, new password through the
# first-login enrolment to working site_admin authority, every seeded tenant
# resource still present by id, tenant logins unaffected.
IDENTUUM_E2E_RECOVERED_ADMIN_PASSWORD="R3cover!$(openssl rand -hex 16)"
export IDENTUUM_E2E_RECOVERED_ADMIN_PASSWORD
echo "e2e-full: admin-reset scenario (rotates site_admin; run-local recovery password)"
bash "$GW" step "$RECORD" 'admin-reset=IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_ADMIN_RESET=1 IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" IDENTUUM_E2E_IDP_DIR='"$IDP_DIR"' IDENTUUM_E2E_FIXTURE_FILE='"$ADMIN_RESET_ENVELOPE"' IDENTUUM_E2E_FULL_IDP_BASE=http://127.0.0.1:7113 bash e2e-full/scripts/pw-phase.sh admin-reset e2e/.auth/pw-admin-reset.json -- --project=oss-full --workers=1 admin-reset' || rc=1

bash "$GW" finalize "$RECORD" || rc=1

echo "e2e-full: teardown (down --volumes, app profile included)"
docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app down --volumes

# Green only when EVERY witnessed phase recorded exit=0 (finalize enforces the
# same condition inside the record itself).
exit "$rc"
