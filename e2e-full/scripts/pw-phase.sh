#!/usr/bin/env bash
# pw-phase.sh — run ONE Playwright phase of the e2e-full harness and print a
# machine-checkable summary line derived from the run's OWN JSON report
# (THE-WITNESSED-COVERAGE, 2026-08-29).
#
# Usage: pw-phase.sh <phase-name> <json-report-path> -- <playwright args...>
#
# The summary line starts with "check OK:" so gate-witness's evidence regex
# captures it verbatim into the record — the numbers in GATE-RUN.e2e-full.txt
# are therefore always the run's own, never carried forward. Exits with
# playwright's exit code (a red phase reads red in the record).
set -u

PHASE="$1"
JSON_OUT="$2"
shift 2
[ "${1:-}" = "--" ] && shift

mkdir -p "$(dirname "$JSON_OUT")"
rm -f "$JSON_OUT"

rc=0
PLAYWRIGHT_JSON_OUTPUT_NAME="$JSON_OUT" \
	pnpm exec playwright test --reporter=line,json "$@" || rc=$?

if [ ! -f "$JSON_OUT" ]; then
	echo "pw-phase: $PHASE produced no JSON report — cannot derive numbers" >&2
	exit "${rc:-1}"
fi

# Derive passed/skipped/failed from the report the run itself wrote. The
# leading newline is load-bearing: Playwright's line reporter can leave the
# stream mid-line (a bare \r progress update), which would glue this summary
# onto that partial line and defeat gate-witness's ^-anchored evidence regex
# (measured 2026-08-29: four phases recorded exits but no evidence lines).
printf '\n'
# path.resolve is load-bearing: require() treats a bare relative path as a
# module NAME (measured 2026-08-29: MODULE_NOT_FOUND for an existing file).
# A failed derivation FAILS the phase — numbers that cannot be derived must
# never read green.
if ! node -e '
const j = require(require("node:path").resolve(process.argv[1]));
const s = j.stats || {};
const passed = s.expected ?? 0;
const skipped = s.skipped ?? 0;
const failed = (s.unexpected ?? 0) + (s.flaky ?? 0);
console.log(`check OK: ${process.argv[2]} passed=${passed} skipped=${skipped} failed=${failed}`);
' "$JSON_OUT" "$PHASE"; then
	echo "pw-phase: $PHASE summary derivation failed" >&2
	[ "$rc" -eq 0 ] && rc=1
fi

exit "$rc"
