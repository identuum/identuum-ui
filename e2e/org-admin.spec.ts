/**
 * E2E tests for the /org-admin route guard.
 *
 * These tests verify the guard behavior without requiring org_admin credentials.
 * The UI must be running at http://localhost:7104 (started automatically by webServer).
 *
 * The guard in org-admin/layout.tsx:
 *   - Unauthenticated → redirect to /login; ?reason=session_expired only for a
 *     credential that was presented and refused (src/lib/session-guard.ts)
 *   - Wrong role      → redirect to roleToPath(role)
 *   - Authenticated org_admin → render shell + children
 *
 * Only the unauthenticated path is tested here since it requires no credentials.
 * The authenticated org_admin happy path requires a real org_admin account and
 * is not implemented until a test-user helper is available.
 */

import { expect, test } from "@playwright/test";
import { addDeadAccessCookie, isPlainLogin } from "./helpers/guard-redirect";

test.describe("/org-admin route guard", () => {
  test("a visitor with no credential is sent to the plain /login (no expiry banner)", async ({
    page,
  }) => {
    await page.goto("/org-admin");

    // No credential at all: the plain sign-in page (UI-0912-A, UI019).
    await page.waitForURL(/\/login/);
    expect(isPlainLogin(page.url())).toBe(true);

    // Should land on the login page, not render any admin shell content.
    await expect(page.getByRole("heading", { name: "Overview" })).not.toBeVisible();
  });

  test("a refused access cookie still redirects to /login?reason=session_expired", async ({
    page,
    baseURL,
  }) => {
    await addDeadAccessCookie(page, baseURL);
    await page.goto("/org-admin");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });

  test("a visitor with no credential at /org-admin/users is sent to the plain /login", async ({
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
    expect(isPlainLogin(page.url())).toBe(true);
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
    expect(isPlainLogin(page.url())).toBe(true);
  });
});
