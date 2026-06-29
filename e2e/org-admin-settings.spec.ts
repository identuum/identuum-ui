/**
 * Rendered-DOM Playwright coverage for `/org-admin/settings`.
 *
 * Scope:
 *   - Non-destructive by default. No form submission, no input filling, no
 *     Save click, no policy mutation against any long-lived org.
 *   - One opt-in dynamic-mode-only test ("[dynamic mode only] toggling a radio
 *     enables Save; …") clicks Save against the disposable fixture org. That
 *     test is gated on `IDENTUUM_E2E_USE_DYNAMIC_FIXTURE === "true"` and only
 *     mutates the per-run disposable org, which globalTeardown purges
 *     regardless of outcome. Durable env mode never reaches that test.
 *   - Asserts that the four documented cards render with the correct controls
 *     + copy, and that the page body contains no credential-material /
 *     cross-org-authority / fixture-identifier strings.
 *
 * Mode:
 *   - Designed for both durable (.env.playwright.idp-oss.local) and dynamic
 *     (IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true) modes. login.ts resolves the
 *     credentials in either path; this spec doesn't care which.
 *   - Skips when no credentials are present, matching the project convention.
 *
 * Session strategy:
 *   - Login ONCE in beforeAll and share the browser context across cases. Each
 *     case opens a fresh page from the shared context. Matches the existing
 *     e2e/org-admin-smoke.spec.ts pattern; avoids TOTP replay failures and
 *     keeps total IdP roundtrips low.
 *
 * Requires:
 *   - Full Compose stack (IdP at localhost:7113, UI at localhost:7104).
 *   - Run with --workers=1 to avoid TOTP replay-protection failures.
 *
 * SECURITY:
 *   - Never reads the fixture file contents from the spec. The loader (used by
 *     login.ts) is the only consumer; this spec just exercises the rendered
 *     page that the resulting session can reach.
 *   - Never prints cookies, storage state, or page-body excerpts that could
 *     contain credentials. Assertions use Playwright's role/text locators
 *     instead of dumping the entire DOM.
 *   - The negative-invariant blocklist patterns include real-fixture sentries
 *     (`audi` / `admin@audi`) as documented regression guards; per the task
 *     spec, intentional negative-invariant patterns are allowed.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loadOrgAdminFixtureOrgDomain } from "./helpers/fixture";
import { loginAsOrgAdmin, skipOrgAdminTests } from "./helpers/login";

const SKIP_MSG =
  "Set IDENTUUM_TEST_ORG_ADMIN_EMAIL + _PASSWORD (durable) or " +
  "IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true (dynamic) to run this test";

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

// ── 1. Main settings surface ─────────────────────────────────────────────────

test.describe("/org-admin/settings — main settings surface", () => {
  test("renders heading + all four documented card titles", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      expect(await page.title()).not.toMatch(/500|internal error|application error/i);

      // Page heading
      await expect(page.getByRole("heading", { name: "Organization settings" })).toBeVisible();

      // Four card titles — the two implemented forms, the new Invite policy
      // read-only card, and the Domains placeholder.
      await expect(page.getByText("Organization profile", { exact: true })).toBeVisible();
      await expect(page.getByText("Security policy", { exact: true })).toBeVisible();
      await expect(page.getByText("Invite policy", { exact: true })).toBeVisible();
      await expect(page.getByText("Domains", { exact: true })).toBeVisible();

      // Four NEW read-only headings landed by slice
      // identuum-20260530-org-admin-settings-readonly-tabs. Each
      // section's <h2> is the load-bearing anchor.
      await expect(page.getByRole("heading", { name: "Identity providers" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Scope templates" })).toBeVisible();

      // Defence-in-depth — no secret-shaped substring anywhere in
      // the rendered body. The captured body text is NEVER printed
      // in test output; assertion messages name only the matching
      // pattern.
      const bodyText = (await page.locator("body").textContent()) ?? "";
      const BANNED: RegExp[] = [
        /\bclient_secret\b/i,
        /\bclient_secret_encrypted\b/i,
        /\bbind_password\b/i,
        /\bsecret_hash\b/i,
        /\bprivate_key\b/i,
        /\bsigning_cert\b/i,
        /\baccess_token\b/i,
        /\brefresh_token\b/i,
        /\bauthorization_code\b/i,
        /Bearer\s+[A-Za-z0-9._-]{8,}/,
        /\bsigning_key\b/i,
        /\bpassword_hash\b/i,
        /otpauth:\/\//i,
        /\bmfa_secret\b/i,
        /\bSet-Cookie\b/i,
      ];
      for (const pat of BANNED) {
        expect(bodyText.match(pat), `settings body matched forbidden pattern ${pat}`).toBeNull();
      }
    } finally {
      await page.close();
    }
  });
});

// ── 2. Organization profile form ─────────────────────────────────────────────

test.describe("/org-admin/settings — Organization profile form", () => {
  test("renders name input + Save profile button + read-only Primary domain", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Organization name label + input. The input is enabled (operator can
      // edit), but this spec does NOT fill it.
      const nameInput = page.getByLabel("Organization name");
      await expect(nameInput).toBeVisible();
      expect(await nameInput.isDisabled()).toBe(false);

      // Save profile button is visible — but this spec does NOT click it.
      await expect(page.getByRole("button", { name: /save profile/i })).toBeVisible();

      // Primary domain section renders as a read-only <p>, not as <input>.
      // `getByLabel("Primary domain")` would only match an input control;
      // assert the COUNT is zero so a future regression that wired an
      // editable input would be caught.
      expect(await page.getByLabel(/primary domain/i).count()).toBe(0);

      // The OIDC-discovery helper copy block, when present, identifies the
      // read-only justification rendered with the domain.
      const helpCount = await page.getByText("Domain changes affect", { exact: false }).count();
      if (helpCount > 0) {
        await expect(page.getByText("Domain changes affect", { exact: false })).toBeVisible();
      }
    } finally {
      await page.close();
    }
  });
});

// ── 3. MFA policy form ───────────────────────────────────────────────────────

test.describe("/org-admin/settings — MFA policy form", () => {
  test("renders Optional + Required radios + Save policy button (mutex enforced)", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      const optionalOpt = page.getByRole("radio", { name: /^Optional/ });
      const requiredOpt = page.getByRole("radio", { name: /^Required/ });
      await expect(optionalOpt).toBeVisible();
      await expect(requiredOpt).toBeVisible();

      // Mutex: exactly one selected. This spec does NOT toggle the selection.
      const optChecked = await optionalOpt.isChecked();
      const reqChecked = await requiredOpt.isChecked();
      expect(optChecked || reqChecked).toBe(true);
      expect(optChecked && reqChecked).toBe(false);

      await expect(page.getByRole("button", { name: /save policy/i })).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ── 4. Invite policy card (read-only) ────────────────────────────────────────

test.describe("/org-admin/settings — Invite policy card", () => {
  test("renders card title, three mode radios, exactly one initial selection, Save button, and Users-page link", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Card title + sr-only legend.
      await expect(page.getByText("Invite policy", { exact: true })).toBeVisible();

      // Three radios, one per documented mode.
      // Use the input's `value` attribute to disambiguate — the
      // accessible names of the three radios all include long descriptions
      // and "Public self-registration" is a prefix of two distinct modes.
      const inviteOnlyRadio = page.locator('input[name="invite_policy_mode"][value="invite-only"]');
      const publicWithApprovalRadio = page.locator(
        'input[name="invite_policy_mode"][value="public-with-approval"]'
      );
      const publicImmediateRadio = page.locator(
        'input[name="invite_policy_mode"][value="public-immediate"]'
      );
      await expect(inviteOnlyRadio).toBeVisible();
      await expect(publicWithApprovalRadio).toBeVisible();
      await expect(publicImmediateRadio).toBeVisible();

      // Exactly one is initially checked. The dynamic-fixture org is created
      // with allow=false, approval=false → "invite-only" is initially
      // selected. Durable fixtures depend on their row.
      const inviteOnlyChecked = await inviteOnlyRadio.isChecked();
      const publicWithApprovalChecked = await publicWithApprovalRadio.isChecked();
      const publicImmediateChecked = await publicImmediateRadio.isChecked();
      const checkedCount = [
        inviteOnlyChecked,
        publicWithApprovalChecked,
        publicImmediateChecked,
      ].filter(Boolean).length;
      expect(checkedCount).toBe(1);

      // "Save invite policy" button is visible (this spec does NOT click it
      // unless the dynamic-mode test below opts in).
      await expect(page.getByRole("button", { name: /save invite policy/i })).toBeVisible();

      // "Open Users page →" link points at /org-admin/users (internal,
      // relative). Catches a regression that pointed it at /site-admin/* or
      // an external URL.
      const usersLink = page.getByRole("link", { name: /Open Users page/i });
      await expect(usersLink).toBeVisible();
      expect(await usersLink.getAttribute("href")).toBe("/org-admin/users");

      // The page now has exactly three Save buttons (Save profile, Save
      // policy, Save invite policy). A fourth would indicate an
      // unexpected new mutation surface.
      expect(await page.getByRole("button", { name: /^Save\b/i }).count()).toBe(3);
    } finally {
      await page.close();
    }
  });

  // Write-path coverage — DYNAMIC FIXTURE MODE ONLY.
  //
  // This test toggles the Invite policy mode and clicks Save against the
  // disposable fixture organization. The dynamic fixture is per-run and is
  // hard-purged by globalTeardown regardless of test outcome, so the
  // mutation is contained and reversible by construction.
  //
  // The test self-skips when the operator did NOT opt into dynamic mode
  // (durable env mode might target a long-lived fixture; mutating that
  // would be irreversible). The opt-in signal is the env value the loader
  // honors — when the dynamic JSON file is present, login.ts used its
  // generated credentials; when it is absent, durable env vars are in use.
  test("[dynamic mode only] toggling a radio enables Save; clicking persists and the new mode is reflected", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    // Only run when dynamic fixture mode is explicitly requested — this
    // is the only safe path to click Save against a real org.
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(
        true,
        "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test mutates the disposable fixture org."
      );
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // The dynamic-fixture org is created with mode "invite-only".
      // Disambiguate the three radios by the input's `value` attribute
      // (matches the form's `name="invite_policy_mode"` input pair).
      const inviteOnlyRadio = page.locator('input[name="invite_policy_mode"][value="invite-only"]');
      const publicImmediateRadio = page.locator(
        'input[name="invite_policy_mode"][value="public-immediate"]'
      );
      const saveBtn = page.getByRole("button", { name: /save invite policy/i });

      expect(await inviteOnlyRadio.isChecked()).toBe(true);
      expect(await saveBtn.isDisabled()).toBe(true);

      // Toggle to public-immediate; Save becomes enabled.
      await publicImmediateRadio.check();
      expect(await publicImmediateRadio.isChecked()).toBe(true);
      expect(await saveBtn.isDisabled()).toBe(false);

      // Click Save and wait for the success banner. The banner appears
      // ONLY when the server action returned `{phase: "success"}`, which
      // means the IDP accepted the PUT. The success banner is the load-
      // bearing signal that the save persisted.
      await saveBtn.click();
      await expect(
        page.getByText("Invite policy updated successfully.", { exact: true })
      ).toBeVisible({ timeout: 10_000 });

      // Cross-check: no error banner is visible.
      expect(
        await page
          .locator("div.bg-red-50")
          .filter({ hasText: /Failed/i })
          .count()
      ).toBe(0);

      // Reload the page and verify the new mode is now the initial selection
      // (proves the change was actually persisted to the DB and re-projected
      // through the IDP read path).
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(await publicImmediateRadio.isChecked()).toBe(true);
      expect(await inviteOnlyRadio.isChecked()).toBe(false);
    } finally {
      await page.close();
    }
  });
});

// ── 5. Domains card — real (no longer a placeholder) ───────────────────────

test.describe("/org-admin/settings — Domains card", () => {
  test("renders Domains card with add-domain input + button; NO Coming-soon badge", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // The Domains heading is rendered.
      await expect(page.getByText("Domains", { exact: true })).toBeVisible();

      // Add-domain control surfaces a real <label htmlFor> + button.
      const addInput = page.getByLabel("Add a domain");
      await expect(addInput).toBeVisible();
      expect(await addInput.isDisabled()).toBe(false);
      await expect(page.getByRole("button", { name: /add domain/i })).toBeVisible();

      // No Coming-soon badge anywhere on the page.
      expect(await page.getByText("Coming soon", { exact: true }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // Write-path coverage — DYNAMIC FIXTURE MODE ONLY.
  //
  // Adds a synthetic test-domain that will REMAIN PENDING (we do not click
  // Verify). The dynamic fixture org is per-run and is hard-purged by
  // globalTeardown regardless of test outcome, so the mutation is
  // contained and reversible by construction.
  //
  // The synthetic domain is in a reserved test TLD (`.test`) so the
  // assertion is safe against real public domains and DNS state is
  // irrelevant to the flow.
  test("[dynamic mode only] adding a synthetic .test domain surfaces DNS TXT instructions (no Verify click)", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(
        true,
        "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test mutates the disposable fixture org."
      );
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Generate a per-run synthetic domain in the reserved .test TLD so
      // we never collide with a real public domain. A second `.test` is
      // appended to keep the value clearly a fixture artifact.
      const runID = String(Date.now());
      const syntheticDomain = `ui-added-${runID}.test`;

      const addInput = page.getByLabel("Add a domain");
      await addInput.fill(syntheticDomain);
      await page.getByRole("button", { name: /add domain/i }).click();

      // The DNS-TXT instructions banner appears. We assert the per-field
      // labels are present and that the copy says the value is shown
      // once. We DO NOT print the record_value to test output.
      await expect(page.getByText("Record name", { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Record type", { exact: true })).toBeVisible();
      await expect(page.getByText("Record value", { exact: true })).toBeVisible();
      await expect(page.getByText("Expires at", { exact: true })).toBeVisible();
      // "Copy the record value now — it will not be shown again." copy
      // is visible, telling the operator the value is single-shot.
      await expect(page.getByText(/not be shown again/i)).toBeVisible();

      // Record type is TXT (the <dd> for the Record type label).
      // Anchor on the locator so a future label-text containing "TXT"
      // does not break the strict-mode match.
      const typeRow = page.locator("dd.font-mono", { hasText: /^TXT$/ });
      await expect(typeRow).toBeVisible();

      // The new pending domain appears in the list with a Pending badge.
      // We use a containing locator anchored on the synthetic domain
      // string to find the row.
      const row = page.locator("li", { hasText: syntheticDomain });
      await expect(row).toBeVisible();
      await expect(row.getByText("Pending", { exact: true })).toBeVisible();

      // We intentionally DO NOT click Verify here — the slice-2 verify
      // failure UX is covered by the next test (which uses its own
      // synthetic .test domain and asserts the safe-error banner).
      // globalTeardown purges the org so this row is removed regardless
      // of outcome.
    } finally {
      await page.close();
    }
  });

  // Verify-failure UX (slice 2) — DYNAMIC FIXTURE MODE ONLY.
  //
  // Safety:
  //   - The domain is in the reserved .test TLD (RFC 2606), so the
  //     backend DNS lookup will fail or return no record. Verification
  //     does NOT mutate the row — the backend either returns 400
  //     ("not found" / "does not match" / lookup-failed) or 503.
  //   - The fixture org is per-run and is hard-purged by globalTeardown
  //     regardless of outcome. The pending row goes away with the org.
  //   - The synthetic domain is a per-run unique string in `.test`; we
  //     never assert the actual record_value substring in test output.
  test("[dynamic mode only] clicking Verify on a pending .test domain shows a safe error and the row stays Pending", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(
        true,
        "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test mutates the disposable fixture org."
      );
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Add a per-run synthetic domain we can later identify in the
      // list. The `.test` TLD is reserved so we cannot collide with a
      // real public domain.
      const runID = String(Date.now());
      const syntheticDomain = `ui-verify-${runID}.test`;

      const addInput = page.getByLabel("Add a domain");
      await addInput.fill(syntheticDomain);
      await page.getByRole("button", { name: /add domain/i }).click();

      // Wait for the DNS-TXT instructions banner so we know the add
      // succeeded and the row is pending. We do NOT read the
      // record_value substring out of the DOM.
      await expect(page.getByText("Record name", { exact: true })).toBeVisible({ timeout: 10_000 });

      // Capture the record_value the page is currently displaying so
      // we can assert later that it never reappears inside the verify
      // failure banner. The locator is anchored on the Record value
      // <dt> + adjacent <dd>; we only use this value for a negative
      // assertion. It is NEVER printed, NEVER logged, NEVER stored.
      const recordValueDD = page.locator('dt:has-text("Record value") + dd');
      const displayedRecordValue = ((await recordValueDD.textContent()) ?? "").trim();
      // Sanity: the value is non-empty (so a regression that started
      // sending an empty token would surface — and so the substring
      // search below is meaningful).
      expect(displayedRecordValue.length).toBeGreaterThan(0);

      // Locate the pending row and click its Verify button.
      const row = page.locator("li", { hasText: syntheticDomain });
      await expect(row).toBeVisible();
      await expect(row.getByText("Pending", { exact: true })).toBeVisible();
      const verifyBtn = row.getByRole("button", { name: /^Verify$/ });
      await expect(verifyBtn).toBeVisible();
      await verifyBtn.click();

      // The safe error alert appears. The four allowed copy strings
      // are:
      //   - record-not-found
      //   - mismatch
      //   - lookup-failed
      //   - generic fallback
      // The `.test` TLD almost always lands on lookup-failed or
      // record-not-found; we accept any of the four to keep the
      // assertion robust to resolver behaviour.
      const errorAlert = page.locator('div[role="alert"]').filter({
        hasText:
          /(DNS TXT record was not found yet|DNS TXT record was found, but it does not match the expected value|Identuum could not complete the DNS lookup|Could not verify domain\. Please try again)/,
      });
      await expect(errorAlert).toBeVisible({ timeout: 10_000 });

      // SLICE-2 NEGATIVE INVARIANT: the verify error alert must NOT
      // echo the challenge value. We assert that the rendered alert
      // textContent does not contain the displayed record_value. We
      // never print either value to test output — only use them for
      // this substring check.
      const errorText = ((await errorAlert.textContent()) ?? "").trim();
      expect(errorText.length).toBeGreaterThan(0);
      expect(
        errorText.includes(displayedRecordValue),
        "verify error banner must not echo the DNS challenge record_value"
      ).toBe(false);
      // And must not name any of the internal-detail substrings the
      // safe-copy bundle is supposed to hide.
      expect(errorText).not.toMatch(/record_value/i);
      expect(errorText).not.toMatch(/token_hash/i);
      expect(errorText).not.toMatch(/verification_token_hash/i);
      expect(errorText).not.toMatch(/Set-Cookie/i);
      expect(errorText).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);

      // The pending row remains visible after the failure and still
      // shows the Pending badge — verification did not mutate row state.
      await expect(row).toBeVisible();
      await expect(row.getByText("Pending", { exact: true })).toBeVisible();
      // And the page is still usable: the Add-a-domain input is still
      // present and not disabled.
      await expect(addInput).toBeVisible();
      expect(await addInput.isDisabled()).toBe(false);
    } finally {
      await page.close();
    }
  });

  // Remove-pending-domain UX (slice 5) — DYNAMIC FIXTURE MODE ONLY.
  //
  // Safety rationale:
  //   - The domain is in the reserved .test TLD (RFC 2606), so no
  //     public DNS state is touched and no real organization could
  //     ever own the synthetic domain.
  //   - The fixture organization is per-run and is hard-purged by
  //     global-teardown regardless of test outcome. The removed row
  //     would have gone away with the org anyway.
  //   - The remove targets a pending (non-primary) row we just
  //     created in the same test. We never click Remove against a
  //     long-lived domain row.
  //   - The primary fixture domain (created by the IDP CLI when the
  //     fixture org was provisioned) is explicitly NOT clicked; we
  //     only assert that no Remove affordance is offered for it.
  test("[dynamic mode only] removing a pending .test domain succeeds and the row disappears; primary fixture domain has no Remove control", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(
        true,
        "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test mutates the disposable fixture org."
      );
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Per-run synthetic domain — unique so the row is unambiguous
      // even if a previous failed run left state behind (the
      // teardown purge handles that case too).
      const runID = String(Date.now());
      const syntheticDomain = `ui-remove-${runID}.test`;

      const addInput = page.getByLabel("Add a domain");
      await addInput.fill(syntheticDomain);
      await page.getByRole("button", { name: /add domain/i }).click();

      // Add succeeded → the DNS-TXT instructions banner appears.
      // We do NOT read the record_value out of the DOM here — the
      // slice-2 verify-failure test owns that locator and the
      // slice-5 remove flow has no reason to touch the challenge.
      await expect(page.getByText("Record name", { exact: true })).toBeVisible({ timeout: 10_000 });

      // The new pending row is in the list with a Pending badge.
      const row = page.locator("li", { hasText: syntheticDomain });
      await expect(row).toBeVisible();
      await expect(row.getByText("Pending", { exact: true })).toBeVisible();

      // The synthetic row has a Remove button (it is non-primary).
      const removeBtn = row.getByRole("button", { name: /^Remove$/ });
      await expect(removeBtn).toBeVisible();
      await removeBtn.click();

      // Success banner appears. We pin the exact bundle copy so a
      // regression that inlined a backend-derived string would
      // surface.
      const successBanner = page
        .locator('div[role="status"]')
        .filter({ hasText: new RegExp(`^${syntheticDomain} has been removed\\.$`) });
      await expect(successBanner).toBeVisible({ timeout: 10_000 });

      // The removed row no longer appears in the list.
      await expect(row).toHaveCount(0);

      // The dynamic fixture now (slice-6 fixture-seed) creates a
      // verified primary organization_domains row matching the org's
      // primary domain, so the Domains card list contains exactly
      // one Primary-badge row. That row MUST have no Remove control
      // (the {!d.is_primary && <form …>} gate in DomainsCard). This
      // is the slice-5 invariant promoted from "vacuous" to a
      // positive count-based assertion.
      const primaryRows = page
        .locator("li")
        .filter({ has: page.getByText("Primary", { exact: true }) });
      await expect(primaryRows).toHaveCount(1);
      expect(
        await primaryRows
          .first()
          .getByRole("button", { name: /^Remove$/ })
          .count()
      ).toBe(0);

      // The page remains usable.
      await expect(addInput).toBeVisible();
      expect(await addInput.isDisabled()).toBe(false);
    } finally {
      await page.close();
    }
  });
});

// ── 5.5 Primary domain row (seeded by slice-6 fixture CLI) ─────────────────
//
// After the slice-6 fixture-seed work in identuum-idp, the disposable
// fixture organisation has a verified primary organization_domains row
// matching organizations.domain (e2e-<runID>.test). The Domains card
// list MUST now surface that row with the Primary + Verified badges
// and MUST offer no operator control on it (no Remove, no Verify, no
// Set primary). This block is the positive-assertion counterpart to
// the slice-5 negative invariants.
//
// The test reads the fixture org domain via a narrow accessor
// (loadOrgAdminFixtureOrgDomain) that returns ONLY the non-secret
// domain string when the fixture file is present. No fixture JSON,
// password, TOTP secret, or cookie crosses out of the accessor.
//
// The test never clicks any control on the primary row — only inspects
// presence/absence at the rendered-DOM layer.

test.describe("/org-admin/settings — Primary domain row", () => {
  test("[dynamic mode only] Domains card shows exactly one Primary + Verified row matching the fixture domain; no operator controls on it", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }
    if (process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE !== "true") {
      test.skip(
        true,
        "Set IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true to opt in. This test depends on the disposable fixture seed."
      );
    }

    // Read the fixture-seeded primary domain via the safe accessor.
    // The accessor returns the non-secret reserved e2e-<runID>.test
    // pattern — already printed in the IDP CLI banner and on the
    // Organization profile card — so capturing it here is safe.
    const fixtureDomain = requireValue(
      loadOrgAdminFixtureOrgDomain(),
      "dynamic-fixture mode must produce a fixture file the accessor can read"
    );
    // Defence-in-depth: the slice-6 IDP work uses the reserved e2e
    // pattern; pin the suffix without printing the runID specifically
    // into the assertion message.
    expect(fixtureDomain).toMatch(/^e2e-[0-9a-f]{12}\.test$/);

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Exactly one row has the Primary badge — uq_org_domains_one_primary_per_org
      // index in migration 0019 enforces this at the DB layer; the
      // UI surfaces it 1:1.
      const primaryRows = page
        .locator("li")
        .filter({ has: page.getByText("Primary", { exact: true }) });
      await expect(primaryRows).toHaveCount(1);

      const primaryRow = primaryRows.first();

      // The primary row also carries the Verified badge (it is verified
      // by construction — the fixture seed sets verified_at and no
      // verification token).
      await expect(primaryRow.getByText("Verified", { exact: true })).toBeVisible();
      await expect(primaryRow.getByText("Pending", { exact: true })).toHaveCount(0);

      // The primary row's domain matches the fixture org's domain.
      // We assert as a substring inside the row's text content so a
      // future visual change (e.g. monospace wrapper) doesn't break
      // the match.
      const rowText = ((await primaryRow.textContent()) ?? "").trim();
      expect(rowText).toContain(fixtureDomain);

      // No operator control is offered on the primary row — slice-1
      // invariant restated at the rendered-DOM layer. The DomainsCard
      // gates Remove on !d.is_primary, Verify on !d.verified, and Set
      // primary on d.verified && !d.is_primary. All three resolve to
      // "no button" for a verified primary row.
      expect(await primaryRow.getByRole("button", { name: /^Remove$/ }).count()).toBe(0);
      expect(await primaryRow.getByRole("button", { name: /^Verify$/ }).count()).toBe(0);
      expect(await primaryRow.getByRole("button", { name: /^Set primary$/ }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

// ── 6. Placeholder regression — Domains is NOT a Coming-soon placeholder ───

test.describe("/org-admin/settings — placeholder regression sentries", () => {
  test("Domains is no longer a Coming-soon placeholder; no Coming-soon badge anywhere on the page", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Slice 1 of the org-admin Domains UI replaced the Domains
      // placeholder with the real DomainsCard. The "Coming soon" badge
      // is no longer rendered on this page.
      const comingSoonCount = await page.getByText("Coming soon", { exact: true }).count();
      expect(comingSoonCount).toBe(0);

      // No card-level wrapper contains both "Domains" and "Coming soon".
      const cardRoots = page.locator("div.rounded-\\[1\\.5rem\\]");
      const domainsCardWithComingSoon = cardRoots
        .filter({ hasText: "Domains" })
        .filter({ hasText: "Coming soon" });
      expect(await domainsCardWithComingSoon.count()).toBe(0);

      // Invite policy must also not regress to a placeholder.
      const inviteCardWithComingSoon = cardRoots
        .filter({ hasText: "Current mode" })
        .filter({ hasText: "Coming soon" });
      expect(await inviteCardWithComingSoon.count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

// ── 7. Negative invariants on rendered page body ────────────────────────────

test.describe("/org-admin/settings — page-body negative invariants", () => {
  test("page body contains no credential / authority / fixture-identifier strings", async () => {
    if (skipOrgAdminTests) {
      test.skip(true, SKIP_MSG);
    }

    const page = await getSharedContext().newPage();
    try {
      await page.goto("/org-admin/settings");
      await page.waitForLoadState("networkidle");

      // Snapshot the rendered body text only. NEVER print this value or
      // include it in assertion error messages — it could otherwise leak
      // user-visible content into CI logs.
      const bodyText = (await page.locator("body").textContent()) ?? "";

      // Credential-material blocklist. None of these should ever appear in
      // the rendered Organization profile + MFA policy + Invite policy +
      // Domains placeholder copy.
      const credentialTerms: RegExp[] = [
        /password_hash/i,
        /mfa_secret/i,
        /otpauth:\/\//i,
        /Bearer\s+[A-Za-z0-9._-]{8,}/,
        /Set-Cookie/i,
        /session\s+validator/i,
        /reset\s+token/i,
        /claim_token/i,
        /recovery\s+code/i,
        /recovery_codes/i,
        /\bapi\s+key\b/i,
        /\bsecret\s+key\b/i,
      ];
      for (const pat of credentialTerms) {
        expect(bodyText.match(pat), `page body matched credential pattern ${pat}`).toBeNull();
      }

      // Authority-boundary blocklist. None of these should appear in the
      // org-admin-scoped settings copy. Cross-tenant / site-admin language
      // would imply an authority the org_admin role does not have.
      const authorityTerms: RegExp[] = [
        /\bsite[- ]admin\b/i,
        /\bcross[- ]org\b/i,
        /all organizations/i,
        /system user/i,
        /sovereign bunker override/i,
        /archive organization/i,
        /restore organization/i,
        /hard delete/i,
        /delete organization/i,
      ];
      for (const pat of authorityTerms) {
        expect(bodyText.match(pat), `page body matched authority pattern ${pat}`).toBeNull();
      }

      // Real-fixture identifier sentry. Catches a regression that
      // hard-coded a customer / company identifier into operator copy.
      const realFixtureTerms: RegExp[] = [/\baudi\b/i, /admin@audi/i, /\bAudi\b/];
      for (const pat of realFixtureTerms) {
        expect(bodyText.match(pat), `page body matched real-fixture pattern ${pat}`).toBeNull();
      }
    } finally {
      await page.close();
    }
  });
});
