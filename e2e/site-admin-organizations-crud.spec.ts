/**
 * End-to-end CRUD coverage for /site-admin/organizations, added by
 * `agent-a-20260620-idp-ui-ce-organizations-crud-playwright` to close
 * the browser-UI gap noted at CE-7 in
 * `identuum-idp-ce/docs/CE_MANUAL_TEST_MATRIX.md`.
 *
 * The existing `e2e/site-admin-organizations.spec.ts` covers READ +
 * page-render contracts (list/detail navigation, action-route auth
 * redirects, form-field rendering). It does NOT submit any
 * create/edit/delete form. This spec adds the missing wire-through-UI
 * coverage:
 *
 *   1. Submit the create form on /site-admin/organizations/new with a
 *      disposable name + domain + first-org_admin email.
 *   2. Assert the new org appears in the default list (?deleted=false).
 *   3. Edit the name via /site-admin/organizations/{id}/edit + assert
 *      the new name renders.
 *   4. Soft-delete via /site-admin/organizations/{id}/delete (with the
 *      required confirmation checkbox).
 *   5. Assert the org disappears from the default list AND reappears
 *      under the ?deleted=true filter (the soft-delete contract).
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_ORGS_CRUD=1` → run the destructive CRUD ceremony.
 *
 * Why env-gated:
 *   - Creates a real org row + a real first-org_admin user row.
 *   - The test always attempts soft-delete in a try/finally so a leak
 *     only occurs if the create succeeds and then a later step fails
 *     in a way that prevents reaching the delete page. The leaked org
 *     would still be soft-deletable manually via
 *     /site-admin/organizations/{id}/delete on the dev stack.
 *   - Runs against the dev stack (site_admin has TOTP enrolled so
 *     `loginAsSiteAdmin` works); operators who want to run it should
 *     either point IDENTUUM_E2E_BASE_URL at their dev stack OR accept
 *     the customer-smoke stack's MFA-optional helper (this spec uses
 *     the strict-MFA helper to match the rest of the
 *     site-admin-organizations* spec family).
 *
 * Secret-safety contract:
 *   - The site_admin password + TOTP secret live in the operator's
 *     `loginAsSiteAdmin` helper environment (matching every other
 *     site-admin-* spec). NEVER printed.
 *   - The disposable org name + domain + admin_email are RUNTIME-
 *     generated from `Date.now()` + `Math.random()` — no fixed value
 *     reused across runs, no secret content.
 *   - The created org's ID is captured from the post-submit redirect
 *     URL; the spec NEVER reads cookies / JWTs / session storage / any
 *     credential value.
 *   - On-failure diagnostic prints only public URLs + visible page
 *     heading text — no env values, no cookies.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

const CRUD_ENABLED = process.env.IDENTUUM_E2E_ORGS_CRUD === "1";

// One shared site_admin browser context — login once per file run to
// avoid TOTP replay failures (mirrors the existing
// site-admin-organizations.spec.ts pattern).
let siteAdminCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  if (!CRUD_ENABLED || skipAuthTests) return;
  test.setTimeout(180_000);
  siteAdminCtx = await browser.newContext();
  const p = await siteAdminCtx.newPage();
  await loginAsSiteAdmin(p);
  await p.close();
});

test.afterAll(async () => {
  await siteAdminCtx?.close();
  siteAdminCtx = null;
});

test.describe("/site-admin/organizations — end-to-end CRUD", () => {
  test.skip(
    !CRUD_ENABLED,
    "IDENTUUM_E2E_ORGS_CRUD is not 1 — skipping the destructive end-to-end CRUD ceremony. " +
      "The spec creates a real org row + a real first-org_admin user row. Run it standalone " +
      "against the dev stack where site_admin has TOTP enrolled. The try/finally cleanup " +
      "soft-deletes the org at the end, but a leak can occur if the test fails mid-flow."
  );
  test.skip(skipAuthTests, SKIP_AUTH_MSG);

  test("create → list-visible → edit name → soft-delete → list-hidden → deleted-filter-visible", async () => {
    const ctx = siteAdminCtx;
    if (!ctx) throw new Error("siteAdminCtx not initialized — check beforeAll");
    const page = await ctx.newPage();

    // Disposable identifiers — unique per run, no fixed value.
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 100000);
    const initialName = `E2E CRUD ${ts}-${rand}`;
    const editedName = `${initialName} (edited)`;
    const domain = `e2e-crud-${ts}-${rand}.disposible.org`;
    const adminEmail = `admin+e2e-crud-${ts}-${rand}@disposible.org`;

    let createdOrgId: string | null = null;

    try {
      // 1. Submit the create form.
      await page.goto("/site-admin/organizations/new");
      await expect(
        page.getByRole("heading", { name: /Create organization/i, level: 1 })
      ).toBeVisible({ timeout: 10_000 });

      await page.locator('input[name="name"]').fill(initialName);
      await page.locator('input[name="domain"]').fill(domain);
      await page.locator('input[name="admin_email"]').fill(adminEmail);
      await page.getByRole("button", { name: /Create organization/i }).click();

      // The create action either redirects to the org detail OR
      // renders an inline success panel. We tolerate both shapes —
      // the load-bearing assertion below is "the org is visible in
      // the default list", which proves the create wire path worked
      // end-to-end.
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // 2. Assert the new org appears in the DEACTIVATED view. Measured
      // against the shipped product (first live run of this formerly
      // always-skipped spec): create WITH admin_email births the org
      // INACTIVE by design (the create handler refuses active+admin_email
      // — "active_conflicts_with_admin_email" — and the /new page copy
      // says orgs stay inactive until the admin activates), and the
      // default "current" list view is active-only, so the original
      // "visible in the default list" premise could never hold.
      await page.goto("/site-admin/organizations?state=deactivated");
      await expect(page.getByRole("heading", { name: /Organizations/i, level: 1 })).toBeVisible({
        timeout: 10_000,
      });
      const initialRow = page
        .getByRole("row", { name: new RegExp(initialName.replace(/\s+/g, "\\s+"), "i") })
        .or(page.locator(`tr:has-text("${initialName}")`).first());
      await expect(initialRow.first()).toBeVisible({ timeout: 10_000 });

      // 3. Capture the org ID from the Details link inside that row.
      const detailsHref = await initialRow
        .first()
        .locator('a[href^="/site-admin/organizations/"]')
        .first()
        .getAttribute("href");
      const idMatch = detailsHref?.match(
        /\/site-admin\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );
      if (!idMatch) {
        throw new Error(
          `Could not extract org UUID from Details href ${detailsHref ?? "(null)"}; the test cannot reach the edit/delete forms without an ID.`
        );
      }
      createdOrgId = idMatch[1];

      // 4. Edit the name.
      await page.goto(`/site-admin/organizations/${createdOrgId}/edit`);
      await expect(page.getByRole("heading", { name: /Edit organization/i, level: 1 })).toBeVisible(
        { timeout: 10_000 }
      );
      const nameInput = page.locator('input[name="name"]');
      await nameInput.fill(editedName);
      await page.getByRole("button", { name: /Save changes/i }).click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // 5. The deactivated view (the org is still inactive) shows the
      // edited name.
      await page.goto("/site-admin/organizations?state=deactivated");
      await expect(page.locator(`tr:has-text("${editedName}")`).first()).toBeVisible({
        timeout: 10_000,
      });

      // 6. Soft-delete via the destructive-confirm page.
      await page.goto(`/site-admin/organizations/${createdOrgId}/delete`);
      await expect(
        page.getByRole("heading", { name: /Delete organization/i, level: 1 })
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('input[type="checkbox"][name="confirmed"]').check();
      // Danger button — text varies ("Soft-delete organization" or similar).
      await page.getByRole("button", { name: /Soft-delete|Delete organization|Delete/i }).click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // Mark cleanup as done so the finally block does not attempt a
      // second delete.
      createdOrgId = null;

      // 7. The deactivated view (where the org just lived) no longer
      // shows it — the ORIGINAL default-list absence assert was vacuous
      // for an org that was never in the active-only view.
      await page.goto("/site-admin/organizations?state=deactivated");
      await expect(page.locator(`tr:has-text("${editedName}")`)).toHaveCount(0, {
        timeout: 10_000,
      });

      // 8. Deleted view DOES show it — the soft-delete contract.
      await page.goto("/site-admin/organizations?state=deleted");
      await expect(page.locator(`tr:has-text("${editedName}")`).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      // If we have a non-null ID at this point, the create succeeded
      // but the subsequent step failed before the explicit delete.
      // Attempt a best-effort soft-delete to keep the dev DB clean.
      if (createdOrgId) {
        try {
          await page.goto(`/site-admin/organizations/${createdOrgId}/delete`);
          await page.locator('input[type="checkbox"][name="confirmed"]').check();
          await page
            .getByRole("button", { name: /Soft-delete|Delete organization|Delete/i })
            .click();
        } catch {
          // Swallow — the original test failure is what matters; the
          // leaked org can be cleaned up manually.
        }
      }
      await page.close();
    }
  });
});
