#!/usr/bin/env bash
# ============================================================================
# CANONICAL OSS SITE-ADMIN OVERVIEW SMOKE — single documented entrypoint.
#
#   identuum-ui/e2e/scripts/run-oss-site-admin-smoke.sh
#     (equivalent: `pnpm e2e:oss-site-admin-smoke` from identuum-ui/)
#
# One command that:
#   1. boots identuum-idp-oss against a DISPOSABLE test Postgres,
#   2. bootstraps a site_admin via the `--bootstrap` CLI with a
#      policy-conforming password,
#   3. starts identuum-ui (Playwright's webServer: `next dev`) pointed at that
#      backend via IDENTUUM_UI_CONFIG_FILE,
#   4. runs EXACTLY ONE Playwright test (e2e/oss-site-admin-smoke.spec.ts) that
#      logs in as the bootstrapped site_admin and asserts the /site-admin
#      overview renders its Identity, Deployed capabilities, and Backend health
#      cards,
#   5. ALWAYS tears the disposable stack down (trap), and
#   6. exits 0 only when the Playwright test passes.
#
# Nothing here modifies any backend handler or any authorization guard; the
# test exercises the real server-side RequireSiteAdmin / site-admin layout
# guard. No secret value is printed.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UI_DIR="$(cd "$HERE/../.." && pwd)"   # identuum-ui

cleanup() {
  # Preserve the spec exit code across teardown.
  local rc=$?
  if [ -n "${SMOKE_DIR:-}" ]; then
    bash "$HERE/oss-site-admin-smoke-down.sh" "$SMOKE_DIR" || true
  fi
  return "$rc"
}
trap cleanup EXIT INT TERM

# 1–3 + 5. Bring the disposable stack up; capture the scratch dir.
SMOKE_DIR="$(bash "$HERE/oss-site-admin-smoke-up.sh")"
[ -n "$SMOKE_DIR" ] && [ -d "$SMOKE_DIR" ] || { echo "run-oss-site-admin-smoke: up failed" >&2; exit 1; }

# Source the env exports (gates the spec, points the UI at OSS, supplies creds).
# shellcheck disable=SC1091
. "$SMOKE_DIR/live-env.sh"

# 4. Run EXACTLY ONE Playwright spec. Playwright's webServer auto-starts
#    `next dev` on IDENTUUM_E2E_PORT, inheriting IDENTUUM_UI_CONFIG_FILE so the
#    UI talks to the disposable OSS backend.
( cd "$UI_DIR" && pnpm exec playwright test e2e/oss-site-admin-smoke.spec.ts --reporter=line )
SPEC_RC=$?

if [ "$SPEC_RC" -eq 0 ]; then
  echo "run-oss-site-admin-smoke: PASS"
else
  echo "run-oss-site-admin-smoke: FAIL (playwright exit ${SPEC_RC})" >&2
fi
exit "$SPEC_RC"
