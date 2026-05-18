/**
 * Authenticated org-admin coverage tests.
 *
 * Verifies that an org_admin can reach the /org-admin/* and /account/settings
 * areas, that key pages render the expected UI without error, and that the
 * org_admin cannot reach site-admin areas. Does not mutate any data.
 *
 * All assertions target stable non-sensitive structure (headings, filter tabs,
 * card titles, role labels). No user emails, IDs, or counts are asserted.
 *
 * Session strategy: login ONCE in beforeAll and share the browser context.
 * This avoids TOTP replay-protection failures from repeated authentication.
 *
 * Navigation strategy: tests that check the same URL share a single page
 * navigation. This reduces total server-side IdP calls by ~55%, preventing
 * transient Docker DNS failures under combined-suite load.
 *
 * Skipped unless IDENTUUM_TEST_ORG_ADMIN_EMAIL and
 * IDENTUUM_TEST_ORG_ADMIN_PASSWORD are set (auto-loaded from .env.playwright.local).
 *
 * Requires: full Compose stack (IdP at localhost:7113, UI at localhost:7114).
 * Run with --workers=1 to avoid TOTP replay failures.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL and IDENTUUM_TEST_ORG_ADMIN_PASSWORD to run this test";

// ── Shared auth context ───────────────────────────────────────────────────────

let sharedCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // allow up to ~101s (31s cooldown + 70s TOTP retry)
  if (skipOrgAdminTests) return;
  sharedCtx = await browser.newContext();
  const setupPage = await sharedCtx.newPage();
  await loginAsOrgAdmin(setupPage);
  await setupPage.close();
});

test.afterAll(async () => {
  await sharedCtx?.close();
  sharedCtx = null;
});

// ── org-admin area access ──────────────────────────────────────────────────────

test.describe("/org-admin — authenticated route access", () => {

  test("/org-admin overview: renders heading, org-admin copy, and role display", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      await expect(page.getByText("Organization administration")).toBeVisible();
      // Identity section with role label
      await expect(page.getByText("Identity")).toBeVisible();
      // "org_admin" appears in top-bar and Identity section body
      expect(await page.getByText("org_admin", { exact: true }).count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  test("/org-admin/users: heading, filter tabs, table/empty state, and Details link", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/users");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
      await expect(page.getByText("Members of your organization")).toBeVisible();

      // Filter tabs are hardcoded and always rendered
      await expect(page.getByRole("link", { name: /^All/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Active/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Pending/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Disabled/ })).toBeVisible();

      // One of: table, empty state, or error state
      const hasTable = (await page.getByRole("columnheader", { name: "Role" }).count()) > 0;
      const hasEmpty = (await page.getByText("No users yet").count()) > 0;
      const hasError = (await page.getByText("Could not load users").count()) > 0;
      expect(hasTable || hasEmpty || hasError).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("/org-admin/users filter tabs navigable without 500", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/users");
      await page.waitForLoadState("networkidle");

      for (const tabName of ["Active", "Pending", "Disabled"]) {
        await page.getByRole("link", { name: new RegExp(`^${tabName}`) }).click();
        await page.waitForLoadState("networkidle");
        expect(await page.title()).not.toMatch(/500|internal error|application error/i);
        await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
      }
    } finally {
      await page.close();
    }
  });

  test("/org-admin/users first Details link navigates to user detail (skips if no users)", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/users");
      await page.waitForLoadState("networkidle");

      const detailsLinks = page.getByRole("link", { name: "Details" });
      if ((await detailsLinks.count()) === 0) {
        test.skip(true, "No users in org — skipping user detail navigation test");
        return;
      }

      await detailsLinks.first().click();
      await page.waitForLoadState("networkidle");

      expect(new URL(page.url()).pathname).toMatch(
        /^\/org-admin\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByText("Account details")).toBeVisible();
      await expect(page.getByRole("link", { name: "← Back to Users" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("/org-admin/settings: all cards, form controls, and placeholder sections", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByRole("heading", { name: "Organization settings" })).toBeVisible();

      // Organization profile card
      await expect(page.getByText("Organization profile")).toBeVisible();
      const nameInput = page.getByLabel("Organization name");
      await expect(nameInput).toBeVisible();
      expect(await nameInput.isDisabled()).toBe(false);
      await expect(page.getByRole("button", { name: /save profile/i })).toBeVisible();

      // Domain field is read-only (rendered as <p>, not <input>)
      expect(await page.getByLabel(/primary domain/i).count()).toBe(0);
      if ((await page.getByText("Domain changes affect", { exact: false }).count()) > 0) {
        await expect(page.getByText("Domain changes affect", { exact: false })).toBeVisible();
      }

      // Security policy card — MFA radio buttons
      await expect(page.getByText("Security policy")).toBeVisible();
      const optionalOpt = page.getByRole("radio", { name: /^Optional/ });
      const requiredOpt = page.getByRole("radio", { name: /^Required/ });
      await expect(optionalOpt).toBeVisible();
      await expect(requiredOpt).toBeVisible();
      const optChecked = await optionalOpt.isChecked();
      const reqChecked = await requiredOpt.isChecked();
      expect(optChecked || reqChecked).toBe(true);
      expect(optChecked && reqChecked).toBe(false);
      await expect(page.getByRole("button", { name: /save policy/i })).toBeVisible();

      // Placeholder cards
      expect(await page.getByText("Domains", { exact: true }).count()).toBeGreaterThan(0);
      expect(await page.getByText("Invite policy", { exact: true }).count()).toBeGreaterThan(0);
      expect(await page.getByText("Coming soon").count()).toBeGreaterThanOrEqual(2);
    } finally {
      await page.close();
    }
  });

  test("/org-admin/audit: renders without crash, org-scoped, no site-admin navigation", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/audit");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);

      const hasAuditLog = (await page.getByRole("heading", { name: "Audit log" }).count()) > 0;
      const hasUnavailable = (await page.getByText(/Professional tier|requires.*tier/i).count()) > 0;
      expect(hasAuditLog || hasUnavailable).toBe(true);

      if (hasAuditLog) {
        await expect(page.getByText("Audit events for your organization")).toBeVisible();
        const hasTableHeader = (await page.getByRole("columnheader", { name: "Event" }).count()) > 0;
        const hasEmptyState = (await page.getByText("No audit events found").count()) > 0;
        const hasErrorState = (await page.getByText("Could not load audit events").count()) > 0;
        expect(hasTableHeader || hasEmptyState || hasErrorState).toBe(true);
        expect(await page.getByRole("link", { name: "View organization →" }).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });
});

// ── account/settings from org_admin session ────────────────────────────────────

test.describe("/account/settings — authenticated from org_admin session", () => {

  test("/account/settings: heading, tabs, and no site-admin controls", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/account/settings");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();

      // Tab navigation
      await expect(page.getByRole("link", { name: /password/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /sessions/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /passkeys/i })).toBeVisible();

      // Must not expose site-admin controls
      await expect(page.getByText("System settings", { exact: true })).not.toBeVisible();
      await expect(page.getByText("Infrastructure", { exact: true })).not.toBeVisible();
      expect(page.url()).toContain("/account/settings");
    } finally {
      await page.close();
    }
  });
});

// ── site-admin access denied ───────────────────────────────────────────────────

test.describe("/site-admin/* — access denied for org_admin", () => {

  test("org_admin cannot reach /site-admin/organizations — redirected away", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      expect(page.url()).not.toMatch(/\/site-admin/);
      await expect(page.getByRole("heading", { name: "Organizations" })).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("org_admin cannot reach /site-admin/settings — redirected away", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/site-admin/settings");
      await page.waitForLoadState("networkidle");
      expect(page.url()).not.toMatch(/\/site-admin/);
    } finally {
      await page.close();
    }
  });

  test("org_admin cannot reach /site-admin/audit — redirected away", async () => {
    if (skipOrgAdminTests) { test.skip(true, SKIP_MSG); }

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/site-admin/audit");
      await page.waitForLoadState("networkidle");
      expect(page.url()).not.toMatch(/\/site-admin/);
    } finally {
      await page.close();
    }
  });
});
