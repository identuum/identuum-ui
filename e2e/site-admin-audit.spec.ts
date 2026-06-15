/**
 * E2E coverage for /site-admin/audit subject-filter URL params and
 * organization-subject audit row navigation links.
 *
 * Subject-filter notice tests:
 *   - Zero UUID (system context): shows "System-level organization events"; no View org link.
 *   - Non-zero org UUID: shows "Viewing events for one organization" + View organization link.
 *   - Clear filter link always points to /site-admin/audit.
 *
 * Organization-subject link test:
 *   Verifies that any "View organization →" links present in the audit table
 *   point to valid org-detail hrefs. Because listAuditEvents is a server-side
 *   call (Node.js → IdP direct), Playwright page.route() cannot inject mock
 *   responses — real audit data is required for these assertions to be non-trivial.
 *   When no organization-subject events exist in the database the test passes
 *   trivially (no links to check).
 *
 * Session strategy: login ONCE in beforeAll and share the browser context.
 * This avoids TOTP replay-protection failures from back-to-back logins.
 *
 * Skipped unless IDENTUUM_TEST_SITE_ADMIN_PASSWORD and _TOTP_SECRET are set.
 * Requires: full Compose stack (IdP at localhost:7113, UI at localhost:7114).
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { SKIP_AUTH_MSG, loginAsSiteAdmin, skipAuthTests } from "./helpers/login";

const skip = skipAuthTests;

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const NON_ZERO_TEST_UUID = "11111111-1111-1111-1111-111111111111";

// ── Shared site_admin context (login once per file run) ───────────────────────

let sharedCtx: BrowserContext | null = null;

function getSharedContext(): BrowserContext {
  if (!sharedCtx) {
    throw new Error("shared context not initialized");
  }
  return sharedCtx;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // allow up to ~101s (31s cooldown + 70s TOTP retry)
  if (skip) return;
  sharedCtx = await browser.newContext();
  const p = await sharedCtx.newPage();
  await loginAsSiteAdmin(p);
  await p.close();
});

test.afterAll(async () => {
  await sharedCtx?.close();
  sharedCtx = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("/site-admin/audit subject-filter notice", () => {
  test("zero UUID org subject filter shows system-level message with no View organization link", async () => {
    if (skip) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto(`/site-admin/audit?subject_id=${ZERO_UUID}&subject_type=organization`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("Subject filter active:")).toBeVisible();
      await expect(page.getByText("organization", { exact: true })).toBeVisible();

      await expect(page.getByText("System-level organization events")).toBeVisible();
      await expect(page.getByRole("link", { name: "View organization →" })).not.toBeVisible();

      const clearLink = page.getByRole("link", { name: "Clear subject filter" });
      await expect(clearLink).toBeVisible();
      expect(await clearLink.getAttribute("href")).toBe("/site-admin/audit");
    } finally {
      await page.close();
    }
  });

  test("non-zero org UUID subject filter shows org message and View organization link", async () => {
    if (skip) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto(
        `/site-admin/audit?subject_id=${NON_ZERO_TEST_UUID}&subject_type=organization`
      );
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("Subject filter active:")).toBeVisible();
      await expect(page.getByText("organization", { exact: true })).toBeVisible();
      await expect(page.getByText("Viewing events for one organization")).toBeVisible();

      const viewOrgLink = page.getByRole("link", { name: "View organization →" });
      await expect(viewOrgLink).toBeVisible();
      expect(await viewOrgLink.getAttribute("href")).toBe(
        `/site-admin/organizations/${NON_ZERO_TEST_UUID}`
      );

      const clearLink = page.getByRole("link", { name: "Clear subject filter" });
      await expect(clearLink).toBeVisible();
      expect(await clearLink.getAttribute("href")).toBe("/site-admin/audit");
    } finally {
      await page.close();
    }
  });
});

test.describe("/site-admin/audit organization-subject row links", () => {
  test("any 'View organization →' links have valid org-detail hrefs and the page does not crash", async () => {
    if (skip) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/site-admin/audit");
      await page.waitForLoadState("networkidle");

      const orgLinks = page.getByRole("link", { name: "View organization →" });
      const count = await orgLinks.count();

      for (let i = 0; i < count; i++) {
        const linkHref = await orgLinks.nth(i).getAttribute("href");
        expect(linkHref).toMatch(
          /^\/site-admin\/organizations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      }

      await page.goto(`/site-admin/audit?subject_id=${ZERO_UUID}&subject_type=organization`);
      await page.waitForLoadState("networkidle");

      const linksOnEmptyPage = await page
        .getByRole("link", { name: "View organization →" })
        .count();
      expect(linksOnEmptyPage).toBe(0);
    } finally {
      await page.close();
    }
  });
});
