/**
 * E2E tests for the /dashboard route guard.
 *
 * These tests verify the guard behavior without requiring org_user credentials.
 * The UI must be running at http://localhost:7114 (started automatically by webServer).
 *
 * The guard in dashboard/layout.tsx:
 *   - Unauthenticated → redirect to /login?reason=session_expired
 *   - org_admin       → redirect to /org-admin
 *   - site_admin      → redirect to /site-admin
 *   - Authenticated org_user → render shell + children
 *
 * Only the unauthenticated path is tested here since it requires no credentials.
 * The authenticated org_user happy path requires a real org_user account and is
 * not implemented until a test-user helper is available.
 */

import { expect, test } from "@playwright/test";

test.describe("/dashboard route guard", () => {
  test("unauthenticated request redirects to /login?reason=session_expired", async ({ page }) => {
    await page.goto("/dashboard");

    // Guard redirects unauthenticated visitors to login with a reason hint.
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {
      // waitForURL may time out if the redirect already resolved in goto().
    });

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");

    // Dashboard shell must not render for unauthenticated visitors.
    await expect(page.getByRole("heading", { name: "Overview" })).not.toBeVisible();
  });
});
