/**
 * E2E tests for the /org-admin route guard.
 *
 * These tests verify the guard behavior without requiring org_admin credentials.
 * The UI must be running at http://localhost:7114 (started automatically by webServer).
 *
 * The guard in org-admin/layout.tsx:
 *   - Unauthenticated → redirect to /login?reason=session_expired
 *   - Wrong role      → redirect to roleToPath(role)
 *   - Authenticated org_admin → render shell + children
 *
 * Only the unauthenticated path is tested here since it requires no credentials.
 * The authenticated org_admin happy path requires a real org_admin account and
 * is not implemented until a test-user helper is available.
 */

import { expect, test } from "@playwright/test";

test.describe("/org-admin route guard", () => {
  test("unauthenticated request redirects to /login?reason=session_expired", async ({ page }) => {
    await page.goto("/org-admin");

    // Guard redirects unauthenticated visitors to login with a reason hint.
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("reason=session_expired");

    // Should land on the login page, not render any admin shell content.
    await expect(page.getByRole("heading", { name: "Overview" })).not.toBeVisible();
  });

  test("unauthenticated /org-admin/users redirects to /login?reason=session_expired", async ({
    page,
  }) => {
    // page.goto() follows server-side redirects and resolves at the final URL.
    // The layout guard at /org-admin covers all child routes including /users.
    await page.goto("/org-admin/users");

    // Redirect may have already resolved inside goto(); use waitForURL with a
    // short poll to handle both in-flight and already-complete redirects.
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {
      // If waitForURL times out, assert below will surface the actual URL.
    });

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });

  test("unauthenticated /org-admin/users/[id] redirects to /login (layout guard fires before detail page)", async ({
    page,
  }) => {
    // The /org-admin layout guard fires before the detail page renders.
    // A well-formed UUID is used to avoid triggering the UUID-validation
    // fallback before the auth guard has a chance to redirect.
    await page.goto("/org-admin/users/00000000-0000-0000-0000-000000000001");

    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });
});
