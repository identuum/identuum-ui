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
 *   - Full Compose stack (IdP at localhost:7113, UI at localhost:7114).
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
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";
import { loadOrgAdminFixtureSampleClient } from "./helpers/fixture";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test runs against the disposable fixture's seeded org + sample OAuth client.";

const SAMPLE_CLIENT_MISSING_SKIP_MSG =
  "Fixture envelope is missing the sample_client block. Rebuild IDP after slice identuum-20260530-e2e-fixture-seed-sample-oauth-client to seed it.";

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

    const page = await sharedCtx!.newPage();
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
        expect(
          bodyText.match(pat),
          `list page body matched forbidden pattern ${pat}`
        ).toBeNull();
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

    const page = await sharedCtx!.newPage();
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
      expect(page.url()).toContain(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );
      expect(await page.title()).not.toMatch(
        /500|404|internal error|application error|not found/i
      );

      // Detail page heading is the sample client name.
      await expect(page.getByRole("heading", { name: sample.name })).toBeVisible();
      // client_id displays as the mono sub-header.
      await expect(page.getByText(sample.clientId, { exact: true }).first()).toBeVisible();

      // Public badge AND Type=Public dt/dd row (the slice spec wants
      // "Public" surfaced on the detail page).
      await expect(page.getByText("Public", { exact: true }).first()).toBeVisible();

      // Safe-field labels — the seeded client has one redirect URI and
      // a default scope, so both labels render. The seeded client's
      // redirect URI is operator-safe loopback (http://localhost:7114/callback)
      // — we assert presence of the label and the loopback value.
      await expect(page.getByText("Redirect URIs", { exact: true })).toBeVisible();
      await expect(
        page.getByText("http://localhost:7114/callback", { exact: true })
      ).toBeVisible();
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

    const page = await sharedCtx!.newPage();
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

    const page = await sharedCtx!.newPage();
    try {
      await page.goto("/org-admin/applications");
      await page.waitForLoadState("networkidle");

      const createLink = page.getByRole("link", { name: /^Create application$/ });
      await expect(createLink).toBeVisible();
      expect(await createLink.getAttribute("href")).toBe("/org-admin/applications/new");

      await Promise.all([page.waitForLoadState("networkidle"), createLink.click()]);

      // Routed to /new — sanity checks.
      expect(page.url()).toContain("/org-admin/applications/new");
      expect(await page.title()).not.toMatch(
        /500|404|internal error|application error|not found/i
      );

      // Page chrome — heading + subtitle that names the single-shot
      // contract ("shown only once").
      await expect(
        page.getByRole("heading", { name: "Create application" })
      ).toBeVisible();
      await expect(page.getByText(/shown only once/i)).toBeVisible();

      // Form fields — each is a labelled input/textarea. Use the
      // exact accessible names (including the required-marker " *"
      // suffix) so the locators don't strict-mode-collide with each
      // other (e.g. "Redirect URIs *" vs "Post-logout redirect URIs"
      // would both match a substring "Redirect URIs").
      await expect(
        page.getByRole("textbox", { name: "Application name *" })
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Redirect URIs *" })).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Post-logout redirect URIs" })
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Allowed audiences" })
      ).toBeVisible();
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

    const page = await sharedCtx!.newPage();
    try {
      await page.goto(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );
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
      expect(page.url()).toContain(
        `/org-admin/applications/${encodeURIComponent(sample.id)}/edit`
      );
      expect(await page.title()).not.toMatch(
        /500|404|internal error|application error|not found/i
      );

      // Page chrome — heading mentions Edit + the client name.
      await expect(
        page.getByRole("heading", { name: `Edit ${sample.name}` })
      ).toBeVisible();

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
      // the loopback "http://localhost:7114/callback" the IDP CLI
      // hard-codes. The textarea's initial value is that single URI.
      expect(await redirectsInput.inputValue()).toBe(
        "http://localhost:7114/callback"
      );

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
      expect(await page.getByRole("textbox", { name: /token.endpoint.auth.method/i }).count()).toBe(0);
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

    const page = await sharedCtx!.newPage();
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
      expect(
        await page.getByRole("textbox", { name: /Type to confirm/i }).count()
      ).toBe(0);
      await expect(
        page.getByRole("button", { name: /^Delete application$/ })
      ).toBeVisible();

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
      expect(page.url()).toContain(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );
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

    const page = await sharedCtx!.newPage();
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
      expect(
        await page.getByRole("button", { name: /^Rotate client secret$/ }).count()
      ).toBe(0);
      // The type-to-confirm input MUST NOT be present.
      expect(
        await page.getByRole("textbox", { name: /Type to confirm/i }).count()
      ).toBe(0);
      // The success panel's copy-once / token-expiry phrases MUST NOT
      // be present on the public-branch render.
      expect(await page.getByText(/Copy this secret now/i).count()).toBe(0);
      expect(
        await page.getByText(
          /Existing access tokens issued before rotation continue to validate until/i
        ).count()
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
      expect(page.url()).toContain(
        `/org-admin/applications/${encodeURIComponent(sample.id)}`
      );
    } finally {
      await page.close();
    }
  });
});
