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

echo "e2e-full: rebuilding + starting the appliance (oss-up)"
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

echo "e2e-full: teardown (down --volumes, app profile included)"
docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app down --volumes

exit "$rc"
