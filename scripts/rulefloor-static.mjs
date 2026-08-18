#!/usr/bin/env node
// The IN-REPO static ledger floor for one-repo checkouts — CI cannot see the
// sibling ../rulefloor checkout, so without this the remote pipeline runs no
// ledger check at all. A DELIBERATE SUBSET of `rulefloor check`:
//
//   - strict parse of RULE-FLOOR.md (FLOOR line, optional RED-PROOFS line,
//     header, six non-empty cells)
//   - row count >= FLOOR
//   - once RED-PROOFS is adopted: the count of armed rows whose red-proof
//     cell is not "-" must not sit below it (a proof emptied or a proven
//     row deleted)
//   - every armed row's check file exists
//   - the row's tag is present in that file ("[ID]" for *.spec.ts and
//     *.test.ts, "// RULE: ID" for *_test.go)
//   - a *.spec.ts / *.test.ts line carrying the "[ID]" tag must not carry
//     .skip( or .only(
//
// NO HASH VERIFICATION, no body extraction, no execution, no orphan scan:
// hashing and extraction stay the rulefloor tool's alone. Exit 0 clean;
// exit 1 on any failure or parse fault.
//
// `--selftest` builds throwaway fixtures and red-proves every failure mode.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function liteCheck(repo) {
  const ledgerPath = path.join(repo, "RULE-FLOOR.md");
  const data = fs.readFileSync(ledgerPath, "utf8");
  let floor = -1;
  let redProofs = -1; // -1: header not adopted (legacy ledger)
  let stage = 0;
  const rows = [];
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (stage === 0) {
      const m = line.match(/^FLOOR: (\d+)$/);
      if (!m) throw new Error(`line ${i + 1}: expected "FLOOR: N"`);
      floor = Number(m[1]);
      stage = 1;
    } else if (stage === 1 && line.startsWith("RED-PROOFS: ")) {
      // The optional ratchet line sits between FLOOR and the table header.
      if (redProofs >= 0) throw new Error(`line ${i + 1}: duplicate RED-PROOFS line`);
      const m = line.match(/^RED-PROOFS: (\d+)$/);
      if (!m) throw new Error(`line ${i + 1}: invalid RED-PROOFS`);
      redProofs = Number(m[1]);
    } else if (stage === 1 || stage === 2) {
      stage++; // header, separator — shape-checked via cell count below
    } else {
      const cells = line.split("|");
      if (cells.length !== 8 || cells[0].trim() !== "" || cells[7].trim() !== "") {
        throw new Error(`line ${i + 1}: malformed row`);
      }
      for (const c of cells.slice(1, 7)) {
        if (c.trim() === "") throw new Error(`line ${i + 1}: missing field`);
      }
      rows.push({ id: cells[1].trim(), check: cells[4].trim(), redProof: cells[5].trim() });
    }
  }
  if (stage < 3) throw new Error("truncated ledger");
  const problems = [];
  if (rows.length < floor) {
    problems.push(`ledger: ${rows.length} rows is below FLOOR ${floor}`);
  }
  if (redProofs >= 0) {
    const measured = rows.filter((r) => r.check !== "NONE" && r.redProof !== "-").length;
    if (measured < redProofs) {
      problems.push(
        `ledger: ${measured} red-proved armed rows is below RED-PROOFS ${redProofs} (a proof was emptied or a proven row deleted)`
      );
    }
  }
  for (const r of rows) {
    if (r.check === "NONE") continue;
    const at = r.check.indexOf(" @ ");
    if (at < 0) {
      problems.push(`${r.id}: malformed check field`);
      continue;
    }
    const file = r.check.slice(0, at).trim();
    const full = path.join(repo, file);
    if (!fs.existsSync(full)) {
      problems.push(`${r.id}: check file missing: ${file}`);
      continue;
    }
    const src = fs.readFileSync(full, "utf8");
    if (file.endsWith(".spec.ts") || file.endsWith(".test.ts")) {
      const tag = `[${r.id}]`;
      let found = false;
      for (const ln of src.split("\n")) {
        if (!ln.includes(tag)) continue;
        found = true;
        if (ln.includes(".skip(") || ln.includes(".only(")) {
          problems.push(`${r.id}: tagged title line carries .skip/.only in ${file}`);
        }
      }
      if (!found) problems.push(`${r.id}: tag ${tag} absent from ${file}`);
    } else if (file.endsWith("_test.go")) {
      if (!src.includes(`// RULE: ${r.id}`)) {
        problems.push(`${r.id}: tag "// RULE: ${r.id}" absent from ${file}`);
      }
    } else {
      problems.push(`${r.id}: unknown check file kind: ${file}`);
    }
  }
  return problems;
}

function selftest() {
  const ledger = [
    "FLOOR: 2",
    "",
    "| ID | one-sentence rule | enforced-by | check | red-proof | hash |",
    "|---|---|---|---|---|---|",
    "| L-1 | Spec rule. | playwright | e2e/a.spec.ts @ chromium | - | abcdef012345 |",
    "| L-2 | Go rule. | go-test | a_test.go @ unit | - | abcdef012345 |",
    "",
  ].join("\n");
  const freshRepo = () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rfstatic-"));
    fs.mkdirSync(path.join(repo, "e2e"), { recursive: true });
    fs.writeFileSync(path.join(repo, "RULE-FLOOR.md"), ledger);
    fs.writeFileSync(path.join(repo, "e2e/a.spec.ts"), "test('holds [L-1]', async () => {});\n");
    fs.writeFileSync(path.join(repo, "a_test.go"), "package a\n\n// RULE: L-2\nfunc TestL2(t *testing.T) {}\n");
    return repo;
  };
  const ratchetLedger = [
    "FLOOR: 3",
    "RED-PROOFS: 1",
    "",
    "| ID | one-sentence rule | enforced-by | check | red-proof | hash |",
    "|---|---|---|---|---|---|",
    "| L-1 | Spec rule. | playwright | e2e/a.spec.ts @ chromium | mutation watched FAIL, restored | abcdef012345 |",
    "| L-2 | Go rule. | go-test | a_test.go @ unit | - | abcdef012345 |",
    "| L-3 | Vitest rule. | vitest | src/__tests__/w.test.ts @ vitest | - | abcdef012345 |",
    "",
  ].join("\n");
  // Overlays the ratchet-era ledger + vitest pin onto a fresh repo.
  const writeRatchet = (repo) => {
    fs.mkdirSync(path.join(repo, "src/__tests__"), { recursive: true });
    fs.writeFileSync(path.join(repo, "RULE-FLOOR.md"), ratchetLedger);
    fs.writeFileSync(path.join(repo, "src/__tests__/w.test.ts"), "it('wire read holds [L-3]', () => {});\n");
  };
  const cases = [
    ["clean repo passes", (r) => {}, null],
    ["deleted row drops below FLOOR", (r) => {
      const p = path.join(r, "RULE-FLOOR.md");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\| L-2 .*\n/, ""));
    }, "below FLOOR"],
    ["check file missing", (r) => fs.rmSync(path.join(r, "e2e/a.spec.ts")), "check file missing"],
    ["spec tag absent", (r) => fs.writeFileSync(path.join(r, "e2e/a.spec.ts"), "test('untagged', async () => {});\n"), "absent from"],
    ["go tag absent", (r) => fs.writeFileSync(path.join(r, "a_test.go"), "package a\n\nfunc TestL2(t *testing.T) {}\n"), "absent from"],
    ["tagged line gains .skip", (r) => fs.writeFileSync(path.join(r, "e2e/a.spec.ts"), "test.skip('holds [L-1]', async () => {});\n"), ".skip/.only"],
    ["tagged line gains .only", (r) => fs.writeFileSync(path.join(r, "e2e/a.spec.ts"), "test.only('holds [L-1]', async () => {});\n"), ".skip/.only"],
    // THE-RED-PROOF-FLOOR: RED-PROOFS header + *.test.ts kind.
    ["ratchet ledger clean passes", (r) => writeRatchet(r), null],
    ["emptied proof drops below RED-PROOFS", (r) => {
      writeRatchet(r);
      const p = path.join(r, "RULE-FLOOR.md");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("| mutation watched FAIL, restored |", "| - |"));
    }, "below RED-PROOFS"],
    ["vitest tag absent", (r) => {
      writeRatchet(r);
      fs.writeFileSync(path.join(r, "src/__tests__/w.test.ts"), "it('untagged', () => {});\n");
    }, "absent from"],
    ["vitest tagged line gains .skip", (r) => {
      writeRatchet(r);
      fs.writeFileSync(path.join(r, "src/__tests__/w.test.ts"), "it.skip('wire read holds [L-3]', () => {});\n");
    }, ".skip/.only"],
  ];
  let failed = 0;
  for (const [name, mutate, want] of cases) {
    const repo = freshRepo();
    mutate(repo);
    const problems = liteCheck(repo);
    const joined = problems.join("\n");
    const ok = want === null ? problems.length === 0 : joined.includes(want);
    console.log(`${ok ? "ok " : "FAIL"} selftest: ${name}`);
    if (!ok) failed++;
    fs.rmSync(repo, { recursive: true, force: true });
  }
  // A malformed ledger must be a parse fault, not a pass.
  const repo = freshRepo();
  fs.writeFileSync(path.join(repo, "RULE-FLOOR.md"), "not a ledger\n");
  try {
    liteCheck(repo);
    console.log("FAIL selftest: malformed ledger did not fault");
    failed++;
  } catch {
    console.log("ok  selftest: malformed ledger is a parse fault");
  }
  fs.rmSync(repo, { recursive: true, force: true });
  // A bad RED-PROOFS line must be a parse fault, not a pass.
  for (const [name, broken] of [
    ["invalid RED-PROOFS value", "RED-PROOFS: x"],
    ["duplicate RED-PROOFS line", "RED-PROOFS: 1\nRED-PROOFS: 2"],
  ]) {
    const r = freshRepo();
    writeRatchet(r);
    const p = path.join(r, "RULE-FLOOR.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("RED-PROOFS: 1", broken));
    try {
      liteCheck(r);
      console.log(`FAIL selftest: ${name} did not fault`);
      failed++;
    } catch {
      console.log(`ok  selftest: ${name} is a parse fault`);
    }
    fs.rmSync(r, { recursive: true, force: true });
  }
  if (failed > 0) process.exit(1);
  console.log("selftest OK: every failure mode red-proved");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  let problems;
  try {
    problems = liteCheck(".");
  } catch (e) {
    console.error(`rulefloor-static: ${e.message}`);
    process.exit(1);
  }
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length > 0) {
    console.error(`rulefloor-static: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("rulefloor-static OK (static subset; hashes are rulefloor's job)");
}
