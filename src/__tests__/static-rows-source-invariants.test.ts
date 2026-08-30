/**
 * static-rows-source-invariants.test.ts — STATIC-ROWS-1
 *
 * THE-PROBES-THAT-STAY (2026-08-29): the behavioral census's 23 formerly
 * static-only rows are asserted live every harness run by the
 * static-rows-sweep phase, and the assertion must not silently rot. The
 * enforcement lives where the record is born — static-rows-from-run.mjs
 * derives the PASSED [ROW n] set from the sweep phase's own JSON report and
 * fails the phase on ANY divergence from the committed set (drift in either
 * direction) or a drop below the floor. These pins keep that enforcement from
 * being quietly unwired:
 *
 *   (a) the committed file exists, lists 26 distinct rows (the 23 census rows
 *       + the [ROW 200/201/202] refusal sentinels), and carries a positive
 *       integer floor equal to the list length;
 *   (b) the enforcement script READS the committed file, COMPARES the
 *       passed set, and EXITS NON-ZERO on drift and on a floor violation;
 *   (c) full-run.sh runs BOTH the sweep phase and the enforcement step as
 *       witnessed steps, so a self-skipping sweep can never read green
 *       (the STALE-SPEC-COPY lesson);
 *   (d) every committed row has a matching [ROW n] test in the sweep spec.
 *
 * Source-invariant style (no process spawn, no network, no browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/** Comment-stripped source, same rationale as COVERAGE-FLOOR-1's pins. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

describe("the static census rows stay asserted every harness run [STATIC-ROWS-1]", () => {
  it("static-rows.json commits 26 distinct rows and a floor equal to the list length", () => {
    const parsed = JSON.parse(read("e2e-full/static-rows.json")) as {
      rows?: unknown;
      rows_asserted_floor?: unknown;
    };
    const rows = parsed.rows;
    expect(Array.isArray(rows), "rows must be a list").toBe(true);
    const list = rows as number[];
    expect(new Set(list).size, "rows must be distinct").toBe(list.length);
    // 23 formerly-static-only census rows + the three refusal sentinels:
    // [ROW 200] (site_admin) and [ROW 201] (org_user) fire the identical
    // 45-verb tenant-resource battery; [ROW 202] fires the golden-derived
    // site-admin-surface battery as both tenant principals (T4-2).
    expect(list.length, "23 census rows + the three refusal sentinels [ROW 200/201/202]").toBe(26);
    expect(parsed.rows_asserted_floor, "floor equals the committed list length").toBe(list.length);
  });

  it("static-rows-from-run.mjs reads the committed set, fails on drift, and fails below the floor [STATIC-ROWS-1]", () => {
    const mjs = stripComments(read("e2e-full/scripts/static-rows-from-run.mjs"));
    expect(mjs, "reads the committed file").toContain("static-rows.json");
    expect(
      mjs,
      "set equality enforced in both directions (the enforcing if, not a neutralized condition)"
    ).toMatch(/if \(JSON\.stringify\(observed\) !== JSON\.stringify\(committedRows\)\)/);
    expect(mjs, "drift exits non-zero").toMatch(/STATIC ROWS DRIFT[\s\S]*?process\.exit\(1\)/);
    expect(mjs, "floor comparison is the enforcing if").toMatch(/if \(observed\.length < floor\)/);
    expect(mjs, "floor violation exits non-zero").toMatch(
      /STATIC ROWS FLOOR VIOLATION[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "evidence line derives from the observation").toContain("static-rows-asserted");
  });

  it("full-run.sh runs the sweep AND the enforcement as witnessed steps", () => {
    const sh = stripComments(read("e2e-full/scripts/full-run.sh"));
    expect(sh, "sweep phase is planned").toMatch(
      /PLAN\+=\(provisioner static-rows-sweep static-rows /
    );
    expect(sh, "sweep runs as a witnessed step with the opt-in flag").toMatch(
      /step "\$RECORD" 'static-rows-sweep=IDENTUUM_E2E_FULL=1 IDENTUUM_E2E_STATIC_ROWS=1/
    );
    expect(sh, "enforcement runs as its own witnessed step").toMatch(
      /step "\$RECORD" 'static-rows=node e2e-full\/scripts\/static-rows-from-run\.mjs/
    );
  });

  it("every committed row has a matching [ROW n] test in the sweep spec", () => {
    const rows = (JSON.parse(read("e2e-full/static-rows.json")) as { rows: number[] }).rows;
    const spec = stripComments(read("e2e-full/static-rows-sweep.spec.ts"));
    for (const n of rows) {
      expect(spec, `[ROW ${n}] test present`).toContain(`"[ROW ${n}]`);
    }
  });
});
