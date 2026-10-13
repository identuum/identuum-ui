import { expect, type Locator, type Page, test } from "@playwright/test";
import { login, orgUserAccount } from "./export-login";

// UI-0912-A (C4), owner Q4 b and Q5 a: the member Overview shows link cards
// (Profile, Security, Sessions; Applications since v0.9.13 D3, its own spec
// is applications.spec.ts) and no "Coming soon"; the member menu carries the
// same items and marks the current one. The live test signs in as the run's org_user (e2e-full); the
// fake-boundary tests run wherever the export is served.

const CARDS = [
  { title: "Profile", tab: "profile", link: "Edit profile" },
  { title: "Security", tab: "password", link: "Manage security" },
  { title: "Sessions", tab: "sessions", link: "See devices and sign out" },
  { title: "Applications", tab: "applications", link: "Review" },
] as const;

const NOT_LOADED = "We could not load this right now. Open the page to see it.";

function cards(page: Page): Locator {
  return page.locator("main a[href^='/account/settings?tab=']");
}

function card(page: Page, title: string): Locator {
  return cards(page).filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function menu(page: Page): Locator {
  return page.locator("aside nav");
}

async function checkOverview(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.getByTestId("home")).toHaveText("Overview");
  await expect(cards(page)).toHaveCount(CARDS.length);
  for (const c of CARDS) {
    const el = card(page, c.title);
    await expect(el).toHaveAttribute("href", `/account/settings?tab=${c.tab}`);
    await expect(el.getByText(c.link, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/coming soon/i)).toHaveCount(0);

  // The member menu: Overview is current here.
  const nav = menu(page);
  for (const name of ["Overview", "Profile", "Security", "Sessions", "Applications"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(nav.locator("[aria-current='page']")).toHaveText("Overview");

  // Keyboard: each card is one focus stop and Enter opens its tab.
  for (const c of CARDS) {
    await page.goto("/dashboard");
    await card(page, c.title).focus();
    await expect(card(page, c.title)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/account/settings\\?tab=${c.tab}$`));
  }

  // The menu items open the same tabs, and the open tab's item is current.
  for (const [name, tab] of [
    ["Profile", "profile"],
    ["Security", "password"],
    ["Sessions", "sessions"],
    ["Applications", "applications"],
  ] as const) {
    await menu(page).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/account/settings\\?tab=${tab}$`));
    await expect(menu(page).locator("[aria-current='page']")).toHaveText(name);
  }
}

// RQ-1 (a): the fixed 240 px sidebar already makes the shell scroll sideways
// at phone widths (a known issue, queued apart). What is proven here: the
// cards add no sideways scroll at 390 and 320 px.
async function checkNarrow(page: Page): Promise<void> {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/dashboard");
    await expect(cards(page)).toHaveCount(CARDS.length);
    const added = await cards(page)
      .first()
      .evaluate((first) => {
        const grid = first.parentElement as HTMLElement;
        const main = document.querySelector("main") as HTMLElement;
        const shown = [document.documentElement.scrollWidth, main.scrollWidth];
        grid.style.display = "none";
        const hidden = [document.documentElement.scrollWidth, main.scrollWidth];
        grid.style.display = "";
        return shown.map((v, i) => v - (hidden[i] ?? 0));
      });
    expect(added, `cards add sideways scroll at ${width} px`).toEqual([0, 0]);
  }
}

test("org_user Overview in the binary: the cards, member menu, keyboard", async ({ page }) => {
  const account = orgUserAccount();
  // Inside e2e-full the fixture is required: a skip there would read green
  // having proven nothing.
  test.skip(
    !account && process.env.IDENTUUM_E2E_EXPORT_FIXTURE !== "1",
    "requires the disposable export org_user fixture"
  );
  if (!account) throw new Error("the run's fixture envelope has no org_user block");
  await login(page, account.email, account.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  // Each card shows a fact from its own read, not the failure line.
  for (const c of CARDS) await expect(card(page, c.title)).not.toContainText(NOT_LOADED);
  await checkOverview(page);
  await checkNarrow(page);
});

// ------------------------------------------------------------ fake boundary

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

// Controlled answers for the member's own reads; `failSessions` makes the
// sessions read answer 503 to prove one failed read hides no other card.
async function fakeMember(page: Page, opts: { failSessions?: boolean } = {}): Promise<void> {
  await page.route("**/bff/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let status = 200;
    let json: unknown = {};
    if (path === "/api/v1/validate") {
      json = { success: true, role: "org_user", user: USER };
    } else if (path === "/api/v1/profile") {
      json = USER;
    } else if (path === "/api/v1/me/mfa/status") {
      json = { mfa_enabled: true, recovery_codes_remaining_count: 2 };
    } else if (path === "/api/v1/me/consents") {
      json = { consents: [], access_token_lifetime_seconds: 3600 };
    } else if (path === "/api/v1/sessions") {
      status = opts.failSessions ? 503 : 200;
      json = opts.failSessions
        ? {}
        : {
            sessions: [
              { id: "s1", created_at: "2026-10-12T10:00:00Z", is_current: true },
              { id: "s2", created_at: "2026-10-11T10:00:00Z" },
            ],
          };
    } else {
      status = 404;
    }
    await route.fulfill({ status, json });
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

test("member Overview: the cards with their facts, menu and keyboard", async ({ page }) => {
  await fakeMember(page);
  await page.goto("/dashboard");
  await expect(card(page, "Profile")).toContainText("Name: Member Fixture");
  await expect(card(page, "Security")).toContainText("Two-step sign-in: On");
  await expect(card(page, "Security")).toContainText("Only 2 backup codes left. Make new ones.");
  await expect(card(page, "Sessions")).toContainText("Signed in on 2 devices.");
  await expect(card(page, "Applications")).toContainText(
    "You have not allowed any applications yet."
  );
  await checkOverview(page);
});

test("member Overview: a failed sessions read hides no other card", async ({ page }) => {
  await fakeMember(page, { failSessions: true });
  await page.goto("/dashboard");
  await expect(card(page, "Sessions")).toContainText(NOT_LOADED);
  await expect(card(page, "Sessions")).toHaveAttribute("href", "/account/settings?tab=sessions");
  await expect(card(page, "Profile")).toContainText("Name: Member Fixture");
  await expect(card(page, "Security")).toContainText("Two-step sign-in: On");
});

test("member Overview: cards add no sideways scroll at 390 and 320 px", async ({ page }) => {
  await fakeMember(page);
  await checkNarrow(page);
});
