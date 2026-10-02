/**
 * pw-phase-skip-names-source-invariants.test.ts — OSS-V0.9.0 (owner ruling)
 *
 * A phase's record named its failures one per line but its skips only as a
 * count ("passed=3 skipped=2 failed=0"), so a reader could not tell a skip
 * by design from a spec that silently proved nothing. pw-phase.sh now prints
 * one evidence line per skipped test — file:line, title and the reason its
 * test.skip gave — derived from the run's own JSON report, in the
 * "check OK:" form gate-witness captures. These pins keep it wired.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const stripComments = (src: string): string => src.replace(/^\s*#.*$/gm, "");
const sh = stripComments(readFileSync(resolve(REPO, "e2e-full/scripts/pw-phase.sh"), "utf8"));

describe("pw-phase.sh names every skipped test and why", () => {
  it("selects the skipped tests from the run's own JSON report", () => {
    expect(sh).toMatch(/if \(t\.status !== "skipped"\) continue;/);
  });

  it("takes the reason from the test's skip annotation", () => {
    expect(sh).toMatch(/a\.type === "skip"/);
  });

  it("prints one captured evidence line per skipped test", () => {
    expect(sh).toMatch(/echo "check OK: \$PHASE skipped: \$line"/);
  });
});
