/**
 * ci-judge-declaration-source-invariants.test.ts
 *
 * THE-TWO-THINGS-YESTERDAY-BROKE (2026-09-16). The shared CI judge
 * (identuum-idp-oss tools/ci-witness, since e437b0c) refuses a caller that
 * does not declare which gate it is asking about and what plan it expects:
 * "the caller did not declare an expected gate; the caller did not declare
 * its current expected plan". This repository's ci-witness recipe ran the
 * judge from the sibling checkout and declared neither, so `make verify`
 * stopped at its eleventh target.
 *
 * The ui's CI record is PRODUCED by one line: the "Open the gate run record"
 * step of build-and-test in .github/workflows/ci.yml, whose init call names
 * the gate label and lists the plan. That line is the single definition.
 * The judge's expectation is READ from it (yq, already a verify tool) —
 * never written out a second time — so the producer and the judge cannot
 * drift: the judge quotes the producer. These pins keep that wiring:
 *
 *   (a) the workflow's init line carries the label with the matrix node and
 *       a non-empty plan;
 *   (b) the ci-witness recipe reads that very step from ci.yml and passes
 *       the judge both --expect-gate and --expect-plan derived from it;
 *   (c) no second copy of the plan exists in the Makefile.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

const stripComments = (src: string): string =>
  src.replace(/^\s*#.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const INIT_LINE =
  /gate-witness\.sh init GATE-RUN\.ci\.txt "identuum-ui CI build-and-test \(node \$\{\{ matrix\.node \}\}\)" ([a-z0-9-]+(?: [a-z0-9-]+)+)/;

describe("the ui declares its CI gate identity and plan to the shared judge, once", () => {
  const ci = read(".github/workflows/ci.yml");
  const mk = stripComments(read("Makefile"));

  it("the workflow's record-opening step is the single definition of the gate label and the plan", () => {
    const m = ci.match(INIT_LINE);
    expect(m, "ci.yml opens the record with the gate label and a plan").not.toBeNull();
    expect(m?.[1].split(" ").length, "the plan has more than one target").toBeGreaterThan(1);
  });

  it("the ci-witness recipe derives both expectations from that step and hands them to the judge", () => {
    const recipe = mk.match(/^ci-witness:\n((?:\t.*\n?)+)/m)?.[1] ?? "";
    expect(recipe, "the recipe exists").not.toBe("");
    expect(recipe, "the recipe reads the record-opening step from ci.yml").toMatch(
      /yq '\.jobs\.build-and-test\.steps\[\] \| select\(\.name == "Open the gate run record"\) \| \.run'/
    );
    expect(recipe, "the gate label is declared to the judge").toMatch(/--expect-gate "\$\$gate"/);
    expect(recipe, "the plan is declared to the judge").toMatch(/--expect-plan "\$\$plan"/);
    expect(recipe, "the matrix node in the label resolves the way ci-fetch resolves it").toMatch(
      /CI_MATRIX_NODE/
    );
  });

  it("the Makefile never writes the CI plan out a second time", () => {
    const m = ci.match(INIT_LINE);
    const plan = m?.[1] ?? "";
    expect(plan).not.toBe("");
    expect(mk, "the plan's target list appears only in ci.yml").not.toContain(plan);
  });
});
