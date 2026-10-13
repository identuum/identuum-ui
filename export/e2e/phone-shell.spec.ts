import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import orgAdminAnswers from "../__tests__/fixtures/oss-org-admin-answers.json";
import siteAdminAnswers from "../__tests__/fixtures/oss-site-admin-answers.json";

/**
 * UI-0913-C (D5, RQ-1): the console shells on a phone. Below 768 px the
 * sidebar is hidden and a "Menu" button opens it as a drawer; at 768 px and
 * wider the sidebar is unchanged. On every role's home and Settings page the
 * page never scrolls sideways at 390 and 320 px.
 *
 * Browser proofs over the real export bundle (`pnpm build:export` writes
 * ../../out), served here with its stylesheet, against controlled answers
 * for each role's reads. They are layout and keyboard proofs, not backend
 * proofs.
 */

let server: Server;
let baseURL = "";
const out = path.resolve(__dirname, "../../out");
const TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture.test").pathname;
    const file = pathname.startsWith("/assets/")
      ? path.join(out, pathname)
      : path.join(out, "index.html");
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "text/html");
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
  baseURL = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

type Role = "org_user" | "org_admin" | "site_admin";
type Answers = Record<string, { status?: number; json: unknown }>;

// A long address, so the header has to truncate it at 320 px.
const EMAIL = "a.rather.long.address.for.a.narrow.screen@capture-organization.test";

const ROLES: { role: Role; home: string; settings: string; navLink: string }[] = [
  { role: "org_user", home: "/dashboard", settings: "/account/settings", navLink: "Sessions" },
  { role: "org_admin", home: "/org-admin", settings: "/org-admin/settings", navLink: "Users" },
  {
    role: "site_admin",
    home: "/site-admin",
    settings: "/site-admin/settings",
    navLink: "Organizations",
  },
];

function user(role: Role) {
  return {
    id: "01990000-0000-7000-8000-000000000021",
    email: EMAIL,
    name: "Fixture Person",
    role,
    organization_id: "01990000-0000-7000-8000-000000000001",
    organization_name: "Capture",
    domain: "capture.test",
    active: true,
    mfa_enabled: true,
    email_verified: true,
  };
}

// Each role's reads: the recorded OSS answers for the two admin areas, a
// small member fixture for org_user. Anything else answers 404.
async function fakeBoundary(page: Page, role: Role): Promise<void> {
  const recorded: Answers =
    role === "org_admin"
      ? (orgAdminAnswers.answers as Answers)
      : role === "site_admin"
        ? (siteAdminAnswers.answers as Answers)
        : {
            "GET /api/v1/profile": { json: user(role) },
            "GET /api/v1/me/mfa/status": { json: { mfa_enabled: true } },
            "GET /api/v1/sessions": {
              json: { sessions: [{ id: "s1", created_at: "2026-10-12T10:00:00Z" }] },
            },
          };
  await page.route("**/bff/**", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.slice(4);
    if (p === "/api/v1/validate") {
      await route.fulfill({ json: { success: true, role, user: user(role) } });
      return;
    }
    const answer = recorded[`${request.method()} ${p}`];
    await route.fulfill({ status: answer?.status ?? 404, json: answer?.json ?? {} });
  });
  await page.route("**/api/v1/component", (route) =>
    route.fulfill({
      json: {
        component: "identuum-idp",
        product: "identuum-idp-oss",
        status: "ok",
        capability_map_schema_version: "idp-capabilities.v1",
        capabilities: { oauth_clients: true, api_resources: true, service_accounts: true },
        license: { status: "valid", license_type: "oss", tier: "starter" },
      },
    })
  );
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({ json: { state: "setup_complete" } })
  );
}

async function open(page: Page, target: string): Promise<void> {
  await page.goto(baseURL + target);
  await expect(page).toHaveURL(baseURL + target);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

/** How far the page scrolls sideways: 0 when it fits. */
function sideways(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu", exact: true });
const drawer = (page: Page) => page.locator("#shell-menu");

for (const { role, home, settings } of ROLES) {
  for (const width of [390, 320]) {
    test(`${role} home and Settings do not scroll sideways at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await fakeBoundary(page, role);
      for (const target of [home, settings]) {
        await open(page, target);
        expect(await sideways(page), `${target} scrolls sideways at ${width} px`).toBe(0);
        // The address is cut short in the header, never pushed off the page.
        await expect(page.getByTestId("who")).toHaveText(EMAIL);
        const who = await page.getByTestId("who").boundingBox();
        expect(who && who.x + who.width <= width, `${target}: the address leaves the page`).toBe(
          true
        );
      }
    });
  }
}

for (const { role, home, navLink } of ROLES) {
  test(`${role}: the phone menu opens, traps focus, closes four ways and returns focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await fakeBoundary(page, role);
    await open(page, home);

    const button = menuButton(page);
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-controls", "shell-menu");
    await expect(drawer(page)).toBeHidden();

    // Keyboard only: Enter opens; focus moves into the drawer.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page)).toHaveAttribute("aria-modal", "true");
    expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    const box = await drawer(page).boundingBox();
    expect(box?.width).toBeLessThanOrEqual(Math.min(280, 390 * 0.85));
    // The same menu and Sign out as the sidebar.
    await expect(drawer(page).getByRole("link", { name: navLink, exact: true })).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    // The page behind does not scroll.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    // Focus is trapped: Tab past the last stop comes back to the first, and
    // Shift+Tab from the first goes to the last.
    const stops = await drawer(page).evaluate(
      (d) => d.querySelectorAll("a[href], button:not([disabled])").length
    );
    for (let i = 0; i < stops + 2; i++) {
      await page.keyboard.press("Tab");
      expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < stops + 2; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }

    // 1. Escape closes; focus returns to Menu; the page scrolls again.
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");

    // 2. The "Close menu" button closes.
    await button.click();
    await drawer(page).getByRole("button", { name: "Close menu", exact: true }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(button).toBeFocused();

    // 3. A tap on the dimmed backdrop closes.
    await button.click();
    await page.mouse.click(385, 400);
    await expect(drawer(page)).toBeHidden();
    await expect(button).toBeFocused();

    // 4. A link tap goes to the page and the menu is closed there.
    await button.click();
    await drawer(page).getByRole("link", { name: navLink, exact: true }).click();
    await expect(page).not.toHaveURL(baseURL + home);
    await expect(page.locator("main")).toBeVisible();
    await expect(drawer(page)).toBeHidden();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  });
}

test("at 768 px and wider the sidebar shows and there is no Menu button", async ({ page }) => {
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { role, home, navLink } of ROLES) {
      await page.unrouteAll();
      await fakeBoundary(page, role);
      await open(page, home);
      await expect(menuButton(page)).toBeHidden();
      await expect(page.locator("aside nav")).toBeVisible();
      await expect(page.locator("aside nav").getByRole("link", { name: navLink })).toBeVisible();
      expect(await sideways(page), `${home} at ${width} px`).toBe(0);
    }
  }
});

test("the account menu shows the whole address", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await fakeBoundary(page, "org_user");
  await open(page, "/dashboard");
  await page.getByTestId("account-menu").click();
  const full = page.getByTestId("account-popover").getByTestId("account-email");
  await expect(full).toHaveText(EMAIL);
  // UI-0913-C-REVIEW F2: the address is outside the menu, which holds items only.
  await expect(
    page.getByRole("menu", { name: "Account options" }).getByTestId("account-email")
  ).toHaveCount(0);
  const box = await full.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
});
