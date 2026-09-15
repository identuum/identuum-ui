/**
 * login-error-role-source-invariants.test.ts — THE-SIX-SMALL-ONES, UI 2
 * (2026-09-16)
 *
 * The login form rendered its errors with no accessible role — zero
 * role="alert" in login-flow.tsx and password-form.tsx (measured 2026-09-15)
 * — so a screen reader was not told a login failed, and the e2e helpers had
 * to match errors by Tailwind class (`form [class*="text-red-"]`), which a
 * class rename would silence until a run with a wrong password.
 *
 * These pins hold the cure in both places: the form's error region carries a
 * real role, and the helpers match that role SCOPED TO THE FORM — never a
 * class, and never the page-wide brute-force banner, which keeps its own
 * role="alert" outside every form by design.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

describe("the login form's error region has a real role [UI 2]", () => {
  it('login-flow.tsx announces its server and passkey errors with role="alert"', () => {
    const src = read("src/components/auth/login-flow.tsx");
    expect(src, "the email step's server error is an alert").toMatch(
      /\{serverError && \(?\s*<p role="alert"/
    );
    expect(src, "the passkey error is an alert").toMatch(/\{passkeyError && \(?\s*<p role="alert"/);
  });

  it('password-form.tsx announces its server error with role="alert"', () => {
    const src = read("src/components/auth/password-form.tsx");
    expect(src, "the password step's server error is an alert").toMatch(
      /\{serverError && \(\s*<div\s+role="alert"/
    );
  });

  it("the page-wide brute-force banner keeps its own alert role, unchanged", () => {
    const src = read("src/components/shared/brute-force-warning.tsx");
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/Brute-force protections are disabled\./);
  });
});

describe("the e2e login helpers match the role, scoped to the form, and no class [UI 2]", () => {
  for (const rel of ["e2e/oss-change-password.spec.ts", "e2e/helpers/login.ts"]) {
    it(`${rel} matches form [role="alert"] and never a text-red class`, () => {
      const src = stripComments(read(rel));
      expect(src, "the login error is the form's alert").toMatch(/form \[role="alert"\]/);
      expect(src, "no class-based error matcher survives").not.toMatch(/class\*="text-red-"/);
      expect(src, "no unscoped alert matcher survives").not.toMatch(
        /locator\('\[role="alert"\]'\)/
      );
      expect(src, "no unscoped alert role query survives").not.toMatch(
        /page\.getByRole\("alert"\)/
      );
    });
  }
});
