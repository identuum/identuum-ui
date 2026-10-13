import { expect, type Page, test } from "@playwright/test";

// UI-0913-B (D3, owner Q5 a): the Applications tab of /account/settings and
// the Overview's Applications card, over a fake boundary that answers the
// identuum-idp-oss v0.9.13 contract (GET and DELETE /api/v1/me/consents).
// The lifetime is 900 s here, so "15 minutes" in the question proves it is
// read from the answer and not written into the page.

const USER = {
  id: "01990000-0000-7000-8000-000000000021",
  email: "member@capture.test",
  name: "Member Fixture",
  role: "org_user",
  organization_id: "01990000-0000-7000-8000-000000000001",
  organization_name: "Capture",
  domain: "capture.test",
  active: true,
  mfa_enabled: true,
  email_verified: true,
};

const APPS = [
  {
    client_id: "app-1",
    name: "Example App",
    scopes: ["openid", "email", "offline_access", "custom:read"],
    first_granted_at: "2026-10-01T10:00:00Z",
    last_granted_at: "2026-10-05T10:00:00Z",
  },
  {
    client_id: "app-2",
    name: "Second App",
    scopes: ["profile"],
    first_granted_at: "2026-10-02T10:00:00Z",
    last_granted_at: "2026-10-02T10:00:00Z",
  },
];

interface Fake {
  /** The list answer: a status, or the apps. "ce" answers like a binary without the route. */
  list?: "ce" | 503 | typeof APPS;
  /** The DELETE answer. */
  remove?: 204 | 404 | 503;
  deletes: { path: string; body: string | null }[];
}

async function fakeMember(page: Page, fake: Fake): Promise<void> {
  await page.route("**/bff/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.slice(4);
    if (path === "/api/v1/validate") {
      return route.fulfill({ json: { success: true, role: "org_user", user: USER } });
    }
    if (path === "/api/v1/profile") return route.fulfill({ json: USER });
    if (path === "/api/v1/me/mfa/status") {
      return route.fulfill({ json: { mfa_enabled: true, recovery_codes_remaining_count: 5 } });
    }
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: [] } });
    if (path === "/api/v1/me/consents" && req.method() === "GET") {
      const list = fake.list ?? APPS;
      if (list === "ce") return route.fulfill({ status: 404, body: "404 page not found" });
      if (list === 503) {
        return route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
      }
      return route.fulfill({ json: { consents: list, access_token_lifetime_seconds: 900 } });
    }
    if (path.startsWith("/api/v1/me/consents/") && req.method() === "DELETE") {
      fake.deletes.push({ path, body: req.postData() });
      const status = fake.remove ?? 204;
      if (status === 204) return route.fulfill({ status: 204, body: "" });
      if (status === 404) return route.fulfill({ status: 404, json: { error: "not_found" } });
      return route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
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

function row(page: Page, name: string) {
  return page.locator("main li").filter({ hasText: name });
}

test("Applications tab: rows, the question with the lifetime, removal", async ({ page }) => {
  const fake: Fake = { deletes: [] };
  await fakeMember(page, fake);
  await page.goto("/account/settings?tab=applications");
  await expect(page.locator("main li")).toHaveCount(2);
  const app = row(page, "Example App");
  await expect(app).toContainText(
    "Can see: who you are, your email address, stay signed in, custom:read"
  );
  await expect(app).toContainText("Allowed on");
  await expect(page.locator("aside nav [aria-current='page']")).toHaveText("Applications");

  const button = app.getByRole("button", { name: "Remove access" });
  const box = await button.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await button.click();
  const question = app.getByText(
    "Example App will have to ask you again next time. It may keep working for up to 15 minutes."
  );
  await expect(question).toBeFocused();
  // Cancel closes the question; nothing is removed.
  await app.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  expect(fake.deletes).toHaveLength(0);

  await app.getByRole("button", { name: "Remove access" }).click();
  await app.getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByRole("status")).toHaveText("Access removed for Example App.");
  await expect(page.getByText("Can see: who you are")).toHaveCount(0);
  await expect(row(page, "Second App")).toContainText("Can see: your name");
  // Only the client_id travels, in the path; no user id, no body.
  expect(fake.deletes).toEqual([{ path: "/api/v1/me/consents/app-1", body: null }]);
});

test("Applications tab: keyboard opens and answers the question", async ({ page }) => {
  const fake: Fake = { deletes: [] };
  await fakeMember(page, fake);
  await page.goto("/account/settings?tab=applications");
  const button = row(page, "Second App").getByRole("button", { name: "Remove access" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(row(page, "Second App").getByText(/will have to ask you again/)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row(page, "Second App").getByRole("button", { name: "Remove access" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Access removed for Second App.");
  expect(fake.deletes.map((d) => d.path)).toEqual(["/api/v1/me/consents/app-2"]);
});

test("Applications tab: 404 not_found removes the row and says why", async ({ page }) => {
  await fakeMember(page, { remove: 404, deletes: [] });
  await page.goto("/account/settings?tab=applications");
  const app = row(page, "Example App");
  await app.getByRole("button", { name: "Remove access" }).click();
  await app.getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByRole("status")).toHaveText("This app no longer has access.");
  await expect(page.getByText("Can see: who you are")).toHaveCount(0);
});

test("Applications tab: a failed removal shows on the row and keeps it", async ({ page }) => {
  await fakeMember(page, { remove: 503, deletes: [] });
  await page.goto("/account/settings?tab=applications");
  const app = row(page, "Example App");
  await app.getByRole("button", { name: "Remove access" }).click();
  await app.getByRole("button", { name: "Remove access" }).click();
  await expect(app).toContainText("Access could not be removed. Try again.");
  await expect(app).toContainText("Can see: who you are");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("Applications tab: list error, CE and no applications", async ({ page }) => {
  const fake: Fake = { list: 503, deletes: [] };
  await fakeMember(page, fake);
  await page.goto("/account/settings?tab=applications");
  await expect(page.getByText("Your applications could not be loaded. Try again.")).toBeVisible();

  fake.list = "ce";
  await page.goto("/account/settings?tab=applications");
  await expect(page.getByText("Not available on this server.")).toBeVisible();
  await expect(page.getByText(/could not be loaded/)).toHaveCount(0);

  fake.list = [];
  await page.goto("/account/settings?tab=applications");
  await expect(page.getByText("You have not allowed any applications yet.")).toBeVisible();
});

test("Overview: the Applications card counts and links to the tab", async ({ page }) => {
  const fake: Fake = { deletes: [] };
  await fakeMember(page, fake);
  await page.goto("/dashboard");
  const card = page
    .locator("main a[href='/account/settings?tab=applications']")
    .filter({ has: page.getByRole("heading", { name: "Applications", exact: true }) });
  await expect(card).toContainText("You have allowed 2 applications.");
  await expect(card.getByText("Review", { exact: true })).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account\/settings\?tab=applications$/);

  fake.list = [];
  await page.goto("/dashboard");
  await expect(card).toContainText("You have not allowed any applications yet.");
  fake.list = "ce";
  await page.goto("/dashboard");
  await expect(card).toContainText("Not available on this server.");
});

test("Applications tab: rows stack and add no sideways scroll at 390 and 320 px", async ({
  page,
}) => {
  await fakeMember(page, { deletes: [] });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/account/settings?tab=applications");
    const app = row(page, "Example App");
    const name = await app.getByText("Example App", { exact: true }).boundingBox();
    const button = await app.getByRole("button", { name: "Remove access" }).boundingBox();
    expect(name && button && button.y >= name.y + name.height, `stacked at ${width}`).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `sideways scroll at ${width} px`).toBe(0);
  }
});
