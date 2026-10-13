import { expect, type Page, test } from "@playwright/test";

// UI-0912-AB-FIX F7 (judge ruling): only the signed-out banner shows once —
// its reason leaves the address bar, a reload does not repeat it, and a
// sign-in attempt hides it. "Sign-out could not be confirmed" (with Retry
// sign-out) and "signed out on this device only" stay, address and all, until
// they are resolved. UI-only: the boundary is a fixture that knows no one.
async function noOneBoundary(page: Page) {
  await page.route("**/bff/**", (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    if (path === "/api/v1/validate") return route.fulfill({ json: { authenticated: false } });
    if (path === "/api/v1/auth/organization-lookup") {
      return route.fulfill({ json: { error: "organization_not_found" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/v1/component", (route) =>
    route.fulfill({
      json: {
        component: "identuum-idp",
        product: "identuum-idp-oss",
        status: "ok",
        capability_map_schema_version: "idp-capabilities.v1",
        capabilities: {},
        license: { status: "valid", license_type: "oss", tier: "starter" },
      },
    })
  );
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({ json: { state: "setup_complete" } })
  );
}

async function attemptSignIn(page: Page) {
  await page.getByLabel("Email or domain").fill("someone@capture.test");
  await page.getByRole("button", { name: "Continue" }).click();
}

test("signed out: the banner shows once", async ({ page }) => {
  await noOneBoundary(page);
  await page.goto("/login?reason=signed_out");
  const banner = page.getByTestId("login-reason");
  await expect(banner).toHaveText("You have been signed out.");
  await expect(page).toHaveURL(/\/login$/);
  await attemptSignIn(page);
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("login-reason")).toHaveCount(0);
});

for (const [reason, line] of [
  ["sign_out_unconfirmed", "Sign-out could not be confirmed. Your session may still be active."],
  [
    "signed_out_locally",
    "You were signed out on this device only: the identity provider could not be reached to end the session.",
  ],
] as const) {
  test(`${reason}: the banner stays until it is resolved`, async ({ page }) => {
    await noOneBoundary(page);
    await page.goto(`/login?reason=${reason}`);
    const banner = page.getByTestId("login-reason");
    await expect(banner).toContainText(line);
    await expect(page).toHaveURL(new RegExp(`reason=${reason}$`));
    if (reason === "sign_out_unconfirmed") {
      await expect(banner.getByRole("button", { name: "Retry sign-out" })).toBeVisible();
    }
    await attemptSignIn(page);
    await expect(banner).toContainText(line);
    await page.reload();
    await expect(page.getByTestId("login-reason")).toContainText(line);
  });
}

// UI-0913-A-REST (UI-0913-A-EARLY-FIX-REVIEW N2): a name every object
// inherits is not a reason. The page shows no banner and signs in as usual.
for (const reason of ["constructor", "__proto__"] as const) {
  test(`${reason}: no banner, the sign-in form works`, async ({ page }) => {
    await noOneBoundary(page);
    await page.goto(`/login?reason=${reason}`);
    await expect(page.getByLabel("Email or domain")).toBeVisible();
    await expect(page.getByTestId("login-reason")).toHaveCount(0);
    await attemptSignIn(page);
    await expect(page.getByTestId("login-reason")).toHaveCount(0);
  });
}
