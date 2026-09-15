/**
 * THE-SELF-REPLENISHING-CODES — source-invariant pins for the self-service
 * recovery-code regenerate form, action and client on /account/settings.
 *
 * Measured in identuum-idp-ce (read-only): the regenerate at
 * POST /api/v1/me/mfa/recovery-codes/regenerate now demands a current
 * authenticator (TOTP) code as its ONLY proof — the owner's ruling (b): a
 * recovery code must not buy more recovery codes. The server's refusal is
 * deliberately cause-neutral (one 401 invalid_proof for absent, empty,
 * wrong, recovery-code-supplied and locked alike), so the FORM is the only
 * place a user can learn the rule: the copy must say an authenticator
 * code, and must say a recovery code is not accepted here. Nothing pinned
 * the disable's strings when they went stale (THE-STALE-PROOF); these pins
 * hold the regenerate's in the same convention.
 *
 * Invariants under test:
 *   1. RecoveryCodesRegenerateForm has an authenticator-code input, keeps
 *      the typed REGENERATE confirmation, and its copy names the
 *      authenticator code as the proof and says recovery codes are not
 *      accepted.
 *   2. regenerateRecoveryCodesAction requires the code (a submission with
 *      no code is refused client-side, before any request), sends it, has
 *      ONE message for the server's 401 that names the authenticator code
 *      and the recovery-code exclusion, and ONE message for a 503.
 *   3. regenerateOwnMfaRecoveryCodes takes the code and sends it as the
 *      JSON body {code} with the JSON content type.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("RecoveryCodesRegenerateForm — an authenticator code is the proof", () => {
  const src = source("app/account/settings/mfa-self-service-forms.tsx");
  const start = src.indexOf("export function RecoveryCodesRegenerateForm(");
  const end = src.indexOf("export function DisableMfaForm(", start);
  const form = src.slice(start, end);

  it("has an authenticator-code input and keeps the typed REGENERATE confirmation", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(form).toMatch(/name="code"/);
    expect(form).toMatch(/autoComplete="one-time-code"/);
    expect(form).toMatch(/Type REGENERATE to confirm/);
  });

  it("says a current authenticator code is required and a recovery code is not accepted", () => {
    // JSX wraps prose across lines, so words are joined by any whitespace.
    expect(form).toMatch(/Requires\s+a\s+current\s+authenticator\s+code\./);
    expect(form).toMatch(
      /A\s+recovery\s+code\s+cannot\s+be\s+used\s+to\s+generate\s+new\s+recovery\s+codes\./
    );
    expect(form).toMatch(/>\s*Authenticator code\s*</);
    expect(form).not.toMatch(/Authenticator or recovery code/);
  });
});

describe("regenerateRecoveryCodesAction — the code is required and sent", () => {
  const src = source("app/account/settings/mfa-actions.ts");
  const start = src.indexOf("const regenerateSchema");
  const end = src.indexOf("export type DisableMfaState", start);
  const action = src.slice(start, end);

  it("refuses a submission without a code before any request", () => {
    expect(start).toBeGreaterThan(0);
    expect(action).toMatch(/code:\s*z\.string\(\)/);
    expect(action).toMatch(/if \(!parsed\.data\.code\)/);
    expect(action).toMatch(/Enter your authenticator code\./);
  });

  it("calls regenerateOwnMfaRecoveryCodes with the code", () => {
    expect(action).toMatch(/regenerateOwnMfaRecoveryCodes\(\{\s*code:\s*parsed\.data\.code\s*\}\)/);
  });

  it("has one refused-proof message naming the authenticator code and the recovery-code exclusion, and a separate signed-out one", () => {
    // THE-SIX-SMALL-ONES, UI 1 (2026-09-16): this pin used to assert the
    // ABSENCE of the signed-out message, which pinned the defect — every 401
    // read as a refused proof. The two truths a 401 can carry now each have
    // their own branch and message; the refused-proof copy is unchanged.
    expect(action).toMatch(/result\.invalidProof/);
    expect(action).toMatch(
      /Could not verify the code\. Enter a current authenticator code; recovery codes cannot regenerate recovery codes\./
    );
    expect(action).toMatch(/result\.unauthorized/);
    expect(action).toMatch(/Your session has expired\. Sign in again\./);
  });

  it("has one 503 message", () => {
    expect(action).toMatch(/result\.unavailable/);
    expect(action).toMatch(/Recovery-code regeneration is not available from this IDP runtime\./);
  });
});

describe("regenerateOwnMfaRecoveryCodes — the client sends the code", () => {
  const client = source("lib/idp-account-client.ts");
  const start = client.indexOf("export async function regenerateOwnMfaRecoveryCodes(");
  const end = client.indexOf("export async function disableOwnMfa(", start);
  const fn = client.slice(start, end);

  it("takes the code and posts it as the JSON body", () => {
    expect(start).toBeGreaterThan(0);
    expect(fn).toMatch(/regenerateOwnMfaRecoveryCodes\(input: \{\s*code: string;?\s*\}\)/);
    expect(fn).toContain('"Content-Type": "application/json"');
    expect(fn).toContain("body: JSON.stringify({ code: input.code })");
  });
});
