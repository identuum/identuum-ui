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
 * The full Compose stack must be running (IdP at localhost:7113, UI at localhost:7114).
 * The Playwright runner reuses the existing server automatically; see playwright.config.ts.
 *
 * Before first run: pnpm e2e:install
 * Run: pnpm e2e (credentials auto-loaded from .env.playwright.local)
 */

import { expect, test } from "@playwright/test";
import {
  SITE_ADMIN_EMAIL,
  SITE_ADMIN_PASSWORD,
  SITE_ADMIN_TOTP_SECRET,
  SKIP_AUTH_MSG,
  skipAuthTests,
} from "./helpers/login";
import { generateTOTP } from "./helpers/totp";

test.describe("identuum-ui login flow", () => {
  test("email step → password step → MFA step → dashboard → logout", async ({ page }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Root redirects to /login when configured.
    await page.goto("/");
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
    const code = generateTOTP(SITE_ADMIN_TOTP_SECRET);
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

test.describe("/login — passkey/WebAuthn login affordance (non-destructive)", () => {
  test("password login form renders without auto-submitting on a fresh /login visit", async ({
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

  test("WebAuthn-unsupported branch: passkey button is gated off, password form still renders", async ({
    browser,
  }) => {
    // Fresh context so the addInitScript only affects this test. The
    // init script runs BEFORE any page script, deleting the
    // PublicKeyCredential global so LoginFlow's `isWebAuthnSupported`
    // evaluates to false at component mount time.
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate browser-API removal for test
      delete (window as any).PublicKeyCredential;
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

  test("navigator.credentials.get / create are NOT invoked by rendering /login", async ({
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

  test("/login page body never contains WebAuthn credential material or other credential terms", async ({
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
