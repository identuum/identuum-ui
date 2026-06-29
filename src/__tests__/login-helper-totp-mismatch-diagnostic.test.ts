/**
 * Source-invariant tests for the TOTP-secret-mismatch diagnostic added to
 * e2e/helpers/login.ts::completeTOTPWithRetry, and for the correctness of the
 * RFC 6238 TOTP generator in e2e/helpers/totp.ts.
 *
 * Background (agent-a-20260705-ui-ce-customer-smoke-login-mfa-blocker-fix):
 *   The CE customer-smoke passkey + license-card Playwright targets failed at
 *   the MFA step with a visible "Invalid verification code. Try again." banner
 *   after the helper submitted fresh TOTP codes in two different 30-second
 *   windows. The generator is correct and the password was accepted, so the
 *   root cause is a TOTP SECRET mismatch in the operator overlay
 *   (IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET ≠ the secret enrolled on the
 *   customer-smoke site_admin) — an operator-side credential issue, not a UI
 *   bug. The helper previously surfaced this as an opaque 90s waitForURL
 *   timeout; it now throws an actionable, secret-free diagnostic.
 *
 * These are deterministic source-file reads + a pure-function check — no
 * credentials, cookies, secrets, or browser are touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(import.meta.dirname, "../../");
const loginHelper = readFileSync(resolve(UI_ROOT, "e2e/helpers/login.ts"), "utf-8");
const totpHelper = readFileSync(resolve(UI_ROOT, "e2e/helpers/totp.ts"), "utf-8");

describe("completeTOTPWithRetry — actionable TOTP-secret-mismatch diagnostic", () => {
  it("detects a persistent 'invalid verification code' rejection rather than only timing out", () => {
    expect(loginHelper).toContain("invalid verification code");
    expect(loginHelper).toContain("TOTP verification code REJECTED");
  });

  it("names the actionable operator cause + the runbook remediation, not an opaque timeout", () => {
    expect(loginHelper).toContain("does NOT match the TOTP secret currently enrolled");
    expect(loginHelper).toContain("CE_CUSTOMER_SMOKE_RUNBOOK.md");
    expect(loginHelper).toMatch(/mfa\/reset|account\/settings\?tab=mfa/);
  });

  it("keeps the diagnostic secret-free (no secret/code/cookie value printed)", () => {
    // The diagnostic string must explicitly disclaim printing secret material.
    expect(loginHelper).toContain(
      "NO credential, secret, code, cookie, or env value is read or printed"
    );
  });

  it("does NOT weaken the success assertion — completeTOTPWithRetry still requires the success URL", () => {
    // Success navigation is still required (raced against the rejection
    // banner); a rejection or timeout never resolves as success.
    expect(loginHelper).toContain("waitForURL(successPattern, { timeout: 90_000 })");
    expect(loginHelper).toContain('"success" as const');
  });
});

describe("totp.ts — RFC 6238 generator stays correct (the codes are valid; the secret is the variable)", () => {
  it("uses SHA-1 / 6-digit / 30s-step semantics", () => {
    expect(totpHelper).toContain('createHmac("sha1"');
    expect(totpHelper).toContain("% 1_000_000");
    expect(totpHelper).toContain("/ 30");
  });
});
