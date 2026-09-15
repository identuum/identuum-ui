/**
 * Optional local browser verification for the identuum-ui login flow.
 *
 * This spec drives the login UI step-by-step (not via the shared
 * loginAsSiteAdmin helper) because the goal is to verify each visible
 * step renders correctly. Credentials are imported from the helper so
 * legacy/canonical env-var resolution lives in exactly one place.
 *
 * Required env vars (canonical names only):
 *   IDENTUUM_TEST_SITE_ADMIN_EMAIL       — default: site_admin@system.local
 *   IDENTUUM_TEST_SITE_ADMIN_PASSWORD
 *   IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET — base32 seed from identuum-idp-setup
 *
 * Legacy IDENTUUM_TEST_EMAIL / _PASSWORD / _TOTP_SECRET are no longer
 * read — operators with stale .env files must rename them.
 *
 * The full Compose stack must be running (IdP at localhost:7113, UI at localhost:7104).
 * The Playwright runner reuses the existing server automatically; see playwright.config.ts.
 *
 * Before first run: pnpm e2e:install
 * Run: pnpm e2e (credentials auto-loaded from .env.playwright.idp-oss.local)
 */

import { expect, test } from "@playwright/test";
import { expectHonestAuthAnswer } from "./helpers/appliance-fixture";
import {
  SITE_ADMIN_EMAIL,
  SITE_ADMIN_PASSWORD,
  SITE_ADMIN_TOTP_SECRET,
  SKIP_AUTH_MSG,
  skipAuthTests,
} from "./helpers/login";
import { unconsumedTOTP } from "./helpers/totp";

test.describe("identuum-ui login flow", () => {
  test("email step → password step → MFA step → dashboard → logout", async ({ page }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Navigate directly to the IDP login page. Do not use "/" — in a
    // split-runtime deployment the UI root redirects to /ag-admin/login,
    // not the IDP login page.
    await page.goto("/login");
    await page.waitForURL(/\/login/);

    // Email step.
    const emailInput = page.getByLabel("Email or domain");
    await emailInput.fill(SITE_ADMIN_EMAIL);
    await page.getByRole("button", { name: "Continue" }).click();

    // Password step.
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill(SITE_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // MFA step — generate code immediately before submission.
    const codeInput = page.getByLabel("Verification code");
    await expect(codeInput).toBeVisible();
    const code = await unconsumedTOTP(SITE_ADMIN_TOTP_SECRET, SITE_ADMIN_EMAIL);
    await codeInput.fill(code);
    await page.getByRole("button", { name: "Verify" }).click();

    // Post-login: should reach a dashboard or admin page.
    await page.waitForURL(/\/(dashboard|site-admin|org-admin)/);

    // Runtime-config must not expose internal URLs.
    const configRes = await page.request.get("/api/runtime-config");
    const config = await configRes.json();
    expect(config.configured).toBe(true);
    expect(config.idp?.internal_base_url).toBeUndefined();
    expect(config.ag?.internal_base_url).toBeUndefined();

    // /api/status must show IdP healthy (served from server-side, no CORS needed).
    const statusRes = await page.request.get("/api/status");
    const status = await statusRes.json();
    expect(status.idp.enabled).toBe(true);
    expect(status.idp.healthy).toBe(true);

    // Logout via POST (the Sign out button submits a form).
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    // Post-logout: validate endpoint must reject the session.
    const validateRes = await page.request.get("/api/idp/api/v1/validate");
    expect(validateRes.status()).toBe(401);
  });

  // THE-STALE-COOKIE: the coverage gap that hid a total sign-in dead-end.
  // No test signed in, signed out, and signed in AGAIN in one browser
  // context — so nothing caught that logout never cleared the browser's
  // auth cookies, the /api/idp proxy lifted the surviving revoked
  // access_token into Authorization: Bearer, and the backend's global
  // BearerPrincipal 401'd the PUBLIC organization-lookup before its
  // handler ran ("Unable to look up your organization"; measured by hand
  // on v0.3.3). This cycle is the regression fence.
  test("sign in → sign out → sign in AGAIN in one browser context (stale-cookie fence) [COOKIE-1]", async ({
    page,
  }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    test.setTimeout(90_000);

    async function signInViaUI() {
      await page.goto("/login");
      await page.getByLabel("Email or domain").fill(SITE_ADMIN_EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      const passwordInput = page.getByLabel("Password");
      await expect(passwordInput).toBeVisible();
      await passwordInput.fill(SITE_ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      const codeInput = page.getByLabel("Verification code");
      await expect(codeInput).toBeVisible();
      await codeInput.fill(await unconsumedTOTP(SITE_ADMIN_TOTP_SECRET, SITE_ADMIN_EMAIL));
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForURL(/\/(dashboard|site-admin|org-admin)/);
    }

    // Round 1.
    await signInViaUI();

    // Cookie-clearing proof, half 1: the auth cookies exist while
    // signed in (values never read beyond presence).
    const cookiesBefore = (await page.context().cookies()).map((c) => c.name);
    expect(cookiesBefore).toContain("access_token");

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    // Cookie-clearing proof, half 2: logout's OWN response expired them.
    const cookiesAfter = (await page.context().cookies()).map((c) => c.name);
    expect(cookiesAfter).not.toContain("access_token");
    expect(cookiesAfter).not.toContain("refresh_token");

    // Round 2 — the previously-impossible part: the SAME context signs
    // in again, all the way through.
    await signInViaUI();

    // And the session is genuinely live.
    const validateRes = await page.request.get("/api/idp/api/v1/validate");
    // THE-SESSION-REJECTION-ROOT-CAUSE (AUTH-503): the IdP now answers a
    // store error as 503 with a correlation id and a genuine verdict as 401
    // with a reason — the two are no longer the same body, so the former
    // second-probe diagnostic is gone. A 401 here must NAME its verdict; a
    // 503 must carry the correlation id that joins it to the IdP's ERROR log.
    await expectHonestAuthAnswer(
      validateRes.status(),
      () => validateRes.json(),
      "validate after re-login"
    );
    expect(validateRes.status()).toBe(200);
  });
});

// ── /login passkey/WebAuthn affordance — non-destructive render pins ──────────
//
// Pins the visible LoginFlow surface at /login without invoking any
// WebAuthn ceremony, without submitting the password form, and without
// requiring authenticated credentials. The tests are entirely
// unauthenticated — they run on a default fresh browser context every
// time and skip the existing TOTP login chain.
//
// Discipline (do not change without an explicit task):
//   - Tests NEVER click "Sign in with passkey" or "Continue" or "Sign in".
//   - Tests NEVER call navigator.credentials.get or .create directly.
//   - The instrumented test installs a sentinel that records whether
//     navigator.credentials.get/create was invoked by anything; the
//     subsequent assertion confirms it stayed at zero.
//   - The unsupported-fallback test deletes window.PublicKeyCredential
//     BEFORE any page script runs (via addInitScript) so the affordance
//     is gated off cleanly — the password form must still render.

// ── MFA enrollment flow — mocked responses ───────────────────────────────────
//
// These tests verify UI state transitions for the in-browser enrollment flow
// using Playwright's page.route() to mock all backend calls. No real backend,
// TOTP secret, or live credentials are required.
//
// Route patterns use exact regex anchors ($) so longer paths like
// /mfa/enroll/initiate are not accidentally matched by the /login pattern.
//
// Assertions check UI structure (headings, button text) — NOT secret values.

// ── fetch-mock helper ─────────────────────────────────────────────────────────
//
// page.route() has proven unreliable for these tests — the Next.js dev
// server's keep-alive connections cause some requests to bypass Playwright's
// network-layer intercept. Instead we use page.addInitScript() to patch
// window.fetch before any React/Next.js hydration code runs. The patched
// fetch intercepts client-side calls (which is all we need for UI state
// testing) and falls through to the original for everything else.
//
// Rules:
//  - Scripts contain NO secrets, tokens, TOTP seeds, or real credentials.
//  - "AAAAAAAAAAAAAAAA" is a deliberately fake placeholder, not a TOTP secret.
//  - "019e7000-mock-*" UUIDs are fake; the real backend rejects them.
//  - No cookies are set — the mocked session has no actual auth; the server
//    redirects any post-login navigation back to /login, which is expected.

// ── fetch interceptor helper ──────────────────────────────────────────────────
//
// page.route() is unreliable for these tests (Next.js dev-server keep-alive
// connections bypass Playwright's network-layer intercept in some cases).
// page.addInitScript() patches window.fetch BEFORE React/Next.js hydration,
// guaranteeing the intercept runs for all client-side fetch calls.
//
// Scripts are passed as raw strings so TypeScript does not attempt to
// type-check the browser-context code.

test.describe("/login — MFA enrollment flow (mocked backend)", () => {
  test("mfa_enrollment_required with session_id shows enrollment form → QR → verify → recovery codes", async ({
    page,
  }) => {
    // Patch window.fetch with all four mocked endpoints.
    // Runs on every navigation within this page fixture.
    // Contains NO secrets — values are placeholder stubs only.
    await page.addInitScript(`
      (function() {
        var _orig = window.fetch.bind(window);
        window.fetch = function(input, init) {
          var url = typeof input === 'string' ? input : (input ? input.url : '');
          var method = ((init && init.method) || 'GET').toUpperCase();
          if (url.indexOf('/api/idp/api/v1/auth/organization-lookup') !== -1) {
            return Promise.resolve(new Response('null', {status: 404, headers: {'Content-Type': 'application/json'}}));
          }
          if (/\\/api\\/idp\\/api\\/v1\\/auth\\/login$/.test(url) && method === 'POST') {
            return Promise.resolve(new Response(JSON.stringify({error:'mfa_enrollment_required',mfa_required:true,mfa_enrollment_required:true,session_id:'019e7000-mock-enroll-session'}), {status:401,headers:{'Content-Type':'application/json'}}));
          }
          if (/\\/api\\/idp\\/api\\/v1\\/auth\\/login\\/mfa\\/enroll\\/initiate$/.test(url) && method === 'POST') {
            return Promise.resolve(new Response(JSON.stringify({secret:'AAAAAAAAAAAAAAAA',otpauth_url:'otpauth://totp/Test%3Atest%40example.com?secret=AAAAAAAAAAAAAAAA&issuer=Test',recovery_codes:['AAAAA-AAAAA','BBBBB-BBBBB'],expires_at:'2099-01-01T00:00:00Z'}), {status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
          }
          if (/\\/api\\/idp\\/api\\/v1\\/auth\\/login\\/mfa\\/enroll\\/complete$/.test(url) && method === 'POST') {
            return Promise.resolve(new Response(JSON.stringify({role:'site_admin',success:true}), {status:200,headers:{'Content-Type':'application/json'}}));
          }
          return _orig(input, init);
        };
      })();
    `);

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Email step.
    await page.getByLabel("Email or domain").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    // Password step.
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.getByLabel("Password").fill("any-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // MFA enrollment form — QR code section must appear.
    await expect(page.getByText("Set up two-factor authentication")).toBeVisible({ timeout: 8000 });
    const codeInput = page.getByLabel("Verification code");
    await expect(codeInput).toBeVisible();

    // Enter any 6-digit code (backend is mocked to succeed).
    await codeInput.fill("123456");
    await page.getByRole("button", { name: "Verify and sign in" }).click();

    // Recovery codes phase must appear — user must acknowledge before proceeding.
    await expect(page.getByText("Save your recovery codes")).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "I've saved my recovery codes" })).toBeVisible();

    // Structural assertion: monospaced code elements are rendered in the recovery section.
    const codeElements = page.locator(".font-mono.text-slate-800");
    await expect(codeElements.first()).toBeVisible();

    // Warning must be visible.
    await expect(page.getByText("These codes will not be shown again.")).toBeVisible();

    // Click acknowledge. onSuccess(role) fires → router.push to dashboard.
    // No URL assertion: mocked session has no real cookies so the server
    // redirects back to /login — this is expected behavior for a mock-only test.
    await page.getByRole("button", { name: "I've saved my recovery codes" }).click();
  });

  test("mfa_enrollment_required with null sessionId (old OSS path) shows fallback message [LOGIN-MFA-FALLBACK-1]", async ({
    page,
  }) => {
    // Old OSS contract: 401 + error field only — no booleans, no session_id.
    await page.addInitScript(`
      (function() {
        var _orig = window.fetch.bind(window);
        window.fetch = function(input, init) {
          var url = typeof input === 'string' ? input : (input ? input.url : '');
          var method = ((init && init.method) || 'GET').toUpperCase();
          if (url.indexOf('/api/idp/api/v1/auth/organization-lookup') !== -1) {
            return Promise.resolve(new Response('null', {status:404,headers:{'Content-Type':'application/json'}}));
          }
          if (/\\/api\\/idp\\/api\\/v1\\/auth\\/login$/.test(url) && method === 'POST') {
            return Promise.resolve(new Response(JSON.stringify({error:'mfa_enrollment_required'}), {status:401,headers:{'Content-Type':'application/json'}}));
          }
          return _orig(input, init);
        };
      })();
    `);

    await page.goto("/login");
    await page.getByLabel("Email or domain").fill("testuser@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByLabel("Password")).toBeVisible();
    await page.getByLabel("Password").fill("any-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Fallback message must appear — enrollment form must NOT appear.
    await expect(page.getByText(/Two-factor authentication enrollment is required/)).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText("Set up two-factor authentication")).not.toBeVisible();
  });

  test("mfa_required with session_id (OSS 401) shows MFA verify form [LOGIN-MFA-VERIFY-1]", async ({
    page,
  }) => {
    await page.addInitScript(`
      (function() {
        var _orig = window.fetch.bind(window);
        window.fetch = function(input, init) {
          var url = typeof input === 'string' ? input : (input ? input.url : '');
          var method = ((init && init.method) || 'GET').toUpperCase();
          if (url.indexOf('/api/idp/api/v1/auth/organization-lookup') !== -1) {
            return Promise.resolve(new Response('null', {status:404,headers:{'Content-Type':'application/json'}}));
          }
          if (/\\/api\\/idp\\/api\\/v1\\/auth\\/login$/.test(url) && method === 'POST') {
            return Promise.resolve(new Response(JSON.stringify({error:'mfa_required',mfa_required:true,mfa_enrollment_required:false,session_id:'019e7000-mock-mfa-session'}), {status:401,headers:{'Content-Type':'application/json'}}));
          }
          return _orig(input, init);
        };
      })();
    `);

    await page.goto("/login");
    await page.getByLabel("Email or domain").fill("testuser@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByLabel("Password")).toBeVisible();
    await page.getByLabel("Password").fill("any-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // MFA verify form (not enrollment form) must appear.
    await expect(page.getByText("Two-factor authentication")).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel("Verification code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
    // Enrollment heading must NOT appear.
    await expect(page.getByText("Set up two-factor authentication")).not.toBeVisible();
  });
});

test.describe("/login — passkey/WebAuthn login affordance (non-destructive)", () => {
  test("password login form renders without auto-submitting on a fresh /login visit [LOGIN-NO-AUTOSUBMIT-1]", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // URL did NOT auto-advance to any post-login surface.
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(await page.title()).not.toMatch(/500|internal error|application error/i);

    // Email step renders.
    await expect(page.getByLabel("Email or domain")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("WebAuthn-supported branch: 'Sign in with passkey' button is visible but NOT clicked", async ({
    page,
  }) => {
    // Headless Chromium normally exposes window.PublicKeyCredential, so
    // the supported branch is the typical render. Belt-and-suspenders:
    // assert browser support before the affordance assertion so a
    // future Playwright runtime that strips PublicKeyCredential gets
    // explicitly skipped, not silently mis-categorised.
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const hasWebAuthn = await page.evaluate(
      () => typeof window.PublicKeyCredential !== "undefined"
    );
    if (!hasWebAuthn) {
      test.skip(true, "Browser does not expose window.PublicKeyCredential");
    }

    const passkeyButton = page.getByRole("button", { name: /^Sign in with passkey$/i });
    await expect(passkeyButton).toBeVisible();
    await expect(passkeyButton).toBeEnabled();

    // CRITICAL: do NOT click. Just confirm the button is in its idle
    // default state — the mid-ceremony "Follow your device prompt…"
    // label MUST NOT appear at page-load time. That label only renders
    // while passkeyLoading=true, so its presence on the default render
    // would mean the ceremony state machine has leaked.
    const buttonText = (await passkeyButton.textContent()) ?? "";
    expect(buttonText).not.toMatch(/Follow your device prompt/i);
  });

  test("WebAuthn-unsupported branch: passkey button is gated off, password form still renders [LOGIN-WEBAUTHN-GATED-1]", async ({
    browser,
  }) => {
    // Fresh context so the addInitScript only affects this test. The
    // init script runs BEFORE any page script, deleting the
    // PublicKeyCredential global so LoginFlow's `isWebAuthnSupported`
    // evaluates to false at component mount time.
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate browser-API removal for test
      Reflect.deleteProperty(window as any, "PublicKeyCredential");
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      // Sanity: the global is actually gone in this page context.
      const hasWebAuthn = await page.evaluate(
        () => typeof window.PublicKeyCredential !== "undefined"
      );
      expect(hasWebAuthn).toBe(false);

      // Affordance MUST NOT render in the unsupported branch.
      const passkeyButtonCount = await page
        .getByRole("button", { name: /^Sign in with passkey$/i })
        .count();
      expect(passkeyButtonCount).toBe(0);

      // The mid-ceremony copy MUST NOT render either — its presence
      // would mean a `passkeyLoading=true` initial state leaked.
      const ceremonyCopyCount = await page.getByText(/Follow your device prompt/i).count();
      expect(ceremonyCopyCount).toBe(0);

      // Password login path must remain functional in the unsupported
      // branch — assert the email form is still present.
      await expect(page.getByLabel("Email or domain")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  test("navigator.credentials.get / create are NOT invoked by rendering /login [LOGIN-WEBAUTHN-PASSIVE-1]", async ({
    browser,
  }) => {
    // Instrumented test: wrap navigator.credentials.get and .create
    // BEFORE any page script runs, recording a call count on the
    // window. The assertion below confirms the counts stayed at zero
    // for the duration of the page load + idle wait — proving no
    // ceremony was started merely by rendering /login.
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate sentinel install
      const win = window as any;
      win.__webauthnCallCounts = { get: 0, create: 0 };
      // Only instrument if navigator.credentials exists in this
      // browser; some sandboxes may strip it.
      if (typeof navigator !== "undefined" && navigator.credentials) {
        const origGet = navigator.credentials.get?.bind(navigator.credentials);
        const origCreate = navigator.credentials.create?.bind(navigator.credentials);
        if (origGet) {
          navigator.credentials.get = (...args: unknown[]) => {
            win.__webauthnCallCounts.get += 1;
            // biome-ignore lint/suspicious/noExplicitAny: pass-through to original
            return origGet(...(args as any));
          };
        }
        if (origCreate) {
          navigator.credentials.create = (...args: unknown[]) => {
            win.__webauthnCallCounts.create += 1;
            // biome-ignore lint/suspicious/noExplicitAny: pass-through to original
            return origCreate(...(args as any));
          };
        }
      }
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      // Give any deferred effects a moment to potentially fire. The
      // /login page should not run any WebAuthn ceremony at all on
      // initial render — the user has to explicitly click the passkey
      // button — but pin the absence.
      await page.waitForTimeout(500);

      const counts = await page.evaluate(
        // biome-ignore lint/suspicious/noExplicitAny: reading test-only sentinel
        () => (window as any).__webauthnCallCounts as { get: number; create: number }
      );
      expect(counts.get).toBe(0);
      expect(counts.create).toBe(0);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  test("/login page body never contains WebAuthn credential material or other credential terms [NOLEAK-LOGIN-1]", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Negative-invariant scan over the rendered HTML. None of these
    // strings have any business in the email-step render — they would
    // either signal that a WebAuthn ceremony payload leaked into a
    // <script> tag or that the page is rendering an error envelope
    // containing credential metadata.
    const body = await page.content();
    const forbidden: RegExp[] = [
      /challenge"?\s*:\s*"/i,
      /allowCredentials/i,
      /publicKey"?\s*:\s*\{/i,
      /authenticatorData/i,
      /clientDataJSON/i,
      /"signature"\s*:\s*"/i,
      /userHandle/i,
      /"credentialId"\s*:\s*"/i,
      /Set-Cookie/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /otpauth:\/\//i,
      /mfa_secret/i,
      /password_hash/i,
      /reset_token/i,
      /claim_token/i,
    ];
    for (const pat of forbidden) {
      expect(body, `page body must not match ${pat}`).not.toMatch(pat);
    }
  });
});
