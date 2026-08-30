/**
 * skip-ceiling-source-invariants.test.ts — SKIP-CEILING-1
 *
 * THE-DISPOSABLE-IDENTITIES (2026-08-30): the devloop skip count was the last
 * printed-but-unenforced number in the witnessed record — a new self-skip
 * could creep in green forever (the STALE-SPEC-COPY shape). The enforcement
 * lives where the record is born: skip-ceiling-from-run.mjs reads the devloop
 * phase's OWN report and fails the skip-ceiling phase when skipped exceeds
 * the committed ceiling. These pins keep that enforcement wired:
 *
 *   (a) the committed file carries a non-negative integer ceiling;
 *   (b) the script compares the run's stats.skipped against it with an
 *       enforcing if and exits non-zero on a violation;
 *   (c) full-run.sh runs the enforcement as a witnessed step in the plan.
 *
 * The ceiling VALUE is lowered by commit after greener runs; this test pins
 * only that a valid one exists and is enforced (the file is the single
 * source, like the coverage floor).
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

describe("the devloop skip count has an enforced ceiling [SKIP-CEILING-1]", () => {
  it("skip-ceiling.json carries a non-negative integer ceiling", () => {
    const parsed = JSON.parse(read("e2e-full/skip-ceiling.json")) as {
      devloop_skipped_ceiling?: unknown;
    };
    const ceiling = parsed.devloop_skipped_ceiling;
    expect(Number.isInteger(ceiling), "ceiling must be an integer").toBe(true);
    expect(ceiling as number, "ceiling must be non-negative").toBeGreaterThanOrEqual(0);
  });

  it("skip-ceiling-from-run.mjs enforces the ceiling with an enforcing if and a non-zero exit [SKIP-CEILING-1]", () => {
    const mjs = stripComments(read("e2e-full/scripts/skip-ceiling-from-run.mjs"));
    expect(mjs, "reads the committed ceiling file").toContain("skip-ceiling.json");
    expect(mjs, "the observation comes from the run's own report").toMatch(
      /report\.stats\?\.skipped/
    );
    expect(mjs, "the enforcing if, not a neutralized condition").toMatch(
      /if \(skipped > ceiling\)/
    );
    expect(mjs, "violation exits non-zero").toMatch(
      /SKIP CEILING VIOLATION[\s\S]*?process\.exit\(1\)/
    );
    expect(mjs, "evidence line derives from the observation").toContain("devloop-skip-ceiling");
  });

  it("full-run.sh runs the enforcement as a witnessed step in the plan", () => {
    const sh = stripComments(read("e2e-full/scripts/full-run.sh"));
    // The plan tail grew when THE-ADMIN-RESET joined it (T-R2a) — the pin
    // asserts skip-ceiling's PRESENCE in the plan, not the plan's tail.
    expect(sh, "skip-ceiling is a planned phase").toMatch(
      /devloop-provisioned skip-ceiling coverage/
    );
    expect(sh, "enforcement runs as its own witnessed step").toMatch(
      /step "\$RECORD" 'skip-ceiling=node e2e-full\/scripts\/skip-ceiling-from-run\.mjs/
    );
  });
});
