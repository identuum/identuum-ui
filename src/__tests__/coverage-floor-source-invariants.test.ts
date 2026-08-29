/**
 * coverage-floor-source-invariants.test.ts — COVERAGE-FLOOR-1
 *
 * THE-COVERAGE-FLOOR (2026-08-29): route coverage must not silently rot. The
 * enforcement lives where the record is born — coverage-from-run.mjs compares
 * the RUN-DERIVED routes-content-reached against the committed floor and fails
 * the harness coverage phase (record red, make e2e-full non-zero) on a drop.
 * These pins keep that enforcement from being quietly unwired:
 *
 *   (a) the committed floor file exists and carries a positive integer floor;
 *   (b) the coverage script READS that file, COMPARES the observed size
 *       against it, and EXITS NON-ZERO on a violation;
 *   (c) full-run.sh runs the coverage script as a witnessed step, so the
 *       enforcement actually executes inside `make e2e-full`.
 *
 * The floor VALUE is ratcheted by commit after higher green runs; this test
 * deliberately does not pin the number itself (the file is the single source),
 * only that a valid one exists and is enforced.
 *
 * Source-invariant style (no process spawn, no network, no browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/**
 * Strip //-line and block comments so a COMMENTED-OUT enforcement block can
 * never satisfy the pins below — the exact mutation class that survived the
 * first red-proof attempt (the neutralized line kept the text in a trailing
 * comment). Crude by design: it does not parse strings, but the enforcement
 * shapes asserted here never appear inside string literals in the script.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

describe("the coverage floor is committed and enforced in the harness [COVERAGE-FLOOR-1]", () => {
  it("coverage-floor.json carries a positive integer floor", () => {
    const parsed = JSON.parse(read("e2e-full/coverage-floor.json")) as {
      routes_content_reached_floor?: unknown;
    };
    const floor = parsed.routes_content_reached_floor;
    expect(Number.isInteger(floor), "floor must be an integer").toBe(true);
    expect(floor as number, "floor must be positive").toBeGreaterThan(0);
  });

  it("coverage-from-run.mjs reads the floor, compares the observed value, and fails on a drop [COVERAGE-FLOOR-1]", () => {
    // COMMENT-STRIPPED source: a commented-out enforcement block cannot
    // satisfy any pin below (THE-FRESH-APPLIANCE-PHASE hardening — the
    // owner's review showed the un-stripped regexes still matched the same
    // lines commented out).
    const mjs = stripComments(read("e2e-full/scripts/coverage-from-run.mjs"));
    expect(mjs, "reads the committed floor file").toContain("coverage-floor.json");
    expect(mjs, "compares the run-derived observation against the floor").toMatch(
      /if \(reached\.size < floor\)/
    );
    expect(mjs, "a violation exits non-zero (fails the witnessed phase)").toMatch(
      /COVERAGE FLOOR VIOLATION[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "a held floor is recorded as evidence").toContain("check OK: coverage-floor");
  });

  it("full-run.sh executes the coverage script as a witnessed step", () => {
    const sh = read("e2e-full/scripts/full-run.sh");
    // Anchor on the INVOCATION (a header comment also mentions the script).
    const invocation = "node e2e-full/scripts/coverage-from-run.mjs";
    const idx = sh.indexOf(invocation);
    expect(idx, "the coverage invocation exists").toBeGreaterThan(-1);
    // It runs via gate-witness step, so its exit lands in the record: the
    // invocation sits inside a step command string on the same line.
    const lineStart = sh.lastIndexOf("\n", idx) + 1;
    const line = sh.slice(lineStart, sh.indexOf("\n", idx));
    expect(line, "the coverage invocation is a gate-witness step").toContain('step "$RECORD"');
  });
});
