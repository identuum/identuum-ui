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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// THE-FRESH-APPLIANCE-PHASE: coverage now spans MULTIPLE phases (the
// fresh-appliance phase + the provisioned dev-loop run), so the origin comes
// first and every following argument is one phase's JSON report.
const uiOrigin = process.argv[2] ?? "";
const reportPaths = process.argv.slice(3);
if (!uiOrigin || reportPaths.length === 0) {
  console.error("usage: coverage-from-run.mjs <ui-origin> <pw-json-report>...");
  process.exit(2);
}

// ── 1. Route inventory from the tree ─────────────────────────────────────────
function collectRoutes(dir, prefix) {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") routes.push({ route: prefix === "" ? "/" : prefix, file: full });
      continue;
    }
    if (entry === "ag-admin") continue; // outside the censused parent
    // Route groups "(x)" contribute no URL segment.
    const seg = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
    routes.push(...collectRoutes(full, prefix + seg));
  }
  return routes;
}
const routeFiles = new Map();
for (const { route, file } of collectRoutes(join(UI_DIR, "src", "app"), "")) {
  if (!routeFiles.has(route)) routeFiles.set(route, file);
}
const inventory = [...routeFiles.keys()].sort();

/**
 * REDIRECT-ONLY pages render no JSX at all — their entire designed content is
 * a redirect() (e.g. the root router, the /dashboard/security compat
 * redirect). The UI census classifies an asserted redirect as CONTENT for
 * such pages, and this metric agrees: a redirect-only route counts as reached
 * when a PASSING test navigated to it (the redirect it asserts IS the page's
 * behavior). Detection is mechanical, from the page source on disk: a
 * redirect() call and zero JSX markers. Pages WITH JSX still require frames —
 * so a guard-bounced goto against a real page (e.g. /site-admin/settings
 * anonymous → /login) can never inflate the count.
 */
function isRedirectOnly(route) {
  const file = routeFiles.get(route);
  if (!file) return false;
  const src = readFileSync(file, "utf8");
  return /\bredirect\(/.test(src) && !/return \(|=> \(|<[A-Za-z]/.test(src);
}

// ── THE-REDIRECT-PIN: the metric's definition output is COMMITTED ────────────
// isRedirectOnly is a source heuristic re-run every time; unpinned, a page
// refactored into a redirect would become "reached" for free — coverage
// granted by a source edit, not by a test. The committed set is the
// reference; the source-derived set must EQUAL it in both directions, or the
// phase FAILS. Growing or shrinking the set is a deliberate commit, exactly
// like a floor raise.
const redirectPinFile = join(UI_DIR, "e2e-full", "redirect-only-routes.json");
const committedRedirectSet = JSON.parse(readFileSync(redirectPinFile, "utf8")).routes;
if (
  !Array.isArray(committedRedirectSet) ||
  committedRedirectSet.some((r) => typeof r !== "string")
) {
  console.error("coverage-from-run: redirect-only-routes.json carries no valid route list");
  process.exit(2);
}
const derivedRedirectSet = inventory.filter((r) => isRedirectOnly(r)).sort();
const committedSorted = [...committedRedirectSet].sort();
if (JSON.stringify(derivedRedirectSet) !== JSON.stringify(committedSorted)) {
  console.error(
    `coverage-from-run: REDIRECT SET DRIFT — source-derived redirect-only set [${derivedRedirectSet.join(", ")}] does not equal the committed set [${committedSorted.join(", ")}]. A page's redirect-only status changed without a deliberate commit; update e2e-full/redirect-only-routes.json on purpose or fix the page.`
  );
  process.exit(1);
}

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
const tracePaths = [];
for (const reportPath of reportPaths) {
  const report = JSON.parse(
    execFileSync("cat", [reportPath], { maxBuffer: 64 * 1024 * 1024 }).toString()
  );
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
}

const reached = new Set();
const navigated = new Set();
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
  // FRAMES define "reached": frameUrl entries are pages that actually
  // rendered inside the passing test. Navigation TARGETS (params.url, which
  // can be relative) are collected separately below — a pure-server-redirect
  // route (e.g. a compat redirect) never gets a frame of its own, and a
  // guard-bounced goto never renders its target either; conflating the two
  // with frames would make the frame-metric's words false (measured
  // 2026-08-29: a guard test's bounced goto would have counted as content).
  for (const m of text.matchAll(/"frameUrl":"(https?:\/\/[^"]+)"/g)) {
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
  for (const m of text.matchAll(/"url":"(https?:\/\/[^"]+|\/[^"]*)"/g)) {
    let u;
    try {
      u = new URL(m[1], uiOrigin);
    } catch {
      continue;
    }
    if (u.origin !== uiOrigin) continue;
    const route = matchRoute(u.pathname);
    if (route) navigated.add(route);
  }
}

// REDIRECT-ONLY routes navigated in a passing test count as reached (their
// asserted redirect IS the content — census-aligned; see isRedirectOnly).
const redirectAsserted = [...navigated].filter((r) => !reached.has(r) && isRedirectOnly(r)).sort();
for (const r of redirectAsserted) reached.add(r);
const dark = inventory.filter((r) => !reached.has(r));
// Real pages a passing test navigated to WITHOUT rendering a frame there
// (guard-bounced gotos). Never merged into the count.
const navOnly = [...navigated].filter((r) => !reached.has(r)).sort();
console.log(
  `check OK: routes-content-reached ${reached.size} of ${inventory.length} (src/app page.tsx routes a PASSING provisioned test put a frame on, plus redirect-only pages it navigated; traces of ${tracePaths.length} passed tests${unreadable ? `, ${unreadable} unreadable` : ""})`
);
console.log(
  `check OK: redirect-routes-asserted ${redirectAsserted.length}: ${redirectAsserted.join(", ")}`
);
console.log(`check OK: redirect-only-set matched (${committedSorted.length} committed)`);
console.log(`check OK: dark-routes ${dark.length}: ${dark.join(", ")}`);
console.log(`check OK: navigated-not-rendered ${navOnly.length}: ${navOnly.join(", ")}`);
if (tracePaths.length === 0) {
  console.error("coverage-from-run: no traces found for passed tests — was --trace on set?");
  process.exit(1);
}

// ── THE-COVERAGE-FLOOR ratchet ───────────────────────────────────────────────
// The committed floor is the reference; the OBSERVED number above came from
// THIS run's traces. A drop below the floor FAILS the coverage phase — the
// witnessed record reads red and `make e2e-full` exits non-zero — so route
// coverage cannot silently rot. Raising the floor is a deliberate committed
// act after a higher green run; the script never auto-raises.
const floorFile = join(UI_DIR, "e2e-full", "coverage-floor.json");
const floorRaw = JSON.parse(readFileSync(floorFile, "utf8"));
const floor = floorRaw.routes_content_reached_floor;
if (!Number.isInteger(floor) || floor < 1) {
  console.error(`coverage-from-run: coverage-floor.json carries no valid floor (${floor})`);
  process.exit(2);
}
if (reached.size < floor) {
  console.error(
    `coverage-from-run: COVERAGE FLOOR VIOLATION — routes-content-reached ${reached.size} < floor ${floor}. A previously-lit route went dark; fix the regression, never lower the floor.`
  );
  process.exit(1);
}
console.log(`check OK: coverage-floor ${floor} held (observed ${reached.size})`);
if (reached.size > floor) {
  console.log(
    `coverage-from-run: observed ${reached.size} exceeds the floor ${floor} — consider ratcheting coverage-floor.json up in a commit.`
  );
}
