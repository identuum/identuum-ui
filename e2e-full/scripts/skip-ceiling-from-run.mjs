#!/usr/bin/env node
// skip-ceiling-from-run.mjs — enforce the devloop skip CEILING from the
// phase's OWN Playwright JSON report (THE-DISPOSABLE-IDENTITIES). The skip
// count was the last printed-but-unenforced number in the record: a new
// self-skip could creep in green forever. Mirrors coverage-from-run.mjs:
// the observation comes from the run, the commitment from
// e2e-full/skip-ceiling.json, and exceeding it is a hard failure.
//
// Usage: skip-ceiling-from-run.mjs <devloop-report.json>

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: skip-ceiling-from-run.mjs <devloop-report.json>");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const committed = JSON.parse(readFileSync(join(HERE, "..", "skip-ceiling.json"), "utf8"));
const ceiling = committed.devloop_skipped_ceiling;
if (!Number.isInteger(ceiling) || ceiling < 0) {
  console.error("skip-ceiling-from-run: malformed e2e-full/skip-ceiling.json");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
} catch (e) {
  console.error(`skip-ceiling-from-run: cannot read report ${reportPath}: ${e.message}`);
  process.exit(2);
}

const skipped = report.stats?.skipped;
if (!Number.isInteger(skipped)) {
  console.error("skip-ceiling-from-run: report carries no integer stats.skipped");
  process.exit(2);
}

if (skipped > ceiling) {
  console.error(
    `skip-ceiling-from-run: SKIP CEILING VIOLATION — devloop skipped ${skipped} > ceiling ${ceiling}. ` +
      "A new skip crept in; name it and either fix it or raise the ceiling deliberately."
  );
  process.exit(1);
}

console.log(`check OK: devloop-skip-ceiling ${ceiling} held (observed ${skipped})`);
