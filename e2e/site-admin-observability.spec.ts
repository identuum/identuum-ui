/**
 * Smoke coverage for the six site-admin observability pages landed by
 * slice identuum-20260530-site-admin-observability-pages.
 *
 * Read-only, non-mutating. Each test logs in as site_admin (using the
 * existing durable-env login helper), navigates to one of the six new
 * pages, and asserts: (a) the documented heading is visible; (b) no
 * 500 / not-found / application-error title; (c) no secret-shaped
 * substring appears in the rendered body.
 *
 * Self-skips when IDENTUUM_TEST_SITE_ADMIN_PASSWORD +
 * IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET are absent (the durable login
 * helper already enforces this via `skipAuthTests`).
 *
 * SECURITY:
 *   - The body text is captured into a local string and used only for
 *     substring assertions; it is NEVER printed to test output.
 *   - No mutation, no click on any sidebar action, no `?verify=true`
 *     navigation that would walk the audit chain (audit-chain page is
 *     visited in its idle state only).
 */

import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

const BODY_BANNED_PATTERNS: RegExp[] = [
  /\bclient_secret\b/i,
  /\bsecret_hash\b/i,
  /\bprivate_key\b/i,
  /\baccess_token\b/i,
  /\brefresh_token\b/i,
  /\bauthorization_code\b/i,
  /Bearer\s+[A-Za-z0-9._-]{8,}/,
  /\bsigning_key\b/i,
  /\bpassword_hash\b/i,
  /otpauth:\/\//i,
  /\bmfa_secret\b/i,
  /\bSet-Cookie\b/i,
  /\bDATABASE_URL\b/i,
  /\bREDIS_URL\b/i,
];

test.describe("/site-admin observability pages — read-only smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
      return;
    }
    await loginAsSiteAdmin(page);
  });

  test("Signing keys page renders", async ({ page }) => {
    await page.goto("/site-admin/keys");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Signing keys" })).toBeVisible();
    const bodyText = (await page.locator("body").textContent()) ?? "";
    for (const pat of BODY_BANNED_PATTERNS) {
      expect(bodyText.match(pat), `signing-keys body matched forbidden pattern ${pat}`).toBeNull();
    }
  });

  test("Anomaly page renders", async ({ page }) => {
    await page.goto("/site-admin/anomaly");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Anomaly" })).toBeVisible();
    const bodyText = (await page.locator("body").textContent()) ?? "";
    for (const pat of BODY_BANNED_PATTERNS) {
      expect(bodyText.match(pat), `anomaly body matched forbidden pattern ${pat}`).toBeNull();
    }
  });

  test("Reports page states the boundary and offers no export link", async ({ page }) => {
    await page.goto("/site-admin/reports");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    // Owner decision 5 (2026-09-25): no edition serves report exports.
    await expect(page.getByText("Report exports are not available")).toBeVisible();
    expect(await page.locator('main a[href*="/reports/"]').count()).toBe(0);
    expect(await page.getByRole("link", { name: /^(JSON|CSV|PDF)$/ }).count()).toBe(0);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    for (const pat of BODY_BANNED_PATTERNS) {
      expect(bodyText.match(pat), `reports body matched forbidden pattern ${pat}`).toBeNull();
    }
  });

  test("System landing page renders with three sub-page links", async ({ page }) => {
    await page.goto("/site-admin/system");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open Admin sessions$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open Audit chain verify$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open Runtime info$/ })).toBeVisible();
  });

  test("System / sessions page renders", async ({ page }) => {
    await page.goto("/site-admin/system/sessions");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Admin sessions" })).toBeVisible();
    // No emergency-revoke button is visible.
    expect(await page.getByRole("button", { name: /Emergency revoke/i }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^Revoke$/i }).count()).toBe(0);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    for (const pat of BODY_BANNED_PATTERNS) {
      expect(bodyText.match(pat), `sessions body matched forbidden pattern ${pat}`).toBeNull();
    }
  });

  test("System / audit-chain page renders the edition boundary on OSS (no verify invite)", async ({
    page,
  }) => {
    await page.goto("/site-admin/system/audit-chain");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Audit chain verify" })).toBeVisible();
    // AUDIT-CHAIN-INVITE-1: the OSS appliance reports audit_chain=false, so
    // the page pre-gates the verification invitation — the FeatureBoundaryPanel
    // renders directly and the "Ready to verify" invite + Verify button never
    // mount. (Before the pre-gate this smoke asserted the invite; that
    // expectation went stale when the gate deliberately removed it on OSS.)
    await expect(page.getByText(/Audit chain verification requires Enterprise\/CE/i)).toBeVisible();
    await expect(page.getByText(/Ready to verify/i)).not.toBeVisible();
    await expect(page.getByRole("link", { name: /^Verify audit chain$/ })).not.toBeVisible();
  });

  test("System / info page renders WITHOUT exposing DB URLs / Redis URLs / env vars [OBS-PASSIVE-1]", async ({
    page,
  }) => {
    await page.goto("/site-admin/system/info");
    await page.waitForLoadState("networkidle");
    expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);
    await expect(page.getByRole("heading", { name: "Runtime info" })).toBeVisible();
    const bodyText = (await page.locator("body").textContent()) ?? "";
    // Tighten the negative scan: NO `postgres://`, NO `redis://`,
    // NO `DATABASE_URL=`, NO `REDIS_URL=`, NO env-var-shape
    // substring. These should not appear because the backend's
    // /api/v1/health/details response does not return them.
    const INFO_BANNED: RegExp[] = [
      /postgres:\/\//i,
      /postgresql:\/\//i,
      /redis:\/\//i,
      /DATABASE_URL\s*=/i,
      /REDIS_URL\s*=/i,
      /\bIDENTUUM_IDP_DATABASE_PASSWORD\b/,
      /\bIDENTUUM_ENCRYPTION_KEY\b/,
    ];
    for (const pat of [...BODY_BANNED_PATTERNS, ...INFO_BANNED]) {
      expect(bodyText.match(pat), `system-info body matched forbidden pattern ${pat}`).toBeNull();
    }
  });
});
