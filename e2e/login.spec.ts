/**
 * Optional local browser verification for the identuum-ui login flow.
 *
 * This test is skipped unless all three required env vars are set:
 *   IDENTUUM_TEST_EMAIL        - login email (default: site_admin@system.local)
 *   IDENTUUM_TEST_PASSWORD     - login password
 *   IDENTUUM_TEST_TOTP_SECRET  - base32 TOTP seed from identuum-idp-setup output
 *
 * The full Compose stack must be running (IdP at localhost:7113, UI at localhost:7114).
 * The Playwright runner reuses the existing server automatically; see playwright.config.ts.
 *
 * Before first run: pnpm e2e:install
 * Run: IDENTUUM_TEST_PASSWORD=... IDENTUUM_TEST_TOTP_SECRET=... pnpm e2e
 */

import { expect, test } from "@playwright/test";
import { generateTOTP } from "./helpers/totp";

const EMAIL = process.env.IDENTUUM_TEST_EMAIL ?? "site_admin@system.local";
const PASSWORD = process.env.IDENTUUM_TEST_PASSWORD ?? "";
const TOTP_SECRET = process.env.IDENTUUM_TEST_TOTP_SECRET ?? "";

const skip = !PASSWORD || !TOTP_SECRET;

test.describe("identuum-ui login flow", () => {
  test("email step → password step → MFA step → dashboard → logout", async ({ page }) => {
    if (skip) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run");
    }

    // Root redirects to /login when configured.
    await page.goto("/");
    await page.waitForURL(/\/login/);

    // Email step.
    const emailInput = page.getByLabel("Email or domain");
    await emailInput.fill(EMAIL);
    await page.getByRole("button", { name: "Continue" }).click();

    // Password step.
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // MFA step — generate code immediately before submission.
    const codeInput = page.getByLabel("Verification code");
    await expect(codeInput).toBeVisible();
    const code = generateTOTP(TOTP_SECRET);
    await codeInput.fill(code);
    await page.getByRole("button", { name: "Verify" }).click();

    // Post-login: should reach a dashboard or admin page.
    await page.waitForURL(/\/(dashboard|site-admin|org-admin)/);

    // Runtime-config must not expose internal URLs.
    const configRes = await page.request.get("/api/runtime-config");
    const config = await configRes.json();
    expect(config.configured).toBe(true);
    expect(config.idp?.internal_base_url).toBeUndefined();
    expect(config.ag?.internal_base_url).toBeUndefined();

    // /api/status must show IdP healthy (served from server-side, no CORS needed).
    const statusRes = await page.request.get("/api/status");
    const status = await statusRes.json();
    expect(status.idp.enabled).toBe(true);
    expect(status.idp.healthy).toBe(true);

    // Logout via POST (the Sign out button submits a form).
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    // Post-logout: validate endpoint must reject the session.
    const validateRes = await page.request.get("/api/idp/api/v1/validate");
    expect(validateRes.status()).toBe(401);
  });
});
