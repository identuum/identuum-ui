#!/usr/bin/env node
// role-matrix-from-run.mjs — THE-ROLE-CENSUS (2026-08-30).
//
// TEST-spec R1 says every functionality must be tested for EACH user type.
// "133 of 133 endpoints exercised" counts ENDPOINTS; the honest denominator
// is (endpoint, role) CELLS. This script derives the observed cells from the
// run's OWN api() observations (JSONL written when the harness sets
// IDENTUUM_E2E_MATRIX_LOG), collapses them against the docgen endpoint
// golden (the 133-endpoint denominator, read from the sibling
// identuum-idp-oss checkout the harness already requires), and enforces the
// committed matrix in e2e-full/role-matrix.json:
//
//   - BOOTSTRAP: if the committed file is ABSENT, write it from this run's
//     observations and exit 0 — measure first, commit deliberately.
//   - ENFORCE: every committed cell must be observed in THIS run (a test
//     that stopped exercising a cell reads as ROLE-MATRIX DRIFT), and the
//     covered-cell count must hold the committed floor. Cells observed
//     BEYOND the committed set are reported as candidates to commit — new
//     coverage is growth, never a failure.
//
// HONEST LIMITS, stated: a covered cell means the (endpoint, role) pair was
// EXERCISED inside a passing witnessed phase — assertion quality is not
// mechanically knowable. Browser-cookie requests (the UI-driving phases'
// page loads) do not pass through api() and are not observed here; UI-route
// coverage has its own floor (coverage-from-run.mjs). Roles are the three
// human principals; anon/unknown observations are counted in the stats line
// but are not matrix cells.
//
// Usage: role-matrix-from-run.mjs <observations.jsonl>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const obsPath = process.argv[2];
if (!obsPath) {
  console.error("usage: role-matrix-from-run.mjs <observations.jsonl>");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const committedPath = join(HERE, "..", "role-matrix.json");
const goldenPath = join(
  HERE,
  "..",
  "..",
  "..",
  "identuum-idp-oss",
  "tools",
  "api-docgen",
  "testdata",
  "endpoints.golden.yaml"
);

const ROLES = ["site_admin", "org_admin", "org_user"];

// ── the denominator: method+path templates from the docgen golden ──────────
if (!existsSync(goldenPath)) {
  console.error(
    `role-matrix-from-run: docgen golden not found at ${goldenPath} — the harness requires the sibling identuum-idp-oss checkout`
  );
  process.exit(2);
}
const endpoints = [];
{
  let method = null;
  for (const line of readFileSync(goldenPath, "utf8").split("\n")) {
    const m = /^\s*method:\s*"([A-Z]+)"\s*$/.exec(line);
    if (m) {
      method = m[1];
      continue;
    }
    const p = /^\s*path:\s*"([^"]+)"\s*$/.exec(line);
    if (p && method) {
      endpoints.push({ method, template: p[1], segs: p[1].split("/") });
      method = null;
    }
  }
}
if (endpoints.length === 0) {
  console.error(
    "role-matrix-from-run: parsed 0 endpoints from the golden — parser or golden format drifted"
  );
  process.exit(2);
}

// ── template matcher: same segment count; literal match or :param; prefer
//    the template with the most literal segments (fewest params) ───────────
function matchTemplate(method, rawPath) {
  const path = rawPath.split("?")[0];
  const segs = path.split("/");
  let best = null;
  let bestLiterals = -1;
  for (const e of endpoints) {
    if (e.method !== method || e.segs.length !== segs.length) continue;
    let literals = 0;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const t = e.segs[i];
      if (t.startsWith(":")) continue;
      if (t !== segs[i]) {
        ok = false;
        break;
      }
      literals++;
    }
    if (ok && literals > bestLiterals) {
      best = e;
      bestLiterals = literals;
    }
  }
  return best;
}

// ── collapse the observations ──────────────────────────────────────────────
let observedLines = 0;
let unmatched = 0;
const nonRole = { anon: 0, unknown: 0, other: 0 };
const observed = new Map(); // "METHOD template" -> Set(role)
try {
  for (const line of readFileSync(resolve(obsPath), "utf8").split("\n")) {
    if (!line.trim()) continue;
    observedLines++;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const e = matchTemplate(o.m, o.p);
    if (!e) {
      unmatched++;
      continue;
    }
    if (!ROLES.includes(o.role)) {
      if (o.role === "anon") nonRole.anon++;
      else if (o.role === "unknown") nonRole.unknown++;
      else nonRole.other++;
      continue;
    }
    const key = `${e.method} ${e.template}`;
    if (!observed.has(key)) observed.set(key, new Set());
    observed.get(key).add(o.role);
  }
} catch (err) {
  console.error(`role-matrix-from-run: cannot read observations ${obsPath}: ${err.message}`);
  process.exit(2);
}

const observedCells = [];
for (const [key, roles] of observed) for (const r of roles) observedCells.push(`${key} @ ${r}`);
observedCells.sort();
const denominator = endpoints.length * ROLES.length;

// ── bootstrap or enforce ───────────────────────────────────────────────────
if (!existsSync(committedPath)) {
  const cells = {};
  for (const [key, roles] of [...observed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    cells[key] = ROLES.filter((r) => roles.has(r));
  }
  const doc = {
    _comment:
      "THE-ROLE-CENSUS committed (endpoint, role) coverage matrix. Denominator: the docgen endpoint golden x {site_admin, org_admin, org_user}. A cell listed here was EXERCISED by the harness's own api() observations inside a passing witnessed run; role-matrix-from-run.mjs FAILS the phase when a committed cell is not observed (ROLE-MATRIX DRIFT) or the covered count drops below the floor. Cells observed beyond this set are growth candidates — commit them deliberately, like a floor raise.",
    endpoints: endpoints.length,
    roles: ROLES,
    cells,
    covered_cells_floor: observedCells.length,
  };
  writeFileSync(committedPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `role-matrix-from-run: BOOTSTRAPPED e2e-full/role-matrix.json from this run — ${observedCells.length} of ${denominator} cells covered (${endpoints.length} endpoints x ${ROLES.length} roles). Review and commit it; the next run enforces.`
  );
  process.exit(0);
}

const committed = JSON.parse(readFileSync(committedPath, "utf8"));
if (committed.endpoints !== endpoints.length) {
  console.error(
    `role-matrix-from-run: DENOMINATOR DRIFT — committed matrix says ${committed.endpoints} endpoints, the golden has ${endpoints.length}. Re-derive the matrix deliberately.`
  );
  process.exit(1);
}
const committedCells = [];
for (const [key, roles] of Object.entries(committed.cells)) {
  for (const r of roles) committedCells.push(`${key} @ ${r}`);
}
committedCells.sort();
const observedSet = new Set(observedCells);
const missing = committedCells.filter((c) => !observedSet.has(c));
if (missing.length > 0) {
  console.error(
    `role-matrix-from-run: ROLE-MATRIX DRIFT — ${missing.length} committed cell(s) not observed this run (a test stopped exercising them):\n  ${missing.slice(0, 20).join("\n  ")}${missing.length > 20 ? `\n  … and ${missing.length - 20} more` : ""}`
  );
  process.exit(1);
}
if (observedCells.length < committed.covered_cells_floor) {
  console.error(
    `role-matrix-from-run: ROLE-MATRIX FLOOR VIOLATION — covered cells ${observedCells.length} < floor ${committed.covered_cells_floor}.`
  );
  process.exit(1);
}
const committedSet = new Set(committedCells);
const growth = observedCells.filter((c) => !committedSet.has(c));

const perRole = Object.fromEntries(ROLES.map((r) => [r, 0]));
for (const c of observedCells) perRole[c.split(" @ ")[1]]++;
console.log(
  `check OK: role-matrix ${committedCells.length} committed cells all observed (floor ${committed.covered_cells_floor} held; observed ${observedCells.length} of ${denominator} = ${endpoints.length} endpoints x ${ROLES.length} roles)`
);
console.log(
  `check OK: role-matrix per-role site_admin=${perRole.site_admin} org_admin=${perRole.org_admin} org_user=${perRole.org_user} (observations ${observedLines}, unmatched-path ${unmatched}, anon ${nonRole.anon}, unknown ${nonRole.unknown})`
);
if (growth.length > 0) {
  console.log(
    `role-matrix-from-run: ${growth.length} NEW cell(s) observed beyond the committed set — growth candidates, commit deliberately:\n  ${growth.slice(0, 10).join("\n  ")}${growth.length > 10 ? `\n  … and ${growth.length - 10} more` : ""}`
  );
}
