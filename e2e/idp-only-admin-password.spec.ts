import { expect, test } from "@playwright/test";

// OSS-0913-IDPONLY-ADMIN-FIX (acceptance row V0913-012): under "sign-in
// provider only" (idp_only) a member still goes to the provider, and an
// administrator can still reach the password step, so a broken provider does
// not lock the administrator out. The organization lookup knows the domain
// only, so the email step offers the password choice to every address alike;
// the server decides who may use it.
//
// Mocked backend, as in login.spec.ts: window.fetch is patched before
// hydration (page.route misses some fetches through the dev server's
// keep-alive connections); the provider navigation is a page navigation and
// is answered by page.route. No secrets, tokens or credentials: the UUID is
// a fake placeholder.

const IDP_LOGIN = "/api/v1/auth/idp/0190a000-0000-7000-8000-0000000000aa/login";

const ACME_IDP_ONLY = `
  (function() {
    var _orig = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input ? input.url : '');
      if (url.indexOf('/api/idp/api/v1/auth/organization-lookup') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({
          slug: 'acme', name: 'Acme', auth_policy: 'idp_only',
          identity_providers: [{id: 'p1', type: 'oidc', name: 'Acme SSO', login_url: '${IDP_LOGIN}'}]
        }), {status: 200, headers: {'Content-Type': 'application/json'}}));
      }
      return _orig(input, init);
    };
  })();
`;

test.describe("/login — provider-only organization (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(ACME_IDP_ONLY);
    await page.route("**/api/v1/auth/idp/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider stub</p>" })
    );
  });

  test("a member's Continue still goes to the provider", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or domain").fill("member@acme.example");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.pathname === IDP_LOGIN);
    await expect(page.getByText("provider stub")).toBeVisible();
  });

  test("an administrator reaches the password step", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or domain").fill("admin@acme.example");
    const choice = page.getByRole("button", { name: "Administrator? Sign in with password" });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("the email step is the same for every address", async ({ page }) => {
    await page.goto("/login");
    const choice = page.getByRole("button", { name: "Administrator? Sign in with password" });
    await expect(choice).toBeVisible();
    await page.getByLabel("Email or domain").fill("member@acme.example");
    await expect(choice).toBeVisible();
    await page.getByLabel("Email or domain").fill("admin@acme.example");
    await expect(choice).toBeVisible();
  });
});
