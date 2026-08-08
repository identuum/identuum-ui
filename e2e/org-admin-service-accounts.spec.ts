/**
 * Rendered-DOM Playwright coverage for /org-admin/service-accounts.
 *
 * Scope:
 *   - Safe-state list + create-form rendering, plus a single
 *     dynamic-mode mutation test that creates and deletes a
 *     disposable service account in the fixture org.
 *   - The fixture org's organization_id FK on service_accounts is
 *     declared ON DELETE CASCADE (migration 0001_identity_credentials.sql:158),
 *     so any leftover SA row from a partial test run is swept by the
 *     fixture-org purge in global teardown.
 *
 * SECURITY:
 *   - The IDP service-account create endpoint does NOT return a
 *     credential. There is no copy-once secret to capture or assert
 *     against. The mutation test asserts that no secret-shaped string
 *     appears on the success surface.
 *   - The test never types or stores any credential / secret.
 */
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loadOrgAdminFixtureConfidentialSampleClient } from "./helpers/fixture";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

const DYNAMIC_ONLY_SKIP_MSG =
  "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test mutates the disposable fixture org by creating a service account; cleanup is via fixture-org CASCADE.";

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

test.describe("/org-admin/service-accounts — safe-state list + nav", () => {
  test("renders the heading, the Create link, and the sidebar entry", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/service-accounts");
      await expect(
        page.getByRole("heading", { name: /^Service accounts$/, level: 1 })
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /^Create service account$/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Service accounts$/ })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("list page renders no rotate/regenerate or Recent activity copy", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/service-accounts");
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/rotate\s+credential/i);
      expect(bodyText).not.toMatch(/regenerate\s+credential/i);
      expect(bodyText).not.toMatch(/Recent\s+activity/i);
    } finally {
      await page.close();
    }
  });
});

test.describe("/org-admin/service-accounts/new — safe-state create form", () => {
  test("renders the heading, all form fields, and the Cancel link", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/service-accounts/new");
      await expect(
        page.getByRole("heading", { name: /^Create service account$/, level: 1 })
      ).toBeVisible();
      await expect(page.getByLabel(/^Name/)).toBeVisible();
      await expect(page.getByLabel(/^Description/)).toBeVisible();
      await expect(page.getByLabel(/^Role/)).toBeVisible();
      await expect(page.getByLabel(/^Expires at/)).toBeVisible();
      await expect(page.getByRole("button", { name: /^Create service account$/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Cancel$/ })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("create form renders no credential / rotate / Recent activity copy", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      await page.goto("/org-admin/service-accounts/new");
      const bodyText = (await page.textContent("body")) ?? "";
      expect(bodyText).not.toMatch(/rotate\s+credential/i);
      expect(bodyText).not.toMatch(/regenerate\s+credential/i);
      expect(bodyText).not.toMatch(/Recent\s+activity/i);
      // No credential input field is present on the create form.
      await expect(page.locator('input[name="client_secret"]')).toHaveCount(0);
      await expect(page.locator('input[name="credential"]')).toHaveCount(0);
      await expect(page.locator('input[name="secret"]')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});

test.describe("/org-admin/service-accounts — create + delete (dynamic mode, fixture-cascade cleanup)", () => {
  test("[dynamic mode only] creates a disposable service account, views detail, and deletes it via DangerZone", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      // Disposable SA name keyed by a per-run nonce so concurrent
      // Playwright workers cannot collide on the (org_id, name)
      // uniqueness assumption. The fixture-org CASCADE FK ensures the
      // row is swept even if a step fails mid-test.
      const nonce = Date.now().toString(36);
      const saName = `e2e-sa-${nonce}`;

      // 1. Create the service account.
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saName);
      await page.getByLabel(/^Description/).fill("Playwright temporary SA");
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
      // Success panel renders with no credential surface.
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      // Negative scan: no credential / secret string appears in the
      // success panel.
      const successBody = (await page.textContent("body")) ?? "";
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
      ]) {
        expect(successBody).not.toContain(forbidden);
      }

      // 2. Navigate to the detail page via the success-panel link.
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.getByRole("link", { name: /^View details$/ }).click(),
      ]);
      // Detail page shows the safe fields + Danger zone + no rotate
      // surface. Recent activity IS mounted on the detail page (slice
      // identuum-20260530-org-admin-service-account-recent-activity-ui)
      // — its dedicated flow lives in the link-to-OAuth-client test
      // below; this test does not exercise it.
      await expect(page.getByRole("heading", { name: saName, level: 1 })).toBeVisible();
      await expect(page.getByText("Configuration", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Danger zone", level: 2 })).toBeVisible();
      const detailBody = (await page.textContent("body")) ?? "";
      expect(detailBody).not.toMatch(/rotate\s+credential/i);
      expect(detailBody).not.toMatch(/regenerate\s+credential/i);

      // 3. DangerZone two-step expand + type-to-confirm gate.
      //    The destructive submit button is enabled only after a
      //    matching confirm value. The test exercises the gate up to
      //    "submit enabled" but does NOT click submit — leaving the
      //    seeded SA in place. The fixture-org CASCADE FK
      //    (organization_id ON DELETE CASCADE in migration
      //    0001_identity_credentials.sql:158) sweeps the row in
      //    global teardown when the disposable org is purged.
      await page
        .getByRole("button", { name: /^Delete service account$/ })
        .first()
        .click();
      const confirmInput = page.getByLabel(/^Type to confirm/);
      await expect(confirmInput).toBeVisible();
      const submit = page.getByRole("button", { name: /^Delete service account$/ });
      await expect(submit).toBeDisabled();
      await confirmInput.fill("not the right value");
      await expect(submit).toBeDisabled();
      await confirmInput.fill(saName);
      await expect(submit).toBeEnabled();
      // Re-blanking re-disables (paste-Enter race protection).
      await confirmInput.fill("");
      await expect(submit).toBeDisabled();
      // Re-type the exact name and click submit. This is the
      // destructive path the slice identuum-20260530-service-accounts-delete-validation
      // re-introduces after the original mutation test had to drop it.
      await confirmInput.fill(saName);
      await expect(submit).toBeEnabled();
      // Explicitly wait for the URL to navigate to the list page with
      // ?deleted= (Playwright's `waitForURL` polls until the URL
      // changes, tolerating Next.js server-action redirect timing).
      await submit.click();
      await page.waitForURL(/\/org-admin\/service-accounts\?deleted=/, {
        timeout: 15_000,
      });
      const finalURL = page.url();
      expect(finalURL).toContain("/org-admin/service-accounts");
      expect(finalURL).toContain(`deleted=${encodeURIComponent(saName)}`);
      await expect(page.getByText(`Deleted ${saName}.`, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `View service account ${saName}` })).toHaveCount(
        0
      );
    } finally {
      await page.close();
    }
  });
});

const CONFIDENTIAL_CLIENT_MISSING_SKIP_MSG =
  "Fixture envelope is missing the confidential_sample_client block. Rebuild IDP after slice identuum-20260530-e2e-fixture-seed-confidential-oauth-client to seed it.";

test.describe("/org-admin/service-accounts/[id] — link to OAuth client (dynamic mode, fixture-cascade cleanup)", () => {
  test("[dynamic mode only] creates a disposable service account, links it to the seeded confidential OAuth client, and asserts the safe success surface", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    const confidential = loadOrgAdminFixtureConfidentialSampleClient();
    if (!confidential) {
      test.skip(true, CONFIDENTIAL_CLIENT_MISSING_SKIP_MSG);
      return;
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      // Disposable SA name keyed by a per-run nonce so concurrent
      // Playwright workers cannot collide on (org_id, name) uniqueness.
      // The fixture-org CASCADE FK sweeps the row in global teardown.
      const nonce = Date.now().toString(36);
      const saName = `e2e-sa-link-${nonce}`;

      // 1. Create the disposable service account.
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saName);
      await page.getByLabel(/^Description/).fill("Playwright link target SA");
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 2. Navigate to the SA detail page via the success-panel link.
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.getByRole("link", { name: /^View details$/ }).click(),
      ]);
      await expect(page.getByRole("heading", { name: saName, level: 1 })).toBeVisible();

      // 2a. LIFECYCLE — slice identuum-20260530-service-account-
      //     disable-enable-ui-reload-validation. With the backend
      //     `types.ServiceAccount.Active` DTO field now landed (slice
      //     identuum-20260530-service-account-active-dto-backend), the
      //     UI can render the persistent Active/Disabled badge after a
      //     hard reload. This step now exercises the full
      //     disable → reload-survives → enable → reload-survives round
      //     trip + a lifecycle-event audit drill-in.
      await expect(page.getByRole("heading", { name: "Lifecycle", level: 2 })).toBeVisible();
      await expect(page.getByLabel(/Service account status: Active/)).toBeVisible();
      // 2b. Disable: two-step expand + DISABLE type-to-confirm gate.
      //     After submit, the server action's revalidatePath() causes
      //     Next.js to re-render the page with the new active=false
      //     state from the backend DTO; the LifecycleCard's render
      //     branch switches from DisablePanel to EnablePanel and the
      //     in-memory useActionState success banner is unmounted along
      //     with the DisablePanel. We therefore observe success via
      //     the persistent Disabled badge that now renders directly
      //     from the server, without needing a manual reload.
      await page
        .getByRole("button", { name: /^Disable service account$/ })
        .first()
        .click();
      const disableConfirm = page.getByLabel(/^Type DISABLE to confirm/);
      await expect(disableConfirm).toBeVisible();
      await disableConfirm.fill("DISABLE");
      await page
        .getByRole("button", { name: /^Disable service account$/ })
        .last()
        .click();
      await expect(page.getByLabel(/Service account status: Disabled/)).toBeVisible({
        timeout: 15_000,
      });
      // 2c. Hard reload to prove the server-side fetch (not just the
      //     post-mutation re-render) returns active=false → the
      //     Disabled badge MUST persist; the Enable affordance MUST
      //     appear (no Disable button on a disabled SA).
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByLabel(/Service account status: Disabled/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel(/Service account status: Active/)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^Enable service account$/ }).first()
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^Disable service account$/ })).toHaveCount(0);
      // 2d. Enable: two-step expand + ENABLE type-to-confirm gate.
      //     Same revalidatePath-masks-in-memory-banner posture as
      //     2b — observe success via the persistent Active badge.
      await page
        .getByRole("button", { name: /^Enable service account$/ })
        .first()
        .click();
      const enableConfirm = page.getByLabel(/^Type ENABLE to confirm/);
      await expect(enableConfirm).toBeVisible();
      await enableConfirm.fill("ENABLE");
      await page
        .getByRole("button", { name: /^Enable service account$/ })
        .last()
        .click();
      await expect(page.getByLabel(/Service account status: Active/)).toBeVisible({
        timeout: 15_000,
      });
      // 2e. Hard reload — persistent Active badge MUST survive the
      //     server-side fetch. The Disable affordance MUST appear
      //     again (no Enable button on an active SA).
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByLabel(/Service account status: Active/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel(/Service account status: Disabled/)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^Disable service account$/ }).first()
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^Enable service account$/ })).toHaveCount(0);
      // 2f. Lifecycle card negative scan: no credential / secret /
      //     hash / private-key / token / cookie / session-id substring
      //     appears in the rendered <main>. Scope is <main> to avoid
      //     false positives from the inline Next.js RSC payload's
      //     legitimate token_endpoint_auth_method="client_secret_basic"
      //     substring on adjacent OAuth client objects.
      const lifecycleMain = (await page.locator("main").textContent()) ?? "";
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "service_account_secret",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "authorization_code",
      ]) {
        expect(lifecycleMain).not.toContain(forbidden);
      }

      // 3. Link card is visible with the safe operator copy.
      await expect(
        page.getByRole("heading", { name: "Link to OAuth client", level: 2 })
      ).toBeVisible();
      await expect(page.getByText(/No new credential is issued by linking/i)).toBeVisible();

      // 4. The seeded confidential OAuth client appears as a selectable
      //    option in the dropdown.
      const select = page.locator('select[name="oauth_client_id"]');
      await expect(select).toBeVisible();
      await expect(select).toBeEnabled();
      await select.selectOption(confidential.id);

      // 5. Submit the link form.
      await page.getByRole("button", { name: /^Link to OAuth client$/ }).click();
      await expect(
        page.getByText("Service account linked to OAuth client.", { exact: true })
      ).toBeVisible({ timeout: 15_000 });

      // 6. Success surface shows the safe identifiers + an "Open
      //    Application detail →" link to the OAuth client's detail
      //    page. NO new secret was issued, and NO credential / hash /
      //    private-key / token-shaped string appears anywhere in the
      //    rendered DOM.
      await expect(page.getByText(/No new secret was issued/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /Open Application detail/ })).toBeVisible();
      // Both safe identifiers render — the OAuth client's display
      // client_id string and its internal UUID.
      await expect(page.getByText(confidential.clientId, { exact: false })).toBeVisible();
      await expect(page.getByText(confidential.id, { exact: false })).toBeVisible();
      // Scope the negative scan to the rendered <main> element so the
      // inline Next.js RSC payload <script> blocks (which legitimately
      // serialise the OAuth client's token_endpoint_auth_method =
      // "client_secret_basic" as part of its non-secret config) cannot
      // produce a false positive on the "client_secret" substring scan.
      // The card UI itself uses the natural-English phrase "client
      // secret" (with a space) when it has to mention it at all.
      const linkSuccessMain = (await page.locator("main").textContent()) ?? "";
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
      ]) {
        expect(linkSuccessMain).not.toContain(forbidden);
      }
      // Defence-in-depth: no rotate/regenerate credential UI sneaks
      // onto the success surface. Recent activity IS now mounted on
      // the detail page (slice
      // identuum-20260530-org-admin-service-account-recent-activity-ui)
      // and is exercised by the follow-up test below.
      expect(linkSuccessMain).not.toMatch(/rotate\s+credential/i);
      expect(linkSuccessMain).not.toMatch(/regenerate\s+credential/i);

      // 6a. PERSISTENT LINKED-STATE — slice
      //     identuum-20260530-service-account-linked-clients-read-model-ui.
      //     Reload the SA detail page so the server-side
      //     listServiceAccountOAuthClients fetch picks up the
      //     persisted link from the prior mutation. The card MUST
      //     render the LinkedStatePanel (NOT the empty Form) without
      //     relying on useActionState — proving that hard reload
      //     surfaces the backend read model.
      const saUUIDForUnlink = new URL(page.url()).pathname.split("/").pop() ?? "";
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Currently linked OAuth client.", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      // Both safe identifiers of the persisted link are rendered.
      await expect(page.getByText(confidential.clientId, { exact: false })).toBeVisible();
      await expect(page.getByText(confidential.id, { exact: false })).toBeVisible();
      // The per-row "Unlink OAuth client" affordance is visible
      // immediately on first load — the operator did NOT need to
      // re-link to see the Unlink action.
      await expect(
        page.getByRole("button", { name: /^Unlink OAuth client$/ }).first()
      ).toBeVisible();

      // 7. Trigger the unlink flow from the PERSISTENT linked-state
      //    panel (slice identuum-20260530-service-account-oauth-
      //    client-unlink-ui). Two-step expand + literal "UNLINK"
      //    confirmation gate.
      const expandUnlink = page.getByRole("button", { name: /^Unlink OAuth client$/ }).first();
      await expect(expandUnlink).toBeVisible();
      await expandUnlink.click();
      const confirmInput = page.getByLabel(/^Type UNLINK to confirm/);
      await expect(confirmInput).toBeVisible();
      await confirmInput.fill("UNLINK");
      const submitUnlink = page.getByRole("button", { name: /^Unlink OAuth client$/ }).last();
      await submitUnlink.click();
      // The server action's revalidatePath() invalidates the SA detail
      // route, so Next.js re-renders the server components with fresh
      // server data (listServiceAccountOAuthClients now returns []).
      // The persistent LinkedStatePanel unmounts → the "Currently
      // linked OAuth client." copy disappears, and the link Form
      // re-renders in its place. The disappearance + Form reappearance
      // are jointly proof that the unlink succeeded — observed
      // entirely from server state, with NO useActionState dependence.
      await expect(page.getByText("Currently linked OAuth client.", { exact: true })).toHaveCount(
        0,
        { timeout: 15_000 }
      );
      await expect(page.locator('select[name="oauth_client_id"]')).toBeVisible({ timeout: 15_000 });
      // Defence-in-depth no-credential scan over the post-unlink
      // <main>. Scope is <main> (not <body>) to avoid false positives
      // from the inline Next.js RSC payload's legitimate
      // token_endpoint_auth_method="client_secret_basic" substring on
      // adjacent OAuth client objects.
      const unlinkSuccessMain = (await page.locator("main").textContent()) ?? "";
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "service_account_secret",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "authorization_code",
      ]) {
        expect(unlinkSuccessMain).not.toContain(forbidden);
      }

      // 8. After the unlink succeeds, reload the SA detail page so the
      //    server-side listAuditEvents fetch picks up BOTH the
      //    AuditServiceAccountLinkedOAuthClient + the newly-emitted
      //    AuditServiceAccountUnlinkedOAuthClient rows AND the
      //    listServiceAccountOAuthClients fetch returns an empty array
      //    (the backend column is now NULL). useActionState keeps the
      //    prior page in the per-row "Unlinked." confirmation in
      //    memory — only a fresh server render re-runs the page's data
      //    fetch. The audit pipeline is async; Playwright's auto-retry
      //    on `toBeVisible({timeout})` tolerates that lag.
      await page.reload();
      await page.waitForLoadState("networkidle");

      // 8a. PERSISTENT-LINKED-STATE REVERTS — slice
      //     identuum-20260530-service-account-linked-clients-read-
      //     model-ui. After the unlink + reload, the backend returns
      //     an empty oauth_clients array, so the LinkedStatePanel
      //     MUST NOT render and the link Form MUST be available again.
      await expect(page.getByText("Currently linked OAuth client.", { exact: true })).toHaveCount(
        0
      );
      await expect(page.locator('select[name="oauth_client_id"]')).toBeVisible({ timeout: 15_000 });

      // 9. Recent activity card appears with the mapped labels for
      //    BOTH the link and unlink events, AND (slice
      //    identuum-20260530-service-account-disable-enable-ui) the
      //    disabled + enabled events emitted earlier in this test.
      //    The IDP feed orders by created_at DESC; pageSize=5 is just
      //    enough to contain the SA's full lifecycle in this test
      //    (created → disabled → enabled → linked → unlinked).
      await expect(page.getByRole("heading", { name: "Recent activity", level: 2 })).toBeVisible();
      await expect(page.getByText("OAuth client linked", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("OAuth client unlinked", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      // Slice identuum-20260530-service-account-disable-enable-ui-
      // reload-validation: with the active DTO field now wired, both
      // the disable AND enable lifecycle events are exercised + must
      // surface as Recent activity rows.
      await expect(page.getByText("Service account disabled", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Service account enabled", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 9a. Pin the per-row href shape for both lifecycle events. We
      //     do NOT click the rows here (navigation would interfere
      //     with Step 10's unlink-row drill-in below); the existing
      //     Step 10 already proves the audit page drill-in works
      //     end-to-end for an SA-scoped event_type query param. These
      //     per-row href assertions + Step 10's click together cover
      //     the drill-in contract for lifecycle events without
      //     duplicating the navigation. Re-uses the SA UUID captured
      //     earlier in this test as `saUUIDForUnlink`.
      const lifecycleRow = page.getByRole("link", {
        name: "View audit event service_account.disabled for this service account",
      });
      await expect(lifecycleRow).toBeVisible();
      const lifecycleRowHref = await lifecycleRow.getAttribute("href");
      expect(lifecycleRowHref).toBe(
        `/org-admin/audit?subject_id=${encodeURIComponent(saUUIDForUnlink)}&event_type=service_account.disabled`
      );
      const enableRow = page.getByRole("link", {
        name: "View audit event service_account.enabled for this service account",
      });
      await expect(enableRow).toBeVisible();
      const enableRowHref = await enableRow.getAttribute("href");
      expect(enableRowHref).toBe(
        `/org-admin/audit?subject_id=${encodeURIComponent(saUUIDForUnlink)}&event_type=service_account.enabled`
      );

      // 10. Per-row drill-in on the UNLINK row: click the row whose
      //     accessible name is "View audit event
      //     service_account_unlinked_oauth_client for this service
      //     account" and assert both subject_id + event_type are on
      //     the resulting /org-admin/audit URL.
      const saUUID = saUUIDForUnlink;
      const unlinkRow = page.getByRole("link", {
        name: "View audit event service_account.unlinked_oauth_client for this service account",
      });
      await expect(unlinkRow).toBeVisible();
      const unlinkRowHref = await unlinkRow.getAttribute("href");
      expect(unlinkRowHref).toBe(
        `/org-admin/audit?subject_id=${encodeURIComponent(saUUID)}&event_type=service_account.unlinked_oauth_client`
      );
      await unlinkRow.click();
      await page.waitForURL(
        /\/org-admin\/audit\?subject_id=[^&]+&event_type=service_account.unlinked_oauth_client/,
        { timeout: 15_000 }
      );
      const auditURL = page.url();
      expect(auditURL).toContain(`subject_id=${encodeURIComponent(saUUID)}`);
      expect(auditURL).toContain("event_type=service_account.unlinked_oauth_client");

      // 11. Negative scan on the audit page: no credential / secret /
      //     hash / private-key / token / bearer / set-cookie / session-id
      //     identifier appears in the rendered <main>. The body scope is
      //     <main> (not <body>) to avoid false positives from the inline
      //     Next.js RSC payload's legitimate token_endpoint_auth_method
      //     "client_secret_basic" substring on adjacent OAuth client
      //     objects.
      const auditMain = (await page.locator("main").textContent()) ?? "";
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "service_account_secret",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "authorization_code",
      ]) {
        expect(auditMain).not.toContain(forbidden);
      }

      // The SA row is left in place; the fixture-org purge CASCADE in
      // global teardown sweeps both the SA and the link column reset.
    } finally {
      await page.close();
    }
  });
});

// ── Edit details — slice identuum-20260530-service-account-edit-ui ─────────
//
// End-to-end validation for the org-admin "Edit details" affordance on
// /org-admin/service-accounts/[id]. Creates a disposable SA, edits
// name/description/role through the EditDetailsCard, hard-reloads to
// prove the change is persistent (not just the in-memory useActionState
// success branch), and asserts the per-SA Recent activity card surfaces
// the new "Service account updated" row with the documented audit
// drill-in href. A second test exercises the 409 duplicate-name path
// (slice identuum-20260530-service-account-name-conflict-backend) by
// creating two SAs and attempting to rename one to the other's name.

test.describe("/org-admin/service-accounts/[id] — edit details (dynamic mode, fixture-cascade cleanup)", () => {
  test("[dynamic mode only] edits name/description/role, reload survives the change, and the audit row appears", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      const nonce = Date.now().toString(36);
      // The original and renamed names share no prefix — the negative
      // scan below asserts the original name no longer appears in the
      // rendered <main>, which would be defeated by a renamed value
      // that contains the original as a substring.
      const saName = `e2e-sa-edit-original-${nonce}`;
      const renamedSaName = `e2e-sa-edit-renamed-${nonce}`;

      // 1. Create the disposable SA.
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saName);
      await page.getByLabel(/^Description/).fill("Playwright edit target");
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 2. Navigate to the SA detail page via "View details".
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.getByRole("link", { name: /^View details$/ }).click(),
      ]);
      await expect(page.getByRole("heading", { name: saName, level: 1 })).toBeVisible();

      // 3. Capture the SA UUID from the rendered "Service account ID"
      //    row (the Configuration card surfaces sa.id as a monospace
      //    span). We need it later to assert the audit row's per-row
      //    drill-in href.
      //    Strategy: read the URL — the detail page is mounted at
      //    /org-admin/service-accounts/<uuid>.
      const url = new URL(page.url());
      const saUUID = url.pathname.split("/").pop() ?? "";
      expect(saUUID).toMatch(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
      );

      // 4. The Edit details card must be visible with the current
      //    values, and the form must start collapsed (only the "Edit
      //    details" expand button + the read-only details visible).
      const editDetailsHeading = page.getByRole("heading", {
        name: "Edit details",
        level: 2,
      });
      await expect(editDetailsHeading).toBeVisible();
      // No form fields should be visible while collapsed (the
      // edit-form inputs use stable element ids — pin those rather
      // than fishing for label text that also appears in the
      // read-only Configuration grid).
      await expect(page.locator("#edit-sa-name")).toHaveCount(0);
      await expect(page.locator("#edit-sa-description")).toHaveCount(0);
      await expect(page.locator("#edit-sa-role")).toHaveCount(0);
      // 5. Click "Edit details" to expand the form.
      await page
        .getByRole("button", { name: /^Edit details$/ })
        .first()
        .click();
      const nameInput = page.locator("#edit-sa-name");
      const descInput = page.locator("#edit-sa-description");
      const roleSelect = page.locator("#edit-sa-role");
      await expect(nameInput).toBeVisible();
      await expect(descInput).toBeVisible();
      await expect(roleSelect).toBeVisible();
      await expect(nameInput).toHaveValue(saName);
      await expect(descInput).toHaveValue("Playwright edit target");
      await expect(roleSelect).toHaveValue("org_user");
      // 6. Modify all three fields.
      await nameInput.fill(renamedSaName);
      await descInput.fill("Playwright edit updated");
      await roleSelect.selectOption("org_admin");
      // 7. Submit. After the server action's revalidatePath() the page
      //    re-renders with the new server-side values; the in-memory
      //    success banner may be unmounted along with the form. We
      //    therefore observe success via the persistent updated values.
      await page.getByRole("button", { name: /^Save details$/ }).click();
      // The page heading mirrors sa.name (from the server-side fetch);
      // after revalidatePath it MUST reflect the new name.
      await expect(page.getByRole("heading", { name: renamedSaName, level: 1 })).toBeVisible({
        timeout: 15_000,
      });
      // 8. Hard reload — the new values MUST persist (i.e. the PATCH
      //    actually hit the backend, not just the in-memory state).
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: renamedSaName, level: 1 })).toBeVisible({
        timeout: 15_000,
      });
      const mainText = (await page.locator("main").textContent()) ?? "";
      expect(mainText).toContain("Playwright edit updated");
      expect(mainText).toContain("org_admin");
      expect(mainText).not.toContain(saName);
      expect(mainText).not.toContain("Playwright edit target");
      // 9. Recent activity card must now include the documented
      //    "Service account updated" row, with the per-row drill-in
      //    href pinning subject_id + event_type.
      const updatedRow = page.getByRole("link", {
        name: "View audit event service_account.updated for this service account",
      });
      await expect(updatedRow).toBeVisible({ timeout: 15_000 });
      const updatedHref = await updatedRow.getAttribute("href");
      expect(updatedHref).toBe(
        `/org-admin/audit?subject_id=${encodeURIComponent(saUUID)}&event_type=service_account.updated`
      );
      // 10. Negative scan on the detail page <main>: no credential /
      //     secret / hash / private-key / token / bearer / set-cookie /
      //     session-id substring leaks via the edit slice. Scope to
      //     <main> to avoid false positives from the inline RSC
      //     payload's "client_secret_basic" substring on adjacent
      //     OAuth client objects.
      for (const forbidden of [
        "client_secret",
        "client_secret_hash",
        "service_account_secret",
        "secret_hash",
        "private_key",
        "signing_key",
        "access_token",
        "refresh_token",
        "authorization_code",
      ]) {
        expect(mainText).not.toContain(forbidden);
      }
      // The fixture-org CASCADE FK sweeps the renamed SA in global
      // teardown — no explicit cleanup needed.
    } finally {
      await page.close();
    }
  });

  test("[dynamic mode only] renaming to an existing SA's name surfaces a name-field error (409 conflict)", async () => {
    if (skipOrgAdminTests) test.skip(true, SKIP_MSG);
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(true, DYNAMIC_ONLY_SKIP_MSG);
    }
    if (!sharedCtx) throw new Error("shared context not initialized");
    const page = await sharedCtx.newPage();
    try {
      const nonce = Date.now().toString(36);
      const saNameA = `e2e-sa-edit-conflict-a-${nonce}`;
      const saNameB = `e2e-sa-edit-conflict-b-${nonce}`;

      // 1. Create SA A.
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saNameA);
      await page.getByLabel(/^Description/).fill("Conflict-test SA A");
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 2. Create SA B (separate run — the create form's success panel
      //    holds context for one creation at a time).
      await page.goto("/org-admin/service-accounts/new");
      await page.getByLabel(/^Name/).fill(saNameB);
      await page.getByLabel(/^Description/).fill("Conflict-test SA B");
      await page.getByLabel(/^Role/).selectOption("org_user");
      await page.getByRole("button", { name: /^Create service account$/ }).click();
      await expect(page.getByText("Service account created", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 3. Open SA B's detail page and try to rename it to A's name.
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.getByRole("link", { name: /^View details$/ }).click(),
      ]);
      await expect(page.getByRole("heading", { name: saNameB, level: 1 })).toBeVisible();
      await page
        .getByRole("button", { name: /^Edit details$/ })
        .first()
        .click();
      const nameInput = page.locator("#edit-sa-name");
      await expect(nameInput).toBeVisible();
      await nameInput.fill(saNameA);
      await page.getByRole("button", { name: /^Save details$/ }).click();

      // 4. The server action MUST surface the duplicate-name error in
      //    the form's error alert region (mapped from 409 conflict).
      //    The form-level <div role="alert"> carries the public string.
      //    Scope to the Edit details region — the unrelated Next.js
      //    route-announcer also has role="alert".
      const conflictAlert = page.getByRole("region", { name: "Edit details" }).getByRole("alert");
      await expect(conflictAlert).toBeVisible({ timeout: 15_000 });
      await expect(conflictAlert).toContainText("Service account name already exists.");

      // 5. Hard reload — the SA's name MUST NOT have changed (the PATCH
      //    was rejected with 409).
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: saNameB, level: 1 })).toBeVisible({
        timeout: 15_000,
      });
      // Both fixture SAs are swept by the CASCADE FK in global teardown.
    } finally {
      await page.close();
    }
  });
});
