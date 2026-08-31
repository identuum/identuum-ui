#!/usr/bin/env node
// closure-from-run.mjs — THE-CLOSURE-AUDIT (2026-08-31).
//
// The 45 endpoints OUTSIDE the role matrix (15 auth=session + 30
// public/oauth_client/bearer class endpoints) were "covered elsewhere" by
// CLAIM. This script turns the claim into a per-run FACT: every one of the
// 45 must be OBSERVED in this run's own evidence, or the phase fails naming
// the missing endpoint. Two evidence sources, both from the run itself:
//
//   1. the api()/observeRaw JSONL (IDENTUUM_E2E_MATRIX_LOG) — API-suite
//      traffic, including the request-fixture ceremonies that call
//      observeRaw after their assertions pass;
//   2. the network snapshots inside the traces of PASSED dev-loop tests
//      (HAR-shaped resource-snapshots: request.method, request.url,
//      response.status) — browser-cookie surfaces (sign-out, sessions tab,
//      passkey list/register/delete). Proxy-prefixed URLs (/api/idp/...)
//      are unwrapped before matching. Only PASSED tests' traces count: the
//      request happened inside a test whose assertions held.
//
// The 45-list derives LIVE from the docgen golden (auth=session +
// public/oauth_client/bearer), so a golden change reads DENOMINATOR DRIFT
// until the committed file is re-derived deliberately — same discipline as
// role-matrix-from-run.mjs. The committed file records, per endpoint, the
// evidence source(s) and statuses the bootstrap run saw.
//
// Usage: closure-from-run.mjs <observations.jsonl> <pw-report.json>...

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const obsPath = process.argv[2];
const reportPaths = process.argv.slice(3);
if (!obsPath || reportPaths.length === 0) {
  console.error("usage: closure-from-run.mjs <observations.jsonl> <pw-report.json>...");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const committedPath = join(HERE, "..", "closure-coverage.json");
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

// ── the 45 from the golden ─────────────────────────────────────────────────
const SESSION = "session";
const CLASS_ONCE = new Set(["public", "oauth_client", "bearer"]);
const targets = [];
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
      if (a[1] === SESSION || CLASS_ONCE.has(a[1])) {
        targets.push({
          method,
          template: path,
          segs: path.split("/"),
          kind: a[1] === SESSION ? "session" : "class",
        });
      }
      method = null;
      path = null;
    }
  }
}
if (targets.length === 0) {
  console.error("closure-from-run: parsed 0 closure targets from the golden — parser drifted");
  process.exit(2);
}

function matchTarget(method, rawPath) {
  let path = rawPath.split("?")[0];
  // The dev-loop UI proxies IdP calls as /api/idp/<real path>.
  if (path.startsWith("/api/idp/")) path = path.slice("/api/idp".length);
  const segs = path.split("/");
  let best = null;
  let bestLiterals = -1;
  for (const t of targets) {
    if (t.method !== method || t.segs.length !== segs.length) continue;
    let literals = 0;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (t.segs[i].startsWith(":")) continue;
      if (t.segs[i] !== segs[i]) {
        ok = false;
        break;
      }
      literals++;
    }
    if (ok && literals > bestLiterals) {
      best = t;
      bestLiterals = literals;
    }
  }
  return best;
}

// key -> { sources:Set, statuses:Set }
const observed = new Map();
const note = (t, source, status) => {
  const key = `${t.method} ${t.template}`;
  if (!observed.has(key)) observed.set(key, { sources: new Set(), statuses: new Set() });
  observed.get(key).sources.add(source);
  observed.get(key).statuses.add(status);
};

// ── source 1: the JSONL ────────────────────────────────────────────────────
for (const line of readFileSync(resolve(obsPath), "utf8").split("\n")) {
  if (!line.trim()) continue;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    continue;
  }
  const t = matchTarget(o.m, o.p);
  if (t) note(t, "jsonl", o.s);
}

// ── source 2: traces of PASSED dev-loop tests ──────────────────────────────
let tracesRead = 0;
for (const reportPath of reportPaths) {
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
  } catch (e) {
    console.error(`closure-from-run: cannot read report ${reportPath}: ${e.message}`);
    process.exit(2);
  }
  const tracePaths = [];
  (function walk(s) {
    (s.suites ?? []).forEach(walk);
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          if (r.status !== "passed") continue;
          for (const a of r.attachments ?? []) {
            if (a.name === "trace" && a.path) tracePaths.push(a.path);
          }
        }
      }
    }
  })({ suites: report.suites ?? [] });
  for (const zip of tracePaths) {
    let text;
    try {
      text = execFileSync("unzip", ["-p", zip, "*.network"], {
        maxBuffer: 256 * 1024 * 1024,
      }).toString();
    } catch {
      continue; // a test without network snapshots — nothing to read
    }
    tracesRead++;
    for (const line of text.split("\n")) {
      if (!line.includes('"resource-snapshot"')) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const req = e.snapshot?.request;
      const res = e.snapshot?.response;
      if (!req?.url || !req?.method) continue;
      let pathname;
      try {
        pathname = new URL(req.url).pathname;
      } catch {
        continue;
      }
      const t = matchTarget(req.method, pathname);
      if (t) note(t, "trace", res?.status ?? 0);
    }
  }
}

const rows = targets
  .map((t) => {
    const key = `${t.method} ${t.template}`;
    const o = observed.get(key);
    return {
      key,
      kind: t.kind,
      sources: o ? [...o.sources].sort() : [],
      statuses: o ? [...o.statuses].sort((a, b) => a - b) : [],
    };
  })
  .sort((a, b) => a.key.localeCompare(b.key));
const missing = rows.filter((r) => r.sources.length === 0);

// ── bootstrap or enforce ───────────────────────────────────────────────────
if (!existsSync(committedPath)) {
  if (missing.length > 0) {
    console.error(
      `closure-from-run: BOOTSTRAP INCOMPLETE — ${missing.length} closure endpoint(s) NOT observed in this run; the committed file is NOT written until all are evidenced or the gap is fixed:\n  ${missing.map((r) => r.key).join("\n  ")}`
    );
    process.exit(1);
  }
  const doc = {
    _comment:
      "THE-CLOSURE-AUDIT committed closure set: every endpoint OUTSIDE the role matrix (auth=session + public/oauth_client/bearer classes) must be OBSERVED in each run's own evidence — the api()/observeRaw JSONL or the network snapshots of PASSED dev-loop traces. closure-from-run.mjs FAILS the phase when any listed endpoint stops being observed, and reads DENOMINATOR DRIFT when the golden's closure set changes. The recorded sources/statuses are the bootstrap run's evidence, kept for the audit trail.",
    endpoints: rows.map((r) => ({
      endpoint: r.key,
      kind: r.kind,
      sources: r.sources,
      statuses: r.statuses,
    })),
    closure_floor: rows.length,
  };
  writeFileSync(committedPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `closure-from-run: BOOTSTRAPPED e2e-full/closure-coverage.json — all ${rows.length} closure endpoints observed (${rows.filter((r) => r.kind === "session").length} session + ${rows.filter((r) => r.kind === "class").length} class; traces read: ${tracesRead}). Review and commit; the next run enforces.`
  );
  process.exit(0);
}

const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const committedKeys = committed.endpoints.map((e) => e.endpoint).sort();
const liveKeys = rows.map((r) => r.key).sort();
if (JSON.stringify(committedKeys) !== JSON.stringify(liveKeys)) {
  console.error(
    "closure-from-run: DENOMINATOR DRIFT — the golden's closure set differs from the committed list. Re-derive deliberately."
  );
  process.exit(1);
}
if (missing.length > 0) {
  console.error(
    `closure-from-run: CLOSURE DRIFT — ${missing.length} committed closure endpoint(s) NOT observed this run (a test stopped exercising them):\n  ${missing.map((r) => r.key).join("\n  ")}`
  );
  process.exit(1);
}
if (rows.length < committed.closure_floor) {
  console.error(
    `closure-from-run: CLOSURE FLOOR VIOLATION — ${rows.length} < ${committed.closure_floor}.`
  );
  process.exit(1);
}
const bySrc = { jsonl: 0, trace: 0, both: 0 };
for (const r of rows) {
  if (r.sources.length === 2) bySrc.both++;
  else if (r.sources[0] === "jsonl") bySrc.jsonl++;
  else bySrc.trace++;
}
console.log(
  `check OK: closure ${rows.length} of ${committed.closure_floor} outside-matrix endpoints observed (${rows.filter((r) => r.kind === "session").length} session + ${rows.filter((r) => r.kind === "class").length} class; jsonl-only ${bySrc.jsonl}, trace-only ${bySrc.trace}, both ${bySrc.both}; traces read ${tracesRead})`
);
