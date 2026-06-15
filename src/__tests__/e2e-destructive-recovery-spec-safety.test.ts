/**
 * Source-text invariant tests for the destructive site_admin → org_admin
 * MFA-recovery Playwright spec at e2e/site-admin-admin-recovery.spec.ts.
 *
 * The spec mutates real DB state when run with
 * IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true. The
 * requireConcreteDestructiveRecoveryTarget() helper in the spec refuses
 * to run if the target identifiers are still the neutral placeholder
 * defaults — those defaults must NEVER be hit by a destructive endpoint.
 *
 * These tests pin every load-bearing invariant of the safety guard so a
 * future regression that removed the placeholder refusal would be caught
 * BEFORE it reached operator hands.
 *
 * Scope discipline:
 *   - Source-text invariants (no DOM, no Playwright runtime). The
 *     load-bearing behavior is the guard's wiring and message shape;
 *     both are static and read off the spec source file.
 *   - The synthetic mutations in this file use only neutral placeholders
 *     (`admin@example.org`, all-zero UUID). No real customer/company
 *     identifier appears.
 *
 * SECURITY:
 *   - No DB mutation. No reset endpoint is called. No `.env*` file is
 *     opened. No fixture JSON or credential value is read or printed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(__dirname, "..", "..");
const SPEC_PATH = resolve(UI_ROOT, "e2e", "site-admin-admin-recovery.spec.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const RAW_SPEC_SRC = readFileSync(SPEC_PATH, "utf-8");
const SPEC_SRC = stripComments(RAW_SPEC_SRC);

// ── Opt-in gate preservation ────────────────────────────────────────────────

describe("destructive recovery spec — opt-in gate preserved", () => {
  it("declares the DESTRUCTIVE_ALLOWED constant from IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET === 'true'", () => {
    // The strict-equals-string-"true" comparison is load-bearing: any
    // other value (including the unset case which becomes undefined,
    // and surrogate truthy strings like "1"/"yes") MUST NOT opt in.
    expect(SPEC_SRC).toMatch(
      /const\s+DESTRUCTIVE_ALLOWED\s*=\s*process\.env\.IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET\s*===\s*["']true["']/
    );
  });

  it("each destructive test skips when DESTRUCTIVE_ALLOWED is false", () => {
    // Count the `if (!DESTRUCTIVE_ALLOWED) { test.skip(...) }` blocks.
    // Both destructive tests must guard themselves — a regression that
    // dropped the gate on either path would be caught here.
    const matches = SPEC_SRC.match(/if\s*\(\s*!DESTRUCTIVE_ALLOWED\s*\)\s*\{\s*test\.skip\(/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ── Placeholder-refusal guard wiring ────────────────────────────────────────

describe("destructive recovery spec — placeholder-refusal guard", () => {
  it("declares requireConcreteDestructiveRecoveryTarget()", () => {
    expect(RAW_SPEC_SRC).toMatch(/\bfunction\s+requireConcreteDestructiveRecoveryTarget\s*\(\s*\)/);
  });

  it("the guard refuses empty IDENTUUM_TEST_ORG_ID", () => {
    expect(SPEC_SRC).toMatch(/if\s*\(\s*!ORG_ID\s*\)[\s\S]*?IDENTUUM_TEST_ORG_ID is empty/);
  });

  it("the guard refuses the all-zero placeholder IDENTUUM_TEST_ORG_ID", () => {
    expect(SPEC_SRC).toMatch(/if\s*\(\s*ORG_ID\s*===\s*DEFAULT_ORG_ID\s*\)[\s\S]*?placeholder/);
  });

  it("the guard refuses empty IDENTUUM_TEST_ORG_ADMIN_EMAIL", () => {
    expect(SPEC_SRC).toMatch(
      /if\s*\(\s*!ORG_ADMIN_EMAIL\s*\)[\s\S]*?IDENTUUM_TEST_ORG_ADMIN_EMAIL is empty/
    );
  });

  it("the guard refuses the 'admin@example.org' placeholder IDENTUUM_TEST_ORG_ADMIN_EMAIL", () => {
    expect(SPEC_SRC).toMatch(
      /if\s*\(\s*ORG_ADMIN_EMAIL\s*===\s*DEFAULT_ORG_ADMIN_EMAIL\s*\)[\s\S]*?admin@example\.org/
    );
  });

  it("the guard throws Error (not test.skip) — destructive opt-in must FAIL FAST, never silently skip with bad inputs", () => {
    // Inside the guard body, every refusal MUST throw a new Error. A
    // regression that converted the throws to test.skip() would let
    // operators believe destructive mode "passed" while it was actually
    // refusing to do anything against the placeholder values.
    const guardBody = RAW_SPEC_SRC.match(
      /\bfunction\s+requireConcreteDestructiveRecoveryTarget[\s\S]*?return\s+\{[\s\S]*?\}[;\s]*\n\}/
    )?.[0];
    expect(guardBody).toBeTruthy();
    expect(guardBody).not.toMatch(/test\.skip\(/);
    // At least four refusal cases must each throw a new Error.
    const throwMatches = guardBody?.match(/throw\s+new\s+Error\(/g) ?? [];
    expect(throwMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("the guard error messages name variable names but NEVER reference values", () => {
    const guardBody =
      RAW_SPEC_SRC.match(
        /\bfunction\s+requireConcreteDestructiveRecoveryTarget[\s\S]*?return\s+\{[\s\S]*?\}[;\s]*\n\}/
      )?.[0] ?? "";

    // Variable names MUST appear in at least the four expected refusals.
    expect(guardBody).toMatch(/IDENTUUM_TEST_ORG_ID is empty/);
    expect(guardBody).toMatch(/IDENTUUM_TEST_ORG_ID is the all-zero placeholder/);
    expect(guardBody).toMatch(/IDENTUUM_TEST_ORG_ADMIN_EMAIL is empty/);
    expect(guardBody).toMatch(
      /IDENTUUM_TEST_ORG_ADMIN_EMAIL is the neutral 'admin@example\.org' placeholder/
    );

    // The error messages must NEVER print the offending env VALUE via
    // template interpolation — any `${ORG_ID}` / `${ORG_ADMIN_EMAIL}` /
    // `${process.env.…}` inside an Error(...) constructor would leak.
    expect(guardBody).not.toMatch(/\$\{\s*ORG_ID\s*\}/);
    expect(guardBody).not.toMatch(/\$\{\s*ORG_ADMIN_EMAIL\s*\}/);
    expect(guardBody).not.toMatch(/\$\{\s*ORG_ADMIN_PASSWORD\s*\}/);
    expect(guardBody).not.toMatch(/\$\{\s*process\.env\./);
  });
});

// ── Test-call extraction helper (paren-balanced, string-literal-aware) ──────

/**
 * Walks `src` starting at `start` (which MUST point at an opening `(`)
 * and returns the index immediately after the matching `)`. Returns -1
 * when no matching close is found. Skips over `"…"`, `'…'`, and `` `…` ``
 * string literals so apostrophes / parentheses inside test names do not
 * unbalance the counter. Backslash escapes inside quoted strings are
 * honored. Comments are NOT skipped here because callers pass a
 * comment-stripped source.
 */
function balanceParens(src: string, start: number): number {
  if (src[start] !== "(") return -1;
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Returns every top-level `test(…)` call body found in `src`. Each entry
 * is the substring starting at the `t` of `test` and ending immediately
 * after the matching close paren. Matches the bare identifier `test`
 * followed by an opening paren — `test.skip(`, `test.describe(`,
 * `test.beforeAll(` etc. all contain a `.` between `test` and `(` and
 * are therefore NOT matched.
 */
function extractTopLevelTestCalls(src: string): string[] {
  const results: string[] = [];
  const re = /\btest\s*\(/g;
  while (true) {
    const m = re.exec(src);
    if (m === null) break;
    // Confirm this is not `test.something(` — the regex already excludes
    // that via `\s*\(` placement, but verify nothing surprising sneaks
    // through (e.g. unicode quirks).
    const startOfParen = m.index + m[0].length - 1;
    if (src[startOfParen] !== "(") continue;
    const end = balanceParens(src, startOfParen);
    if (end === -1) continue;
    results.push(src.slice(m.index, end));
    re.lastIndex = end;
  }
  return results;
}

// ── Helper-level tests for the parser ──────────────────────────────────────

describe("extractTopLevelTestCalls + balanceParens — parser correctness", () => {
  it("balanceParens walks balanced parens", () => {
    const s = "(a(b)c)";
    expect(balanceParens(s, 0)).toBe(s.length);
  });

  it("balanceParens skips parens inside string literals", () => {
    const s = "('a)b)c', d)";
    expect(balanceParens(s, 0)).toBe(s.length);
  });

  it("balanceParens skips parens inside template literals", () => {
    // eslint-disable-next-line no-template-curly-in-string
    const s = "(`a)b`, c)";
    expect(balanceParens(s, 0)).toBe(s.length);
  });

  it("balanceParens honors backslash escapes inside strings", () => {
    // Actual characters: ( ' a \ ' b ' c )
    // The \' inside the string is an escaped quote; the string runs
    // from the first ' to the second non-escaped ' (after 'b'). The
    // trailing c) is OUTSIDE the string, and the final ) balances the
    // opening (.
    const s = "('a\\'b'c)";
    expect(balanceParens(s, 0)).toBe(s.length);
  });

  it("balanceParens returns -1 when no balanced close exists", () => {
    expect(balanceParens("(unclosed", 0)).toBe(-1);
  });

  it("balanceParens refuses to start at a non-paren", () => {
    expect(balanceParens("abc", 0)).toBe(-1);
  });

  it("extractTopLevelTestCalls finds top-level test( calls and skips test.describe / test.skip", () => {
    const synthetic = [
      'test.describe("group", () => {',
      '  test("a", () => {});',
      '  test("b", () => { test.skip(true, "x"); });',
      "});",
      "",
      'test("c", () => {});',
    ].join("\n");
    const calls = extractTopLevelTestCalls(synthetic);
    // The synthetic source has three top-level `test(` calls. The
    // `test.skip(` and `test.describe(` invocations are ignored because
    // of the `.` between `test` and `(`.
    expect(calls.length).toBe(3);
    expect(calls[0]).toContain('"a"');
    expect(calls[1]).toContain('"b"');
    expect(calls[2]).toContain('"c"');
  });

  it("extractTopLevelTestCalls handles apostrophes inside test names", () => {
    const synthetic = `test("alice's case", async () => { return; });`;
    const calls = extractTopLevelTestCalls(synthetic);
    expect(calls.length).toBe(1);
  });
});

// ── Guard call sites ────────────────────────────────────────────────────────

describe("destructive recovery spec — guard is invoked before any page interaction", () => {
  // Source without the guard's own function declaration. The declaration
  // contains the literal `requireConcreteDestructiveRecoveryTarget` text,
  // which would otherwise inflate the guard-call count.
  const SPEC_WITHOUT_GUARD_DECL = SPEC_SRC.replace(
    /\bfunction\s+requireConcreteDestructiveRecoveryTarget[\s\S]*?return\s+\{[\s\S]*?\}[;\s]*\n\}/,
    ""
  );

  // Every top-level test call in the spec.
  const ALL_TEST_CALLS = extractTopLevelTestCalls(SPEC_WITHOUT_GUARD_DECL);

  // A "destructive" test body is one that contains the existing opt-in
  // gate pattern. Marker-free — we use the gate that already exists for
  // the same purpose, so the invariant follows the spec's natural shape.
  const DESTRUCTIVE_TEST_CALLS = ALL_TEST_CALLS.filter((body) =>
    /if\s*\(\s*!DESTRUCTIVE_ALLOWED\s*\)/.test(body)
  );

  it("the spec contains at least one destructive test (otherwise the suite has no destructive coverage)", () => {
    // Sanity floor: if a refactor accidentally removed every destructive
    // case the count-equality check below would trivially pass with 0 ===
    // 0. This guards against that no-op pass.
    expect(DESTRUCTIVE_TEST_CALLS.length).toBeGreaterThanOrEqual(2);
  });

  it("EVERY destructive test body calls requireConcreteDestructiveRecoveryTarget() — count equality, not lower bound", () => {
    // STRICT invariant: the number of destructive test bodies and the
    // number of guard calls inside them MUST be equal. A future agent
    // who adds a third destructive test without the guard would fail
    // this assertion. The prior `>= 2` lower bound silently allowed the
    // hole; this strict equality closes it.
    const guarded = DESTRUCTIVE_TEST_CALLS.filter((body) =>
      /requireConcreteDestructiveRecoveryTarget\s*\(\s*\)/.test(body)
    );
    expect(
      guarded.length,
      "every destructive test body must call requireConcreteDestructiveRecoveryTarget()"
    ).toBe(DESTRUCTIVE_TEST_CALLS.length);

    // Cross-check: total guard calls anywhere in the spec (excluding
    // the function declaration) MUST equal the destructive test count.
    // A spurious guard call outside a destructive test would also be
    // a regression signal.
    const allGuardCalls =
      SPEC_WITHOUT_GUARD_DECL.match(/requireConcreteDestructiveRecoveryTarget\s*\(\s*\)/g) ?? [];
    expect(
      allGuardCalls.length,
      "total guard call count must equal the destructive test count"
    ).toBe(DESTRUCTIVE_TEST_CALLS.length);
  });

  it("the guard call sits AFTER the opt-in skip and BEFORE any page / context / network interaction", () => {
    // The order within each destructive test body MUST be:
    //   1. if (!DESTRUCTIVE_ALLOWED) test.skip(...)
    //   2. requireConcreteDestructiveRecoveryTarget()
    //   3. browser.newContext() / siteAdminCtx!.newPage() / page.goto() /
    //      request.post() / fetch()
    //
    // A regression that placed the guard AFTER any of the (3) calls
    // would let a request reach the IDP against placeholder identifiers
    // before the refusal could fire.
    expect(DESTRUCTIVE_TEST_CALLS.length).toBeGreaterThanOrEqual(2);
    for (const body of DESTRUCTIVE_TEST_CALLS) {
      const skipIdx = body.indexOf("DESTRUCTIVE_ALLOWED");
      const guardIdx = body.indexOf("requireConcreteDestructiveRecoveryTarget");
      const interactionIdx = body.search(
        /siteAdminCtx!?\.newPage|browser\.newContext|page\.goto|request\.post|\bfetch\s*\(/
      );
      expect(skipIdx, "DESTRUCTIVE_ALLOWED gate must be present").toBeGreaterThan(-1);
      expect(guardIdx, "guard call must be present").toBeGreaterThan(-1);
      expect(guardIdx, "guard must follow the DESTRUCTIVE_ALLOWED gate").toBeGreaterThan(skipIdx);
      if (interactionIdx > -1) {
        expect(guardIdx, "guard must precede any page/context/network interaction").toBeLessThan(
          interactionIdx
        );
      }
    }
  });
});

// ── Docstring documents the required env variable names ─────────────────────

describe("destructive recovery spec — docstring documents required env vars", () => {
  it("names the destructive opt-in env variable in the spec docstring", () => {
    expect(RAW_SPEC_SRC).toMatch(/IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true/);
  });

  it("names IDENTUUM_TEST_ORG_ID and IDENTUUM_TEST_ORG_ADMIN_EMAIL", () => {
    expect(RAW_SPEC_SRC).toMatch(/IDENTUUM_TEST_ORG_ID\b/);
    expect(RAW_SPEC_SRC).toMatch(/IDENTUUM_TEST_ORG_ADMIN_EMAIL\b/);
  });

  it("names IDENTUUM_TEST_ORG_ADMIN_PASSWORD for the post-reset login check", () => {
    expect(RAW_SPEC_SRC).toMatch(/IDENTUUM_TEST_ORG_ADMIN_PASSWORD\b/);
  });
});

// ── Neutrality + credential negative invariants ─────────────────────────────

describe("destructive recovery spec — neutrality + credential invariants", () => {
  it("contains no real customer/company identifier (post-comment-strip)", () => {
    expect(SPEC_SRC).not.toMatch(/\baudi\b/i);
    expect(SPEC_SRC).not.toMatch(/admin@audi/i);
    expect(SPEC_SRC).not.toMatch(/\bAudi\b/);
  });

  it("contains no inlined credential-material literal", () => {
    const blocklist = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
    ];
    for (const pat of blocklist) {
      expect(SPEC_SRC).not.toMatch(pat);
    }
  });

  it("does not console.log credentials or fixture identifiers", () => {
    // The spec must not print env values, page-body text, or fixture
    // contents. Any console.log of process.env.* or of ORG_ADMIN_PASSWORD
    // would be a leak vector.
    expect(SPEC_SRC).not.toMatch(/console\.log\([^)]*process\.env/);
    expect(SPEC_SRC).not.toMatch(/console\.log\([^)]*ORG_ADMIN_PASSWORD/);
    expect(SPEC_SRC).not.toMatch(/console\.log\([^)]*ORG_ADMIN_EMAIL/);
  });
});
