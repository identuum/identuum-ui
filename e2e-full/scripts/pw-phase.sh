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

# THE-ELEVEN-MISMATCHES (2026-09-15): READ THE BROWSER CONSOLE. For four days
# every mint's dev server printed "Hydration failed because the server
# rendered HTML didn't match the client" eleven times while every spec
# passed, because nothing in this harness looked at the console — a React
# hydration mismatch (server markup ≠ the client's first render) was
# invisible to every gate. The phase's OWN traces (--trace on) carry every
# console message the browser emitted; this scan reads them and FAILS the
# phase on a React rendering or hydration error, one "check FAILED:" line per
# hit naming the page (pathname only — never a query string) and the test.
#
# SCOPE, precisely — a message React's renderer wrote about markup or
# rendering, whether the browser surfaced it as an UNCAUGHT PAGE ERROR (the
# trace's pageError event — how React 19 under next dev reports a hydration
# mismatch: measured, all eleven of 2026-09-15 were pageError, none console)
# or as a console message of type error: it says "Hydration failed", "didn't
# match the client", "while hydrating", "The above error occurred in", or
# carries React's own https://react.dev/link/ pointer (every React 19 renderer
# error and warning ends with one). NOT every console line, NOT every page
# error. These classes are TOLERATED — counted in the evidence line, never
# failed on — because the suite provokes them on purpose:
#   - "Failed to load resource: the server responded with a status of NNN":
#     Chromium logs every non-2xx fetch as a console error, and this suite
#     sends wrong passwords, unauthenticated probes and a deliberate 503 stub.
#   - everything else that is not React's (Next dev-overlay, HMR, app logs,
#     a page error a spec injects on purpose): counted as "other" console
#     errors and "other" page errors so a new kind is visible in the record
#     and can be promoted to a failure by name.
# A phase without traces (a browser-less api phase, or --trace off) is NOT
# judged and says so instead of reading OK.
if ! node -e '
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const j = require(path.resolve(process.argv[1]));
const phase = process.argv[2];
const traces = [];
const walk = (s, file) => {
  const f = (s.file || file || "").replace(/^(\.\.\/)+/, "");
  for (const spec of s.specs || []) for (const t of spec.tests || []) for (const r of t.results || []) for (const a of r.attachments || []) {
    if (a.name === "trace" && a.path) traces.push({ zip: a.path, test: `${f}:${spec.line} › ${spec.title}` });
  }
  for (const c of s.suites || []) walk(c, f);
};
for (const s of j.suites || []) walk(s, s.file);
if (traces.length === 0) {
  console.log(`browser-console: ${phase} recorded no traces (a browser-less phase, or --trace off) — the console was NOT judged`);
  process.exit(0);
}
const REACT = [/Hydration failed/, /didn.t match the client/, /while hydrating/, /^The above error occurred in/, /https:\/\/react\.dev\/link\//];
const NETWORK = /^Failed to load resource: the server responded with a status of \d+/;
let reactHits = 0, network = 0, other = 0, otherPageErrors = 0, unreadable = 0;
const lines = [];
for (const { zip, test } of traces) {
  let text;
  try { text = execFileSync("unzip", ["-p", zip, "*.trace"], { maxBuffer: 256 * 1024 * 1024 }).toString(); }
  catch { unreadable++; continue; }
  let where = "?";
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "before" && e.params && typeof e.params.url === "string") { try { where = new URL(e.params.url, "http://x").pathname; } catch {} continue; }
    if (e.type === "frame-snapshot" && e.snapshot && typeof e.snapshot.frameUrl === "string") { try { where = new URL(e.snapshot.frameUrl).pathname; } catch {} continue; }
    let msg; let kind;
    if (e.type === "event" && e.method === "pageError") {
      msg = String(e.params?.error?.error?.message ?? e.params?.error?.message ?? "");
      kind = "page error";
    } else if (e.type === "console" && e.messageType === "error") {
      msg = String(e.text ?? "");
      kind = "console error";
    } else continue;
    if (REACT.some((re) => re.test(msg))) {
      reactHits++;
      const first = msg.split("\n")[0].slice(0, 160);
      const tail = msg.split("https://react.dev/link/hydration-mismatch")[1] ?? "";
      const diff = tail.split("\n").filter((l) => /^\s*[+-] /.test(l)).slice(0, 2).map((l) => l.replace(/\s+/g, " ").trim().slice(0, 100)).join(" ");
      lines.push(`check FAILED: ${phase} browser-console: React error on ${where} in ${test} (${kind}) — ${first}${diff ? ` [diff: ${diff}]` : ""}`);
    } else if (kind === "page error") otherPageErrors++;
    else if (NETWORK.test(msg)) network++;
    else other++;
  }
}
for (const l of lines) console.log(l);
// FAIL CLOSED: a trace the scan could not open is evidence it did not judge,
// and a gate that judged nothing must not read OK (measured: every trace of a
// kept report unreadable at a moved path read "react-errors=0").
const red = reactHits > 0 || unreadable > 0;
console.log(`check ${red ? "FAILED" : "OK"}: ${phase} browser-console react-errors=${reactHits} over ${traces.length} trace(s)${unreadable ? ` (${unreadable} UNREADABLE — not judged, so not green)` : ""}; tolerated: console network-resource=${network} console other=${other} page-errors other=${otherPageErrors}`);
process.exit(red ? 1 : 0);
' "$JSON_OUT" "$PHASE"; then
	[ "$rc" -eq 0 ] && rc=1
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
