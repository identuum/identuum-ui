/**
 * THE-ENROLL-PASSWORD — source-invariant pins for the password the
 * /account/settings TOTP enrollment now collects before it initiates.
 *
 * Cause: identuum-idp-ce d9ca9fe (CE log/0100) made
 * POST /api/v1/mfa/setup/initiate require the caller's current password —
 * a hijacked session alone could otherwise arm the attacker's
 * authenticator on any account with no active factor and hand it ten
 * recovery codes, with no self-service way back. The server accepts
 * exactly {"password"} through a lenient decoder: an absent, empty or
 * wrong password all collapse to the SAME 401 invalid_proof; a step-up
 * outage and an unwritable audit chain are both 503. The client must not
 * pretend to distinguish what the server deliberately does not.
 *
 * Why source-invariant rather than runtime DOM tests: the form is a
 * "use client" component on react-hook-form + qrcode.react; the repo's
 * convention for such components (account-mfa-enrollment-done-button
 * .test.ts) pins behaviour at the source-text layer. We follow it.
 *
 * Invariants under test:
 *   1. accountMfaSetupInitiate takes the password and sends it as the
 *      JSON body {password} — never the old `{}`.
 *   2. The enroll form has a "password" phase BEFORE "display": it does
 *      not initiate on mount any more; the initiate call carries the
 *      password the operator typed.
 *   3. Client-side, an empty password cannot start enrollment (zod
 *      min(1)); the server stays the authority for a wrong one.
 *   4. The password field reuses the disable form's shape: label
 *      "Current password", name="password", type="password",
 *      autoComplete="current-password".
 *   5. A 401 from initiate surfaces as ONE cause-neutral message the
 *      form renders (no "wrong"/"missing"/"locked" guesses); a 503 has
 *      its own single "temporarily unavailable" message; 409 keeps the
 *      already_enrolled phase.
 *   6. The password is asked for once, at initiate; complete still sends
 *      only {code}.
 *   7. The password is never persisted or logged.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("idp-client.ts — accountMfaSetupInitiate sends {password}", () => {
  const src = source("lib/idp-client.ts");
  const start = src.indexOf("export async function accountMfaSetupInitiate(");
  const end = src.indexOf("\nexport async function accountMfaSetupComplete(");
  const body = src.slice(start, end);

  it("takes the current password as its argument", () => {
    expect(body).toMatch(/accountMfaSetupInitiate\(\s*password:\s*string\s*\)/);
  });

  it("sends JSON.stringify({ password }) and never the empty object", () => {
    expect(body).toContain("body: JSON.stringify({ password })");
    expect(body).not.toContain('body: "{}"');
  });

  it("keeps the ApiError surface on non-2xx (no swallowed 401)", () => {
    expect(body).toMatch(/if \(!res\.ok\)\s*\{\s*throw new ApiError\(res\.status/);
  });

  it("complete still sends only {code} — the password is asked for once", () => {
    const completeBody = src.slice(end);
    expect(completeBody).toContain("body: JSON.stringify({ code })");
    expect(completeBody.slice(0, completeBody.indexOf("\n}\n"))).not.toMatch(/password/);
  });
});

describe("AccountMFAEnrollForm — the password phase", () => {
  const src = source("app/account/settings/account-mfa-enroll-form.tsx");

  it("has a password phase ahead of display", () => {
    expect(src).toMatch(/type Phase =[^;]*"password"/);
    expect(src).toMatch(/useState<Phase>\(\s*"password"\s*\)/);
  });

  it("does not initiate on mount: no useEffect calls accountMfaSetupInitiate", () => {
    const effectIdx = src.indexOf("useEffect(");
    if (effectIdx >= 0) {
      const effect = src.slice(effectIdx, effectIdx + 600);
      expect(effect).not.toMatch(/accountMfaSetupInitiate\(/);
    }
  });

  it("initiates with the password the operator typed, from a submit handler", () => {
    expect(src).toMatch(/accountMfaSetupInitiate\(\s*data\.password\s*\)/);
  });

  it("refuses an empty password client-side (zod min(1)); the server stays the authority", () => {
    expect(src).toMatch(/password:\s*z\s*\.string\(\)\s*\.min\(1,/);
  });

  it("reuses the disable form's field shape: Current password, name/type password, current-password autocomplete", () => {
    expect(src).toMatch(/label="Current password"/);
    expect(src).toMatch(/type="password"/);
    expect(src).toMatch(/autoComplete="current-password"/);
    expect(src).toMatch(/register\("password"\)/);
  });

  it("renders ONE cause-neutral message for the server's 401 and one for a 503", () => {
    // The server collapses absent, empty and wrong into 401 invalid_proof
    // and the step-up lockout into the same 401; the client cannot tell
    // them apart and must not claim to.
    expect(src).toMatch(/err\.status === 503/);
    expect(src).toMatch(/Could not verify your password\. Try again\./);
    expect(src).toMatch(/temporarily unavailable/);
    expect(src).not.toMatch(/wrong password|incorrect password|password is incorrect|locked out/i);
  });

  it("keeps the already_enrolled phase on 409", () => {
    expect(src).toMatch(/AccountMFAAlreadyEnrolledError/);
    expect(src).toMatch(/setPhase\("already_enrolled"\)/);
  });

  it("clears the typed password from form state once the secret is issued", () => {
    // The password has done its work when the secret arrives; the form
    // must not keep it in state alongside the secret.
    expect(src).toMatch(/resetPasswordForm\(\)/);
  });

  it("never persists or logs the password", () => {
    expect(src).not.toMatch(/localStorage\s*\.\s*(set|get|remove)Item/);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(set|get|remove)Item/);
    expect(src).not.toMatch(/console\s*\.\s*(log|warn|error|debug|info)\s*\(/);
  });
});
