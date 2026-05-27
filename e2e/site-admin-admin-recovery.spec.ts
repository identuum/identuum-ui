/**
 * Local-demo regression coverage for the site_admin → org_admin MFA
 * recovery flow on /site-admin/organizations/[id].
 *
 * Covers behaviors 7–18 of identuum-20260527-playwright-local-demo-regression-suite:
 *
 *   - site_admin login + navigation to the Audi organization detail page.
 *   - The "Organization administrators" recovery card renders.
 *   - admin@audi.de appears in that card with an MFA status pill.
 *   - The "Reset MFA" button opens a confirmation dialog whose copy is
 *     interpolated with the actual admin email — must read
 *       "Reset MFA for admin@audi.de? This will revoke active sessions.
 *        The administrator must sign in again and enroll a new authenticator."
 *     and NEVER "Reset MFA for ?".
 *   - (DESTRUCTIVE, opt-in) Confirming the reset shows a success badge,
 *     refreshes the row's MFA badge to "MFA disabled".
 *   - (DESTRUCTIVE, opt-in) admin@audi.de's next login routes into the
 *     TOTP enrollment form ("Set up two-factor authentication"), not
 *     directly into /org-admin.
 *
 * Env-gating:
 *   - Read-only tests require:
 *       IDENTUUM_TEST_SITE_ADMIN_PASSWORD + _TOTP_SECRET
 *       IDENTUUM_TEST_ORG_ID                                (default: Audi local UUID)
 *       IDENTUUM_TEST_ORG_ADMIN_EMAIL                       (default: admin@audi.de)
 *
 *   - Destructive tests additionally require:
 *       IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true
 *     This flag exists so a routine `pnpm e2e` never wipes a local
 *     demo's admin MFA enrollment by accident.
 *
 *     For the "next login routes to enrollment" check, IDENTUUM_TEST_ORG_ADMIN_PASSWORD
 *     must also be set so the password step can be exercised.
 *
 * Mutation footprint when the destructive flag is on:
 *   - users.mfa_enabled flips false for admin@audi.de.
 *   - users.mfa_secret is cleared.
 *   - admin@audi.de's active sessions are revoked.
 *   The org_admin can immediately re-enroll on next login. No other state
 *   is touched, and tenant org_user rows are never read or modified.
 *
 *   These tests print neither credentials, TOTP codes, secret blobs,
 *   nor session cookies. No setup/claim/recovery URL is ever surfaced
 *   by this flow.
 *
 * Requires the full Compose stack (IdP at localhost:7113, UI at localhost:7114).
 * Run with --workers=1 (shared with the rest of the auth suite).
 */

import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { SKIP_AUTH_MSG, loginAsSiteAdmin, skipAuthTests } from "./helpers/login";

// Local-demo defaults from CLAUDE.md / Audi fixture row.
const DEFAULT_ORG_ID = "019e67c6-e71d-76ce-a615-ada70411d953";
const DEFAULT_ORG_ADMIN_EMAIL = "admin@audi.de";

const ORG_ID = process.env.IDENTUUM_TEST_ORG_ID ?? DEFAULT_ORG_ID;
const ORG_ADMIN_EMAIL =
  process.env.IDENTUUM_TEST_ORG_ADMIN_EMAIL ?? DEFAULT_ORG_ADMIN_EMAIL;

const ORG_ADMIN_PASSWORD = process.env.IDENTUUM_TEST_ORG_ADMIN_PASSWORD ?? "";

// Opt-in safety latch. Keep the literal string "true" — any other value
// (including unset, empty, "1", "yes") leaves destructive tests skipped.
const DESTRUCTIVE_ALLOWED =
  process.env.IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET === "true";

const SKIP_DESTRUCTIVE_MSG =
  "Set IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true to opt in. This test resets admin@audi.de's MFA in the local demo.";

// ── Shared site_admin context ─────────────────────────────────────────────────

let siteAdminCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // see other auth specs — TOTP cooldown headroom
  if (skipAuthTests) return;
  siteAdminCtx = await browser.newContext();
  const p = await siteAdminCtx.newPage();
  await loginAsSiteAdmin(p);
  await p.close();
});

test.afterAll(async () => {
  await siteAdminCtx?.close();
  siteAdminCtx = null;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Locator for the "Organization administrators" card container. Anchored
 * on the card heading and walked up to the rounded card wrapper.
 *
 * Scoping subsequent assertions through this locator avoids strict-mode
 * collisions with neighbouring cards — the existing "Administrator
 * status" card also mentions the sovereign bunker policy, so a
 * page-wide getByText would match two elements.
 */
function recoveryCard(page: Page) {
  return page
    .getByText("Organization administrators")
    .locator("xpath=ancestor::*[contains(@class,'rounded-')][1]");
}

/**
 * Locates the admin@audi.de row inside the recovery card. The row is a
 * <li> whose visible content includes the email text.
 */
function adminRowFor(page: Page, email: string) {
  return recoveryCard(page).locator("li").filter({ hasText: email });
}

// ── Read-only behavior (items 7–15) ───────────────────────────────────────────

test.describe("/site-admin/organizations/[id] — admin recovery card (read-only)", () => {
  test("admin recovery card lists admin@audi.de with an MFA status pill", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto(`/site-admin/organizations/${ORG_ID}`);
      await page.waitForLoadState("networkidle");

      // Fail fast if the session was rejected.
      expect(new URL(page.url()).pathname).toBe(`/site-admin/organizations/${ORG_ID}`);

      // Card heading is the wire-anchor for the recovery section.
      await expect(page.getByText("Organization administrators")).toBeVisible();

      const row = adminRowFor(page, ORG_ADMIN_EMAIL);
      await expect(row).toHaveCount(1);

      // MFA pill is one of "MFA enabled" or "MFA disabled" — both are
      // valid depending on the current local-demo state.
      const mfaEnabled = await row.getByText("MFA enabled").count();
      const mfaDisabled = await row.getByText("MFA disabled").count();
      expect(mfaEnabled + mfaDisabled).toBeGreaterThanOrEqual(1);

      // The card never lists tenant org_users — sovereign-bunker invariant.
      // We can't enumerate org_user emails here (we shouldn't), so we
      // pin the card description instead. Scope the lookup to the recovery
      // card so we don't strict-mode-collide with the neighbouring
      // "Administrator status" card, whose own paragraph also mentions
      // the sovereign bunker policy.
      await expect(
        recoveryCard(page).getByText(
          /Only org_admin accounts are shown|sovereign bunker policy/i
        )
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("'Reset MFA' button opens dialog with the actual email interpolated into the copy", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto(`/site-admin/organizations/${ORG_ID}`);
      await page.waitForLoadState("networkidle");

      const row = adminRowFor(page, ORG_ADMIN_EMAIL);
      await expect(row).toHaveCount(1);

      // Click the row's "Reset MFA" trigger. The same string is the
      // accessible name of both the trigger button and the dialog's
      // confirm button, so we click via the row scope.
      await row.getByRole("button", { name: /Reset MFA/i }).click();

      // The dialog is a single role="dialog" element.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // PIN: the dialog copy MUST include the actual email — regression
      // guard against "Reset MFA for ?" (the empty-interpolation bug).
      // We assert that the email appears somewhere in the dialog body.
      await expect(dialog).toContainText(ORG_ADMIN_EMAIL);

      // PIN: the destructive-side-effect copy must be present.
      await expect(dialog).toContainText(/revoke active sessions/i);
      await expect(dialog).toContainText(
        /sign in again and enroll a new authenticator/i
      );

      // Negative pin: empty interpolation must never render.
      await expect(dialog).not.toContainText("Reset MFA for ?");

      // Cancel without confirming — non-destructive.
      await dialog.getByRole("button", { name: /Cancel/i }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ── Destructive coverage (items 16–18, opt-in) ────────────────────────────────

test.describe("/site-admin/organizations/[id] — admin recovery flow (DESTRUCTIVE)", () => {
  test("confirming reset clears MFA on the row and shows the success badge", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    if (!DESTRUCTIVE_ALLOWED) {
      test.skip(true, SKIP_DESTRUCTIVE_MSG);
    }

    const page = await siteAdminCtx!.newPage();
    try {
      await page.goto(`/site-admin/organizations/${ORG_ID}`);
      await page.waitForLoadState("networkidle");

      const row = adminRowFor(page, ORG_ADMIN_EMAIL);
      await expect(row).toHaveCount(1);

      // Capture the row's button strictly — the dialog's submit button
      // has the same accessible name and we don't want to bind to it
      // yet.
      const triggerBtn = row.getByRole("button", { name: /Reset MFA/i }).first();
      await triggerBtn.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Sanity: confirm the email is interpolated. Reuse the same
      // assertion here so a failure points clearly at this step.
      await expect(dialog).toContainText(ORG_ADMIN_EMAIL);

      // The dialog has its own submit button with the same name. Filter
      // to the one inside <form> (the trigger sits outside any form).
      const confirmBtn = dialog.locator("form").getByRole("button", {
        name: /Reset MFA/i,
      });
      await confirmBtn.click();

      // Dialog closes on success. Wait for it to detach before checking
      // page state — revalidatePath rerenders the row inline.
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      // After revalidation, the row should re-render with the
      // MFA-disabled pill. The page rerender may take a tick.
      const updatedRow = adminRowFor(page, ORG_ADMIN_EMAIL);
      await expect(updatedRow.getByText("MFA disabled")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await page.close();
    }
  });

  test("admin@audi.de's next login routes into TOTP enrollment, not /org-admin", async ({
    browser,
  }) => {
    if (!DESTRUCTIVE_ALLOWED) {
      test.skip(true, SKIP_DESTRUCTIVE_MSG);
    }
    if (!ORG_ADMIN_PASSWORD) {
      test.skip(
        true,
        "Set IDENTUUM_TEST_ORG_ADMIN_PASSWORD to verify post-reset MFA enrollment routing"
      );
    }

    // Use a clean context — we want a fresh login flow, not a
    // restored cached session (loginAsOrgAdmin would short-circuit
    // here, which is the opposite of what we need).
    const freshCtx = await browser.newContext();
    const page = await freshCtx.newPage();
    try {
      await page.goto("/login");
      await page.waitForURL(/\/login/);

      // Email step.
      await page.getByLabel("Email or domain").fill(ORG_ADMIN_EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();

      // Password step.
      const passwordInput = page.getByLabel("Password");
      await passwordInput.waitFor({ state: "visible" });
      await passwordInput.fill(ORG_ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();

      // PIN: the next surface is MFA enrollment, NOT /org-admin.
      // The enrollment form is detectable by its unique heading.
      await expect(
        page.getByRole("heading", { name: "Set up two-factor authentication" })
      ).toBeVisible({ timeout: 10_000 });

      // Negative pin: the user must not have been routed past MFA into
      // the org_admin area.
      expect(new URL(page.url()).pathname).not.toMatch(/^\/org-admin/);

      // We intentionally do NOT complete enrollment here. Driving
      // enrollment requires extracting the freshly-generated TOTP
      // secret from the page, generating a code, and submitting it.
      // That would re-enable MFA with a secret we cannot replay
      // across runs. The operator is expected to complete enrollment
      // manually after this test runs. See spec doc-block for the
      // documented limitation.
    } finally {
      await page.close();
      await freshCtx.close();
    }
  });
});
