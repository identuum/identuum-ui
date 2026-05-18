/**
 * E2E tests for the /site-admin/settings route guard.
 *
 * The guard in site-admin/layout.tsx redirects unauthenticated visitors to
 * /login?reason=session_expired before rendering any child page or form.
 *
 * Password change has moved to /account/settings (personal account settings).
 * /site-admin/settings now shows only system/infrastructure settings and a link
 * to /account/settings for personal credentials.
 */

import { expect, test } from "@playwright/test";

test.describe("/site-admin/settings route guard", () => {
  test("unauthenticated request redirects to /login?reason=session_expired", async ({ page }) => {
    await page.goto("/site-admin/settings");

    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("reason=session_expired");

    // Must not render any admin shell or password form.
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible();
    await expect(page.getByLabel("Current password")).not.toBeVisible();
  });
});
