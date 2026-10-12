/**
 * E2E tests for the /site-admin/settings route guard.
 *
 * The guard in site-admin/layout.tsx redirects unauthenticated visitors to
 * /login before rendering any child page or form; ?reason=session_expired only
 * for a credential that was presented and refused (src/lib/session-guard.ts).
 *
 * Password change has moved to /account/settings (personal account settings).
 * /site-admin/settings now shows only system/infrastructure settings and a link
 * to /account/settings for personal credentials.
 */

import { expect, test } from "@playwright/test";
import { addDeadAccessCookie, isPlainLogin } from "./helpers/guard-redirect";

test.describe("/site-admin/settings route guard", () => {
  test("a visitor with no credential is sent to the plain /login (no expiry banner)", async ({
    page,
  }) => {
    await page.goto("/site-admin/settings");

    await page.waitForURL(/\/login/);
    expect(isPlainLogin(page.url())).toBe(true);

    // Must not render any admin shell or password form.
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible();
    await expect(page.getByLabel("Current password")).not.toBeVisible();
  });

  test("a refused access cookie still redirects to /login?reason=session_expired", async ({
    page,
    baseURL,
  }) => {
    await addDeadAccessCookie(page, baseURL);
    await page.goto("/site-admin/settings");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });
});
