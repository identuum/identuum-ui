/**
 * THE-STALE-PROOF — source-invariant pins for the self-service MFA
 * disable form and action on /account/settings.
 *
 * Measured in identuum-idp-ce (read-only): since f89ca88 the disable
 * verifies ONLY through the second factor — mfaService.ValidateCode(code),
 * a TOTP or recovery code; the password field is read off the wire and
 * discarded. A password-only body leaves the proof unverified, records a
 * step-up failure and answers 401 invalid_proof. The ui still offered a
 * "Current password" input, accepted a password-only submission and told
 * the user the password was wrong — walking them into a guaranteed 401
 * that spends their step-up lockout budget. Nothing pinned these strings,
 * which is why they went stale.
 *
 * Invariants under test:
 *   1. DisableMfaForm offers no password input; its copy names the code
 *      proofs only.
 *   2. disableMfaAction requires a code (a submission with no code is
 *      refused client-side, before any request) and never reads a
 *      password field.
 *   3. The action's invalid-proof message names the code proofs only.
 *   4. The wire request stays valid: disableOwnMfa still sends
 *      {code, password: ""} (CE's decoder knows both keys and ignores the
 *      password), and the action calls it with the code alone.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("DisableMfaForm — a code-only proof", () => {
  const src = source("app/account/settings/mfa-self-service-forms.tsx");
  const start = src.indexOf("export function DisableMfaForm(");
  const form = src.slice(start);

  it("offers no password input", () => {
    expect(start).toBeGreaterThan(0);
    expect(form).not.toMatch(/name="password"/);
    expect(form).not.toMatch(/Current password/);
    expect(form).not.toMatch(/autoComplete="current-password"/);
  });

  it("says a current authenticator code or recovery code is required — not a password", () => {
    expect(form).toMatch(/Requires a current authenticator code or recovery code\./);
    expect(form).not.toMatch(/or password/);
  });

  it("keeps the code input and the typed DISABLE confirmation", () => {
    expect(form).toMatch(/name="code"/);
    expect(form).toMatch(/Type DISABLE to confirm/);
  });
});

describe("disableMfaAction — a code is required; the password is gone", () => {
  const src = source("app/account/settings/mfa-actions.ts");
  const start = src.indexOf("const disableSchema");
  const end = src.indexOf("revalidatePath", start);
  const action = src.slice(start, end);

  it("reads no password field", () => {
    expect(start).toBeGreaterThan(0);
    expect(action).not.toMatch(/password/);
  });

  it("refuses a submission without a code before any request", () => {
    expect(action).toMatch(/if \(!parsed\.data\.code\)/);
    expect(action).toMatch(/Enter an authenticator or recovery code\./);
  });

  it("names the code proofs only when the server refuses the proof", () => {
    expect(action).toMatch(
      /Could not verify the code\. Try a current authenticator code or recovery code\./
    );
  });

  it("calls disableOwnMfa with the code alone (the client keeps the wire shape)", () => {
    expect(action).toMatch(/disableOwnMfa\(\{\s*code:\s*parsed\.data\.code\s*\}\)/);
    const client = source("lib/idp-account-client.ts");
    expect(client).toContain(
      'body: JSON.stringify({ code: input.code ?? "", password: input.password ?? "" })'
    );
  });
});
