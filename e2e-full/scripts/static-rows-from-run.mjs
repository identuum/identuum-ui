#!/usr/bin/env node
// static-rows-from-run.mjs — derive the asserted static-census-row set from
// the sweep phase's OWN Playwright JSON report and enforce the committed set
// + floor (THE-PROBES-THAT-STAY). Mirrors coverage-from-run.mjs: numbers come
// from the run, the commitments come from e2e-full/static-rows.json, and any
// divergence is a hard failure — a self-skipping sweep can never read green.
//
// Usage: static-rows-from-run.mjs <sweep-report.json>

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: static-rows-from-run.mjs <sweep-report.json>");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const committedPath = join(HERE, "..", "static-rows.json");
const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const committedRows = [...committed.rows].sort((a, b) => a - b);
const floor = committed.rows_asserted_floor;
if (!Array.isArray(committedRows) || typeof floor !== "number") {
  console.error("static-rows-from-run: malformed e2e-full/static-rows.json");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
} catch (e) {
  console.error(`static-rows-from-run: cannot read report ${reportPath}: ${e.message}`);
  process.exit(2);
}

const passedRows = new Set();
(function walk(s) {
  (s.suites ?? []).forEach(walk);
  for (const spec of s.specs ?? []) {
    const m = /^\[ROW (\d+)\]/.exec(spec.title ?? "");
    if (!m) continue;
    for (const t of spec.tests ?? []) {
      for (const r of t.results ?? []) {
        if (r.status === "passed") passedRows.add(Number(m[1]));
      }
    }
  }
})({ suites: report.suites ?? [] });

const observed = [...passedRows].sort((a, b) => a - b);

if (JSON.stringify(observed) !== JSON.stringify(committedRows)) {
  const missing = committedRows.filter((r) => !passedRows.has(r));
  const extra = observed.filter((r) => !committedRows.includes(r));
  console.error(
    `static-rows-from-run: STATIC ROWS DRIFT — passed set != committed set` +
      `${missing.length ? ` (missing/not-passed: ${missing.join(", ")})` : ""}` +
      `${extra.length ? ` (unexpected: ${extra.join(", ")})` : ""}. ` +
      "A skipped, deleted, or failing row test must never read green; grow the committed set only deliberately."
  );
  process.exit(1);
}

if (observed.length < floor) {
  console.error(
    `static-rows-from-run: STATIC ROWS FLOOR VIOLATION — rows-asserted ${observed.length} < floor ${floor}.`
  );
  process.exit(1);
}

console.log(
  `check OK: static-rows-asserted ${observed.length} of ${committedRows.length} (committed set matched)`
);
console.log(`check OK: static-rows-floor ${floor} held (observed ${observed.length})`);
