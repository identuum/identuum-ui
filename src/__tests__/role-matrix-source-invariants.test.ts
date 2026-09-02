/**
 * role-matrix-source-invariants.test.ts — ROLE-MATRIX-1
 *
 * THE-ROLE-CENSUS (2026-08-30): TEST-spec R1 demands every functionality be
 * tested for EACH user type. The honest denominator is (endpoint, role)
 * CELLS — the docgen endpoint golden × {site_admin, org_admin, org_user} —
 * and the harness now measures it from its own api() observations and
 * enforces the committed matrix every run. These pins keep that enforcement
 * from being quietly unwired:
 *
 *   (a) the committed matrix exists, its cells carry only the three human
 *       roles, and the floor is a positive integer no greater than the
 *       committed cell count;
 *   (b) the enforcement script READS the committed matrix AND the golden,
 *       and EXITS NON-ZERO on cell drift, on a floor violation, and on
 *       denominator drift;
 *   (c) full-run.sh exports the observation log, truncates it per run, and
 *       runs the enforcement as a witnessed step inside the plan;
 *   (d) the api() helper actually writes the observations when the harness
 *       sets the env — no observations, no census.
 *
 * Source-invariant style (no process spawn, no network, no browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/** Comment-stripped source, same rationale as STATIC-ROWS-1's pins. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

const ROLES = ["site_admin", "org_admin", "org_user"];

describe("the (endpoint, role) coverage matrix stays enforced every harness run [ROLE-MATRIX-1]", () => {
  it("role-matrix.json commits a valid v2 matrix: role cells + class cells + named exclusions, floor ≤ total", () => {
    const parsed = JSON.parse(read("e2e-full/role-matrix.json")) as {
      endpoints?: unknown;
      role_endpoints?: unknown;
      class_endpoints?: unknown;
      excluded_session_endpoints?: unknown;
      roles?: unknown;
      cells?: Record<string, string[]>;
      class_cells?: string[];
      covered_cells_floor?: unknown;
    };
    expect(typeof parsed.endpoints, "endpoint denominator present").toBe("number");
    expect(parsed.endpoints as number).toBeGreaterThan(0);
    expect(typeof parsed.role_endpoints, "role-endpoint count present (v2)").toBe("number");
    expect(typeof parsed.class_endpoints, "class-endpoint count present (v2)").toBe("number");
    expect(
      Array.isArray(parsed.excluded_session_endpoints),
      "session exclusions are LISTED BY NAME, never silent"
    ).toBe(true);
    expect((parsed.excluded_session_endpoints as string[]).length).toBeGreaterThan(0);
    expect(parsed.roles, "the three human principals, exactly").toEqual(ROLES);
    const cells = parsed.cells ?? {};
    let total = 0;
    for (const [key, roles] of Object.entries(cells)) {
      expect(/^[A-Z]+ \//.test(key), `cell key is "METHOD /path": ${key}`).toBe(true);
      expect(roles.length, `cell ${key} names at least one role`).toBeGreaterThan(0);
      for (const r of roles) {
        expect(ROLES, `cell ${key} carries only human roles`).toContain(r);
      }
      total += roles.length;
    }
    const classCells = parsed.class_cells ?? [];
    for (const c of classCells) {
      expect(/^[A-Z]+ \/.* @ any$/.test(c), `class cell is "METHOD /path @ any": ${c}`).toBe(true);
    }
    total += classCells.length;
    expect(total, "at least one covered cell").toBeGreaterThan(0);
    const floor = parsed.covered_cells_floor as number;
    expect(typeof floor).toBe("number");
    expect(floor, "floor is positive").toBeGreaterThan(0);
    expect(floor, "floor never exceeds the committed cells").toBeLessThanOrEqual(total);
  });

  it("role-matrix-from-run.mjs reads matrix + golden and fails on drift, floor, and denominator [ROLE-MATRIX-1]", () => {
    const mjs = stripComments(read("e2e-full/scripts/role-matrix-from-run.mjs"));
    expect(mjs, "reads the committed matrix").toContain("role-matrix.json");
    expect(mjs, "reads the docgen golden (the denominator)").toContain("endpoints.golden.yaml");
    expect(mjs, "cell drift exits non-zero").toMatch(/ROLE-MATRIX DRIFT[\s\S]*?process\.exit\(1\)/);
    expect(mjs, "floor comparison is the enforcing if (v2: role + class total)").toMatch(
      /if \(observedTotal < committed\.covered_cells_floor\)/
    );
    expect(mjs, "floor violation exits non-zero").toMatch(
      /ROLE-MATRIX FLOOR VIOLATION[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "denominator drift exits non-zero").toMatch(
      /DENOMINATOR DRIFT[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "evidence line derives from the observation").toContain("check OK: role-matrix");
  });

  it("full-run.sh exports the observation log, truncates it per run, and enforces as a witnessed step", () => {
    const sh = stripComments(read("e2e-full/scripts/full-run.sh"));
    expect(sh, "observation log exported for every phase").toMatch(
      /export IDENTUUM_E2E_MATRIX_LOG=/
    );
    expect(sh, "observations truncated per run (never carried forward)").toMatch(
      /: >"\$IDENTUUM_E2E_MATRIX_LOG"/
    );
    expect(sh, "role-matrix phase is planned").toMatch(
      /PLAN\+=\(provisioner static-rows-sweep static-rows role-matrix /
    );
    expect(sh, "enforcement runs as its own witnessed step").toMatch(
      /step "\$RECORD" 'role-matrix=node e2e-full\/scripts\/role-matrix-from-run\.mjs/
    );
  });

  it("the outside-matrix closure stays enforced: committed set, enforcing exits, witnessed step", () => {
    // THE-CLOSURE-AUDIT: "covered elsewhere" is a per-run FACT, not a claim.
    const committed = JSON.parse(read("e2e-full/closure-coverage.json")) as {
      endpoints?: Array<{ endpoint: string; kind: string; sources: string[] }>;
      closure_floor?: number;
    };
    const eps = committed.endpoints ?? [];
    expect(eps.length, "the closure set is committed").toBeGreaterThan(0);
    expect(committed.closure_floor, "floor equals the committed set").toBe(eps.length);
    for (const e of eps) {
      expect(/^[A-Z]+ \//.test(e.endpoint), `endpoint shape: ${e.endpoint}`).toBe(true);
      expect(["session", "class"], `kind is session|class: ${e.endpoint}`).toContain(e.kind);
      expect(e.sources.length, `bootstrap evidence recorded: ${e.endpoint}`).toBeGreaterThan(0);
    }
    const mjs = stripComments(read("e2e-full/scripts/closure-from-run.mjs"));
    expect(mjs, "reads the committed file").toContain("closure-coverage.json");
    expect(mjs, "reads the golden (live denominator)").toContain("endpoints.golden.yaml");
    expect(mjs, "unobserved endpoint fails").toMatch(/CLOSURE DRIFT[\s\S]*?process\.exit\(1\)/);
    expect(mjs, "golden change fails until re-derived").toMatch(
      /DENOMINATOR DRIFT[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "floor violation fails").toMatch(
      /CLOSURE FLOOR VIOLATION[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "evidence line derives from the observation").toContain("check OK: closure");
    const sh = stripComments(read("e2e-full/scripts/full-run.sh"));
    // THE-SESSION-REJECTION-ROOT-CAUSE: the credential-free AUTH-503 log scan
    // is the only phase allowed after admin-reset (it reads the appliance log,
    // it needs no credential).
    expect(sh, "closure phase is planned").toMatch(/coverage closure admin-reset auth503-scan\)/);
    expect(sh, "enforcement runs as its own witnessed step").toMatch(
      /step "\$RECORD" 'closure=node e2e-full\/scripts\/closure-from-run\.mjs/
    );
    const fixture = stripComments(read("e2e/helpers/appliance-fixture.ts"));
    expect(fixture, "observeRaw evidence tap exists for request-fixture specs").toContain(
      "export function observeRaw"
    );
  });

  it("api() writes the observations when the harness asks — no observations, no census", () => {
    const ts = stripComments(read("e2e/helpers/appliance-fixture.ts"));
    expect(ts, "env-gated").toContain("process.env.IDENTUUM_E2E_MATRIX_LOG");
    expect(ts, "appends one JSONL line per call").toMatch(
      /appendFileSync\(matrixLog[\s\S]*?JSON\.stringify\(\{ m: method, p: path, role, s: res\.status \}\)/
    );
  });
});
