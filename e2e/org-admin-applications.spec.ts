/**
 * Rendered-DOM Playwright coverage for /org-admin/applications —
 * the read-only OAuth-clients list landed in the
 * `identuum-20260530-org-admin-applications-surface-discovery-and-foundation`
 * slice.
 *
 * Scope:
 *   - Dynamic-fixture mode only. The fixture provisions a disposable
 *     org with NO OAuth clients, so this test primarily exercises:
 *     route renders, page is not 500/404, sidebar Applications link
 *     is marked active, the empty-state panel appears, and no
 *     secret-shaped substring leaks into the page body.
 *   - The test also visits /org-admin Overview and clicks the
 *     Applications card to verify the Overview-card navigation
 *     wiring landed in the same slice.
 *   - The test is strictly read-only. No mutation, no DELETE/POST/PATCH,
 *     no reset endpoint, no destructive flow. It only navigates and
 *     reads rendered DOM.
 *   - Self-skips when dynamic-fixture mode is not requested.
 *
 * Session strategy:
 *   - Login ONCE in beforeAll and share the browser context, matching
 *     the existing e2e/org-admin-smoke.spec.ts + e2e/org-admin-settings.spec.ts
 *     + e2e/org-admin-user-detail.spec.ts pattern. Avoids TOTP replay
 *     failures.
 *
 * Requires:
 *   - Full Compose stack (IdP at localhost:7113, UI at localhost:7104).
 *   - Run with --workers=1 to avoid TOTP replay-protection failures.
 *
 * SECURITY:
 *   - The page-body negative scan blocks `client_secret`, `private_key`,
 *     `access_token`, `refresh_token`, generic `Bearer …`, `signing_key`,
 *     `authorization_code`, and `auth_code` shapes. The UI types,
 *     wire client, and page source all guarantee these are never
 *     rendered; this test is the rendered-DOM regression-guard.
 *   - The test NEVER prints the page body or any rendered text — only
 *     uses substring assertions on locally-captured snapshots. No
 *     fixture JSON, no password, no TOTP secret, no Playwright
 *     storage state crosses out of the test.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  loadOrgAdminFixtureConfidentialSampleClient,
  loadOrgAdminFixtureSampleClient,
} from "./helpers/fixture";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test runs against the disposable fixture's seeded org + sample OAuth client.";

const SAMPLE_CLIENT_MISSING_SKIP_MSG =
  "Fixture envelope is missing the sample_client block. Rebuild IDP after slice identuum-20260530-e2e-fixture-seed-sample-oauth-client to seed it.";

const CONFIDENTIAL_CLIENT_MISSING_SKIP_MSG =
  "Fixture envelope is missing the confidential_sample_client block. Rebuild IDP after slice identuum-20260530-e2e-fixture-seed-confidential-oauth-client to seed it.";

// Page-body negative scan — none of these substrings may appear anywhere
// in the rendered DOM. The list mirrors the slice spec's blocklist. The
// body text is captured locally and NEVER printed to test output
// (assertion messages do not include the body).
const BODY_BANNED_PATTERNS: RegExp[] = [
  /\bclient_secret\b/i,
  /\bsecret_hash\b/i,
  /\bprivate_key\b/i,
  /\baccess_token\b/i,
  /\brefresh_token\b/i,
  /\bauthorization_code\b/i,
  /\bauth_code\b/i,
  /Bearer\s+[A-Za-z0-9._-]{8,}/,
  /\bsigning_key\b/i,
  /\bpassword_hash\b/i,
  /otpauth:\/\//i,
  /\bmfa_secret\b/i,
  /\bSet-Cookie\b/i,
];

// ── Shared auth context ──────────────────────────────────────────────────────

let sharedCtx: BrowserContext | null = null;

function getSharedContext(): BrowserContext {
  if (!sharedCtx) {
    throw new Error("shared context not initialized");
  }
  return sharedCtx;
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

// ── /org-admin/applications page render + sidebar active state ─────────────

test.describe("/org-admin/applications — read-only foundation", () => {
  test("[dynamic mode only] populated list renders the seeded sample client (name + client_id + Public); empty-state copy is gone; no secret-shaped string in body", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const sample = loadOrgAdminFixtureSampleClient();
    if (!sample) {
      test.skip(true, SAMPLE_CLIENT_MISSING_SKIP_MSG);
      return;
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/applications");
      await page.waitForLoadState("networkidle");

      // 500/404 sentry — Playwright's title for a Next.js 500 includes
      // "500" / "Internal Server Error" / "Application error".
      expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);

      // Heading is the load-bearing operator anchor.
      await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
      // Subtitle confirms within-org scoping.
      await expect(page.getByText(/OAuth clients registered in/i)).toBeVisible();
      await expect(page.getByText(/Read-only/i).first()).toBeVisible();

      // Sidebar Applications link is marked active.
      const sidebarApplications = page.locator(
        'nav a[href="/org-admin/applications"][aria-current="page"]'
      );
      await expect(sidebarApplications).toBeVisible();
      // The "soon" pill that used to render must NOT be present anymore.
      expect(await page.getByText("soon", { exact: true }).count()).toBe(0);

      // Empty-state copy MUST NOT appear — the seeded sample client
      // means the populated branch renders instead.
      expect(await page.getByText("No applications yet", { exact: true }).count()).toBe(0);

      // The seeded sample client name + client_id are operator-visible.
      // Name appears in two places (row title + the link's aria-label),
      // so use the first-match anchor to avoid a strict-mode collision.
      await expect(page.getByText(sample.name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(sample.clientId, { exact: true }).first()).toBeVisible();

      // Row badge — the seeded client is public, so a "Public" badge
      // MUST be visible on the row. Anchor on the exact label so we
      // do not collide with operator copy elsewhere on the page.
      await expect(page.getByText("Public", { exact: true }).first()).toBeVisible();

      // "View details" affordance is reachable by accessible name.
      const viewDetails = page.getByRole("link", {
        name: `View application ${sample.name}`,
      });
      await expect(viewDetails).toBeVisible();
      expect(await viewDetails.getAttribute("href")).toBe(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );

      // SECURITY — page body negative scan. Body text is captured
      // locally; assertion messages do not include the body.
      const bodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(bodyText.match(pat), `list page body matched forbidden pattern ${pat}`).toBeNull();
      }
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] View-details link navigates to detail page; detail renders sample client name + client_id + Public + safe fields; back link returns to list; no secret-shaped string in body", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const sample = loadOrgAdminFixtureSampleClient();
    if (!sample) {
      test.skip(true, SAMPLE_CLIENT_MISSING_SKIP_MSG);
      return;
    }

    const page = await getSharedContext().newPage();
    try {
      // Start on the populated list, then click through via the
      // operator-facing affordance so we exercise the same path a
      // human would take (not a deep-link navigation).
      await page.goto("/org-admin/applications");
      await page.waitForLoadState("networkidle");

      const viewDetails = page.getByRole("link", {
        name: `View application ${sample.name}`,
      });
      await expect(viewDetails).toBeVisible();
      await Promise.all([page.waitForLoadState("networkidle"), viewDetails.click()]);

      // URL reaches the deterministic sample client id.
      expect(page.url()).toContain(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
      expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);

      // Detail page heading is the sample client name.
      await expect(page.getByRole("heading", { name: sample.name })).toBeVisible();
      // client_id displays as the mono sub-header.
      await expect(page.getByText(sample.clientId, { exact: true }).first()).toBeVisible();

      // Public badge AND Type=Public dt/dd row (the slice spec wants
      // "Public" surfaced on the detail page).
      await expect(page.getByText("Public", { exact: true }).first()).toBeVisible();

      // Safe-field labels — the seeded client has one redirect URI and
      // a default scope, so both labels render. The seeded client's
      // redirect URI is operator-safe loopback (http://localhost:7104/callback)
      // — we assert presence of the label and the loopback value.
      await expect(page.getByText("Redirect URIs", { exact: true })).toBeVisible();
      await expect(page.getByText("http://localhost:7104/callback", { exact: true })).toBeVisible();
      await expect(page.getByText("Default scope", { exact: true })).toBeVisible();
      await expect(page.getByText("openid profile email", { exact: true })).toBeVisible();
      // Client ID dt label is also present (separate from the mono
      // sub-header) — pins the documented label set.
      await expect(page.getByText("Client ID", { exact: true })).toBeVisible();

      // Detail page MUST NOT carry any mutation affordance.
      expect(await page.getByRole("button", { name: /^Edit$/ }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /^Delete$/ }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /^Regenerate/i }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /^Rotate/i }).count()).toBe(0);

      // SECURITY — detail page body negative scan.
      const detailBodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(
          detailBodyText.match(pat),
          `detail page body matched forbidden pattern ${pat}`
        ).toBeNull();
      }

      // Back link returns to the list page.
      const backLink = page.getByRole("link", { name: /Back to Applications/i });
      await expect(backLink).toBeVisible();
      expect(await backLink.getAttribute("href")).toBe("/org-admin/applications");
      await Promise.all([page.waitForLoadState("networkidle"), backLink.click()]);
      expect(page.url()).toMatch(/\/org-admin\/applications$/);
      await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Overview Applications card navigates to /org-admin/applications", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);

      // The Overview cards expose accessible names of the form
      // "Open <Title>" via aria-label on the wrapping anchor. The
      // Applications card MUST be reachable by that name.
      const applicationsLink = page.getByRole("link", { name: /^Open Applications$/ });
      await expect(applicationsLink).toBeVisible();
      // Pin the href before navigating so a regression that flipped
      // the card to a different route would surface.
      expect(await applicationsLink.getAttribute("href")).toBe("/org-admin/applications");

      await Promise.all([page.waitForLoadState("networkidle"), applicationsLink.click()]);

      // After the click we must be on /org-admin/applications, with
      // the heading visible (re-pin of the load-bearing anchor).
      expect(page.url()).toContain("/org-admin/applications");
      await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Create application link navigates to /new and the form renders with copy-once warning", async () => {
    // Non-mutating: we click the "Create application" button on the
    // list page, assert the /new page renders all expected form
    // fields + the single-shot warning placeholder copy, but DO NOT
    // submit the form. No OAuth client is created; no cleanup is
    // required beyond the existing global-teardown fixture purge.
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/applications");
      await page.waitForLoadState("networkidle");

      const createLink = page.getByRole("link", { name: /^Create application$/ });
      await expect(createLink).toBeVisible();
      expect(await createLink.getAttribute("href")).toBe("/org-admin/applications/new");

      await Promise.all([page.waitForLoadState("networkidle"), createLink.click()]);

      // Routed to /new — sanity checks.
      expect(page.url()).toContain("/org-admin/applications/new");
      expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);

      // Page chrome — heading + subtitle that names the single-shot
      // contract ("shown only once").
      await expect(page.getByRole("heading", { name: "Create application" })).toBeVisible();
      await expect(page.getByText(/shown only once/i)).toBeVisible();

      // Form fields — each is a labelled input/textarea. Use the
      // exact accessible names (including the required-marker " *"
      // suffix) so the locators don't strict-mode-collide with each
      // other (e.g. "Redirect URIs *" vs "Post-logout redirect URIs"
      // would both match a substring "Redirect URIs").
      await expect(page.getByRole("textbox", { name: "Application name *" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Redirect URIs *" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Post-logout redirect URIs" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Allowed audiences" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^Default scope$/ })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Public client/i })).toBeVisible();

      // Submit button is present + enabled. We do NOT click it.
      const submitBtn = page.getByRole("button", { name: /^Create application$/ });
      await expect(submitBtn).toBeVisible();
      expect(await submitBtn.isDisabled()).toBe(false);

      // The page MUST NOT prematurely render a "Copy this secret now"
      // banner — that banner only appears on the SuccessPanel after
      // a real submission. Render-time presence would mean the
      // success-branch JSX is leaking into the initial idle state.
      expect(await page.getByText(/Copy this secret now/i).count()).toBe(0);

      // Negative scan — initial render must not contain any secret-
      // shaped substring. The body text is captured locally and
      // never printed.
      const bodyText = (await page.locator("body").textContent()) ?? "";
      const BANNED: RegExp[] = [
        /\bclient_secret\b/i,
        /\bprivate_key\b/i,
        /\baccess_token\b/i,
        /\brefresh_token\b/i,
        /Bearer\s+[A-Za-z0-9._-]{8,}/,
        /\bsigning_key\b/i,
        /\bauthorization_code\b/i,
      ];
      for (const pat of BANNED) {
        expect(
          bodyText.match(pat),
          `create-application page body matched forbidden pattern ${pat}`
        ).toBeNull();
      }
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Edit application link on detail page navigates to /edit; edit form is prefilled with safe fields; NO submit", async () => {
    // Non-mutating: we visit the seeded client's detail page, click
    // the "Edit application" link, assert the edit form prefills the
    // safe fields (name, client_id read-only, redirect URI, scope),
    // and run the body negative-scan. We DO NOT submit the form, so
    // no OAuth client is updated and no cleanup beyond the existing
    // global-teardown CASCADE purge is required.
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const sample = loadOrgAdminFixtureSampleClient();
    if (!sample) {
      test.skip(true, SAMPLE_CLIENT_MISSING_SKIP_MSG);
      return;
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
      await page.waitForLoadState("networkidle");

      // Edit affordance reachable by accessible name.
      const editLink = page.getByRole("link", {
        name: `Edit application ${sample.name}`,
      });
      await expect(editLink).toBeVisible();
      expect(await editLink.getAttribute("href")).toBe(
        `/org-admin/applications/${encodeURIComponent(sample.id)}/edit`
      );

      await Promise.all([page.waitForLoadState("networkidle"), editLink.click()]);

      // URL reaches the edit route.
      expect(page.url()).toContain(`/org-admin/applications/${encodeURIComponent(sample.id)}/edit`);
      expect(await page.title()).not.toMatch(/500|404|internal error|application error|not found/i);

      // Page chrome — heading mentions Edit + the client name.
      await expect(page.getByRole("heading", { name: `Edit ${sample.name}` })).toBeVisible();

      // Read-only client_id badge + Public type are surfaced in the
      // info panel — the seeded sample client is public so the "Type:
      // Public · ..." line must appear; the client_id text must be
      // present. The edit page renders Type / Public inline inside a
      // `<p>` so use a regex rather than exact: true.
      await expect(page.getByText(sample.clientId, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/Type:\s*Public/).first()).toBeVisible();

      // Form field anchors — name, redirect URIs, post-logout URIs,
      // allowed audiences, default scope. Use the exact accessible
      // names (with the required-marker " *" suffix on name +
      // redirect URIs) to avoid strict-mode locator collisions.
      const nameInput = page.getByRole("textbox", { name: "Application name *" });
      await expect(nameInput).toBeVisible();
      expect(await nameInput.inputValue()).toBe(sample.name);

      const redirectsInput = page.getByRole("textbox", { name: "Redirect URIs *" });
      await expect(redirectsInput).toBeVisible();
      // The fixture-seeded client carries exactly one redirect URI —
      // the loopback "http://localhost:7104/callback" the IDP CLI
      // hard-codes. The textarea's initial value is that single URI.
      expect(await redirectsInput.inputValue()).toBe("http://localhost:7104/callback");

      const postLogoutInput = page.getByRole("textbox", {
        name: "Post-logout redirect URIs",
      });
      await expect(postLogoutInput).toBeVisible();
      // The seeded client has no post-logout URIs.
      expect(await postLogoutInput.inputValue()).toBe("");

      const audiencesInput = page.getByRole("textbox", { name: "Allowed audiences" });
      await expect(audiencesInput).toBeVisible();
      expect(await audiencesInput.inputValue()).toBe("");

      const scopeInput = page.getByRole("textbox", { name: /^Default scope$/ });
      await expect(scopeInput).toBeVisible();
      expect(await scopeInput.inputValue()).toBe("openid profile email");

      // The form MUST NOT expose an is_public toggle or any other
      // advanced field — those are out of scope for this slice.
      expect(await page.getByRole("checkbox", { name: /Public client/i }).count()).toBe(0);
      expect(await page.getByRole("textbox", { name: /token.endpoint.auth.method/i }).count()).toBe(
        0
      );
      expect(await page.getByRole("textbox", { name: /^JWKS URI$/i }).count()).toBe(0);
      expect(await page.getByRole("textbox", { name: /^JWKS$/i }).count()).toBe(0);

      // No Delete / Regenerate / Rotate / secret-display affordance
      // on the edit page.
      expect(await page.getByRole("button", { name: /^Delete$/i }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /Regenerate/i }).count()).toBe(0);
      expect(await page.getByRole("button", { name: /Rotate/i }).count()).toBe(0);
      // Crucially: the page MUST NOT render a "Copy this secret now"
      // banner — that lives only on the post-create SuccessPanel and
      // would never appear on the edit surface.
      expect(await page.getByText(/Copy this secret/i).count()).toBe(0);

      // Save button is present + enabled. We DO NOT click it.
      const saveBtn = page.getByRole("button", { name: /^Save application$/ });
      await expect(saveBtn).toBeVisible();
      expect(await saveBtn.isDisabled()).toBe(false);

      // Cancel link points back to the detail page.
      const cancelLink = page.getByRole("link", { name: "Cancel" });
      await expect(cancelLink).toBeVisible();
      expect(await cancelLink.getAttribute("href")).toBe(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );

      // Body negative scan — same blocklist as the populated-list +
      // detail-page tests. Body text is captured locally; assertion
      // messages name only the matching pattern.
      const editBodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(
          editBodyText.match(pat),
          `edit-application page body matched forbidden pattern ${pat}`
        ).toBeNull();
      }
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Danger zone renders on detail page; type-to-confirm gate blocks submit; first click does NOT delete; NO submit", async () => {
    // Non-mutating: we expand the Danger zone, observe the
    // confirmation copy and the disabled-until-match state of the
    // final Delete submit, type a deliberately-wrong value to prove
    // the gate still blocks submit, type the correct value to prove
    // the gate releases — and STOP. We do NOT click the final
    // Delete submit, so no OAuth client is deleted and the
    // fixture-seeded sample client survives global-teardown's
    // CASCADE purge as the only cleanup path.
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const sample = loadOrgAdminFixtureSampleClient();
    if (!sample) {
      test.skip(true, SAMPLE_CLIENT_MISSING_SKIP_MSG);
      return;
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
      await page.waitForLoadState("networkidle");

      // Danger-zone heading is the load-bearing anchor for the
      // destructive surface.
      const dangerHeading = page.getByRole("heading", { name: "Danger zone" });
      await expect(dangerHeading).toBeVisible();

      // The page-level warning copy MUST explicitly mention that the
      // action cannot be undone — the operator must read this before
      // expanding the form.
      await expect(page.getByText(/cannot be undone/i).first()).toBeVisible();

      // Initial render: the EXPAND panel renders a type="button"
      // "Delete application" button that does NOT submit the form.
      // We click it to expand the confirmation panel — this MUST NOT
      // trigger a DELETE wire call (the button is type="button" + the
      // form action is only attached after expansion).
      const expandBtn = page.getByRole("button", { name: /^Delete application$/ });
      await expect(expandBtn).toBeVisible();
      expect(await expandBtn.isDisabled()).toBe(false);
      await expandBtn.click();

      // After expanding, the confirmation surface renders: the
      // type-to-confirm input + a now-visible submit Delete button +
      // a Cancel button. The instruction copy MUST name the exact
      // values the operator can type (the application name OR the
      // OAuth client_id).
      const confirmInput = page.getByRole("textbox", { name: /Type to confirm/i });
      await expect(confirmInput).toBeVisible();
      // The instruction copy includes the application name AND the
      // OAuth client_id — both as exact text.
      await expect(page.getByText(sample.name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(sample.clientId, { exact: true }).first()).toBeVisible();

      // The Submit Delete button is rendered but DISABLED until the
      // typed value matches.
      const submitBtn = page.getByRole("button", { name: /^Delete application$/ });
      await expect(submitBtn).toBeVisible();
      expect(await submitBtn.isDisabled()).toBe(true);

      // Typing a deliberately-wrong value keeps the button disabled.
      await confirmInput.fill("not-the-name");
      expect(await submitBtn.isDisabled()).toBe(true);

      // Typing the application name unlocks the button. We DO NOT
      // click it.
      await confirmInput.fill(sample.name);
      expect(await submitBtn.isDisabled()).toBe(false);

      // Re-blanking the input must re-disable submit so a stray
      // Enter / paste cannot complete the destructive action.
      await confirmInput.fill("");
      expect(await submitBtn.isDisabled()).toBe(true);

      // Typing the OAuth client_id unlocks the button (either matches).
      await confirmInput.fill(sample.clientId);
      expect(await submitBtn.isDisabled()).toBe(false);

      // Cancel collapses the form back to the ExpandPanel — no POST
      // emitted, no state preserved beyond React's transient flag.
      const cancelBtn = page.getByRole("button", { name: /^Cancel$/ });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();
      // After cancel, the ExpandPanel is back and the confirm input
      // is gone.
      expect(await page.getByRole("textbox", { name: /Type to confirm/i }).count()).toBe(0);
      await expect(page.getByRole("button", { name: /^Delete application$/ })).toBeVisible();

      // Body negative scan — same blocklist; no secret-shaped string
      // ever appears on the rendered DOM, even after the danger-zone
      // expand cycle.
      const dangerBodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(
          dangerBodyText.match(pat),
          `detail page (after danger-zone expand) body matched forbidden pattern ${pat}`
        ).toBeNull();
      }

      // Sanity: the seeded client is STILL the detail page's subject
      // — we never hit Delete, so the URL still points at it.
      expect(page.url()).toContain(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Security section renders on detail page; public seeded client shows no-rotate notice; rotate form/button is absent; Danger zone still renders; NO mutation", async () => {
    // The dynamic fixture seeds a PUBLIC OAuth client (is_public=true).
    // The Security section's public-branch MUST render the read-only
    // "Public clients do not have a client secret to rotate." notice
    // and MUST NOT render the rotate form, the type-to-confirm input,
    // or the destructive submit. The Danger zone (delete surface) is
    // unaffected and still renders below.
    //
    // Confidential-branch coverage (the full rotate + copy-once
    // SuccessPanel flow) is a known gap until the IDP fixture CLI
    // seeds a confidential client; this is documented in Section 6d.
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const sample = loadOrgAdminFixtureSampleClient();
    if (!sample) {
      test.skip(true, SAMPLE_CLIENT_MISSING_SKIP_MSG);
      return;
    }
    // The seeded sample client is public by construction (the IDP
    // fixture CLI hard-codes is_public=true on the seed). If a future
    // slice flips that flag the public-branch test below would no
    // longer reflect reality — fail loudly so the regression is
    // visible.
    expect(sample.isPublic).toBe(true);

    const page = await getSharedContext().newPage();
    try {
      await page.goto(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
      await page.waitForLoadState("networkidle");

      // Security section heading is present (load-bearing operator
      // anchor — its label MUST be "Security").
      const securityHeading = page.getByRole("heading", { name: "Security" });
      await expect(securityHeading).toBeVisible();

      // Public-branch notice copy is rendered verbatim.
      await expect(
        page.getByText(/Public clients do not have a client secret to rotate/i).first()
      ).toBeVisible();

      // The "Rotate client secret" button MUST NOT be present on the
      // page at all — neither in the expanded form's submit role nor
      // in the unexpanded ExpandPanel button role.
      expect(await page.getByRole("button", { name: /^Rotate client secret$/ }).count()).toBe(0);
      // The type-to-confirm input MUST NOT be present.
      expect(await page.getByRole("textbox", { name: /Type to confirm/i }).count()).toBe(0);
      // The success panel's copy-once / token-expiry phrases MUST NOT
      // be present on the public-branch render.
      expect(await page.getByText(/Copy this secret now/i).count()).toBe(0);
      expect(
        await page
          .getByText(/Existing access tokens issued before rotation continue to validate until/i)
          .count()
      ).toBe(0);

      // Danger zone (delete surface) is still rendered — its heading
      // anchor confirms the layout is intact.
      const dangerHeading = page.getByRole("heading", { name: "Danger zone" });
      await expect(dangerHeading).toBeVisible();

      // Body negative scan — same blocklist as the populated-list +
      // detail-page tests. Body text is captured locally; assertion
      // messages name only the matching pattern.
      const bodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(
          bodyText.match(pat),
          `Security section (public branch) body matched forbidden pattern ${pat}`
        ).toBeNull();
      }

      // Sanity: URL still points at the seeded client — no navigation,
      // no rotation, no mutation. The fixture's CASCADE-purge global-
      // teardown remains the only cleanup path.
      expect(page.url()).toContain(`/org-admin/applications/${encodeURIComponent(sample.id)}`);
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] Confidential rotation: type-to-confirm → success panel → copy-once → caveat → navigate-away clears the secret", async () => {
    // Mutating BUT scoped strictly to the disposable confidential
    // fixture client: we rotate that client's secret via the Security
    // section's RotateConfirmForm. The new secret is captured into a
    // LOCAL variable inside this test scope and used only for in-test
    // assertions; it is NEVER printed, never logged, never asserted-
    // by-equality against any other string. After rotation we
    // navigate to the list and back and assert the captured value is
    // GONE from the rendered DOM — proving the React useActionState
    // envelope was unmounted and the value is not persisted.
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const confidential = loadOrgAdminFixtureConfidentialSampleClient();
    if (!confidential) {
      test.skip(true, CONFIDENTIAL_CLIENT_MISSING_SKIP_MSG);
      return;
    }
    // The seeded confidential client is is_public=false by construction
    // (the IDP fixture CLI hard-codes is_public=false on this seed). If
    // a future regression flipped that, the loader would return null
    // and we'd hit the skip above; this defence-in-depth assert makes
    // the intent explicit.
    expect(confidential.isPublic).toBe(false);

    const page = await getSharedContext().newPage();
    try {
      // Step 1 — open the confidential client's detail page and assert
      // the Security section is present and the public no-rotate
      // notice is ABSENT.
      await page.goto(`/org-admin/applications/${encodeURIComponent(confidential.id)}`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
      expect(
        await page.getByText(/Public clients do not have a client secret to rotate/i).count()
      ).toBe(0);

      // Step 2 — pre-rotation body negative scan; the page MUST NOT
      // contain any forbidden literal labels at this point.
      const preBodyText = (await page.locator("body").textContent()) ?? "";
      for (const pat of BODY_BANNED_PATTERNS) {
        expect(
          preBodyText.match(pat),
          `pre-rotation body matched forbidden pattern ${pat}`
        ).toBeNull();
      }

      // Step 3 — click the ExpandPanel's "Rotate client secret" button
      // (type="button"; no POST on first click — only flips React
      // state).
      const expandBtn = page.getByRole("button", {
        name: /^Rotate client secret$/,
      });
      await expect(expandBtn).toBeVisible();
      expect(await expandBtn.isDisabled()).toBe(false);
      await expandBtn.click();

      // Step 4 — confirmation form renders with the type-to-confirm
      // input and the instruction copy showing the name AND client_id.
      const confirmInput = page.getByRole("textbox", {
        name: /Type to confirm/i,
      });
      await expect(confirmInput).toBeVisible();
      await expect(page.getByText(confidential.name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(confidential.clientId, { exact: true }).first()).toBeVisible();

      // Step 5 — submit MUST be disabled before any match.
      const submitBtn = page.getByRole("button", {
        name: /^Rotate client secret$/,
      });
      await expect(submitBtn).toBeVisible();
      expect(await submitBtn.isDisabled()).toBe(true);

      // Typing a deliberately-wrong value keeps the submit disabled.
      await confirmInput.fill("not-the-name");
      expect(await submitBtn.isDisabled()).toBe(true);

      // Typing the exact application name enables submit.
      await confirmInput.fill(confidential.name);
      expect(await submitBtn.isDisabled()).toBe(false);

      // Step 6 — submit the rotation. Wait for the SuccessPanel to
      // appear (the action revalidates list + detail caches and
      // returns the success state; useActionState transitions to
      // phase="success").
      await Promise.all([page.waitForLoadState("networkidle"), submitBtn.click()]);

      // SuccessPanel render — anchor on the unique heading copy.
      await expect(page.getByText(/has been rotated/i).first()).toBeVisible();

      // Step 7 — assert the verbatim copy-once warning and the
      // verbatim token-expiry caveat. The caveat split across lines in
      // the JSX renders as a single string in the DOM; use regexes
      // that tolerate whitespace between the sub-phrases.
      await expect(
        page.getByText(/Copy this secret now\.\s+It will not be shown again\./i).first()
      ).toBeVisible();
      await expect(
        page
          .getByText(
            /Existing access tokens issued before rotation continue to validate until\s+they expire\.\s+Future token requests using the old secret will fail\./i
          )
          .first()
      ).toBeVisible();

      // Step 8 — assert the client_id is visible (it's unchanged by
      // rotation — only the secret rotates).
      await expect(page.getByText(confidential.clientId, { exact: true }).first()).toBeVisible();

      // Step 9 — extract the displayed client_secret text from the
      // SuccessPanel. The `<dt>Client secret</dt>` sits next to the
      // `<dd>` containing the value. The captured value is held in a
      // LOCAL variable; the test never prints it.
      const secretDD = page.locator('dt:has-text("Client secret") + dd');
      await expect(secretDD).toBeVisible();
      const capturedSecret = (await secretDD.textContent())?.trim() ?? "";
      expect(capturedSecret.length).toBeGreaterThan(0);
      // The IDP generates the secret via crypto.GenerateRandomString(32)
      // → 32 random bytes hex-encoded → 64 lowercase-hex chars (same
      // recipe as the production create-client path). Assert the
      // SHAPE — the test never echoes the value.
      expect(capturedSecret).toMatch(/^[0-9a-f]{64}$/);

      // Step 10 — after-success body negative scan. The SuccessPanel
      // DELIBERATELY contains a client_secret VALUE, so we cannot run
      // the standard BODY_BANNED_PATTERNS scan as-is. Instead assert
      // the same blocklist but exclude the literal value match from
      // the `\bclient_secret\b` regex's hit — i.e. scan for forbidden
      // LABELS / shapes rather than the secret-value substring.
      const postBodyText = (await page.locator("body").textContent()) ?? "";
      const POST_SUCCESS_BANNED: RegExp[] = [
        /\bclient_secret_hash\b/i,
        /\bsecret_hash\b/i,
        /\bprivate_key\b/i,
        /\baccess_token\b/i,
        /\brefresh_token\b/i,
        /\bauthorization_code\b/i,
        /\bauth_code\b/i,
        /Bearer\s+[A-Za-z0-9._-]{8,}/,
        /\bsigning_key\b/i,
        /\bpassword_hash\b/i,
        /otpauth:\/\//i,
        /\bmfa_secret\b/i,
        /\bSet-Cookie\b/i,
      ];
      for (const pat of POST_SUCCESS_BANNED) {
        expect(
          postBodyText.match(pat),
          `post-success body matched forbidden pattern ${pat}`
        ).toBeNull();
      }

      // Step 11 — navigate away to /org-admin/applications, then back
      // to the same detail page. The captured secret value MUST NOT
      // appear in the body of either page — the React state envelope
      // was unmounted on navigation, the value is gone, and no
      // storage primitive holds it.
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.goto("/org-admin/applications"),
      ]);
      const listBody = (await page.locator("body").textContent()) ?? "";
      expect(
        listBody.includes(capturedSecret),
        "captured client_secret must not appear on the list page after navigation away"
      ).toBe(false);

      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.goto(`/org-admin/applications/${encodeURIComponent(confidential.id)}`),
      ]);
      // The detail page still renders (Security section heading is
      // the load-bearing anchor).
      await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
      // The captured secret is gone from the body.
      const reloadedBody = (await page.locator("body").textContent()) ?? "";
      expect(
        reloadedBody.includes(capturedSecret),
        "captured client_secret must not appear after navigating back to the detail page"
      ).toBe(false);
      // The SuccessPanel itself is gone — the page reverts to the
      // standard expand-panel rendering with the "Rotate client
      // secret" button visible again.
      expect(await page.getByText(/has been rotated/i).count()).toBe(0);
      expect(await page.getByText(/Copy this secret now/i).count()).toBe(0);
      await expect(
        page.getByRole("button", { name: /^Rotate client secret$/ }).first()
      ).toBeVisible();

      // Step 12 — Recent activity card now reflects the rotation
      // event. The IDP backend slice
      // identuum-20260530-client-audit-resource-subjects emits
      // AuditClientSecretRotated with subject_type=oauth_client and
      // subject_id=client.ID, so the application detail page's
      // Recent activity card filters to this rotation event
      // exclusively. The audit pipeline is asynchronous so we use
      // Playwright's auto-retry on the toBeVisible assertion to
      // tolerate a small lag.
      await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
      // The mapped operator-facing label MUST be present.
      await expect(page.getByText("Client secret rotated", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      // The View-all link href contains subject_id.
      const viewAllLink = page.getByRole("link", { name: /^View all →$/ });
      await expect(viewAllLink).toBeVisible();
      const viewAllHref = await viewAllLink.getAttribute("href");
      expect(viewAllHref).toContain("/org-admin/audit");
      expect(viewAllHref).toContain(`subject_id=${encodeURIComponent(confidential.id)}`);

      // Step 13 — click the rotation row to drill into the dedicated
      // audit page; assert the URL carries BOTH subject_id and
      // event_type=client_secret_rotated. The row's accessible name
      // is "View audit event client.secret_rotated for this
      // application" — the released OSS DOT-FORM action name (the
      // underscore spelling was the retired monolith's).
      // .first(): the audit trail legitimately ACCUMULATES — a reused
      // appliance carries rotation events from earlier runs, and the card
      // lists newest first, so .first() is the rotation this test just
      // performed.
      const rotationRow = page
        .getByRole("link", {
          name: "View audit event client.secret_rotated for this application",
        })
        .first();
      await expect(rotationRow).toBeVisible();
      await Promise.all([page.waitForLoadState("networkidle"), rotationRow.click()]);
      expect(page.url()).toContain("/org-admin/audit");
      expect(page.url()).toContain(`subject_id=${encodeURIComponent(confidential.id)}`);
      expect(page.url()).toContain(`event_type=${encodeURIComponent("client.secret_rotated")}`);

      // Step 14 — defence-in-depth: after navigating to the audit
      // page the captured secret value MUST STILL be absent from the
      // page body. The audit page might render the event's metadata
      // (client_id / client_name / client_uuid / secret_rotated:true)
      // but the plaintext secret was never written to any audit row
      // and must not appear anywhere.
      const auditBody = (await page.locator("body").textContent()) ?? "";
      expect(
        auditBody.includes(capturedSecret),
        "captured client_secret must not appear on the audit page after drill-in"
      ).toBe(false);

      // Step 15 — final URL sanity: we are now on the audit page
      // filtered to this client + rotation event. Only the disposable
      // confidential fixture client's secret was rotated; no Delete,
      // no list mutation, no other application was touched.
      expect(page.url()).toContain("/org-admin/audit");
    } finally {
      await page.close();
    }
  });
});
