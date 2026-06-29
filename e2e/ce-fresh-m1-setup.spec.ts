/**
 * ce-fresh-m1-setup.spec.ts — fresh first-run CE setup wizard
 * end-to-end validation against the isolated identuum-idp-ce-m1-fresh
 * compose project (host ports 7125 IDP + 7126 UI).
 *
 * Landed by agent-a-20260627-idp-ce-fresh-setup-m1-totp-e2e-validation
 * to prove D-IDP-INSTALL-26 — first-run setup MUST enroll site_admin
 * TOTP before setup_complete — against a TRULY fresh CE stack, not
 * against the standing customer-smoke project's existing
 * setup_complete state.
 *
 * Validation shape:
 *
 *   T1 negative — POST /api/setup/complete WITHOUT MFA fields
 *                 returns 400 with body { "error": "mfa_enrollment_required" }.
 *                 Proves the server-side gate is in force on a fresh
 *                 install (the application-layer gate at
 *                 internal/setup/service.go::Complete).
 *
 *   T2 positive — drive the /setup wizard browser flow end-to-end:
 *                 (a) read the setup token from the IDP container's
 *                     stdout via `docker logs` (test runner process
 *                     memory only — never written to disk, never
 *                     asserted by value, never echoed to the
 *                     reporter, redacted in any test output);
 *                 (b) verify the setup token;
 *                 (c) fill the admin email + password;
 *                 (d) click "Continue to MFA enrollment";
 *                 (e) wait for the MFA panel; extract the secret from
 *                     setup-mfa-secret test-id into Playwright memory
 *                     (NEVER logged, NEVER snapshotted);
 *                 (f) compute the RFC 6238 code via the existing
 *                     e2e/helpers/totp.ts::generateTOTP helper;
 *                 (g) fill the 6-digit code; click "Verify and finish";
 *                 (h) assert the success panel renders with the
 *                     recovery codes test-id present (structural
 *                     assertion only — codes are NEVER asserted by
 *                     value, NEVER logged, NEVER snapshotted);
 *                 (i) probe GET /api/setup/status from the test
 *                     runner — assert state === "setup_complete".
 *
 * SAFETY:
 *   - The setup token is read from `docker logs identuum-idp-ce-m1-fresh`
 *     via Node's child_process inside the test runner. It is held only
 *     in a local variable, used to fill the wizard's setup-code input,
 *     and discarded. It NEVER appears in test output, snapshots,
 *     screenshots, or assertion messages.
 *   - The TOTP secret rendered by the wizard's MFA panel is extracted
 *     via `.textContent()` and held in a local variable for the
 *     duration of the generateTOTP() call. It NEVER appears in test
 *     output, snapshots, screenshots, or assertion messages.
 *   - Recovery codes are observed structurally (the
 *     setup-recovery-codes <ul> is visible and contains > 0 children)
 *     but never read by value.
 *   - Cookies, session ids, CSRF tokens, and any other secret-bearing
 *     surfaces are never read by this spec.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { generateTOTP } from "./helpers/totp";

const IDP_BASE = process.env.IDP_BASE_URL ?? "http://localhost:7125";
const UI_BASE = process.env.IDENTUUM_E2E_BASE_URL ?? "http://localhost:7126";
const IDP_CONTAINER_NAME =
  process.env.IDENTUUM_E2E_M1_FRESH_IDP_CONTAINER ?? "identuum-idp-ce-m1-fresh";
const ADMIN_EMAIL = "admin@example.test";
const ADMIN_PASSWORD = "fresh-m1-validation-password-1234";

/**
 * Reads the setup token from the IDP container's stdout.
 *
 * The token only appears in the boot banner while the DB is at
 * setup_required; once setup completes, the line stays in the log
 * stream but the token it carries is no longer valid (the hash is
 * cleared and the file is deleted). Test-runner memory only — the
 * returned string is NEVER logged or snapshotted.
 */
function readSetupTokenFromContainer(): string {
  const raw = execSync(`docker logs ${IDP_CONTAINER_NAME} 2>&1`, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const match = raw.match(
    /setup code \(also stored at \/app\/data\/setup-token\.txt\): ([A-Z0-9]+)/
  );
  if (!match || !match[1]) {
    throw new Error(
      "Could not extract setup token from IDP container logs. Has the wizard already completed on this stack?"
    );
  }
  return match[1];
}

test.describe("D-IDP-INSTALL-26 fresh M1 setup — backend gate enforcement", () => {
  test("T1 — POST /api/setup/complete refuses without MFA fields", async ({ request }) => {
    const setupToken = readSetupTokenFromContainer();
    const res = await request.post(`${IDP_BASE}/api/setup/complete`, {
      data: {
        setup_token: setupToken,
        create_tenant_org: false,
        organization_name: "",
        organization_domain: "",
        admin_email: ADMIN_EMAIL,
        admin_password: ADMIN_PASSWORD,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("mfa_enrollment_required");
  });
});

// T2 is gated on the operator having uploaded a valid CE license to
// the isolated fresh-M1 stack BEFORE running this spec. The setup
// wizard refuses to enable the admin email / password fields on a CE
// distribution until `/api/setup/license` reports `license_valid`
// (this is the existing CE customer-smoke license-step contract; see
// internal/runtime/license_state.go + src/app/setup/license-step.tsx).
// Operators who want browser-driven proof of the full
// initiate → verify → complete chain MUST set the env var
// `IDENTUUM_E2E_M1_FRESH_LICENSE_READY=1` after uploading a smoke
// license to the fresh stack. Otherwise T2 skips with the message
// below. The application-layer D-IDP-INSTALL-26 gate is fully
// validated by:
//   * T1 above — server-side mfa_enrollment_required without MFA
//     fields against the live fresh stack;
//   * internal/setup/mfasession_test.go (Go unit suite — 9 tests in
//     the paired implementation slice) — covers the positive path
//     (Initiate → Verify → Complete → MFA enrolled + recovery codes
//     surfaced) WITHOUT requiring license setup;
//   * internal/setup/service_test.go (Go unit suite — 5 existing
//     Complete tests now thread real verified MFA sessions).
test.describe
  .serial("D-IDP-INSTALL-26 fresh M1 setup — wizard happy path", () => {
    test("T2 — wizard drives setup_required → TOTP enrollment → setup_complete", async ({
      page,
    }) => {
      const licensePath = process.env.IDENTUUM_CE_SMOKE_LICENSE_PATH ?? "";
      if (process.env.IDENTUUM_E2E_M1_FRESH_LICENSE_READY !== "1" || !licensePath) {
        test.skip(
          true,
          "T2 requires (a) IDENTUUM_E2E_M1_FRESH_LICENSE_READY=1 AND (b) IDENTUUM_CE_SMOKE_LICENSE_PATH pointing at a valid CE smoke envelope. See identuum-idp-ce/Makefile::m1-fresh-license-check and identuum-ui/Makefile::verify-ui-ce-fresh-m1-setup-licensed."
        );
      }

      // Read the license envelope in test-runner memory. The envelope
      // is sensitive bootstrap material: held in a local variable for
      // the duration of the wizard's license-step fill, NEVER written
      // back to disk by this spec, NEVER logged, NEVER asserted by
      // value, NEVER echoed to the reporter.
      let licenseEnvelope: string;
      try {
        licenseEnvelope = readFileSync(licensePath, "utf8");
      } catch {
        throw new Error(
          "Could not read CE smoke license envelope at the supplied path. Path is intentionally not echoed."
        );
      }

      // Read the setup token in test-runner memory. NEVER logged.
      const setupToken = readSetupTokenFromContainer();

      await page.goto(`${UI_BASE}/setup`);
      await page.waitForLoadState("networkidle");

      // Wizard's first form: verify the setup code.
      await page.locator('[data-testid="setup-code-input"]').fill(setupToken);
      await page.locator('[data-testid="setup-code-verify"]').click();
      await expect(page.locator('[data-testid="setup-code-ok"]')).toBeVisible({
        timeout: 10_000,
      });

      // CE distribution: drive the license-step before the admin form
      // becomes enabled. Paste the envelope into the textarea and
      // click upload. After IDP returns license_valid the wizard
      // unmounts the license-step entirely (showLicenseStep becomes
      // false), so the canonical "license accepted" signal in this
      // spec is "the admin email input has become enabled" rather
      // than the transient setup-license-ok banner.
      await expect(page.locator('[data-testid="setup-license-step"]')).toBeVisible();
      await page.locator('[data-testid="setup-license-envelope"]').fill(licenseEnvelope);
      await page.locator('[data-testid="setup-license-upload"]').click();
      await expect(page.locator('[data-testid="setup-admin-email"]')).toBeEnabled({
        timeout: 15_000,
      });

      // Wizard's second form: admin email + password + confirm.
      await page.locator('[data-testid="setup-admin-email"]').fill(ADMIN_EMAIL);
      await page.locator('[data-testid="setup-admin-password"]').fill(ADMIN_PASSWORD);
      await page.locator('[data-testid="setup-admin-password-confirm"]').fill(ADMIN_PASSWORD);

      // Click "Continue to MFA enrollment" — triggers initiateSetupMFA.
      await page.locator('[data-testid="setup-submit"]').click();

      // Wait for the MFA panel to render. The otpauth URL + secret +
      // code input live exclusively here.
      await expect(page.locator('[data-testid="setup-mfa-pending"]')).toBeVisible({
        timeout: 10_000,
      });

      // Extract the secret from the MFA panel. Held in this local
      // variable only; never logged, never snapshotted, never asserted
      // by value.
      const secretText = await page.locator('[data-testid="setup-mfa-secret"]').textContent();
      if (!secretText || secretText.trim().length === 0) {
        throw new Error("MFA panel rendered without a secret");
      }
      const secret = secretText.trim();

      // Confirm the otpauth URL test-id renders without reading its
      // value (structural-only assertion).
      await expect(page.locator('[data-testid="setup-mfa-otpauth"]')).toBeVisible();

      // Compute the 6-digit code via the existing RFC 6238 helper.
      // Computed in test-runner memory only.
      const code = generateTOTP(secret);

      // Fill the code and click verify.
      await page.locator('[data-testid="setup-mfa-code"]').fill(code);
      await page.locator('[data-testid="setup-mfa-verify"]').click();

      // Wait for the success panel.
      await expect(page.locator('[data-testid="setup-submit-ok"]')).toBeVisible({
        timeout: 15_000,
      });

      // Recovery codes panel is visible and contains > 0 codes. Codes
      // are NEVER read by value — only the structural shape is
      // asserted.
      const recoveryList = page.locator('[data-testid="setup-recovery-codes"]');
      await expect(recoveryList).toBeVisible();
      const recoveryItemCount = await recoveryList.locator("li").count();
      expect(recoveryItemCount).toBeGreaterThan(0);

      // Probe /api/setup/status from the test runner and assert the
      // backend reports setup_complete. This is the end-to-end proof
      // that the D-IDP-INSTALL-26 gate fired and the wizard cleared it.
      const statusRes = await page.request.get(`${IDP_BASE}/api/setup/status`);
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as { state?: string };
      expect(statusBody.state).toBe("setup_complete");
    });
  });
