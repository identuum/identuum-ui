#!/bin/sh
# run-upgrade-backup-live.sh — single-command opt-in runner for the
# live-backend OSS-to-CE /upgrade backup Playwright regression.
#
# Invocation (operator-driven; not part of default verify / e2e):
#
#   make verify-live-upgrade-backup    # Makefile target
#   pnpm e2e:upgrade-backup-live       # equivalent npm script alias
#
# Both wrappers ultimately exec this script. The script chains:
#
#   1. e2e/scripts/upgrade-backup-live-up.sh
#         — brings up the throwaway Compose stack, seeds OSS shape,
#           captures upgrade-token to a mode-0600 file under
#           ${SMOKE_DIR}, writes ${SMOKE_DIR}/live-env.sh.
#
#   2. . ${SMOKE_DIR}/live-env.sh
#         — sources the env exports that gate the live Playwright
#           spec (IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1, port + base URL
#           overrides, scratch-dir paths, etc.).
#
#   3. npx playwright test e2e/upgrade-backup-live.spec.ts
#         — drives the 4-test live spec; the spec self-skips when
#           the opt-in env is unset, so re-runs of this script
#           without the up.sh step would behave correctly too.
#
#   4. e2e/scripts/upgrade-backup-live-down.sh  (ALWAYS)
#         — zero-fills + unlinks the upgrade-token file, removes
#           scratch files, and runs `docker compose down -v` for the
#           throwaway project only. The `trap` below makes this
#           teardown step ALWAYS run, even when Playwright fails or
#           up.sh fails mid-flight.
#
# Exit code is the Playwright exit code on success path; otherwise
# the first failing step propagates. The teardown step never
# overwrites a non-zero spec exit code (we capture it BEFORE calling
# down.sh).
#
# SECURITY:
#   - The upgrade-token plaintext, the DB password, and backup body
#     bytes are NEVER echoed by this script. The captured token
#     lives ONLY inside ${SMOKE_DIR}/upgrade-token.txt (mode 0600)
#     and is zero-filled before unlink by down.sh.
#   - The script does NOT print the full Playwright stdout/stderr
#     verbatim into a log file the operator might `cat` later; the
#     wire-shape evidence (HTTP statuses, JSON state strings) is
#     printed but is the same shape as the spec body asserts.

set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
UI_REPO="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

PROJECT_NAME="${PROJECT_NAME:-idp-ce-upgrade-backup-playwright-20260617}"
SMOKE_DIR="${SMOKE_DIR:-/tmp/${PROJECT_NAME}}"

export PROJECT_NAME
export SMOKE_DIR

UP_SCRIPT="${SCRIPT_DIR}/upgrade-backup-live-up.sh"
DOWN_SCRIPT="${SCRIPT_DIR}/upgrade-backup-live-down.sh"
SPEC_REL="e2e/upgrade-backup-live.spec.ts"

if [ ! -x "$UP_SCRIPT" ] || [ ! -x "$DOWN_SCRIPT" ]; then
    echo "runner: harness scripts missing or not executable at ${SCRIPT_DIR}" >&2
    exit 1
fi

# Always run down.sh on exit, even on early termination. Trap handles
# signals so a Ctrl-C does not leave the throwaway stack running.
# The PROJECT_NAME + SMOKE_DIR env are inherited by the down.sh
# subprocess (they are exported above), so the teardown targets the
# right project even when called from this trap.
cleanup() {
    rc=$?
    echo ""
    echo "runner: running teardown (always)..."
    "$DOWN_SCRIPT" || true
    exit "$rc"
}
trap cleanup EXIT INT TERM HUP

echo "runner: bringing up the live throwaway stack..."
"$UP_SCRIPT"

echo "runner: sourcing live env (paths only; no token VALUE printed)"
# shellcheck disable=SC1091
. "${SMOKE_DIR}/live-env.sh"

echo "runner: running the opt-in Playwright spec"
cd "$UI_REPO"
# The spec self-skips on missing opt-in env, but live-env.sh sets
# IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1 so the gate opens here.
PLAYWRIGHT_EXIT=0
npx playwright test "$SPEC_REL" --reporter=list || PLAYWRIGHT_EXIT=$?

# Re-set $? so the trap surfaces the Playwright exit code.
if [ "$PLAYWRIGHT_EXIT" -ne 0 ]; then
    echo "runner: Playwright spec exited with ${PLAYWRIGHT_EXIT}" >&2
    # Force the script's own exit code to match. The trap will then
    # run teardown and exit with the same code.
    exit "$PLAYWRIGHT_EXIT"
fi

echo "runner: live regression PASSED."
# trap will fire after this line and run teardown.
