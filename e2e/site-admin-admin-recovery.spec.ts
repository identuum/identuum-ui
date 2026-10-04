/**
 * Local-demo regression coverage for the org_admin status card on
 * /site-admin/organizations/[id], and for sign-in after an MFA reset.
 *
 *   - site_admin login + navigation to the target organization detail page.
 *   - The "Organization administrators" card renders.
 *   - The configured org_admin email appears in that card with an MFA
 *     status pill.
 *   - The card offers NO "Reset MFA" action: a site_admin never resets a
 *     user of an organization (D-025), and the IdP refuses it.
 *   - (DESTRUCTIVE, opt-in) An org_admin whose MFA another org_admin of the
 *     same organization reset signs in and is routed into the TOTP
 *     enrollment form ("Set up two-factor authentication"), not directly
 *     into /org-admin. The reset is made while the harness seeds the
 *     disposable recovery organization; this spec proves the sign-in.
 *
 * Env-gating:
 *   - Read-only tests require:
 *       IDENTUUM_TEST_SITE_ADMIN_PASSWORD + _TOTP_SECRET
 *       IDENTUUM_TEST_ORG_ID                                (org UUID; default is a placeholder)
 *       IDENTUUM_TEST_ORG_ADMIN_EMAIL                       (default: admin@example.org placeholder)
 *
 *   - The sign-in test additionally requires:
 *       IDENTUUM_E2E_ALLOW_DESTRUCTIVE_MFA_RESET=true
 *     and the disposable recovery organization the harness seeds (it holds
 *     the account whose MFA was reset). Outside the harness the test skips.
 *
 *     The password step needs IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD, which
 *     the harness sets.
 *
 * Mutation footprint: none from this spec. The sign-in leaves an unfinished
 * enrolment on a disposable account; no other state is touched, and tenant
 * org_user rows are never read or modified.
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
import { expectHonestAuthAnswer } from "./helpers/appliance-fixture";
import {
  loadOrgAdminFixture,
  loadOrgAdminFixtureOrgId,
  loadRecoveryFixture,
} from "./helpers/fixture";
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

// THE-DISPOSABLE-IDENTITIES (2026-08-30): the DISPOSABLE recovery fixture
// (seeded by the harness provisioner; org id + admin email only) WINS over
// the shared envelope and env — this ceremony resets its target's MFA, and
// pointing it at the shared fixture org_admin would stale the envelope's
// TOTP secret for every later spec in the run.
const recoveryFx = (() => {
  try {
    return loadRecoveryFixture();
  } catch {
    return null;
  }
})();
const ORG_ID =
  recoveryFx?.orgId ?? safeFixtureOrgId() ?? process.env.IDENTUUM_TEST_ORG_ID ?? DEFAULT_ORG_ID;
const ORG_ADMIN_EMAIL =
  recoveryFx?.orgAdminEmail ??
  safeFixtureAdminEmail() ??
  process.env.IDENTUUM_TEST_ORG_ADMIN_EMAIL ??
  DEFAULT_ORG_ADMIN_EMAIL;

const ORG_ADMIN_PASSWORD =
  (recoveryFx ? process.env.IDENTUUM_E2E_RECOVERY_ORG_ADMIN_PASSWORD : undefined) ??
  process.env.IDENTUUM_TEST_ORG_ADMIN_PASSWORD ??
  "";

// The org_admin whose MFA the recovery org's own admin reset while the
// harness seeded it (D-025: a site_admin never resets a tenant user). Only the
// harness's disposable recovery fixture carries it.
const RESET_ADMIN_EMAIL = recoveryFx?.resetAdminEmail ?? "";

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

      // Fail fast if the session was rejected. THE-SESSION-REJECTION-ROOT-CAUSE
      // (AUTH-503): the IdP now answers a store error as 503 (the UI's
      // session helper retries it) and a verdict as 401 WITH a reason, so the
      // former second-probe diagnostic is gone; on a bounce, the same cookie
      // jar's /validate must give an honest answer — never a bare 401.
      const landedPath = new URL(page.url()).pathname;
      if (landedPath !== `/site-admin/organizations/${ORG_ID}`) {
        const probe = await page.request.get("/api/idp/api/v1/validate");
        await expectHonestAuthAnswer(
          probe.status(),
          () => probe.json(),
          `after landing on ${landedPath}`
        );
      }
      expect(landedPath).toBe(`/site-admin/organizations/${ORG_ID}`);

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

  test("the card offers no 'Reset MFA' action — a site_admin never resets a tenant user (D-025)", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    const page = await getSiteAdminContext().newPage();
    try {
      await page.goto(`/site-admin/organizations/${ORG_ID}`);
      await page.waitForLoadState("networkidle");

      const row = adminRowFor(page, ORG_ADMIN_EMAIL);
      await expect(row).toHaveCount(1);

      // The row shows status only: no button, so no dialog either.
      await expect(row.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Reset MFA/i })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});

// ── Sign-in after an MFA reset (opt-in) ───────────────────────────────────────

test.describe("sign-in after an MFA reset (DESTRUCTIVE latch)", () => {
  test("the card shows an org_admin whose MFA the organization's own admin reset as 'MFA disabled'", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    if (!DESTRUCTIVE_ALLOWED) {
      test.skip(true, SKIP_DESTRUCTIVE_MSG);
    }
    if (!RESET_ADMIN_EMAIL) {
      test.skip(
        true,
        "The reset account exists only in the harness's disposable recovery organization"
      );
    }
    // SAFETY: refuse placeholder targets BEFORE any page interaction.
    requireConcreteDestructiveRecoveryTarget();

    const page = await getSiteAdminContext().newPage();
    try {
      await page.goto(`/site-admin/organizations/${ORG_ID}`);
      await page.waitForLoadState("networkidle");

      const row = adminRowFor(page, RESET_ADMIN_EMAIL);
      await expect(row).toHaveCount(1);
      await expect(row.getByText("MFA disabled")).toBeVisible({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  test("an org_admin whose MFA was reset signs in to TOTP enrollment, not /org-admin [MFA-RESET-REENROLL-1]", async ({
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
    if (!RESET_ADMIN_EMAIL) {
      test.skip(
        true,
        "The reset account exists only in the harness's disposable recovery organization"
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
      await page.getByLabel("Email or domain").fill(RESET_ADMIN_EMAIL);
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
