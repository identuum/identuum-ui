/**
 * TOOLS-MATRIX-CONTAINERS (2026-10-05): `make verify` runs e2e-full's
 * DENOMINATOR DRIFT check alone (role-matrix-from-run.mjs --denominator-only),
 * so a golden that grew is refused in seconds instead of ~45 minutes into
 * e2e-full. Tiny fixtures: one role-class, one class-once, one session endpoint.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../e2e-full/scripts/role-matrix-from-run.mjs");

const entry = (path: string, auth: string) =>
  `  - id: "x${path}"\n    method: "GET"\n    path: "${path}"\n    auth: "${auth}"\n`;

function run(goldenEntries: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "role-matrix-denominator-"));
  writeFileSync(join(dir, "golden.yaml"), `endpoints:\n${goldenEntries.join("")}`);
  writeFileSync(
    join(dir, "matrix.json"),
    JSON.stringify({
      endpoints: 3,
      role_endpoints: 1,
      class_endpoints: 1,
      cells: {},
      class_cells: [],
    })
  );
  return spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--denominator-only",
      "--golden",
      join(dir, "golden.yaml"),
      "--matrix",
      join(dir, "matrix.json"),
    ],
    { encoding: "utf8" }
  );
}

const base = [entry("/a", "authenticated"), entry("/b", "public"), entry("/c", "session")];

describe("role-matrix denominator check (make verify)", () => {
  it("passes when the committed denominators match the golden", () => {
    const r = run(base);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check OK: role-matrix denominator 3/1/1");
  });

  it("refuses a golden with one more endpoint, with e2e-full's message", () => {
    const r = run([...base, entry("/d", "authenticated")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "check FAILED: role-matrix DENOMINATOR DRIFT: committed 3/1/1 vs golden 4/2/1 (total/role/class endpoints)"
    );
  });
});
