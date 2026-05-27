/**
 * Optional local browser verification for the identuum-ui login flow.
 *
 * This spec drives the login UI step-by-step (not via the shared
 * loginAsSiteAdmin helper) because the goal is to verify each visible
 * step renders correctly. Credentials are imported from the helper so
 * legacy/canonical env-var resolution lives in exactly one place.
 *
 * Required env vars (canonical names only):
 *   IDENTUUM_TEST_SITE_ADMIN_EMAIL       — default: site_admin@system.local
 *   IDENTUUM_TEST_SITE_ADMIN_PASSWORD
 *   IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET — base32 seed from identuum-idp-setup
 *
 * Legacy IDENTUUM_TEST_EMAIL / _PASSWORD / _TOTP_SECRET are no longer
 * read — operators with stale .env files must rename them.
 *
 * The full Compose stack must be running (IdP at localhost:7113, UI at localhost:7114).
 * The Playwright runner reuses the existing server automatically; see playwright.config.ts.
 *
 * Before first run: pnpm e2e:install
 * Run: pnpm e2e (credentials auto-loaded from .env.playwright.local)
 */

import { expect, test } from "@playwright/test";
import {
  SITE_ADMIN_EMAIL,
  SITE_ADMIN_PASSWORD,
  SITE_ADMIN_TOTP_SECRET,
  SKIP_AUTH_MSG,
  skipAuthTests,
} from "./helpers/login";
import { generateTOTP } from "./helpers/totp";

test.describe("identuum-ui login flow", () => {
  test("email step → password step → MFA step → dashboard → logout", async ({ page }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Root redirects to /login when configured.
    await page.goto("/");
    await page.waitForURL(/\/login/);

    // Email step.
    const emailInput = page.getByLabel("Email or domain");
    await emailInput.fill(SITE_ADMIN_EMAIL);
    await page.getByRole("button", { name: "Continue" }).click();

    // Password step.
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill(SITE_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // MFA step — generate code immediately before submission.
    const codeInput = page.getByLabel("Verification code");
    await expect(codeInput).toBeVisible();
    const code = generateTOTP(SITE_ADMIN_TOTP_SECRET);
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
