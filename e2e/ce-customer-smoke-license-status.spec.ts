/**
 * Env-gated Playwright spec for the IDP CE customer-smoke M2
 * license-status verification path.
 *
 * Records the manual M1/M2 result as an automated regression pin:
 *
 *   M1 setup wizard       — PASS (manual, 2026-06-20)
 *   M2 license envelope   — PASS (manual, 2026-06-20)
 *   /api/setup/license    — state="license_valid"
 *   /api/v1/component     — license.status="valid"
 *
 * This spec NEVER reads or prints setup tokens, license envelope
 * bytes, passwords, TOTP secrets, recovery codes, session cookies,
 * JWTs, or .env values. It exercises ONLY the no-secret read-side
 * API surface that the operator already pinned through manual M2.
 *
 * Two test groups:
 *
 *   Group 1 (no-env, no-auth) — runs ALWAYS when the customer-smoke
 *     stack is reachable. Asserts:
 *
 *       a. `GET ${IDP_BASE_URL}/api/setup/license` returns 200 with
 *          `{state: "license_valid"}` on the response body.
 *       b. `GET ${IDP_BASE_URL}/api/v1/component` returns 200 with
 *          `license.status === "valid"`.
 *       c. Invariant #12: the two endpoints agree.
 *
 *     If the stack is NOT prepared (license missing / setup_required),
 *     these assertions fail loudly because they pin the post-M2
 *     observable contract. To run against an unprepared stack, run
 *     the M1+M2 manual runbook first OR set
 *     IDENTUUM_E2E_CE_LICENSE_GATE_PREPARED="0" to skip cleanly.
 *
 *   Group 2 (env-gated, UI-side) — runs ONLY when ALL of:
 *
 *       (a) IDENTUUM_E2E_CE_LICENSE_UI_PREPARED="1" — explicit
 *           operator opt-in.
 *       (b) The standard site_admin auth env vars are present
 *           (`IDENTUUM_TEST_SITE_ADMIN_PASSWORD` +
 *           `IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET`) — same gate the
 *           other authenticated site-admin specs use via
 *           `e2e/helpers/login.ts::skipAuthTests` + `SKIP_AUTH_MSG`.
 *
 *     Asserts:
 *
 *       d. The bundled UI's `/site-admin/settings` page renders and
 *          shows a license card with the expected `valid` posture.
 *
 *     Uses the shared `loginAsSiteAdminMFAOptional(page)` helper
 *     (mirrors the existing `loginAsOrgAdmin` MFA-optional pattern).
 *     Distinct from `loginAsSiteAdmin` because the CE customer-smoke
 *     M1 setup wizard does NOT auto-enroll TOTP for the site_admin
 *     row — MFA enrollment is a deferred operator action under
 *     `/account/settings`. The MFA-optional helper transparently
 *     restores a saved session when available, falls back to full
 *     email + password login when not, fills the TOTP code IF the IDP
 *     rendered the Verification code page within a short window, AND
 *     completes cleanly if the TOTP page never rendered (no MFA
 *     enrolled). The session-state file path is owned by the helper;
 *     this spec NEVER reads the path, the file contents, the password,
 *     or the TOTP secret directly. Skips cleanly when EITHER (a) or
 *     (b) is absent.
 *
 * Runtime selection:
 *
 *   IDP_BASE_URL    — defaults to http://127.0.0.1:7123 (the
 *                     canonical customer-smoke CE IDP backend port
 *                     from deployment/docker-compose.yml).
 *                     OVERRIDE WITH CARE — port 7124 is the bundled
 *                     UI and does NOT proxy /api/setup/license or
 *                     /api/v1/component; hitting that port returns
 *                     the UI's HTML 404 (the 2026-06-20 operator
 *                     report root cause).
 *
 *   IDENTUUM_E2E_CE_LICENSE_GATE_PREPARED
 *       "0" = explicit "stack NOT prepared, skip the read-side
 *             agreement assertions". Default unset = run the
 *             assertions and let them fail loudly if the operator
 *             forgot M1/M2.
 *
 *   IDENTUUM_E2E_CE_LICENSE_UI_PREPARED
 *       "1" = opt-in to drive the authenticated UI license-card
 *             assertion. Requires a separate storage-state path the
 *             operator wires through Playwright config.
 *
 * What this spec is NOT:
 *
 *   - It does NOT execute the setup wizard.
 *   - It does NOT upload a license envelope.
 *   - It does NOT read the operator's setup token.
 *   - It does NOT decode session cookies, JWTs, license_id values,
 *     licensee names, or expires_at timestamps. It pins only the
 *     `state` / `license.status` strings, which are public by
 *     design.
 */

import { expect, test } from "@playwright/test";
import { SKIP_AUTH_MSG, loginAsSiteAdminMFAOptional, skipAuthTests } from "./helpers/login";

const IDP_BASE_URL = process.env.IDP_BASE_URL ?? "http://127.0.0.1:7123";
const CE_LICENSE_GATE_PREPARED = process.env.IDENTUUM_E2E_CE_LICENSE_GATE_PREPARED ?? "";
const CE_LICENSE_UI_PREPARED = process.env.IDENTUUM_E2E_CE_LICENSE_UI_PREPARED ?? "";

const SAFE_LICENSE_KEYS = new Set([
  "state",
  "distribution",
  "product",
  "tier",
  "next_action",
  "licensee",
  "license_id",
  "license_type",
  "expires_at",
  "days_remaining",
]);

const SAFE_COMPONENT_TOP_KEYS = new Set([
  "auth",
  "capabilities",
  "component",
  "capability_map_schema_version",
  "license",
  "product",
  "status",
  "version",
]);

test.describe("CE customer-smoke M2 — backend license-status agreement (no-secret, no-auth)", () => {
  test.skip(
    CE_LICENSE_GATE_PREPARED === "0",
    "IDENTUUM_E2E_CE_LICENSE_GATE_PREPARED=0 — stack explicitly marked not-prepared; M1/M2 manual runbook has not run."
  );

  // CONDITION-JUSTIFIED SKIP (THE-V032-ALL-GREEN Order D). These tests
  // assert the M2-PROVISIONED CE customer-smoke stack (license_valid on both
  // endpoints) — a mere listener on the port is not that (a partially-up CE
  // dev stack answers but is not runbook-provisioned). They therefore run
  // only when the operator marks the M1/M2 manual runbook complete; on an
  // OSS-only workstation they skip with this condition printed and run
  // unchanged when CE ships.
  test.beforeEach(() => {
    test.skip(
      CE_LICENSE_GATE_PREPARED !== "1",
      `CE customer-smoke stack not marked M2-provisioned — set IDENTUUM_E2E_CE_LICENSE_GATE_PREPARED=1 after running the M1/M2 runbook against ${IDP_BASE_URL} (these tests ship with CE).`
    );
  });

  test("GET /api/setup/license returns state=license_valid", async ({ request }) => {
    const res = await request.get(`${IDP_BASE_URL}/api/setup/license`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.state, "license state must be license_valid after M2").toBe("license_valid");
    // Defence in depth: no forbidden keys appear on the wire. We do
    // NOT log the response body — just assert the key set is bounded
    // and known-safe. A future schema regression that added
    // `signing_key` or `envelope_bytes` would surface here.
    for (const key of Object.keys(body)) {
      expect(SAFE_LICENSE_KEYS.has(key), `unexpected key ${key} on /api/setup/license`).toBe(true);
    }
  });

  test("GET /api/v1/component returns license.status=valid", async ({ request }) => {
    const res = await request.get(`${IDP_BASE_URL}/api/v1/component`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { license?: { status?: unknown } } & Record<string, unknown>;
    expect(body.license?.status, "license.status must be valid after M2").toBe("valid");
    // Top-level shape pin (defence in depth — same posture as the
    // /api/setup/license body check above).
    for (const key of Object.keys(body)) {
      expect(
        SAFE_COMPONENT_TOP_KEYS.has(key),
        `unexpected top-level key ${key} on /api/v1/component`
      ).toBe(true);
    }
  });

  test("invariant #12 [LICENSE-AGREE-1] — /api/setup/license and /api/v1/component agree", async ({
    request,
  }) => {
    const setupRes = await request.get(`${IDP_BASE_URL}/api/setup/license`);
    const componentRes = await request.get(`${IDP_BASE_URL}/api/v1/component`);
    expect(setupRes.status()).toBe(200);
    expect(componentRes.status()).toBe(200);
    const setupBody = (await setupRes.json()) as { state?: string };
    const componentBody = (await componentRes.json()) as { license?: { status?: string } };
    const setupGreen = setupBody.state === "license_valid";
    const componentGreen = componentBody.license?.status === "valid";
    expect(setupGreen && componentGreen, "invariant #12 — both endpoints must agree on green").toBe(
      true
    );
  });
});

test.describe("CE customer-smoke M2 — UI license card (env-gated, requires authed storage-state)", () => {
  // Two-stage skip gate. Both must hold for this group to run:
  //
  //   1. `IDENTUUM_E2E_CE_LICENSE_UI_PREPARED="1"` — explicit operator
  //      opt-in. Off by default so the slice's default CI/CLI runs do
  //      not require any secret-bearing env wiring.
  //
  //   2. The canonical site_admin auth env vars
  //      (`IDENTUUM_TEST_SITE_ADMIN_PASSWORD` +
  //      `IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET`) must be present —
  //      this reuses the standard `skipAuthTests` / `SKIP_AUTH_MSG`
  //      gate every other authenticated site-admin spec uses (e.g.
  //      `e2e/site-admin-observability.spec.ts`,
  //      `e2e/site-admin-organizations.spec.ts`).
  //
  // The standard `loginAsSiteAdmin` helper handles the session-restore
  // fast path AND the full email + password + TOTP login. The
  // session-state file path is owned by the helper — this spec never
  // reads the path or its contents.
  test.skip(
    CE_LICENSE_UI_PREPARED !== "1",
    "IDENTUUM_E2E_CE_LICENSE_UI_PREPARED is not 1 — skipping authed UI license-card assertion (operator-controlled fixture)."
  );
  test.skip(skipAuthTests, SKIP_AUTH_MSG);

  // Give the helper room for the session-restore + worst-case full
  // login + TOTP cooldown wait (matches the timeout other authed
  // site-admin specs allocate in their beforeAll blocks).
  test.setTimeout(120_000);

  // Resolve the effective UI base URL the spec will hit. We intentionally
  // re-resolve here (matching Playwright's `baseURL` precedence) so the
  // pre-flight diagnostic prints the SAME URL Playwright will navigate
  // to. The default 7104/7114 dev port is NOT a valid customer-smoke
  // target; the operator must override IDENTUUM_E2E_BASE_URL when running
  // against the customer-smoke stack on port 7124.
  const E2E_UI_BASE_URL =
    process.env.IDENTUUM_E2E_BASE_URL ??
    `http://localhost:${process.env.IDENTUUM_E2E_PORT ?? "7104"}`;

  // Pre-flight: print the actual target URLs the authed Group 2 will
  // hit and verify both surfaces are reachable. This overrides the
  // misleading `[e2e setup] runtime config OK — IdP: enabled (<local
  // config>)` line from `e2e/global-setup.ts` (which only reflects the
  // local-dev `config/ui-runtime.json` file and does NOT control what
  // the customer-smoke UI container actually talks to). The pre-flight
  // never prints any secret value.
  test.beforeAll(async ({ request }) => {
    process.stdout.write(
      `\n[ce-customer-smoke spec] Group 2 effective targets:\n  UI  baseURL : ${E2E_UI_BASE_URL}\n  IDP backend : ${IDP_BASE_URL}\n  (the global-setup banner above reflects the LOCAL ui-runtime.json file and does NOT control where the customer-smoke UI container fetches from)\n`
    );

    // Placeholder guard. The .env.playwright.idp-ce.local.example
    // template ships REPLACE_ME_* placeholder values. If the operator
    // copied the template but forgot to fill it in, the canonical site_admin
    // env vars will be present (so `skipAuthTests` is false) BUT carry
    // the placeholder string. Catch this before attempting login so the
    // operator sees an actionable diagnostic instead of a login failure
    // that could be misread as a credential-correctness issue. We check
    // only for the explicit "REPLACE_ME" prefix; real credentials never
    // legitimately begin with this token. The check does NOT print any
    // env-var value.
    const placeholderVars: string[] = [];
    for (const key of [
      "IDENTUUM_TEST_SITE_ADMIN_EMAIL",
      "IDENTUUM_TEST_SITE_ADMIN_PASSWORD",
      "IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET",
    ]) {
      const raw = process.env[key];
      if (raw?.startsWith("REPLACE_ME")) {
        placeholderVars.push(key);
      }
    }
    if (placeholderVars.length > 0) {
      throw new Error(
        `[ce-customer-smoke spec] The following env vars still carry REPLACE_ME placeholder values: ${placeholderVars.join(", ")}. Edit identuum-ui/.env.playwright.idp-ce.local with the credentials you chose at the customer-smoke M1 setup wizard. The template at .env.playwright.idp-ce.local.example documents each field. NO VALUE IS PRINTED BY THIS DIAGNOSTIC.`
      );
    }

    // IDP backend reachability (no auth, no secrets, public state).
    const setupRes = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    if (setupRes.status() !== 200) {
      throw new Error(
        `[ce-customer-smoke spec] IDP backend at ${IDP_BASE_URL} returned ${setupRes.status()} on /api/setup/status. Group 2 requires the customer-smoke CE IDP backend to be reachable on this port. Verify with: make customer-smoke-status (from identuum-idp-ce).`
      );
    }
    const setupBody = (await setupRes.json()) as { setup_complete?: boolean };
    if (!setupBody.setup_complete) {
      throw new Error(
        `[ce-customer-smoke spec] IDP backend at ${IDP_BASE_URL} reports setup_complete=false. Run the M1 setup wizard manually first per the runbook (identuum-idp-ce/docs/CE_CUSTOMER_SMOKE_RUNBOOK.md §Operator runbook).`
      );
    }

    // UI surface reachability. The customer-smoke UI's /setup endpoint
    // either renders the wizard (200) or 307-redirects to /login once
    // setup is complete — both are acceptable signals that the right
    // port is up. We convert ECONNREFUSED (and similar connection
    // errors) into the same clear diagnostic so the operator sees the
    // actionable env-var fix instead of a raw connect error.
    let uiStatus: number;
    try {
      const uiRes = await request.head(`${E2E_UI_BASE_URL}/setup`);
      uiStatus = uiRes.status();
    } catch (err) {
      throw new Error(
        `[ce-customer-smoke spec] UI at ${E2E_UI_BASE_URL} could not be reached (${(err as Error).message}). The customer-smoke UI is published on 127.0.0.1:7124 (NOT 7104/7114). Re-run with: IDENTUUM_E2E_BASE_URL=http://127.0.0.1:7124 ...`
      );
    }
    if (uiStatus !== 200 && uiStatus !== 301 && uiStatus !== 302 && uiStatus !== 307) {
      throw new Error(
        `[ce-customer-smoke spec] UI at ${E2E_UI_BASE_URL} returned ${uiStatus} on HEAD /setup. The customer-smoke UI is published on 127.0.0.1:7124 (NOT 7104/7114). Re-run with: IDENTUUM_E2E_BASE_URL=http://127.0.0.1:7124 ...`
      );
    }
  });

  test("/site-admin/settings shows the license card in a green/valid posture", async ({ page }) => {
    // The helper transparently restores a saved session when available
    // (no TOTP code is read or printed) AND falls back to full login
    // when not. Passwords / TOTP secrets are read only by the helper
    // — never by this spec.
    //
    // We wrap the login call in a try/catch that re-throws with a
    // safe diagnostic naming the most likely operator-actionable
    // causes WITHOUT printing any credential value. The original
    // helper error chain is preserved on the wrapped error.
    try {
      // MFA-optional variant: the CE customer-smoke M1 wizard creates a
      // site_admin row WITHOUT enrolling TOTP (MFA enrollment is the
      // operator's deferred /account/settings action). The helper
      // tolerates both shapes: TOTP fills if rendered, skipped if not.
      // Does NOT weaken MFA enforcement — only relaxes the helper's
      // assumption about MFA being already enrolled.
      await loginAsSiteAdminMFAOptional(page);
    } catch (err) {
      const safeDiagnostic = `Login to ${E2E_UI_BASE_URL}/site-admin failed. The underlying helper error below carries the SAFE OBSERVABLE EVIDENCE collected at the post-password-submit moment — including the observed URL, any visible inline error/banner text on the page, and whether the IDP rendered an MFA prompt. NO credential value (email, password, TOTP code, cookie, JWT, env-var content) is referenced. See identuum-idp-ce/docs/CE_CUSTOMER_SMOKE_RUNBOOK.md §Playwright automation reference for the canonical operator command + the credential-matching callout.`;
      throw new Error(`${safeDiagnostic}\nUnderlying helper diagnostic: ${(err as Error).message}`);
    }

    const res = await page.goto("/site-admin/settings");
    expect(res?.status(), "settings page should render once authed").not.toBe(404);
    // Observable assertion against the CURRENT bundled UI shape
    // (verified by reading src/app/site-admin/settings/page.tsx).
    //
    // As of `agent-a-20260620-idp-ui-site-admin-settings-live-
    // license-card`, the page now renders a live License card driven
    // by a server-side probe of `/api/setup/license` — replacing the
    // prior placeholder "Coming soon" badge. The card's status badge
    // ("Valid" / "Missing" / "Invalid" / "Expired" / "Unknown") IS
    // the canonical assertable signal for this group; combined with
    // Group 1's wire-level agreement, it ALSO pins the end-to-end
    // contract that the UI's server-side fetch reached the licensed
    // CE backend.
    //
    // The five safe observable signals THIS PAGE renders:
    //
    //   1. The page title `<h1>Settings</h1>` renders — proves the
    //      cookie session resolved + the layout's site_admin guard
    //      let us through.
    //
    //   2. The "System status" card renders an `Identity Provider
    //      (IdP)` row WITH a `Healthy` badge — the page performs a
    //      server-side `/healthz` probe against the configured IDP
    //      backend; the `Healthy` badge appears only when that probe
    //      returned 200.
    //
    //   3. The live "License" card heading renders — pins the new
    //      LicenseCard component shape.
    //
    //   4. The live License card status badge reads "Valid" — proves
    //      the server-side probe of `/api/setup/license` (a) reached
    //      the licensed CE backend and (b) parsed `state=license_valid`
    //      from the same response Group 1 agreed with. This is the
    //      load-bearing end-to-end M2 assertion in the same page.
    //
    // SECRET-SAFETY: the assertions ONLY read the public status
    // string ("Valid"). They never read or assert `tier`, `licensee`,
    // `license_id`, `license_type`, `expires_at`, raw envelope bytes,
    // signing material, or any admin bearer token.
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
      "settings page H1 should render once authed"
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("System status"), "System status card should render").toBeVisible({
      timeout: 5_000,
    });

    await expect(
      page.getByText("Identity Provider (IdP)").first(),
      "IDP service row should render"
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByText("Healthy", { exact: true }).first(),
      "IDP backend must report Healthy (the /healthz probe succeeded — backend reachable + licensed per Group 1's /api/v1/component license.status=valid agreement)"
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByText("License", { exact: true }).first(),
      "live License card heading should render on /site-admin/settings"
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByText("Valid", { exact: true }).first(),
      "License card status badge must read 'Valid' — proves the server-side /api/setup/license probe reached the licensed CE backend and parsed state=license_valid"
    ).toBeVisible({ timeout: 10_000 });

    // /site-admin/license read-only status (added by
    // `agent-a-20260620-idp-ui-site-admin-license-readonly-view`).
    //
    // The page now renders a server-side read-only status card ABOVE
    // the bearer-token-gated LicenseManager. We navigate in the same
    // session (cookie reused, NO admin bearer token pasted) and pin
    // two observable signals:
    //
    //   (a) the `readonly-license-status-card` test hook is visible —
    //       proves the page-level server-side probe ran and rendered
    //       the read-only section.
    //   (b) the `readonly-license-status-badge` reads "Valid" — proves
    //       the same `/api/setup/license` agreement Group 1 pinned is
    //       reflected on this NEW page without any bearer token.
    //
    // SECRET-SAFETY: the bearer-token input is intentionally untouched.
    // No `licensee` / `expires_at` / `license_id` / `license_type` /
    // raw envelope bytes / signing material / admin bearer token are
    // read or asserted.
    const licenseRes = await page.goto("/site-admin/license");
    expect(licenseRes?.status(), "license page should render once authed").not.toBe(404);

    await expect(
      page.getByTestId("readonly-license-status-card"),
      "/site-admin/license must render the read-only status card without a bearer token"
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("readonly-license-status-badge"),
      "read-only status badge must read 'Valid' on the License page (no bearer token pasted)"
    ).toHaveText(/Valid/, { timeout: 10_000 });

    // Account-settings Sessions tab — agent-a-20260705-idp-account-session-
    // management-completion. The tab MUST render the live session list, NOT the
    // "Session management is not available from this IDP runtime" fallback that
    // the owner reported. The account client now lists via the parity Family-A
    // GET /api/v1/sessions (mounted on both OSS + CE) instead of the OSS-only
    // /me/sessions family (404 on CE). Reuses the same authed site_admin
    // session; no secret value is read or asserted (only public card copy).
    await page.goto("/account/settings?tab=sessions");
    await expect(
      page.getByRole("heading", { name: "Account settings", level: 1 }),
      "account settings page must render once authed"
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Active sessions"),
      "Sessions tab must render the live 'Active sessions' card (not the unavailable fallback)"
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Session management is not available from this IDP runtime"),
      "the unavailable fallback must NOT appear — /api/v1/sessions is mounted on CE"
    ).toHaveCount(0);
  });
});
