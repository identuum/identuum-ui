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

rc=0
(
	cd "$UI_DIR"
	IDENTUUM_E2E_FULL=1 \
	IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" \
	IDENTUUM_E2E_FULL_IDP_BASE="http://127.0.0.1:7113" \
	pnpm exec playwright test --project=oss-full --workers=1
) || rc=$?

# ── THE-UI-PROVISIONER: after the API suite, seed real identities and run the
# dev-loop e2e/ suite against THIS appliance. The dev-loop suite navigates the
# UI, so it runs the "chromium" project WITHOUT IDENTUUM_E2E_FULL=1 (that flag
# omits the webServer) — a fresh `next dev` on the dedicated dev-loop port starts
# and the isolated config points it at the appliance on :7113. Everything below
# is still reached
# ONLY through this harness (make e2e-full → IDENTUUM_E2E_FULL=1 in the shell
# that invoked us); a plain `pnpm e2e` never runs any of it, and the dev loop is
# not slowed. --workers=1 for TOTP replay physics, same as the API suite.
# E2E_UI_PORT is declared above (pre-appliance) so the WebAuthn origin export
# could reference it; reused here for the dev-loop webServer + runtime config.
E2E_UI_CFG="$UI_DIR/e2e/.auth/ui-runtime.provisioner.json"
FIXTURE_FILE="$UI_DIR/e2e/.auth/e2e-org-admin-fixture.json"
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

devloop_rc=0
(
	cd "$UI_DIR"

	# The API suite is browser-less; the dev-loop suite drives a real browser, so
	# ensure the Chromium binary exists (idempotent — a no-op once installed).
	echo "e2e-full: ensuring the Chromium browser is installed for the dev-loop suite"
	pnpm exec playwright install chromium >/dev/null 2>&1 || pnpm exec playwright install chromium

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

	# MEASUREMENT baseline (opt-in via IDENTUUM_E2E_MEASURE=1): the SAME dev-loop
	# suite BEFORE provisioning — no envelope, no dynamic-fixture, no inherited
	# credentials — so the credential-gated specs self-skip. This is the honest
	# "plain run" number the provisioned run is compared against; it is never
	# carried forward.
	if [ "${IDENTUUM_E2E_MEASURE:-}" = "1" ]; then
		echo "e2e-full: MEASURE baseline — dev-loop suite PLAIN (unprovisioned)"
		rm -f "$FIXTURE_FILE"
		IDENTUUM_E2E_PORT="$E2E_UI_PORT" \
		IDENTUUM_UI_CONFIG_FILE="$E2E_UI_CFG" \
		IDENTUUM_IDP_BASE_URL="http://127.0.0.1:7113" \
			pnpm exec playwright test --project=chromium --workers=1 || true
	fi

	# Provision the dev-loop fixture from the ALREADY-bootstrapped site_admin (the
	# API suite above enrolled its MFA; the provisioner reuses that captured
	# secret — no second bootstrap path). Writes e2e/.auth/e2e-org-admin-fixture.json.
	echo "e2e-full: provisioning the dev-loop fixture (opt-in specs light up)"
	IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_PROVISION=1 \
	IDENTUUM_E2E_FULL_ADMIN_PASSWORD="$IDENTUUM_IDP_BOOTSTRAP_PASSWORD" \
	IDENTUUM_E2E_FULL_IDP_BASE="http://127.0.0.1:7113" \
		pnpm exec playwright test --project=oss-full --workers=1 provision-fixture

	# FAIL LOUD if the provisioner did not seal the envelope: without it,
	# global-setup's rebuild path would try to stand up ITS OWN appliance
	# (docker-compose.e2e.yml) on the same :7113 the harness appliance holds —
	# measured 2026-08-29 as a port-bind error after a silent fall-through.
	if [ ! -f "$FIXTURE_FILE" ]; then
		echo "e2e-full: provisioner did not write the fixture envelope — aborting the dev-loop run" >&2
		exit 1
	fi

	# Run the dev-loop suite PROVISIONED: the envelope is present and
	# dynamic-fixture mode is on, so global-setup's fast path REUSES this running
	# appliance (it validates the envelope's site_admin against :7113 and skips
	# any down/up) instead of standing up a second stack.
	echo "e2e-full: dev-loop suite PROVISIONED (the previously-dark specs now light)"
	IDENTUUM_E2E_PORT="$E2E_UI_PORT" \
	IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true \
	IDENTUUM_IDP_BASE_URL="http://127.0.0.1:7113" \
	IDENTUUM_UI_CONFIG_FILE="$E2E_UI_CFG" \
		pnpm exec playwright test --project=chromium --workers=1
) || devloop_rc=$?

echo "e2e-full: teardown (down --volumes, app profile included)"
docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app down --volumes

# Surface either suite's failure: the harness is green only when BOTH the API
# suite and the provisioned dev-loop suite pass.
if [ "$rc" -eq 0 ]; then rc="$devloop_rc"; fi
exit "$rc"
