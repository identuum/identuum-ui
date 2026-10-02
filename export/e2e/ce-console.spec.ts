import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { unconsumedTOTP } from "../../e2e/helpers/totp";

/**
 * CE-UI-5a: the console identuum-idp-ce serves on its own origin (D-019).
 * Every page a site_admin and an org_admin reach from the navigation renders
 * with no browser console error and no answer of 400 or more, and none of
 * the affordances CE does not serve appears: claim links (D-022),
 * self-registration (D-021), service accounts, public clients, API resources
 * and scope templates.
 *
 * Fixture: a CE binary prepared by its operator with a site_admin and one
 * organization's org_admin, both TOTP-enrolled; their credentials and
 * authenticator secrets arrive in the environment and are never printed.
 * The sign-ins go through the API, so the password step's 401 (CE does not
 * honour the step-status opt-in) is no page's console error. Two sign-ins.
 */

const ENABLED = process.env.IDENTUUM_E2E_CE === "1";
const env = (k: string) => process.env[k] ?? "";
const BFF = { "X-Requested-With": "identuum-ui", "Content-Type": "application/json" };

// Text and links CE does not serve; any of them on a page is a failure.
const HIDDEN_TEXT = [
  "Issue claim link",
  "Self-registration",
  "Sign-ups waiting for approval",
  "Service accounts",
  "API resources",
  "Scope templates",
  "Public client",
];
const HIDDEN_HREFS = [
  "/org-admin/service-accounts",
  "/org-admin/api-resources",
  "/org-admin/scope-templates",
  "/site-admin/api-resources",
];

async function signIn(
  request: APIRequestContext,
  who: string,
  email: string,
  password: string,
  secret: string
) {
  const l = await request.post("/api/v1/auth/login", { data: { email, password } });
  const step = (await l.json()) as { mfa_required?: boolean; session_id?: string };
  expect(step.mfa_required, `${who}: the password step asks for MFA`).toBe(true);
  const code = await unconsumedTOTP(secret, email);
  const m = await request.post("/api/v1/auth/login/mfa", {
    data: { session_id: step.session_id, code },
  });
  expect(m.status(), `${who}: the MFA step signs in`).toBe(200);
}

function watched(page: Page, problems: string[]): void {
  const where = () => new URL(page.url()).pathname;
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console @ ${where()}: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror @ ${where()}: ${e.message.slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      problems.push(
        `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} @ ${where()}`
      );
    }
  });
}

/** Visits home, then every navigation link under area, and checks each page. */
async function walk(ctx: BrowserContext, area: string, extra: string[]): Promise<number> {
  const page = await ctx.newPage();
  const problems: string[] = [];
  watched(page, problems);
  await page.goto(area);
  await page.waitForLoadState("networkidle");
  const hrefs = await page
    .locator(`nav a[href^="${area}"]`)
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const pages = [...new Set([area, ...hrefs.filter((h) => h && !h.includes("?")), ...extra])];
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    for (const t of HIDDEN_TEXT) expect(body, `${path} shows "${t}"`).not.toContain(t);
    for (const h of HIDDEN_HREFS)
      expect(await page.locator(`a[href="${h}"]`).count(), `${path} links ${h}`).toBe(0);
  }
  expect(problems, `on ${pages.length} pages`).toEqual([]);
  await page.close();
  return pages.length;
}

test.describe("the CE console on its own origin", () => {
  test.skip(!ENABLED, "runs only against a prepared identuum-idp-ce binary (IDENTUUM_E2E_CE=1)");

  test("site_admin and org_admin pages: no console error, no 4xx, no affordance CE does not serve", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000);
    const site = await browser.newContext({ baseURL });
    const org = await browser.newContext({ baseURL });
    try {
      await signIn(
        site.request,
        "site_admin",
        env("IDENTUUM_E2E_CE_SITE_ADMIN_EMAIL"),
        env("IDENTUUM_E2E_CE_SITE_ADMIN_PASSWORD"),
        env("IDENTUUM_E2E_CE_SITE_ADMIN_TOTP")
      );
      const list = await site.request.get("/bff/api/v1/organizations", { headers: BFF });
      expect(list.status()).toBe(200);
      const orgs =
        ((await list.json()) as { organizations?: Array<{ id: string }> }).organizations ?? [];
      expect(orgs.length, "the prepared organization is listed").toBeGreaterThan(0);
      const id = orgs[0].id;
      const sitePages = await walk(site, "/site-admin", [
        `/site-admin/organizations/${id}`,
        `/site-admin/organizations/${id}/edit`,
        `/site-admin/organizations/${id}/assign-admin`,
        "/site-admin/organizations/new",
        "/site-admin/settings",
      ]);

      await signIn(
        org.request,
        "org_admin",
        env("IDENTUUM_E2E_CE_ORG_ADMIN_EMAIL"),
        env("IDENTUUM_E2E_CE_ORG_ADMIN_PASSWORD"),
        env("IDENTUUM_E2E_CE_ORG_ADMIN_TOTP")
      );
      const orgPages = await walk(org, "/org-admin", [
        "/org-admin/users/new",
        "/org-admin/applications/new",
        "/org-admin/settings",
      ]);
      test.info().annotations.push({
        type: "pages",
        description: `site_admin ${sitePages}, org_admin ${orgPages}`,
      });
    } finally {
      await site.close();
      await org.close();
    }
  });
});
