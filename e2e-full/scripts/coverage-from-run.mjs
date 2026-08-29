/**
 * coverage-from-run.mjs — derive UI-route coverage FROM THE RUN, not from a
 * hand-maintained list (THE-WITNESSED-COVERAGE, 2026-08-29).
 *
 * Inputs:
 *   argv[2]  path to the provisioned dev-loop run's Playwright JSON report
 *   argv[3]  the run's UI origin (e.g. http://localhost:7108) — only frames on
 *            this origin count toward route coverage
 *
 * Derivation, all mechanical:
 *   1. ROUTE INVENTORY — scanned from src/app/**\/page.tsx on disk (route
 *      groups "(x)" stripped, /ag-admin excluded). The parent total is
 *      whatever the tree holds today, never a constant.
 *   2. REACHED ROUTES — for every test the report marks PASSED, its trace
 *      (recorded by --trace on) is read and each frame-snapshot / navigation
 *      URL on the UI origin is matched against the inventory ([id] segments
 *      match any one path segment). A route counts when at least one PASSING
 *      test put a frame on it — navigation inside a green test, so the
 *      test's assertions held while it was there. Client-side (soft)
 *      navigations are captured the same way; a goto-grep would miss them.
 *
 * Output: "check OK:" lines gate-witness captures verbatim as evidence:
 *   check OK: routes-content-reached N of M (...)
 *   check OK: dark-routes K: /a, /b, ...
 *
 * SECURITY: prints route PATTERNS only — never query strings, tokens,
 * cookies, or credential material (trace URLs are reduced to pathnames and
 * then to inventory patterns before printing).
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportPath = process.argv[2];
const uiOrigin = process.argv[3] ?? "";
if (!reportPath || !uiOrigin) {
  console.error("usage: coverage-from-run.mjs <pw-json-report> <ui-origin>");
  process.exit(2);
}

// ── 1. Route inventory from the tree ─────────────────────────────────────────
function collectRoutes(dir, prefix) {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") routes.push(prefix === "" ? "/" : prefix);
      continue;
    }
    if (entry === "ag-admin") continue; // outside the censused parent
    // Route groups "(x)" contribute no URL segment.
    const seg = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
    routes.push(...collectRoutes(full, prefix + seg));
  }
  return routes;
}
const inventory = [...new Set(collectRoutes(join(UI_DIR, "src", "app"), ""))].sort();

function matchRoute(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  // A literal segment must OUTRANK a dynamic one: /api-resources/new belongs to
  // the .../new route even though .../[id] also matches "new". Collect every
  // candidate and pick the one with the most literal segments (the most
  // specific), instead of first-match order (which sorted "[id]" before "new"
  // and silently mis-attributed all four /new pages — measured 2026-08-29).
  let best = null;
  let bestLiterals = -1;
  outer: for (const route of inventory) {
    const rparts = route.split("/").filter(Boolean);
    if (rparts.length !== parts.length) continue;
    let literals = 0;
    for (let i = 0; i < rparts.length; i++) {
      if (rparts[i].startsWith("[")) continue; // dynamic segment matches any
      if (rparts[i] !== parts[i]) continue outer;
      literals++;
    }
    if (literals > bestLiterals) {
      best = route;
      bestLiterals = literals;
    }
  }
  if (best) return best;
  return pathname === "/" && inventory.includes("/") ? "/" : null;
}

// ── 2. Traces of PASSED tests → reached routes ───────────────────────────────
const report = JSON.parse(
  execFileSync("cat", [reportPath], { maxBuffer: 64 * 1024 * 1024 }).toString()
);
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

const reached = new Set();
let unreadable = 0;
for (const zip of tracePaths) {
  let text = "";
  try {
    text = execFileSync("unzip", ["-p", zip, "*.trace"], {
      maxBuffer: 512 * 1024 * 1024,
    }).toString();
  } catch {
    unreadable++;
    continue;
  }
  // frameUrl (frame-snapshots) + params.url (navigation actions).
  for (const m of text.matchAll(/"(?:frameUrl|url)":"(http[^"]+)"/g)) {
    let u;
    try {
      u = new URL(m[1]);
    } catch {
      continue;
    }
    if (u.origin !== uiOrigin) continue;
    const route = matchRoute(u.pathname);
    if (route) reached.add(route);
  }
}

const dark = inventory.filter((r) => !reached.has(r));
console.log(
  `check OK: routes-content-reached ${reached.size} of ${inventory.length} (distinct src/app page.tsx routes a PASSING provisioned test put a frame on; traces of ${tracePaths.length} passed tests${unreadable ? `, ${unreadable} unreadable` : ""})`
);
console.log(`check OK: dark-routes ${dark.length}: ${dark.join(", ")}`);
if (tracePaths.length === 0) {
  console.error("coverage-from-run: no traces found for passed tests — was --trace on set?");
  process.exit(1);
}
