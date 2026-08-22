/**
 * E2E tests for /dashboard — the regular org_user surface.
 *
 * The guard in dashboard/layout.tsx:
 *   - Unauthenticated → redirect to /login?reason=session_expired
 *   - org_admin       → redirect to /org-admin
 *   - site_admin      → redirect to /site-admin
 *   - Authenticated org_user → render shell + children
 *
 * THE-ALL-GREEN-SUITE (2026-08-08): the authenticated org_user happy path — the
 * third credential type, and the case this file stubbed for lack of a test-user
 * helper — is now implemented. The released-appliance harness mints a
 * TOTP-enrolled org_user in the fixture org (required MFA policy), so this
 * exercises a full password+TOTP login for a NON-admin identity and confirms
 * the org_user is FENCED out of /org-admin and /site-admin.
 */

import { expect, test } from "@playwright/test";
import { loginAsOrgUser, skipOrgUserTests } from "./helpers/login";

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

test.describe("/dashboard — authenticated org_user (password + TOTP)", () => {
  test.skip(
    skipOrgUserTests,
    "org_user credentials (email + password + TOTP) not available — run with " +
      "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true, or set IDENTUUM_TEST_ORG_USER_* env vars"
  );

  // The login helper waits up to ~31s for a safe TOTP window between accounts.
  test.beforeAll(() => test.setTimeout(120_000));
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsOrgUser(page);
  });

  test("org_user login with TOTP lands on /dashboard and renders the member shell", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    expect(page.url()).toContain("/dashboard");
    // A logged-in org_user must NOT be bounced to /login or an admin area.
    expect(page.url()).not.toContain("/login");
    expect(page.url()).not.toContain("/org-admin");
    expect(page.url()).not.toContain("/site-admin");
    // The member dashboard shell renders (role chip + Overview).
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    // Positive proof this is the org_user surface, not an admin one that leaked
    // through the guard: the body carries the org_user role, not the admin roles.
    const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    expect(body).toContain("org_user");
    expect(body).not.toContain("site_admin");
  });

  test("org_user is fenced OUT of /org-admin and /site-admin [ROLE-ORGUSER-FENCE-1]", async ({
    page,
  }) => {
    for (const admin of ["/org-admin", "/site-admin"]) {
      await page.goto(admin);
      // The guard must redirect an org_user away from every admin area — either
      // back to their own /dashboard or to /login — never render the admin shell.
      await page
        .waitForURL((u) => !u.pathname.startsWith(admin), { timeout: 15000 })
        .catch(() => {});
      expect(page.url(), `org_user must not remain on ${admin}`).not.toContain(admin);
    }
  });
});
