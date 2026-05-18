/**
 * E2E tests for the public /claim page.
 *
 * These tests exercise the safe states that do not require a valid claim token.
 * The UI must be running at http://localhost:7114.
 *
 * Missing-token test: no backend call is made (SSR returns early before any fetch),
 * so it passes even without the IdP running.
 *
 * Invalid-token test: validateClaimToken() catches network errors and returns
 * { valid: false }, so the "Link invalid or expired" state renders regardless of
 * whether the IdP is reachable. When the IdP is up, it returns HTTP 200
 * { valid: false } for any unrecognised token (oracle-hardened endpoint).
 *
 * Happy path (valid token → setup form → consume → success) is NOT implemented.
 * Reason: it requires site_admin credentials to authenticate, create a test
 * organization via the site-admin API, generate a claim token for that org, then
 * navigate to the claim page, complete the setup form, and assert the success state
 * — too much orchestration for the current test scope. Gate it on
 * IDENTUUM_TEST_PASSWORD + IDENTUUM_TEST_TOTP_SECRET when adding in future.
 */

import { expect, test } from "@playwright/test";

test.describe("/claim page — safe states", () => {
  test("renders missing-link state when no token is in the URL", async ({ page }) => {
    await page.goto("/claim");

    await expect(page.getByRole("heading", { name: "No setup link provided" })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

    // Must not show the setup form or any success/error state for valid tokens.
    await expect(page.getByRole("heading", { name: "Link invalid or expired" })).not.toBeVisible();
  });

  test("renders invalid-link state for an unrecognised token", async ({ page }) => {
    await page.goto("/claim?token=invalid_e2e_test_token_claim");

    await expect(page.getByRole("heading", { name: "Link invalid or expired" })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

    // Must not show the setup form.
    await expect(page.getByRole("heading", { name: "No setup link provided" })).not.toBeVisible();
  });
});
