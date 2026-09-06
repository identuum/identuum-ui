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
#
# THE-RED-MINT-HAS-NO-NAME (2026-09-06): a red phase used to leave the record
# saying `failed=1` and nothing else — the failing test's name lived only in
# the console, and the next Playwright invocation wiped test-results/, so
# after the run nobody could tell a flake from a regression without running
# again. Now, when a phase has failures (or exits non-zero), this script also
# prints one "check OK: <phase> failed:" line PER failing test — file:line,
# title, status and the first line of its error — derived from the same JSON
# report, so the record NAMES what failed; and when E2E_EVIDENCE_DIR is set
# (full-run.sh sets it) it copies the phase's Playwright output directory
# (traces, error-context.md) and the JSON report under
# $E2E_EVIDENCE_DIR/<phase>/ before the next phase can wipe them. The
# failure lines carry the "check FAILED:" prefix — THE-RECORD-SAYS-FAILED
# (2026-09-07) taught gate-witness.sh's EVIDENCE_RE to capture it beside
# "check OK:", so a failure no longer has to say OK to reach the record; the
# phase's exit code is still the verdict.
set -u

PHASE="$1"
JSON_OUT="$2"
shift 2
[ "${1:-}" = "--" ] && shift

# Playwright's output directory for THIS phase: an explicit --output=<dir>
# argument, else the default test-results/. Read here so the evidence copy
# below takes the right directory.
PW_OUT_DIR="test-results"
for a in "$@"; do
	case "$a" in --output=*) PW_OUT_DIR="${a#--output=}" ;; esac
done

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
// THE-RECORD-SAYS-FAILED: the summary says FAILED when anything failed.
console.log(`check ${failed > 0 ? "FAILED" : "OK"}: ${process.argv[2]} passed=${passed} skipped=${skipped} failed=${failed}`);
' "$JSON_OUT" "$PHASE"; then
	echo "pw-phase: $PHASE summary derivation failed" >&2
	[ "$rc" -eq 0 ] && rc=1
fi

# NAME every failing test, one evidence line each (THE-RED-MINT-HAS-NO-NAME).
# Derived from the report's suite tree: a test whose status is neither
# "expected" nor "skipped" failed (unexpected, flaky, timedOut); the first
# line of its first non-passing result's error message is the reason. The
# report's file paths are relative to the config's testDir ("../e2e-full/…");
# the leading "../" is stripped so the name is a repo-relative path.
failed_names=$(node -e '
const j = require(require("node:path").resolve(process.argv[1]));
const out = [];
const walk = (suite, file) => {
  const f = (suite.file || file || "").replace(/^(\.\.\/)+/, "");
  for (const s of suite.specs || []) for (const t of s.tests || []) {
    if (t.status === "expected" || t.status === "skipped") continue;
    const bad = (t.results || []).find((r) => r.status !== "passed" && r.status !== "skipped");
    const reason = bad && bad.error && bad.error.message ? bad.error.message.split("\n")[0].slice(0, 200) : (bad ? bad.status : t.status);
    out.push(`${f}:${s.line}:${s.column} › ${s.title} [${t.status}: ${reason}]`);
  }
  for (const c of suite.suites || []) walk(c, f);
};
for (const s of j.suites || []) walk(s, s.file);
for (const line of out) console.log(line);
' "$JSON_OUT" 2>/dev/null || true)
if [ -n "$failed_names" ]; then
	while IFS= read -r line; do
		echo "check FAILED: $PHASE failed: $line"
	done <<<"$failed_names"
elif [ "$rc" -ne 0 ]; then
	echo "check FAILED: $PHASE failed: no test is marked failed in the JSON report, but playwright exited $rc — read the phase output above"
fi

# KEEP THE EVIDENCE of a red phase before the next Playwright invocation wipes
# its output directory: the traces and error-context.md under the phase's
# output dir, and the JSON report, copied under $E2E_EVIDENCE_DIR/<phase>/.
# Only on failure, only when the harness names an evidence directory.
if [ "$rc" -ne 0 ] && [ -n "${E2E_EVIDENCE_DIR:-}" ]; then
	dest="$E2E_EVIDENCE_DIR/$PHASE"
	mkdir -p "$dest"
	[ -d "$PW_OUT_DIR" ] && cp -R "$PW_OUT_DIR" "$dest/" 2>/dev/null
	cp "$JSON_OUT" "$dest/" 2>/dev/null
	echo "check OK: $PHASE evidence kept at ${dest#"$PWD"/} ($(find "$dest" -type f | wc -l | tr -d ' ') file(s): playwright output dir + json report)"
fi

exit "$rc"
