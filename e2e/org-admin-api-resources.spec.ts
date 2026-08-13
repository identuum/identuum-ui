/**
 * Rendered-DOM Playwright coverage for /org-admin/api-resources.
 *
 * Scope:
 *   - Safe-state navigations only. No row is created, edited, deleted,
 *     or rotated by this spec. The detail page is not visited because
 *     the fixture admin's organization starts with zero API resources.
 *   - All tests are non-destructive and the suite is safe to run
 *     against any environment that hosts a fresh disposable fixture.
 *
 * Session strategy:
 *   - Logs in ONCE in beforeAll and shares the browser context across
 *     tests, matching e2e/org-admin-smoke.spec.ts.
 *
 * SECURITY:
 *   - This spec never types into the create form's secret-bearing
 *     submit path; it never clicks the Delete API resource button.
 *   - The spec does NOT print or assert on any secret-shaped string.
 *   - When dynamic-fixture mode is requested the global teardown
 *     purges the disposable organization via CASCADE, returning the
 *     DB marker count to 0.
 */
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loadOrgAdminFixtureApiResource } from "./helpers/fixture";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test reads the disposable fixture's API resource block.";

let sharedCtx: BrowserContext | null = null;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
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

test.describe("/org-admin/api-resources — list page (safe-state)", () => {
  test("renders the heading, the Create link, and the API resources sidebar entry", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/api-resources");
      await expect(page.getByRole("heading", { name: /^API resources$/, level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Create API resource$/ })).toBeVisible();
      // Sidebar entry is rendered alongside the existing org-admin tabs.
      await expect(page.getByRole("link", { name: /^API resources$/ })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("does not render any rotate/regenerate or recent-activity affordance in the safe-state DOM [APIRES-SAFE-1]", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/api-resources");
      // The list-page text content must NOT name the excluded affordances.
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/rotate\s+secret/i);
      expect(bodyText).not.toMatch(/regenerate\s+secret/i);
      expect(bodyText).not.toMatch(/Recent\s+activity/i);
    } finally {
      await page.close();
    }
  });
});

test.describe("/org-admin/api-resources/new — create form (safe-state)", () => {
  test("renders the heading, the audience field, the scope textarea, and the Cancel link", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/api-resources/new");
      await expect(
        page.getByRole("heading", { name: /^Create API resource$/, level: 1 })
      ).toBeVisible();
      await expect(page.getByLabel(/Resource name/)).toBeVisible();
      await expect(page.getByLabel(/Audience/)).toBeVisible();
      await expect(page.getByLabel(/Token TTL/)).toBeVisible();
      await expect(page.getByLabel(/Scopes/)).toBeVisible();
      await expect(page.getByRole("button", { name: /^Create API resource$/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Cancel$/ })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("does not render any rotate/regenerate or recent-activity affordance in the safe-state DOM", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/api-resources/new");
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/rotate\s+secret/i);
      expect(bodyText).not.toMatch(/regenerate\s+secret/i);
      expect(bodyText).not.toMatch(/Recent\s+activity/i);
    } finally {
      await page.close();
    }
  });
});

// ── Populated-fixture safe-state coverage (dynamic mode only) ───────────────
//
// The IDP fixture CLI seeds one disposable API resource per fixture create
// (slice identuum-20260530-e2e-fixture-seed-api-resource). These tests prove
// the populated list / detail / edit / DangerZone surfaces render correctly
// without mutating the seeded row. The DangerZone confirm input is exercised
// only up to the "submit-disabled-until-match" check; the destructive submit
// button is NEVER clicked (cleanup is via global-teardown CASCADE purge).
//
// SECURITY:
//   - The fixture loader returns ONLY non-secret identifiers (id, audience,
//     name, active, token_ttl_secs). The IDP envelope never writes the
//     plaintext resource_secret — this is pinned by the IDP-side Go test
//     TestFixtureAPIResourceBlock_NeverIncludesSecretMaterial.
//   - The test never types into the create form (no secret-bearing submit).
//   - The test runs a body negative scan against a blocklist of credential-
//     shaped substrings to prove no leak.

test.describe("/org-admin/api-resources — populated (seeded resource)", () => {
  test("[dynamic mode only] list page shows the seeded resource name + audience and the View details link", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const apiResource = loadOrgAdminFixtureApiResource();
    if (!apiResource) {
      test.skip(true, "Dynamic-fixture API resource not available");
      throw new Error("Dynamic-fixture API resource not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/api-resources");
      await expect(page.getByText(apiResource.name)).toBeVisible();
      await expect(page.getByText(apiResource.audience)).toBeVisible();
      // The per-row View-details link is rendered with the resource name in
      // its accessible label.
      await expect(
        page.getByRole("link", { name: `View API resource ${apiResource.name}` })
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] detail page renders configuration + scopes + Edit + Recent activity + DangerZone", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const apiResource = loadOrgAdminFixtureApiResource();
    if (!apiResource) {
      test.skip(true, "Dynamic-fixture API resource not available");
      throw new Error("Dynamic-fixture API resource not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto(`/org-admin/api-resources/${apiResource.id}`);
      // Heading shows the seeded name.
      await expect(page.getByRole("heading", { name: apiResource.name, level: 1 })).toBeVisible();
      // Configuration card shows the safe fields. Use the data-cell content
      // for the audience (the heading also contains it, so locate the
      // definition row by its term label).
      await expect(page.getByText("Configuration", { exact: true })).toBeVisible();
      await expect(
        page.getByText(`${apiResource.tokenTTLSecs} seconds`, { exact: true })
      ).toBeVisible();
      // Active badge is visible.
      await expect(page.getByText(/^Active$/, { exact: true }).first()).toBeVisible();
      // Scopes card renders both seeded scopes (read + write).
      await expect(page.getByText("Scopes", { exact: true })).toBeVisible();
      await expect(page.getByText("read", { exact: true })).toBeVisible();
      await expect(page.getByText("write", { exact: true })).toBeVisible();
      await expect(page.getByText("Read fixture API resource", { exact: true })).toBeVisible();
      await expect(page.getByText("Write fixture API resource", { exact: true })).toBeVisible();
      // Edit affordance is present.
      await expect(page.getByRole("link", { name: /^Edit$/ })).toBeVisible();
      // DangerZone heading is present.
      await expect(page.getByRole("heading", { name: "Danger zone", level: 2 })).toBeVisible();
      // Recent activity card is present (slice
      // identuum-20260530-org-admin-api-resource-detail-audit-card-ui).
      await expect(page.getByRole("heading", { name: "Recent activity", level: 2 })).toBeVisible();
      // Explicit absences for "regenerate" naming — the canonical UI
      // verb is "Rotate API resource secret" which lives on the
      // SecuritySection (covered by the dedicated rotate test below).
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/regenerate\s+secret/i);
      // Credential-shaped negative scan — no envelope leak into the DOM.
      for (const forbidden of [
        "resource_secret_hash",
        "resource_secret",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "Bearer ",
        "Set-Cookie",
        "session_id",
      ]) {
        expect(bodyText).not.toContain(forbidden);
      }
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] edit page is pre-filled with name/TTL/scopes; audience is read-only; no rotate UI", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const apiResource = loadOrgAdminFixtureApiResource();
    if (!apiResource) {
      test.skip(true, "Dynamic-fixture API resource not available");
      throw new Error("Dynamic-fixture API resource not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto(`/org-admin/api-resources/${apiResource.id}/edit`);
      await expect(page.getByRole("heading", { name: /^Edit /, level: 1 })).toBeVisible();
      // Name input is pre-filled.
      await expect(page.getByLabel(/Resource name/)).toHaveValue(apiResource.name);
      // Token TTL is pre-filled.
      await expect(page.getByLabel(/Token TTL/)).toHaveValue(String(apiResource.tokenTTLSecs));
      // Active checkbox is checked.
      await expect(page.getByLabel(/^Active$/)).toBeChecked();
      // Scopes textarea contains BOTH seeded scope lines.
      const scopesValue = await page.getByLabel(/^Scopes$/).inputValue();
      expect(scopesValue).toContain("read: Read fixture API resource");
      expect(scopesValue).toContain("write: Write fixture API resource");
      // Audience is rendered as read-only mono text, NOT a text input.
      // The DOM shows the audience inside a styled <p>, alongside an
      // "Audience is immutable after create." caveat.
      await expect(
        page.getByText("Audience is immutable after create.", { exact: true })
      ).toBeVisible();
      // No <input name="audience"> exists on this page.
      await expect(page.locator('input[name="audience"]')).toHaveCount(0);
      // No rotate/regenerate UI; no Recent activity card.
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/rotate\s+secret/i);
      expect(bodyText).not.toMatch(/regenerate\s+secret/i);
      expect(bodyText).not.toMatch(/Recent\s+activity/i);
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] DangerZone exists; type-to-confirm gate works without submitting", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const apiResource = loadOrgAdminFixtureApiResource();
    if (!apiResource) {
      test.skip(true, "Dynamic-fixture API resource not available");
      throw new Error("Dynamic-fixture API resource not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto(`/org-admin/api-resources/${apiResource.id}`);
      await expect(page.getByRole("heading", { name: "Danger zone", level: 2 })).toBeVisible();
      // Step 1: ExpandPanel — click does NOT submit, only expands.
      await page
        .getByRole("button", { name: /^Delete API resource$/ })
        .first()
        .click();
      // Step 2: confirm input + submit (DISABLED initially).
      const confirmInput = page.getByLabel(/^Type to confirm/);
      await expect(confirmInput).toBeVisible();
      const submit = page.getByRole("button", { name: /^Delete API resource$/ });
      await expect(submit).toBeDisabled();
      // Typing the wrong value keeps it disabled.
      await confirmInput.fill("not the right value");
      await expect(submit).toBeDisabled();
      // Typing the EXACT name enables it.
      await confirmInput.fill(apiResource.name);
      await expect(submit).toBeEnabled();
      // Re-blank → re-disabled (paste-Enter race protection).
      await confirmInput.fill("");
      await expect(submit).toBeDisabled();
      // Typing the audience also enables (either-matches gate).
      await confirmInput.fill(apiResource.audience);
      await expect(submit).toBeEnabled();
      // Cancel collapses back to the ExpandPanel WITHOUT submitting.
      await page.getByRole("button", { name: /^Cancel$/ }).click();
      await expect(confirmInput).toBeHidden();
      // The seeded resource still exists — no Delete was clicked. Verify
      // by re-visiting the list page and checking the name still renders.
      await page.goto("/org-admin/api-resources");
      await expect(page.getByText(apiResource.name)).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ── Rotate-secret end-to-end coverage (dynamic mode only, MUTATES fixture) ──
//
// This test rotates the disposable fixture API resource's secret end-to-end.
// It is destructive ONLY against the disposable fixture and is safe to run
// because (a) the fixture is purged by global-teardown via CASCADE, (b) the
// rotated secret is captured into a LOCAL test variable and NEVER printed.
//
// SECURITY:
//   - The captured plaintext lives in a `const capturedSecret` local that
//     is never written to console.*, never echoed into an assertion
//     message, never compared against `expect(...).toContain(capturedSecret)`
//     in a way that prints the value, never stored in any test artifact.
//   - The post-success body negative scan checks for FORBIDDEN LABELS
//     (resource_secret_hash, secret_hash, private_key, access_token, …),
//     not the captured plaintext substring — the SuccessPanel deliberately
//     contains the secret value, so a substring scan against the live
//     panel would always trip.
//   - Navigation away → back proves the React useActionState envelope
//     unmounts: the secret value is ABSENT from the reloaded detail page
//     body and the ExpandPanel rotate button is back.

test.describe("/org-admin/api-resources/[id] — rotate secret end-to-end (dynamic mode only)", () => {
  test("[dynamic mode only] rotates the seeded API resource secret and surfaces it copy-once", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const apiResource = loadOrgAdminFixtureApiResource();
    if (!apiResource) {
      test.skip(true, "Dynamic-fixture API resource not available");
      throw new Error("Dynamic-fixture API resource not available");
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto(`/org-admin/api-resources/${apiResource.id}`);

      // Security section is present.
      await expect(page.getByRole("heading", { name: "Security", level: 2 })).toBeVisible();

      // Pre-rotation body negative scan: no secret-shaped label leaks.
      const preBody = (await page.textContent("body")) ?? "";
      for (const forbidden of [
        "resource_secret_hash",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
      ]) {
        expect(preBody).not.toContain(forbidden);
      }

      // Click the ExpandPanel "Rotate API resource secret" button — this
      // is a type="button" that ONLY flips a local React `expanded` flag.
      // NO POST should fire on this click.
      await page
        .getByRole("button", { name: /^Rotate API resource secret$/ })
        .first()
        .click();

      // Type-to-confirm input appears. Submit is DISABLED initially.
      const confirmInput = page.getByLabel(/^Type to confirm/);
      await expect(confirmInput).toBeVisible();
      const submit = page.getByRole("button", {
        name: /^Rotate API resource secret$/,
      });
      await expect(submit).toBeDisabled();

      // Wrong value keeps disabled.
      await confirmInput.fill("not the right value");
      await expect(submit).toBeDisabled();

      // Exact name enables.
      await confirmInput.fill(apiResource.name);
      await expect(submit).toBeEnabled();

      // Submit rotation.
      await submit.click();

      // SuccessPanel appears: rotated-name heading + verbatim copy-once
      // warning + verbatim token-expiry caveat + the Audience + the new
      // Resource secret value.
      await expect(
        page.getByText(`${apiResource.name} resource secret has been rotated.`)
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Copy this secret now. It will not be shown again.", { exact: false })
      ).toBeVisible();
      await expect(
        page.getByText(
          /Existing access tokens issued for this audience continue to validate at\s+the resource server until they expire\./
        )
      ).toBeVisible();

      // Audience row in the credentials card.
      await expect(page.getByText(apiResource.audience).first()).toBeVisible();

      // Extract the displayed secret from the <dt>Resource secret</dt> +
      // adjacent <dd> pair into a LOCAL variable. The variable is
      // NEVER printed via console.* and NEVER quoted in an assertion
      // message.
      const secretDd = page
        .locator("dt", { hasText: /^Resource secret$/ })
        .locator("xpath=following-sibling::dd[1]");
      const capturedSecret = ((await secretDd.textContent()) ?? "").trim();
      // Defence-in-depth: assert the captured value is the SHA-256-hex
      // shape the backend mints (crypto.GenerateRandomString(32) → 64
      // lowercase hex chars) without printing it.
      expect(capturedSecret).toMatch(/^[0-9a-f]{64}$/);

      // Navigate away to the list page. The captured plaintext MUST NOT
      // appear in the list page body.
      await page.goto("/org-admin/api-resources");
      const listBody = (await page.textContent("body")) ?? "";
      expect(listBody.includes(capturedSecret)).toBe(false);

      // Navigate back to the detail page. The SuccessPanel must be GONE
      // (React useActionState unmounts on navigation), the rotate
      // ExpandPanel button must be back, and the captured secret MUST
      // NOT appear in the reloaded body.
      await page.goto(`/org-admin/api-resources/${apiResource.id}`);
      await expect(page.getByRole("heading", { name: "Security", level: 2 })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Rotate API resource secret$/ }).first()
      ).toBeVisible();
      // SuccessPanel-only copy must be absent post-navigation.
      await expect(page.getByText("Copy this secret now. It will not be shown again.")).toHaveCount(
        0
      );
      const reloadedBody = (await page.textContent("body")) ?? "";
      expect(reloadedBody.includes(capturedSecret)).toBe(false);

      // ── Recent activity card (slice identuum-20260530-org-admin-api-resource-detail-audit-card-ui) ──
      //
      // The rotation we just performed emitted an
      // AuditAPIResourceSecretRotated event with subject_type="api_resource"
      // and subject_id=<resource UUID>. The detail page now mounts a
      // Recent activity card filtered by that same subject_id, so the
      // mapped label "API resource secret rotated" must appear.
      await expect(page.getByRole("heading", { name: "Recent activity", level: 2 })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("API resource secret rotated", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Per-row drill-in: the row link's href carries both subject_id
      // (the resource UUID) and event_type=api_resource_secret_rotated.
      // The accessible name names the destination explicitly.
      const rowLink = page.getByRole("link", {
        name: "View audit event api_resource_secret_rotated for this API resource",
      });
      await expect(rowLink).toBeVisible();
      const rowHref = (await rowLink.getAttribute("href")) ?? "";
      expect(rowHref).toMatch(/^\/org-admin\/audit\?/);
      expect(rowHref).toContain(`subject_id=${encodeURIComponent(apiResource.id)}`);
      expect(rowHref).toContain("event_type=api_resource_secret_rotated");

      // Click the row → navigate to the audit page.
      await Promise.all([page.waitForLoadState("networkidle"), rowLink.click()]);
      const auditURL = page.url();
      expect(auditURL).toContain("/org-admin/audit");
      expect(auditURL).toContain(`subject_id=${encodeURIComponent(apiResource.id)}`);
      expect(auditURL).toContain("event_type=api_resource_secret_rotated");

      // The captured plaintext secret MUST NOT appear anywhere on the
      // audit page body — the audit row's metadata carries only
      // {api_resource_id, api_resource_name, audience, organization_id,
      // secret_rotated:true} per the backend slice
      // identuum-20260530-api-resource-audit-subjects-backend.
      const auditBody = (await page.textContent("body")) ?? "";
      expect(auditBody.includes(capturedSecret)).toBe(false);
      // Defence-in-depth: no resource_secret_hash / secret_hash /
      // private_key shaped substring on the audit page body. The
      // event-type filter dropdown legitimately lists raw event names
      // like `signing_key_generated` / `access_token_issued` —
      // those are operator-facing event tokens and are NOT a
      // credential leak, so they are EXCLUDED from this scan.
      for (const forbidden of ["resource_secret_hash", "secret_hash", "private_key"]) {
        expect(auditBody).not.toContain(forbidden);
      }
    } finally {
      await page.close();
    }
  });
});
