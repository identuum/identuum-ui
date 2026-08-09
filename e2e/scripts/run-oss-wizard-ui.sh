#!/usr/bin/env bash
# ============================================================================
# CANONICAL OSS SETUP-WIZARD UI END-TO-END — single documented entrypoint.
#
#   identuum-ui/e2e/scripts/run-oss-wizard-ui.sh
#     (equivalent: `pnpm e2e:oss-wizard-ui` from identuum-ui/)
#
# One command that (THE-OPERATOR-PATH order B):
#   1. boots the PUBLISHED identuum-idp-oss appliance FRESH (setup
#      INCOMPLETE) on a dedicated compose project + port,
#   2. reads the single-use setup code from the container,
#   3. starts identuum-ui (Playwright's webServer: `next dev`) pointed at it,
#   4. runs EXACTLY ONE Playwright spec (e2e/oss-wizard-ui.spec.ts) that
#      drives the /setup WIZARD UI — code verify → org + site-admin form
#      (NO setup-time MFA on OSS) → success → /login → first-login TOTP
#      ENROLLMENT via the login UI → a signed-in site_admin,
#   5. ALWAYS tears the disposable stack down (trap), and
#   6. exits 0 only when the spec passes.
#
# Why this exists: the only other spec walking the wizard was the CE-only
# ce-fresh-m1-setup.spec.ts, skipped in every OSS run, while the default
# harness completes setup via direct API calls — so the wizard UI's OSS path
# had NO executable coverage and shipped broken in v0.3.3 (the CE-only
# /api/setup/mfa/initiate 404).
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UI_DIR="$(cd "$HERE/../.." && pwd)"

cleanup() {
  local rc=$?
  if [ -n "${WIZ_DIR:-}" ]; then
    bash "$HERE/oss-wizard-ui-down.sh" "$WIZ_DIR" || true
  fi
  return "$rc"
}
trap cleanup EXIT INT TERM

WIZ_DIR="$(bash "$HERE/oss-wizard-ui-up.sh")"
[ -n "$WIZ_DIR" ] && [ -d "$WIZ_DIR" ] || { echo "run-oss-wizard-ui: up failed" >&2; exit 1; }

# shellcheck disable=SC1091
. "$WIZ_DIR/live-env.sh"

( cd "$UI_DIR" && pnpm exec playwright test e2e/oss-wizard-ui.spec.ts --reporter=line )
SPEC_RC=$?

if [ "$SPEC_RC" -eq 0 ]; then
  echo "run-oss-wizard-ui: PASS"
else
  echo "run-oss-wizard-ui: FAIL (playwright exit ${SPEC_RC})" >&2
fi
exit "$SPEC_RC"
