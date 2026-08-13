/**
 * E2E tests for the public /verify-email page.
 *
 * These tests exercise the safe states that do not require a valid verification token.
 * The UI must be running at http://localhost:7104 (started automatically by webServer).
 *
 * Missing-token test: no backend call is made (SSR returns early before any fetch),
 * so it passes even without the IdP running.
 *
 * Invalid-token test: verifyEmailToken() behavior depends on IdP availability:
 *   - IdP running:   returns HTTP 400 → { status: "invalid" } → "Link invalid or expired"
 *   - IdP not running: fetch throws → catch → { status: "error" } → "Something went wrong"
 * Both are safe states; the test asserts that EITHER heading is visible.
 *
 * Resend-form tests: resendVerificationAction() always returns { phase: "sent" } regardless
 * of backend response (oracle-hardened on the server action side too). These tests pass
 * with or without the IdP running.
 *
 * Happy path (valid token → success state) is NOT implemented.
 * Reason: verification tokens are generated during /register (or triggered by an admin).
 * Obtaining a real token in a test requires registering a new user via API or extracting
 * the token from IdP console output (mock-mode only). Add when a test-user-registration
 * helper is in place.
 */

import { expect, test } from "@playwright/test";

test.describe("/verify-email page — safe states", () => {
  test("renders missing-link state when no token is in the URL", async ({ page }) => {
    await page.goto("/verify-email");

    await expect(
      page.getByRole("heading", { name: "No verification link provided" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

    // Must not show success or invalid-token state.
    await expect(page.getByRole("heading", { name: "Email verified" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Link invalid or expired" })).not.toBeVisible();
    // Resend form must not show on the missing-token state.
    await expect(page.getByRole("button", { name: "Send new link" })).not.toBeVisible();
  });

  test("renders a safe error state for an unrecognised token [VERIFY-EMAIL-SAFE-1]", async ({ page }) => {
    await page.goto("/verify-email?token=invalid_e2e_test_token_verify");

    // Either "Link invalid or expired" (IdP running, 400 response) or
    // "Something went wrong" (IdP unreachable, network error caught) is acceptable.
    const invalidHeading = page.getByRole("heading", { name: "Link invalid or expired" });
    const errorHeading = page.getByRole("heading", { name: "Something went wrong" });
    const eitherVisible = (await invalidHeading.isVisible()) || (await errorHeading.isVisible());
    expect(eitherVisible, "expected an error or invalid-token heading to be visible").toBe(true);

    // A sign-in link must always be present regardless of which error state renders.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

    // Must never show the success state.
    await expect(page.getByRole("heading", { name: "Email verified" })).not.toBeVisible();
  });

  test("resend form is visible in the error state", async ({ page }) => {
    await page.goto("/verify-email?token=invalid_e2e_test_token_verify");

    // The resend form appears in both the invalid-token and unexpected-error states.
    await expect(page.getByRole("button", { name: "Send new link" })).toBeVisible();
    await expect(page.getByLabel("Request a new link")).toBeVisible();
  });

  test("resend form shows generic sent message after submission [VERIFY-RESEND-GENERIC-1]", async ({ page }) => {
    await page.goto("/verify-email?token=invalid_e2e_test_token_verify");

    await page.getByLabel("Request a new link").fill("test-resend@example.com");
    await page.getByRole("button", { name: "Send new link" }).click();

    // Always shows the same generic message regardless of whether the IdP is running.
    // The server action is oracle-hardened: always returns { phase: "sent" }.
    await expect(page.getByText(/if that email is eligible/i)).toBeVisible();

    // The form must not show a token, link, or any account-existence signal.
    await expect(page.getByRole("button", { name: "Send new link" })).not.toBeVisible();
  });
});
