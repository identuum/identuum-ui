/**
 * oss-wizard-ui.spec.ts — THE-OPERATOR-PATH order B.
 *
 * Drives the /setup WIZARD UI on a FRESH published-OSS appliance all the
 * way to a SIGNED-IN site_admin:
 *
 *   1. /setup renders the wizard (appliance is setup_required).
 *   2. Setup code (from env, read off the container by the up-script) is
 *      pasted + verified.
 *   3. OSS form shape: NO create_tenant_org checkbox; organization name
 *      REQUIRED (the backend always creates the first organization);
 *      domain optional. The pinned-login fact
 *      (site_admin@system.local) is displayed read-only at the contact
 *      email field.
 *   4. Submit — the OSS path completes DIRECTLY: no setup-time MFA panel
 *      (the CE-only /api/setup/mfa/* endpoints do not exist on OSS; the
 *      pre-fix wizard died here with a 404).
 *   5. Success screen → Continue to sign in → /login.
 *   6. First login as site_admin@system.local → the login flow's
 *      ENROLLMENT step renders (mfa_enrollment_required), the spec pairs
 *      a TOTP from the displayed secret, verifies, and lands signed in.
 *
 * Runs via `pnpm e2e:oss-wizard-ui` (dedicated disposable stack; see
 * e2e/scripts/run-oss-wizard-ui.sh). In the default suite it skips with a
 * printed condition — the shared appliance completes setup via API in
 * global-setup before any spec runs, so the wizard needs its own fresh
 * stack. Unlike ce-fresh-m1-setup.spec.ts (CE-only, can never run on
 * OSS), this spec runs against OSS today with one command.
 *
 * SECURITY: the setup code, password, and TOTP secret are read from env /
 * page state into locals only to be fed to fill()/TOTP computation —
 * never logged, never asserted verbatim, never echoed.
 */

import { expect, test } from "@playwright/test";
import { unconsumedTOTP, unconsumedTOTPAfterFreshStep } from "./helpers/totp";

const WIZARD_UI_ENABLED = process.env.IDENTUUM_E2E_OSS_WIZARD_UI === "1";
const SETUP_CODE = process.env.IDENTUUM_E2E_WIZARD_SETUP_CODE ?? "";
const IDP_BASE = process.env.OSS_WIZARD_IDP_BASE ?? "";

const ADMIN_CONTACT = "owner@wizard-smoke.test";
const ADMIN_PASSWORD = "Wizard_Smoke_Pw_1!";
const ORG_NAME = "Wizard Smoke Org";
const PINNED_LOGIN = "site_admin@system.local";

test.describe("/setup — OSS wizard UI end-to-end (fresh appliance → signed-in site_admin)", () => {
  test.skip(
    !WIZARD_UI_ENABLED,
    "IDENTUUM_E2E_OSS_WIZARD_UI is not 1 — the wizard needs a FRESH (setup_required) appliance, " +
      "and the default suite's shared appliance completes setup via API in global-setup. " +
      "Run `pnpm e2e:oss-wizard-ui` for the dedicated disposable stack."
  );

  test("wizard: verify code → OSS org+admin form → complete (no setup-time MFA) → first-login TOTP enrollment → signed in [WIZARD-1] [PIN-CHIP-1]", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    expect(SETUP_CODE, "up-script must supply the setup code").not.toBe("");

    // ── 1. wizard renders on the fresh appliance ────────────────────────
    await page.goto("/setup");
    await expect(page.getByTestId("setup-wizard")).toBeVisible();

    // ── 2. setup code verify ────────────────────────────────────────────
    await page.getByTestId("setup-code-input").fill(SETUP_CODE);
    await page.getByTestId("setup-code-verify").click();
    await expect(page.getByTestId("setup-code-ok")).toBeVisible();

    // ── 3. OSS form shape ───────────────────────────────────────────────
    // No CE tenant-org checkbox on OSS…
    await expect(page.getByTestId("setup-create-tenant-org")).toHaveCount(0);
    // …org fields render unconditionally (name required by the backend)…
    await expect(page.getByTestId("setup-org-name")).toBeVisible();
    // …and the pinned-login fact is displayed read-only at the field.
    await expect(page.getByTestId("setup-pinned-login")).toContainText(PINNED_LOGIN);

    await page.getByTestId("setup-org-name").fill(ORG_NAME);
    // Domain left blank deliberately — the backend derives it.
    await page.getByTestId("setup-admin-email").fill(ADMIN_CONTACT);
    await page.getByTestId("setup-admin-password").fill(ADMIN_PASSWORD);
    await page.getByTestId("setup-admin-password-confirm").fill(ADMIN_PASSWORD);

    // The OSS submit label is "Complete setup" (CE reads "Continue to
    // MFA enrollment") — the distribution detection itself, asserted.
    await expect(page.getByTestId("setup-submit")).toHaveText("Complete setup");

    // ── 4. complete directly — no setup-time MFA panel ever appears ─────
    await page.getByTestId("setup-submit").click();
    await expect(page.getByTestId("setup-submit-ok")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("setup-mfa-pending")).toHaveCount(0);
    // The success screen names the pinned sign-in and the first-login
    // enrollment step (OSS copy).
    await expect(page.getByTestId("setup-success-signin-hint")).toContainText(PINNED_LOGIN);
    await expect(page.getByTestId("setup-success-signin-hint")).toContainText(
      "enroll your authenticator app at first sign-in"
    );

    // ── 5. through to /login ────────────────────────────────────────────
    await page.getByTestId("setup-go-to-login").click();
    await page.waitForURL("**/login**");

    // ── 6. first login → enrollment → signed in ─────────────────────────
    await page.getByLabel("Email or domain").fill(PINNED_LOGIN);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The login flow's enrollment step renders (mfa_enrollment_required).
    await expect(page.getByText("Secret key")).toBeVisible({ timeout: 15_000 });
    const secret = (await page.locator("code.select-all").innerText()).trim();
    expect(secret.length).toBeGreaterThan(0);

    await page.getByLabel("Verification code").fill(await unconsumedTOTP(secret, PINNED_LOGIN));
    await page.getByRole("button", { name: /Verify/ }).click();

    // OSS enrollment returns recovery codes — the form shows them once
    // before continuing. Allow one TOTP-window retry if the first code
    // straddled a 30s boundary (the error keeps the code form on screen).
    const savedCodes = page.getByRole("button", { name: /saved my recovery codes/i });
    try {
      await savedCodes.waitFor({ timeout: 10_000 });
    } catch {
      await page
        .getByLabel("Verification code")
        .fill(await unconsumedTOTPAfterFreshStep(secret, PINNED_LOGIN));
      await page.getByRole("button", { name: /Verify/ }).click();
      await savedCodes.waitFor({ timeout: 10_000 });
    }
    await savedCodes.click();

    // Signed-in site_admin: the site-admin shell renders.
    await page.waitForURL("**/site-admin**", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // Backend agrees: setup is complete.
    const status = await page.request.get(`${IDP_BASE}/api/setup/status`);
    expect(status.ok()).toBe(true);
    expect(((await status.json()) as { state?: string }).state).toBe("setup_complete");
  });
});
