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

// THE SMARTER COUNTER (owner ruling, 2026-08-31): per-user-type cells count
// only where user type MATTERS. The golden's own auth class decides:
//   ROLE_CLASSES  -> 3 role cells per endpoint (who you are changes the answer)
//   CLASS_ONCE    -> 1 "@ any" cell per endpoint (public/M2M: the same call
//                    for everyone; covered when ANY observation — anon
//                    included — exercised it)
//   EXCLUDED      -> browser-cookie ceremonies the bearer-based observer
//                    cannot reach BY CONSTRUCTION; covered by the dev-loop
//                    suite and the UI coverage floor, listed here by name so
//                    the exclusion is visible, never silent.
const ROLE_CLASSES = new Set([
  "site_admin",
  "org_admin",
  "authenticated",
  "site_admin|org_admin",
  "site_admin|bearer",
  "session|bearer",
]);
const CLASS_ONCE = new Set(["public", "oauth_client", "bearer"]);
const EXCLUDED_CLASSES = new Set(["session"]);

// ── the denominator: method+path+auth from the docgen golden ───────────────
if (!existsSync(goldenPath)) {
  console.error(
    `role-matrix-from-run: docgen golden not found at ${goldenPath} — the harness requires the sibling identuum-idp-oss checkout`
  );
  process.exit(2);
}
const endpoints = [];
{
  let method = null;
  let path = null;
  for (const line of readFileSync(goldenPath, "utf8").split("\n")) {
    const m = /^\s*method:\s*"([A-Z]+)"\s*$/.exec(line);
    if (m) {
      method = m[1];
      continue;
    }
    const p = /^\s*path:\s*"([^"]+)"\s*$/.exec(line);
    if (p && method) {
      path = p[1];
      continue;
    }
    const a = /^\s*auth:\s*"([^"]*)"\s*$/.exec(line);
    if (a && method && path) {
      endpoints.push({ method, template: path, segs: path.split("/"), auth: a[1] });
      method = null;
      path = null;
    }
  }
}
if (endpoints.length === 0) {
  console.error(
    "role-matrix-from-run: parsed 0 endpoints from the golden — parser or golden format drifted"
  );
  process.exit(2);
}
const unknownClass = endpoints.filter(
  (e) => !ROLE_CLASSES.has(e.auth) && !CLASS_ONCE.has(e.auth) && !EXCLUDED_CLASSES.has(e.auth)
);
if (unknownClass.length > 0) {
  console.error(
    `role-matrix-from-run: ${unknownClass.length} endpoint(s) carry an auth class this counter does not know — classify them before proceeding:\n  ${unknownClass.map((e) => `${e.method} ${e.template} (auth=${e.auth})`).join("\n  ")}`
  );
  process.exit(1);
}
const roleEndpoints = endpoints.filter((e) => ROLE_CLASSES.has(e.auth));
const onceEndpoints = endpoints.filter((e) => CLASS_ONCE.has(e.auth));
const excludedEndpoints = endpoints.filter((e) => EXCLUDED_CLASSES.has(e.auth));

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
const unknownSeen = new Set();
const observed = new Map(); // "METHOD template" -> Set(role)
const observedAny = new Set(); // "METHOD template" seen by ANY observation
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
    const key = `${e.method} ${e.template}`;
    observedAny.add(key);
    if (!ROLES.includes(o.role)) {
      if (o.role === "anon") nonRole.anon++;
      else if (o.role === "unknown") {
        nonRole.unknown++;
        // NAME them. "unknown" means api() saw a bearer it could not decode
        // (opaque or malformed), which is what a deliberately-invalid-token
        // probe looks like — a real class, not an unclassifiable observation.
        // Counting them without naming them is how "unknown 2" sat in every
        // mint record for weeks meaning nothing to anyone reading it.
        unknownSeen.add(`${o.m} ${o.p} -> ${o.s}`);
      } else nonRole.other++;
      continue;
    }
    if (!observed.has(key)) observed.set(key, new Set());
    observed.get(key).add(o.role);
  }
} catch (err) {
  console.error(`role-matrix-from-run: cannot read observations ${obsPath}: ${err.message}`);
  process.exit(2);
}

// v2 cells: role cells only for role-class endpoints; one "@ any" cell for
// each CLASS_ONCE endpoint covered by ANY observation.
const observedCells = [];
for (const e of roleEndpoints) {
  const key = `${e.method} ${e.template}`;
  for (const r of observed.get(key) ?? []) observedCells.push(`${key} @ ${r}`);
}
const observedClassCells = [];
for (const e of onceEndpoints) {
  const key = `${e.method} ${e.template}`;
  if (observedAny.has(key)) observedClassCells.push(`${key} @ any`);
}
observedCells.sort();
observedClassCells.sort();
const denominator = roleEndpoints.length * ROLES.length + onceEndpoints.length;
const observedTotal = observedCells.length + observedClassCells.length;

// ── bootstrap or enforce ───────────────────────────────────────────────────
if (!existsSync(committedPath)) {
  const cells = {};
  for (const e of [...roleEndpoints].sort((a, b) =>
    `${a.method} ${a.template}`.localeCompare(`${b.method} ${b.template}`)
  )) {
    const key = `${e.method} ${e.template}`;
    const roles = ROLES.filter((r) => observed.get(key)?.has(r));
    if (roles.length > 0) cells[key] = roles;
  }
  const doc = {
    _comment:
      "THE-ROLE-CENSUS committed coverage matrix, v2 (THE SMARTER COUNTER — owner ruling 2026-08-31): role cells only where the auth class makes user type matter; public/M2M endpoints carry one '@ any' class cell (exercised by anyone, anon included); browser-cookie 'session' endpoints are EXCLUDED by name (unreachable by the bearer-based observer BY CONSTRUCTION — covered by the dev-loop suite and the UI coverage floor). A listed cell was EXERCISED inside a passing witnessed run; role-matrix-from-run.mjs FAILS the phase on any committed cell not observed, on a floor drop, and on denominator drift. Growth is a deliberate commit.",
    endpoints: endpoints.length,
    role_endpoints: roleEndpoints.length,
    class_endpoints: onceEndpoints.length,
    excluded_session_endpoints: excludedEndpoints.map((e) => `${e.method} ${e.template}`).sort(),
    roles: ROLES,
    cells,
    class_cells: observedClassCells,
    covered_cells_floor: observedTotal,
  };
  writeFileSync(committedPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `role-matrix-from-run: BOOTSTRAPPED e2e-full/role-matrix.json (v2) from this run — ${observedTotal} of ${denominator} cells (${observedCells.length} role cells over ${roleEndpoints.length} endpoints x ${ROLES.length} roles + ${observedClassCells.length} of ${onceEndpoints.length} class cells; ${excludedEndpoints.length} session endpoints excluded by name). Review and commit it; the next run enforces.`
  );
  process.exit(0);
}

const committed = JSON.parse(readFileSync(committedPath, "utf8"));
if (
  committed.endpoints !== endpoints.length ||
  committed.role_endpoints !== roleEndpoints.length ||
  committed.class_endpoints !== onceEndpoints.length
) {
  console.error(
    `role-matrix-from-run: DENOMINATOR DRIFT — committed matrix says ${committed.endpoints}/${committed.role_endpoints}/${committed.class_endpoints} (total/role/class endpoints), the golden has ${endpoints.length}/${roleEndpoints.length}/${onceEndpoints.length}. Re-derive the matrix deliberately.`
  );
  // THE-RED-MINT-HAS-NO-NAME: without this line a red role-matrix step recorded
  // exit=1 and nothing else. THE-RECORD-SAYS-FAILED (2026-09-07): the record's
  // evidence channel now captures "check FAILED:" (gate-witness.sh EVIDENCE_RE),
  // so the verdict says what it means; the exit code is still the verdict.
  console.log(
    `check FAILED: role-matrix DENOMINATOR DRIFT: committed ${committed.endpoints}/${committed.role_endpoints}/${committed.class_endpoints} vs golden ${endpoints.length}/${roleEndpoints.length}/${onceEndpoints.length} (total/role/class endpoints)`
  );
  process.exit(1);
}
const committedCells = [];
for (const [key, roles] of Object.entries(committed.cells)) {
  for (const r of roles) committedCells.push(`${key} @ ${r}`);
}
committedCells.sort();
const committedClassCells = [...(committed.class_cells ?? [])].sort();
const observedSet = new Set(observedCells);
const observedClassSet = new Set(observedClassCells);
const missing = committedCells.filter((c) => !observedSet.has(c));
const missingClass = committedClassCells.filter((c) => !observedClassSet.has(c));
if (missing.length + missingClass.length > 0) {
  const all = [...missing, ...missingClass];
  console.error(
    `role-matrix-from-run: ROLE-MATRIX DRIFT — ${all.length} committed cell(s) not observed this run (a test stopped exercising them):\n  ${all.slice(0, 20).join("\n  ")}${all.length > 20 ? `\n  … and ${all.length - 20} more` : ""}`
  );
  // THE-RED-MINT-HAS-NO-NAME (2026-09-06): the record carried `target:
  // role-matrix exit=1` with NO evidence line, because this verdict went to
  // stderr under a prefix gate-witness's EVIDENCE_RE does not capture. The
  // reason now also goes out on the record's own channel — one line, every
  // missing cell named (the cells are the reason; when a test's setup fails,
  // they are exactly the rows that setup gated). THE-RECORD-SAYS-FAILED
  // (2026-09-07): under the honest prefix.
  console.log(
    `check FAILED: role-matrix ROLE-MATRIX DRIFT: ${all.length} committed cell(s) not observed this run (a test stopped exercising them): ${all.join("; ")}`
  );
  process.exit(1);
}
if (observedTotal < committed.covered_cells_floor) {
  console.error(
    `role-matrix-from-run: ROLE-MATRIX FLOOR VIOLATION — covered cells ${observedTotal} < floor ${committed.covered_cells_floor}.`
  );
  console.log(
    `check FAILED: role-matrix FLOOR VIOLATION: covered cells ${observedTotal} < floor ${committed.covered_cells_floor}`
  );
  process.exit(1);
}
const committedSet = new Set([...committedCells, ...committedClassCells]);
const growth = [...observedCells, ...observedClassCells].filter((c) => !committedSet.has(c));

const perRole = Object.fromEntries(ROLES.map((r) => [r, 0]));
for (const c of observedCells) perRole[c.split(" @ ")[1]]++;
console.log(
  `check OK: role-matrix ${committedCells.length + committedClassCells.length} committed cells all observed (floor ${committed.covered_cells_floor} held; observed ${observedTotal} of ${denominator} = ${roleEndpoints.length} role-endpoints x ${ROLES.length} + ${onceEndpoints.length} class cells; ${excludedEndpoints.length} session endpoints excluded by name)`
);
console.log(
  `check OK: role-matrix per-role site_admin=${perRole.site_admin} org_admin=${perRole.org_admin} org_user=${perRole.org_user} class-cells=${observedClassCells.length} (observations ${observedLines}, unmatched-path ${unmatched}, anon ${nonRole.anon}, unknown ${nonRole.unknown})`
);
if (unknownSeen.size > 0) {
  console.log(
    `check OK: role-matrix unknown-role observations named (${nonRole.unknown} observation(s), ${unknownSeen.size} distinct): ${[...unknownSeen].sort().join(", ")} — a bearer api() could not decode, i.e. a deliberately invalid or opaque token; these carry no role and are correctly outside the (endpoint, role) matrix`
  );
}
if (growth.length > 0) {
  console.log(
    `role-matrix-from-run: ${growth.length} NEW cell(s) observed beyond the committed set — growth candidates, commit deliberately:\n  ${growth.slice(0, 10).join("\n  ")}${growth.length > 10 ? `\n  … and ${growth.length - 10} more` : ""}`
  );
}
