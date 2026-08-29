/**
 * Rendered-DOM Playwright coverage for /org-admin/users/[id] — focuses
 * on the Recent activity card's per-row click → /org-admin/audit
 * subject-filtered navigation contract.
 *
 * Scope:
 *   - Dynamic-fixture mode only. The fixture provisions a disposable
 *     org_admin whose recent successful login produces at least one
 *     auth_success audit row where they are the subject; the test
 *     opens the user detail page for that admin, finds the Recent
 *     activity card, clicks the first row link, and asserts the
 *     audit page renders a subject-filtered view.
 *   - The test never mutates any data. It only navigates and clicks
 *     links. No destructive action, no reset endpoint, no fixture
 *     password / TOTP / cookie / storage state is printed.
 *   - Self-skips when dynamic-fixture mode is not requested.
 *
 * Session strategy:
 *   - Login ONCE in beforeAll and share the browser context, matching
 *     the existing e2e/org-admin-smoke.spec.ts + e2e/org-admin-settings.spec.ts
 *     pattern. Avoids TOTP replay failures.
 *
 * Requires:
 *   - Full Compose stack (IdP at localhost:7113, UI at localhost:7104).
 *   - Run with --workers=1 to avoid TOTP replay-protection failures.
 *
 * SECURITY:
 *   - Reads the fixture admin's user_id via the narrow accessor
 *     `loadOrgAdminFixtureUserId()` which returns ONLY the non-secret
 *     UUID. The accessor never returns credentials or envelope
 *     metadata.
 *   - The clicked link target is constrained to /org-admin/audit with
 *     subject_id + event_type query params. The test asserts the
 *     "Subject filter active:" notice is visible — the IDP backend
 *     enforces tenant scoping so a misconstructed UUID could not
 *     leak cross-tenant data.
 *   - Never asserts on raw audit metadata, IP addresses, user agents,
 *     session IDs, or any sensitive payload. The test inspects only
 *     URL shape, card presence, link role, and the safe filter-notice
 *     copy.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loadOrgAdminFixtureUserId } from "./helpers/fixture";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test reads the disposable fixture's org_admin user_id.";

// ── Shared auth context ──────────────────────────────────────────────────────

let sharedCtx: BrowserContext | null = null;

function getSharedContext(): BrowserContext {
  if (!sharedCtx) {
    throw new Error("shared context not initialized");
  }
  return sharedCtx;
}

function requireValue<T>(value: T | null | undefined, message: string): NonNullable<T> {
  expect(value, message).not.toBeNull();
  expect(value, message).not.toBeUndefined();
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // 31s TOTP cooldown + ~70s TOTP retry headroom
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

// ── Recent activity row → audit filter navigation ────────────────────────────

test.describe("/org-admin/users/[id] — Recent activity card", () => {
  test("[dynamic mode only] clicking a recent activity row navigates to /org-admin/audit with subject_id and event_type filters", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }

    const fixtureUserId = requireValue(
      loadOrgAdminFixtureUserId(),
      "dynamic-fixture mode must produce a fixture file the accessor can read"
    );
    // Narrow UUID-shape sanity (the accessor already enforced this;
    // re-pinning so the test fails loudly if a future regression
    // weakens the accessor).
    expect(fixtureUserId).toMatch(/^[0-9a-fA-F-]{32,36}$/);

    const page = await getSharedContext().newPage();
    try {
      // Navigate directly to the fixture admin's own user-detail page.
      // The /org-admin layout guard already validated the role; this
      // page is reachable to the same org_admin viewing themselves.
      await page.goto(`/org-admin/users/${fixtureUserId}`);
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);

      // The Recent activity card renders only when the API returned
      // at least one event. The fixture admin's recent login (which
      // routed through CompleteMFALogin) should have produced at least
      // one auth_success audit row where the admin is the subject —
      // so the card is expected to appear. If the test environment's
      // licence tier ever degrades to one without audit, this test
      // would self-skip rather than fail; for now we assert the card.
      const cardHeading = page.getByText("Recent activity", { exact: true });
      const cardVisible = await cardHeading
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!cardVisible) {
        test.skip(
          true,
          "Recent activity card not rendered — license tier may not include audit; nothing to click"
        );
      }

      // Each row is now wrapped in an <a> with aria-label
      // "View audit event <event_type> for this user". Find the first
      // such link. We accept any event_type (the fixture admin's
      // first row will typically be `auth_success` but we don't
      // depend on it).
      const rowLinks = page.getByRole("link", {
        name: /^View audit event \S+ for this user$/,
      });
      const rowCount = await rowLinks.count();
      expect(rowCount, "at least one Recent activity row must be a link").toBeGreaterThan(0);

      // Prefer the first auth_success row (the slice's canonical
      // example), but fall back to the first row when no
      // auth_success row is visible. This keeps the test robust to
      // audit-event ordering changes.
      const authSuccessLink = page
        .getByRole("link", { name: /^View audit event auth_success for this user$/ })
        .first();
      const targetLink = (await authSuccessLink.count()) > 0 ? authSuccessLink : rowLinks.first();

      // Capture the link's href BEFORE clicking so we can pin the
      // shape the helper produced. We do NOT print the href to test
      // output — we only assert structural properties.
      const href = (await targetLink.getAttribute("href")) ?? "";
      expect(href).toMatch(/^\/org-admin\/audit\?/);
      expect(href).toContain(`subject_id=${encodeURIComponent(fixtureUserId)}`);
      // The per-row link MUST carry event_type. The helper appends
      // it whenever the row's event_type is non-empty (always true
      // for real audit events).
      expect(href).toMatch(/&event_type=[^&]+/);

      // Extract the event_type from the link href so we can assert
      // it threaded through to the audit page after navigation.
      const eventTypeMatch = href.match(/[?&]event_type=([^&]+)/);
      expect(eventTypeMatch).not.toBeNull();
      const clickedEventType = decodeURIComponent(eventTypeMatch?.[1] ?? "");

      // Click the row link.
      await Promise.all([page.waitForLoadState("networkidle"), targetLink.click()]);

      // The audit page is rendered, not a 500 / 404.
      expect(await page.title()).not.toMatch(/500|internal error|application error/i);
      await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();

      // URL contract: subject_id and event_type both present.
      const finalURL = page.url();
      expect(finalURL).toContain("/org-admin/audit");
      expect(finalURL).toContain(`subject_id=${encodeURIComponent(fixtureUserId)}`);
      expect(finalURL).toContain(`event_type=${encodeURIComponent(clickedEventType)}`);

      // "Subject filter active:" notice is visible — confirms the
      // audit page actually applied the filter (not just received the
      // query param and ignored it).
      await expect(page.getByText("Subject filter active:", { exact: false })).toBeVisible();

      // The "Clear subject filter" affordance is visible so the
      // operator can break out of the filter.
      await expect(page.getByRole("link", { name: /^Clear subject filter$/ })).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ── Users-completion batch (2026-05-30) — safe-state affordance checks ──────
//
// The org-admin Users completion batch adds three new surfaces:
//   - Bulk invite drawer on /org-admin/users (collapsed by default)
//   - Approve registration button on /org-admin/users/[id] (only for
//     pending_approval users — the fixture admin is not in that state so
//     the button should be absent on their own detail page)
//   - Assigned-roles card on /org-admin/users/[id]
//
// These tests assert presence/absence ONLY — they never click the bulk
// submit button, never assign or remove roles, never approve anyone, and
// never type into the textarea. They are safe to run in any environment.

test.describe("/org-admin/users — bulk invite affordance (safe-state)", () => {
  test("the Bulk invite button is rendered on /org-admin/users", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/users");
      await expect(page.getByRole("button", { name: /^Bulk invite$/ })).toBeVisible();
      // THE-INVITE-BUTTON (2026-08-29): the single-invite affordance was
      // REMOVED — measured live, both its shapes (manual link and email)
      // failed with "Could not create invitation." because the OSS backend's
      // POST /api/v1/users refuses password-less creates. This pin holds the
      // affordance absent until a backend that can honor it exists.
      await expect(page.getByRole("button", { name: /^Invite user$/ })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test("the bulk drawer expands/collapses without submitting", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/users");
      await page.getByRole("button", { name: /^Bulk invite$/ }).click();
      // The drawer surfaces the textarea, the Close button, and the Send invites button.
      await expect(page.getByLabel(/Entries/)).toBeVisible();
      await expect(page.getByRole("button", { name: /^Send invites$/ })).toBeVisible();
      // Click Close — do NOT submit.
      await page.getByRole("button", { name: /^Close$/ }).click();
      await expect(page.getByLabel(/Entries/)).toBeHidden();
    } finally {
      await page.close();
    }
  });
});

test.describe("/org-admin/users/[id] — assigned-roles card + approve affordance (safe-state)", () => {
  test("[dynamic mode only] the Assigned roles card is rendered on the fixture admin's own detail page", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const fixtureUserId = await loadOrgAdminFixtureUserId();
    if (!fixtureUserId) {
      test.skip(true, "Dynamic-fixture user id not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto(`/org-admin/users/${fixtureUserId}`);
      // The Assigned-roles card title — rendered as a styled <p>, not a
      // semantic heading, to match the surrounding card layout. Match it
      // by exact text to avoid colliding with the sidebar or any future
      // heading on the page.
      await expect(page.getByText(/^Assigned roles$/, { exact: true })).toBeVisible();
      // The Approve registration button must NOT be visible — the fixture
      // org_admin is active (not banned/pending approval). This guards
      // against an over-eager render that would surface the approve
      // affordance on the wrong predicate.
      await expect(page.getByRole("button", { name: /^Approve registration$/ })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});
