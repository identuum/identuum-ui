/**
 * E2E coverage for /site-admin/organizations list → detail navigation flow,
 * lifecycle action route redirect safety, and authenticated action affordances.
 *
 * Authenticated tests (require IDENTUUM_TEST_PASSWORD + IDENTUUM_TEST_TOTP_SECRET):
 *   - Organizations list renders with a heading and Details links.
 *   - Each list row shows one of three admin state labels (Admin active / Invitation expired / No admin).
 *   - The old broad "Has admin" badge label is not present (replaced by three-state badge).
 *   - Clicking the first Details link navigates to /site-admin/organizations/<uuid>.
 *   - The detail page renders the Organization details card.
 *   - The detail page renders the Administrator status card.
 *   - The detail page renders an Actions card (safe reads only; no destructive actions clicked).
 *   - The "← Back to Organizations" link is present.
 *   - Create organization page renders expected form fields.
 *   - Edit action page renders the edit form for the first available organization.
 *   - assign-admin page never shows the stale "Already has an active administrator" copy.
 *   - assign-admin page shows the recovery form when can_assign_admin=true, or an accurate
 *     policy-blocked message when can_assign_admin=false — conditional on DB state.
 *   - List "Assign admin" affordance links open the recovery form (conditional on DB state).
 *   - Detail page "Assign admin" affordance is consistent with the list affordance.
 *
 * Unauthenticated redirect tests (always run, no auth env vars required):
 *   - Every lifecycle action route redirects to /login when not authenticated.
 *   - No 500 or framework crash on any action route.
 *
 * Requires: full Compose stack (IdP at localhost:7113, UI at localhost:7114).
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ensureExpiredPendingOrgFixture } from "./helpers/fixture-expired-org";
import { loginAsSiteAdmin, skipAuthTests } from "./helpers/login";

const ORG_UUID_RE =
  /^\/site-admin\/organizations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// ── Shared site_admin context (login once per file run) ───────────────────────
// Authenticated tests reuse one session to avoid TOTP replay failures.
let siteAdminCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // allow up to ~101s (31s cooldown + 70s TOTP retry + fixture ~5s)
  if (skipAuthTests) return;
  siteAdminCtx = await browser.newContext();
  const p = await siteAdminCtx.newPage();
  await loginAsSiteAdmin(p);
  await p.close();
  // Ensure the can_assign_admin=true fixture org exists for the conditional tests.
  // Uses the already-authenticated siteAdminCtx — no second TOTP needed.
  await ensureExpiredPendingOrgFixture(siteAdminCtx);
});

test.afterAll(async () => {
  await siteAdminCtx?.close();
  siteAdminCtx = null;
});

test.describe("/site-admin/organizations list → detail navigation", () => {
  test("Details link navigates to read-only organization detail page", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    // ── Open organizations list using shared site_admin session ──────────────
    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      // ── Confirm list page rendered ───────────────────────────────────────────
      await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();

      // ── Admin state badge labels ─────────────────────────────────────────────
      // The old "Has admin" broad badge was replaced by a three-state badge.
      // At least one of the three new labels must appear when orgs exist, and
      // the stale "Has admin" label must never appear.
      // Use count()>0 to avoid strict-mode violations when multiple list rows
      // render the same admin-state badge label.
      const anyAdminActive = (await page.getByText("Admin active").count()) > 0;
      const anyInvitationExpired = (await page.getByText("Invitation expired").count()) > 0;
      const anyNoAdmin = (await page.getByText("No admin").count()) > 0;
      // Stale copy must never appear — count() correctly returns 0 if absent
      expect(await page.getByText("Has admin").count()).toBe(0);

      // ── Find the first Details link (skip if no organizations exist) ─────────
      const detailsLinks = page.getByRole("link", { name: "Details" });
      const count = await detailsLinks.count();
      if (count === 0) {
        test.skip(true, "No organizations exist — cannot test navigation to detail page");
        return;
      }

      // Orgs exist: at least one admin state badge must be visible
      expect(anyAdminActive || anyInvitationExpired || anyNoAdmin).toBe(true);

      // ── Click the first Details link ─────────────────────────────────────────
      await detailsLinks.first().click();
      await page.waitForLoadState("networkidle");

      // ── Assert URL matches /site-admin/organizations/<uuid> ──────────────────
      // page.url() returns the full URL; extract pathname before matching
      expect(new URL(page.url()).pathname).toMatch(ORG_UUID_RE);

      // ── Assert Operational status card (new) ────────────────────────────────
      await expect(page.getByText("Operational status")).toBeVisible();

      // Operational status card must show one of the four valid lifecycle labels.
      // Use .count() > 0 to avoid strict-mode violations when labels repeat elsewhere
      // on the page (e.g. "Active" also appears in the header badge and details row).
      const opActive = (await page.getByText("Active", { exact: true }).count()) > 0;
      const opInactive = (await page.getByText("Inactive", { exact: true }).count()) > 0;
      const opArchived = (await page.getByText("Archived", { exact: true }).count()) > 0;
      expect(opActive || opInactive || opArchived).toBe(true);

      // Operational status card must show one of the four valid admin state labels.
      // These labels are unique on the page, but using count() for consistency.
      const adminOperational = (await page.getByText("Administrator account active").count()) > 0;
      const adminExpiredPending = (await page.getByText("Pending invitation expired").count()) > 0;
      const adminNoAdmin = (await page.getByText("No administrator").count()) > 0;
      const adminSuspended = (await page.getByText("Admin management suspended").count()) > 0;
      expect(adminOperational || adminExpiredPending || adminNoAdmin || adminSuspended).toBe(true);

      // Stale copy must not appear anywhere on the detail page
      await expect(page.getByText("Active administrator present")).not.toBeVisible();
      await expect(page.getByText("Already has an active administrator")).not.toBeVisible();

      // ── Assert read-only Organization details card ───────────────────────────
      await expect(page.getByText("Organization details")).toBeVisible();

      // ── Assert Administrator status card ─────────────────────────────────────
      await expect(page.getByText("Administrator status")).toBeVisible();

      // "Administrator account present" (has_admin=true) or "No active administrator"
      // (has_admin=false) depending on org state.
      const hasAccountPresent = await page.getByText("Administrator account present").isVisible();
      const hasNoAdmin =
        (await page.getByText("No active administrator", { exact: true }).count()) > 0;
      expect(hasAccountPresent || hasNoAdmin).toBe(true);

      // ── Assert back link is present ──────────────────────────────────────────
      const backLink = page.getByRole("link", { name: "← Back to Organizations" });
      await expect(backLink).toBeVisible();
      const backHref = await backLink.getAttribute("href");
      expect(backHref).toBe("/site-admin/organizations");

      // ── Assert safe action links exist (do not click destructive actions) ────
      // Actions card shows Edit for non-deleted orgs; Restore for deleted orgs.
      // At least one of these must be present; exact set depends on org state.
      const hasEdit = await page.getByRole("link", { name: "Edit" }).isVisible();
      const hasRestore = await page.getByRole("link", { name: "Restore" }).isVisible();
      expect(hasEdit || hasRestore).toBe(true);
    } finally {
      await page.close();
    }
  });
});

test.describe("/site-admin/organizations action routes — unauthenticated redirect safety", () => {
  // These tests do not require auth env vars. They verify that every lifecycle
  // action route redirects unauthenticated requests to /login without 500 errors.
  // NIL_UUID is used as a placeholder org ID; the page will 404 or redirect before
  // fetching org data if the session is absent.

  const actionRoutes = [
    "/site-admin/organizations/new",
    `/site-admin/organizations/${NIL_UUID}/edit`,
    `/site-admin/organizations/${NIL_UUID}/assign-admin`,
    `/site-admin/organizations/${NIL_UUID}/deactivate`,
    `/site-admin/organizations/${NIL_UUID}/reactivate`,
    `/site-admin/organizations/${NIL_UUID}/delete`,
    `/site-admin/organizations/${NIL_UUID}/restore`,
  ];

  for (const route of actionRoutes) {
    test(`${route} redirects unauthenticated to /login`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const finalUrl = new URL(page.url());
      // Must redirect to /login (session_expired or unauthorized reason)
      expect(finalUrl.pathname).toBe("/login");

      // Must not render a 500 or internal error frame
      const pageTitle = await page.title();
      expect(pageTitle).not.toMatch(/500|internal error|application error/i);
    });
  }

  test("organizations list redirects unauthenticated to /login", async ({ page }) => {
    await page.goto("/site-admin/organizations");
    await page.waitForLoadState("networkidle");
    const finalUrl = new URL(page.url());
    expect(finalUrl.pathname).toBe("/login");
  });
});

test.describe("/site-admin/organizations — authenticated action page coverage", () => {
  // All tests in this block require IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET.
  // Tests that depend on specific DB state (e.g. can_assign_admin=true orgs) skip
  // gracefully when the prerequisite state is absent — they do not fail.
  // Shared siteAdminCtx is set up in beforeAll at the file level.

  // ── Helper: extract org ID from a /site-admin/organizations/<uuid>[/...] URL ──
  function extractOrgId(href: string): string {
    const parts = href.replace(/\/$/, "").split("/");
    const idx = parts.indexOf("organizations");
    return idx !== -1 ? (parts[idx + 1] ?? "") : "";
  }

  test("create organization page renders expected form fields", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations/new");
      await page.waitForLoadState("networkidle");

      // Fast-fail if redirected to login instead of the create-org page
      expect(new URL(page.url()).pathname).toBe("/site-admin/organizations/new");

      await expect(page.getByRole("heading", { name: "Create organization" })).toBeVisible();
      await expect(page.getByLabel("Name")).toBeVisible();
      await expect(page.getByLabel(/domain/i)).toBeVisible();
      await expect(page.getByLabel(/admin email/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /create organization/i })).toBeVisible();
      const cancelLink = page.getByRole("link", { name: "Cancel" });
      await expect(cancelLink).toBeVisible();
      expect(await cancelLink.getAttribute("href")).toBe("/site-admin/organizations");
    } finally {
      await page.close();
    }
  });

  test("edit action page renders form for first available organization", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      // Skip if there are no organizations at all
      const detailsLinks = page.getByRole("link", { name: "Details" });
      if ((await detailsLinks.count()) === 0) {
        test.skip(true, "No organizations in DB — skipping edit page test");
        return;
      }

      // Extract org ID from first Details link href (avoids a click-navigate roundtrip)
      const firstDetailsHref = await detailsLinks.first().getAttribute("href");
      const orgId = extractOrgId(firstDetailsHref ?? "");
      expect(orgId).toMatch(/^[0-9a-f-]{36}$/i);

      // Navigate to detail page to check active/deleted state before visiting edit
      await page.goto(`/site-admin/organizations/${orgId}`);
      await page.waitForLoadState("networkidle");

      // Edit link is only visible for non-deleted orgs
      const editLink = page.getByRole("link", { name: "Edit" });
      if (!(await editLink.isVisible())) {
        test.skip(true, "First org is deleted — Edit link not shown; skipping edit form test");
        return;
      }

      await page.goto(`/site-admin/organizations/${orgId}/edit`);
      await page.waitForLoadState("networkidle");

      // Edit form must render with correct heading and Name field
      await expect(page.getByRole("heading", { name: "Edit organization" })).toBeVisible();
      await expect(page.getByLabel("Name")).toBeVisible();
      // Cancel link must point back to the org detail page, not the list
      const cancelLink = page.getByRole("link", { name: "Cancel" });
      await expect(cancelLink).toBeVisible();
      expect(await cancelLink.getAttribute("href")).toBe(`/site-admin/organizations/${orgId}`);
    } finally {
      await page.close();
    }
  });

  test("assign-admin page never shows stale 'Already has an active administrator' copy", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      const detailsLinks = page.getByRole("link", { name: "Details" });
      if ((await detailsLinks.count()) === 0) {
        test.skip(true, "No organizations in DB — skipping assign-admin copy test");
        return;
      }

      // Extract org ID from first Details link
      const firstDetailsHref = await detailsLinks.first().getAttribute("href");
      const orgId = extractOrgId(firstDetailsHref ?? "");
      expect(orgId).toMatch(/^[0-9a-f-]{36}$/i);

      await page.goto(`/site-admin/organizations/${orgId}/assign-admin`);
      await page.waitForLoadState("networkidle");

      // Stale copy must never appear
      await expect(page.getByText("Already has an active administrator")).not.toBeVisible();

      // Page must render one of the three valid states:
      //   (a) Recovery form — when can_assign_admin=true
      //   (b) Policy-blocked panel — when can_assign_admin=false
      //   (c) Deleted-org panel — when org.deleted=true
      const showsForm = await page
        .getByRole("button", { name: /generate admin setup link/i })
        .isVisible();
      const showsRecoveryBlocked = await page
        .getByText("Recovery delegation not available")
        .isVisible();
      const showsDeletedGuard = await page.getByText("Organization is deleted").isVisible();

      expect(showsForm || showsRecoveryBlocked || showsDeletedGuard).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("list 'Assign admin' affordance opens recovery form (skips if no can_assign_admin=true org)", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      // "Assign admin" only appears in list rows where can_assign_admin=true
      const assignLinks = page.getByRole("link", { name: "Assign admin" });
      if ((await assignLinks.count()) === 0) {
        test.skip(true, "No organizations with can_assign_admin=true in current DB — skipping");
        return;
      }

      await assignLinks.first().click();
      await page.waitForLoadState("networkidle");

      // Must be on the assign-admin page
      expect(page.url()).toMatch(/\/site-admin\/organizations\/[0-9a-f-]{36}\/assign-admin$/i);

      // Recovery form must be visible
      await expect(page.getByRole("heading", { name: "Assign administrator" })).toBeVisible();
      await expect(page.getByRole("button", { name: /generate admin setup link/i })).toBeVisible();

      // Stale copy must not appear
      await expect(page.getByText("Already has an active administrator")).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("detail page 'Assign admin' affordance consistent with list when can_assign_admin=true", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      const assignLinks = page.getByRole("link", { name: "Assign admin" });
      if ((await assignLinks.count()) === 0) {
        test.skip(true, "No organizations with can_assign_admin=true in current DB — skipping");
        return;
      }

      // Extract org ID from the first "Assign admin" link href
      // href format: /site-admin/organizations/:id/assign-admin
      const href = await assignLinks.first().getAttribute("href");
      const orgId = extractOrgId(href ?? "");
      expect(orgId).toMatch(/^[0-9a-f-]{36}$/i);

      // Navigate to detail page for the same org
      await page.goto(`/site-admin/organizations/${orgId}`);
      await page.waitForLoadState("networkidle");

      // Fast-fail if redirected to login (session failure) rather than waiting 90s
      // for "Operational status" to appear on the wrong page.
      expect(new URL(page.url()).pathname).toMatch(/^\/site-admin\/organizations\//);

      // Wait for the Operational status card to confirm full page render before
      // asserting on the recovery affordance links.
      await page.getByText("Operational status").waitFor({ state: "visible" });

      // Detail page must expose at least one link to the assign-admin route for this org.
      // The detail handler now defaults can_assign_admin=true on DB error (consistent with
      // the list handler), so this count should be > 0 whenever the list shows "Assign admin".
      const assignAdminLinkCount = await page.locator(`a[href*="/assign-admin"]`).count();

      expect(assignAdminLinkCount).toBeGreaterThan(0);

      // Administrator status card must show recovery affordance
      // (either "Pending invitation expired" sub-state or standard "No active administrator")
      const hasExpiredInvitation = (await page.getByText("Pending invitation expired").count()) > 0;
      const hasNoAdmin =
        (await page.getByText("No active administrator", { exact: true }).count()) > 0;
      expect(hasExpiredInvitation || hasNoAdmin).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("detail page shows accurate admin status copy — no stale text variants", async () => {
    if (skipAuthTests) {
      test.skip(true, "Set IDENTUUM_TEST_PASSWORD and IDENTUUM_TEST_TOTP_SECRET to run this test");
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto("/site-admin/organizations");
      await page.waitForLoadState("networkidle");

      const detailsLinks = page.getByRole("link", { name: "Details" });
      if ((await detailsLinks.count()) === 0) {
        test.skip(true, "No organizations in DB — skipping stale copy regression test");
        return;
      }

      const firstDetailsHref = await detailsLinks.first().getAttribute("href");
      const orgId = extractOrgId(firstDetailsHref ?? "");

      await page.goto(`/site-admin/organizations/${orgId}`);
      await page.waitForLoadState("networkidle");

      // Stale copy must not appear anywhere (Operational status card or Administrator status card)
      await expect(page.getByText("Active administrator present")).not.toBeVisible();
      await expect(page.getByText("Already has an active administrator")).not.toBeVisible();

      // Operational status card must be present
      await expect(page.getByText("Operational status")).toBeVisible();

      // Administrator status card must show one of the current valid strings
      // Use count() to avoid strict-mode violations when text appears in multiple elements.
      const accountPresent = (await page.getByText("Administrator account present").count()) > 0;
      const noAdmin = (await page.getByText("No active administrator").count()) > 0;
      const pendingExpired = (await page.getByText("Pending invitation expired").count()) > 0;
      expect(accountPresent || noAdmin || pendingExpired).toBe(true);
    } finally {
      await page.close();
    }
  });
});
