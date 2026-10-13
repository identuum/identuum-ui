/**
 * The console's words for a 409 (UI-0914-STAGE-1, item 2).
 *
 * Each test drives a console form into an answer that identuum-idp-oss
 * d6072cf gives as HTTP 409 and asserts the words the console shows for it.
 * The server side, measured at d6072cf:
 *
 *   slug_exists / domain_exists / email_exists — POST /api/v1/organizations
 *     (internal/handlers/organizations.go:693-698)
 *   name_taken — POST /api/v1/organizations/:id/service-accounts
 *     (internal/handlers/service_accounts.go:506-512)
 *   audience_exists — POST /api/v1/api-resources
 *     (internal/handlers/api_resources.go:383-385)
 *   a domain the organization already holds — POST
 *     /api/v1/organizations/:id/domains (internal/handlers/organization_domains.go:222-225)
 *
 * The console's words, from this tree:
 *
 *   src/app/site-admin/organizations/new/conflict-words.ts:12, :21, :25
 *   src/app/org-admin/service-accounts/actions.ts:162-163
 *   src/app/org-admin/api-resources/actions.ts:141-142
 *   src/app/org-admin/settings/domains-actions.ts:118
 *
 * Every 409 here is provoked by a row this spec creates first, so no fixture
 * row is changed. The new rows are disposable: the organization is
 * soft-deleted at the end, and the service account, API resource and pending
 * domain sit in the fixture organization, which global teardown removes.
 * Dynamic fixture mode only (the harness's devloop phase sets it). No
 * credential, token or link is read or printed.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  loginAsOrgAdmin,
  loginAsSiteAdmin,
  SKIP_AUTH_MSG,
  skipAuthTests,
  skipOrgAdminTests,
} from "./helpers/login";

const DYNAMIC = process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE === "true";
const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This spec creates disposable rows to provoke each 409.";
const ORG_ADMIN_SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const NONCE = `${Date.now().toString(36)}-${Math.floor(Math.random() * 100000)}`;

let siteAdminCtx: BrowserContext | null = null;
let orgAdminCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  if (!DYNAMIC) return;
  if (!skipAuthTests) {
    siteAdminCtx = await browser.newContext();
    const p = await siteAdminCtx.newPage();
    await loginAsSiteAdmin(p);
    await p.close();
  }
  if (!skipOrgAdminTests) {
    orgAdminCtx = await browser.newContext();
    const p = await orgAdminCtx.newPage();
    await loginAsOrgAdmin(p);
    await p.close();
  }
});

test.afterAll(async () => {
  await siteAdminCtx?.close();
  siteAdminCtx = null;
  await orgAdminCtx?.close();
  orgAdminCtx = null;
});

async function submitNewOrganization(
  page: Page,
  fields: { name: string; domain: string; adminEmail: string }
): Promise<void> {
  await page.goto("/site-admin/organizations/new");
  await expect(page.getByRole("heading", { name: /Create organization/i, level: 1 })).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('input[name="name"]').fill(fields.name);
  await page.locator('input[name="domain"]').fill(fields.domain);
  await page.locator('input[name="admin_email"]').fill(fields.adminEmail);
  await page.getByRole("button", { name: /Create organization/i }).click();
}

test.describe("site_admin: New organization names the field a 409 is about", () => {
  test.skip(!DYNAMIC, DYNAMIC_ONLY_SKIP_MSG);
  test.skip(skipAuthTests, SKIP_AUTH_MSG);

  test("slug_exists, domain_exists and email_exists each show their own words", async () => {
    test.setTimeout(120_000);
    const ctx = siteAdminCtx;
    if (!ctx) throw new Error("siteAdminCtx not initialized — check beforeAll");
    const page = await ctx.newPage();

    const name = `E2E Conflict ${NONCE}`;
    const domain = `e2e-conflict-${NONCE}.disposible.org`;
    const adminEmail = `admin+e2e-conflict-${NONCE}@disposible.org`;
    let createdOrgId: string | null = null;

    try {
      // The row every conflict below collides with. With an administrator
      // email the organization is born inactive (the CRUD spec's measured
      // contract), so it is found in the deactivated view.
      await submitNewOrganization(page, { name, domain, adminEmail });
      await expect(page.getByText("Organization created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.goto("/site-admin/organizations?state=deactivated");
      const row = page.locator(`tr:has-text("${name}")`).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      const href = await row
        .locator('a[href^="/site-admin/organizations/"]')
        .first()
        .getAttribute("href");
      createdOrgId =
        href?.match(
          /\/site-admin\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
        )?.[1] ?? null;
      expect(createdOrgId, "the new organization's id is in its row link").not.toBeNull();

      // slug_exists: the same name, a fresh domain and email.
      await submitNewOrganization(page, {
        name,
        domain: `e2e-conflict-b-${NONCE}.disposible.org`,
        adminEmail: `admin+e2e-conflict-b-${NONCE}@disposible.org`,
      });
      await expect(
        page.getByText("An organization with this name already exists. Choose another name.", {
          exact: true,
        })
      ).toBeVisible({ timeout: 15_000 });

      // domain_exists: a fresh name and email, the same domain.
      await submitNewOrganization(page, {
        name: `E2E Conflict C ${NONCE}`,
        domain,
        adminEmail: `admin+e2e-conflict-c-${NONCE}@disposible.org`,
      });
      await expect(
        page.getByText("An organization with this domain already exists.", { exact: true })
      ).toBeVisible({ timeout: 15_000 });

      // email_exists: a fresh name and domain, the first organization's
      // administrator email (that account exists since the first create).
      await submitNewOrganization(page, {
        name: `E2E Conflict D ${NONCE}`,
        domain: `e2e-conflict-d-${NONCE}.disposible.org`,
        adminEmail,
      });
      await expect(
        page.getByText("This email address already has an account. Use another address.", {
          exact: true,
        })
      ).toBeVisible({ timeout: 15_000 });

      // A refused create made nothing: none of the three names is listed.
      for (const view of ["current", "deactivated"]) {
        await page.goto(`/site-admin/organizations?state=${view}`);
        await expect(page.getByRole("heading", { name: /Organizations/i, level: 1 })).toBeVisible({
          timeout: 10_000,
        });
        for (const refused of [`E2E Conflict C ${NONCE}`, `E2E Conflict D ${NONCE}`]) {
          await expect(page.locator(`tr:has-text("${refused}")`)).toHaveCount(0);
        }
      }
    } finally {
      if (createdOrgId) {
        try {
          await page.goto(`/site-admin/organizations/${createdOrgId}/delete`);
          await page.locator('input[type="checkbox"][name="confirmed"]').check();
          await page
            .getByRole("button", { name: /Soft-delete|Delete organization|Delete/i })
            .click();
          await page.waitForLoadState("networkidle", { timeout: 15_000 });
        } catch {
          // The test's own failure is what matters; the disposable
          // appliance is torn down with the run.
        }
      }
      await page.close();
    }
  });
});

test.describe("org_admin: create forms say what a 409 means", () => {
  test.skip(!DYNAMIC, DYNAMIC_ONLY_SKIP_MSG);
  test.skip(skipOrgAdminTests, ORG_ADMIN_SKIP_MSG);

  test("name_taken on Create service account", async () => {
    const ctx = orgAdminCtx;
    if (!ctx) throw new Error("orgAdminCtx not initialized — check beforeAll");
    const page = await ctx.newPage();
    const saName = `e2e-sa-conflict-${NONCE}`;
    const create = async () => {
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saName);
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
    };
    try {
      await create();
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await create();
      // The route announcer is also role=alert: match the alert by its words.
      await expect(
        page.getByRole("alert").filter({
          hasText: "A service account with this name already exists in your organization.",
        })
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Already in use.", { exact: true })).toBeVisible();
      await expect(page.getByText("Service account created", { exact: true })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test("audience_exists on Create API resource", async () => {
    const ctx = orgAdminCtx;
    if (!ctx) throw new Error("orgAdminCtx not initialized — check beforeAll");
    const page = await ctx.newPage();
    const audience = `https://api.e2e-conflict-${NONCE}.test`;
    const create = async (name: string) => {
      await page.goto("/org-admin/api-resources/new");
      await page.getByLabel(/Resource name/).fill(name);
      await page.getByLabel(/Audience/).fill(audience);
      await page.getByRole("button", { name: /^Create API resource$/ }).click();
    };
    try {
      await create(`E2E Conflict API ${NONCE}`);
      await expect(page.getByText("API resource created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await create(`E2E Conflict API B ${NONCE}`);
      await expect(
        page.getByRole("alert").filter({
          hasText: "An API resource with this audience already exists in your organization.",
        })
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Already in use.", { exact: true })).toBeVisible();
      await expect(page.getByText("API resource created", { exact: true })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test("a domain the organization already holds, on Add a domain", async () => {
    const ctx = orgAdminCtx;
    if (!ctx) throw new Error("orgAdminCtx not initialized — check beforeAll");
    const page = await ctx.newPage();
    const syntheticDomain = `ui-conflict-${NONCE}.test`;
    const add = async () => {
      await page.getByLabel("Add a domain").fill(syntheticDomain);
      await page.getByRole("button", { name: /add domain/i }).click();
    };
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");
      await add();
      await expect(page.locator("li", { hasText: syntheticDomain })).toBeVisible({
        timeout: 10_000,
      });
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");
      await add();
      await expect(
        page.getByRole("alert").filter({
          hasText:
            "This domain is already registered for your organization or another organization.",
        })
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("li", { hasText: syntheticDomain })).toHaveCount(1);
    } finally {
      await page.close();
    }
  });
});
