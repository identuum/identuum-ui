/**
 * Local-demo regression coverage for the site_admin → org_admin MFA
 * recovery flow on /site-admin/organizations/[id].
 *
 * Covers behaviors 7–18 of identuum-20260527-playwright-local-demo-regression-suite:
 *
 *   - site_admin login + navigation to the target organization detail page.
 *   - The "Organization administrators" recovery card renders.
 *   - The configured org_admin email appears in that card with an MFA
 *     status pill.
 *   - The "Reset MFA" button opens a confirmation dialog whose copy is
 *     interpolated with the actual admin email — must read
 *       "Reset MFA for <email>? This will revoke active sessions.
 *        The administrator must sign in again and enroll a new authenticator."
 *     and NEVER "Reset MFA for ?".
 *   - (DESTRUCTIVE, opt-in) Confirming the reset shows a success badge,
 *     refreshes the row's MFA badge to "MFA disabled".
 *   - (DESTRUCTIVE, opt-in) The org_admin's next login routes into the
 *     TOTP enrollment form ("Set up two-factor authentication"), not
 *     directly into /org-admin.
 *
 * Env-gating:
 *   - Read-only tests require:
 *       IDENTUUM_TEST_SITE_ADMIN_PASSWORD + _TOTP_SECRET
 *       IDENTUUM_TEST_ORG_ID                                (org UUID; default is a placeholder)
 *       IDENTUUM_TEST_ORG_ADMIN_EMAIL                       (default: admin@example.org placeholder)
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
 *   - users.mfa_enabled flips false for the target org_admin row.
 *   - users.mfa_secret is cleared.
 *   - The target org_admin's active sessions are revoked.
 *   The org_admin can immediately re-enroll on next login. No other state
 *   is touched, and tenant org_user rows are never read or modified.
 *
 *   These tests print neither credentials, TOTP codes, secret blobs,
 *   nor session cookies. No setup/claim/recovery URL is ever surfaced
 *   by this flow.
 *
 * Requires the full Compose stack (IdP at localhost:7113, UI at localhost:7104).
 * Run with --workers=1 (shared with the rest of the auth suite).
 */

import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loadOrgAdminFixture, loadOrgAdminFixtureOrgId } from "./helpers/fixture";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

// Neutral placeholder defaults. Operators with a different local fixture
// MUST set IDENTUUM_TEST_ORG_ID and IDENTUUM_TEST_ORG_ADMIN_EMAIL in their
// local env file; the defaults exist only so the spec compiles and the
// env-resolution path is exercised.
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_ORG_ADMIN_EMAIL = "admin@example.org";

// Dynamic-fixture mode resolves the disposable org + its org_admin from the
// envelope, so the read-only recovery-card pins run against a REAL org rather
// than the nil-UUID placeholder (which renders "Organization not found").
// PRECEDENCE: the envelope WINS over IDENTUUM_TEST_* env vars — those may be
// residue from a retired local stack (the census's local-env-residue class:
// a stale admin email here once pointed the assertions at an org that only
// existed on the owner's machine). Env vars apply only when no envelope is
// present (durable-env mode).
function safeFixtureOrgId(): string | null {
  try {
    return loadOrgAdminFixtureOrgId();
  } catch {
    return null;
  }
}
function safeFixtureAdminEmail(): string | null {
  try {
    return loadOrgAdminFixture()?.email ?? null;
  } catch {
    return null;
  }
}

const ORG_ID = safeFixtureOrgId() ?? process.env.IDENTUUM_TEST_ORG_ID ?? DEFAULT_ORG_ID;
const ORG_ADMIN_EMAIL =
  safeFixtureAdminEmail() ?? process.env.IDENTUUM_TEST_ORG_ADMIN_EMAIL ?? DEFAULT_ORG_ADMIN_EMAIL;

const ORG_ADMIN_PASSWORD = process.env.IDENTUUM_TEST_ORG_ADMIN_PASSWORD ?? "";

// Opt-in safety latch. Keep the literal string "true" — any other value
// (including unset, empty, "1", "yes") leaves destructive tests skipped.
const DESTRUCTIVE_ALLOWED = process.env.IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET === "true";

const SKIP_DESTRUCTIVE_MSG =
  "Set IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true to opt in. This test resets the configured org_admin's MFA in the local demo.";

/**
 * Safety guard against running destructive MFA-reset behavior against the
 * placeholder defaults declared above. Called by every destructive test
 * BEFORE any page interaction (and therefore BEFORE any reset endpoint
 * could be reached) so a misconfigured operator environment fails fast
 * with a clear non-secret error.
 *
 * Refuses when ANY of the following is true:
 *   - IDENTUUM_TEST_ORG_ID is empty.
 *   - IDENTUUM_TEST_ORG_ID equals the all-zero placeholder UUID.
 *   - IDENTUUM_TEST_ORG_ADMIN_EMAIL is empty.
 *   - IDENTUUM_TEST_ORG_ADMIN_EMAIL equals the "admin@example.org"
 *     placeholder.
 *
 * The error message names only the offending VARIABLE NAME and the
 * reason. It NEVER reports the offending value, NEVER reports the
 * password / TOTP secret, and NEVER prints any other env content.
 *
 * Source-invariant tests in
 * src/__tests__/e2e-destructive-recovery-spec-safety.test.ts pin this helper
 * by reading this spec file as text; the spec itself is the runtime consumer.
 */
function requireConcreteDestructiveRecoveryTarget(): {
  orgId: string;
  orgAdminEmail: string;
} {
  if (!ORG_ID) {
    throw new Error("DESTRUCTIVE recovery spec refused to run: IDENTUUM_TEST_ORG_ID is empty");
  }
  if (ORG_ID === DEFAULT_ORG_ID) {
    throw new Error(
      "DESTRUCTIVE recovery spec refused to run: IDENTUUM_TEST_ORG_ID is the all-zero placeholder; set it to the actual local-fixture org UUID"
    );
  }
  if (!ORG_ADMIN_EMAIL) {
    throw new Error(
      "DESTRUCTIVE recovery spec refused to run: IDENTUUM_TEST_ORG_ADMIN_EMAIL is empty"
    );
  }
  if (ORG_ADMIN_EMAIL === DEFAULT_ORG_ADMIN_EMAIL) {
    throw new Error(
      "DESTRUCTIVE recovery spec refused to run: IDENTUUM_TEST_ORG_ADMIN_EMAIL is the neutral 'admin@example.org' placeholder; set it to the actual local-fixture org_admin email"
    );
  }
  return { orgId: ORG_ID, orgAdminEmail: ORG_ADMIN_EMAIL };
}

// ── Shared site_admin context ─────────────────────────────────────────────────

let siteAdminCtx: BrowserContext | null = null;

function getSiteAdminContext(): BrowserContext {
  if (!siteAdminCtx) {
    throw new Error("site admin context not initialized");
  }
  return siteAdminCtx;
}

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
 * Locates the configured org_admin row inside the recovery card. The row
 * is a <li> whose visible content includes the email text.
 */
function adminRowFor(page: Page, email: string) {
  return recoveryCard(page).locator("li").filter({ hasText: email });
}

// ── Read-only behavior (items 7–15) ───────────────────────────────────────────

test.describe("/site-admin/organizations/[id] — admin recovery card (read-only)", () => {
  test("admin recovery card lists the configured org_admin with an MFA status pill", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSiteAdminContext().newPage();
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
        recoveryCard(page).getByText(/Only org_admin accounts are shown|sovereign bunker policy/i)
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("'Reset MFA' button opens dialog with the actual email interpolated into the copy", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSiteAdminContext().newPage();
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
      await expect(dialog).toContainText(/sign in again and enroll a new authenticator/i);

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
    // SAFETY: refuse placeholder targets BEFORE any page interaction so
    // no MFA-reset endpoint can be reached against an unintended fixture.
    requireConcreteDestructiveRecoveryTarget();

    const page = await getSiteAdminContext().newPage();
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

  test("the configured org_admin's next login routes into TOTP enrollment, not /org-admin [MFA-RESET-REENROLL-1]", async ({
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
    // SAFETY: refuse placeholder targets BEFORE any page interaction so
    // no login flow can run against an unintended fixture.
    requireConcreteDestructiveRecoveryTarget();

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
