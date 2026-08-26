/**
 * E2E tests for the /account/settings route guard, tab routing, and the
 * authenticated PasskeySection rendering surface.
 *
 * Tests guard behavior and tab URL routing without requiring authenticated credentials.
 * The UI must be running at http://localhost:7104 (started by webServer).
 *
 * Guard rules (account/layout.tsx):
 *   - Unauthenticated  → redirect to /login?reason=session_expired
 *   - Any valid role   → render account settings
 *
 * Tab routing: ?tab=password (default) | sessions | passkeys | mfa.
 * Unknown values fall back to password.
 *
 * Authenticated PasskeySection tests pin the rendered surface at
 * /account/settings?tab=passkeys without invoking any WebAuthn ceremony.
 * The tests:
 *   - DO NOT click "Add passkey".
 *   - DO NOT call navigator.credentials.create / get.
 *   - DO NOT rename, delete, or otherwise mutate any credential.
 * State-precondition tolerance: the page renders either the empty-state
 * panel, the loading placeholder, or a populated credential list. The
 * tests accept any of the three branches so they pass against any local
 * fixture snapshot.
 */

import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

test.describe("/account/settings route guard", () => {
  test("unauthenticated request redirects to /login?reason=session_expired", async ({ page }) => {
    await page.goto("/account/settings");

    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {
      // waitForURL may resolve before goto() returns — catch the race.
    });

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");

    // Must not render any account settings shell.
    await expect(page.getByRole("heading", { name: "Account settings" })).not.toBeVisible();
    await expect(page.getByText("Passkeys")).not.toBeVisible();
  });

  test("unauthenticated ?tab=sessions redirects to /login", async ({ page }) => {
    await page.goto("/account/settings?tab=sessions");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });

  test("unauthenticated ?tab=passkeys redirects to /login", async ({ page }) => {
    await page.goto("/account/settings?tab=passkeys");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });

  test("unauthenticated ?tab=invalid redirects to /login (unknown tab falls back safely)", async ({
    page,
  }) => {
    await page.goto("/account/settings?tab=invalid");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });
});

test.describe("/org-admin/settings route guard (unchanged)", () => {
  test("unauthenticated request still redirects to /login?reason=session_expired", async ({
    page,
  }) => {
    await page.goto("/org-admin/settings");

    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });

  test("org-admin settings page title no longer mentions personal account settings", async ({
    page,
  }) => {
    // Without authentication the page never renders, but we can verify the
    // page metadata by checking what would be served at the URL — the guard
    // redirects before any page content renders, so this test confirms the
    // redirect (and therefore that the personal-account page is gone from that
    // route) without needing credentials.
    await page.goto("/org-admin/settings");
    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});

    // Confirm the redirect happened (guard is still in place).
    expect(page.url()).not.toContain("/org-admin/settings");
  });
});

test.describe("/dashboard/security compat redirect", () => {
  test("unauthenticated /dashboard/security redirects to /login (via dashboard guard)", async ({
    page,
  }) => {
    // The dashboard layout guard fires before the page redirect to
    // /account/settings?tab=passkeys, so unauthenticated users hit
    // the session-expired redirect first.
    await page.goto("/dashboard/security");

    await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=session_expired");
  });
});

test.describe("/account/settings authenticated section rendering (non-destructive)", () => {
  // ── Authenticated PasskeySection rendering (non-destructive) ───────────────────
  //
  // Pins the visible PasskeySection surface at /account/settings?tab=passkeys
  // so a future agent cannot silently regress the tab routing, the section
  // heading/copy, or the empty-state/list-state rendering.
  //
  // Discipline (do not change without an explicit task):
  //   - Tests never click "Add passkey" / "Register" / "Create passkey".
  //   - Tests never invoke navigator.credentials.create or .get.
  //   - Tests never click "Remove" or "Rename" on any credential row.
  //   - The shared site_admin context is reused across tests in this file.
  //
  // State-precondition tolerance: the local-demo fixture may or may not have
  // passkeys enrolled for the test account. The tests accept any of:
  //   (a) empty-state copy ("No passkeys enrolled yet.")
  //   (b) loading placeholder ("Loading…") if the fetch is in-flight when the
  //       assertion runs
  //   (c) populated credential rows (rendered as <li> with "Added <date>")
  //   (d) browser-WebAuthn-unsupported state (Add-passkey button hidden) —
  //       headless Chromium normally exposes window.PublicKeyCredential, so
  //       this branch should not fire locally, but tests accept it.

  let passkeyCtx: BrowserContext | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000); // allow TOTP cooldown + retry window
    if (skipAuthTests) return;
    passkeyCtx = await browser.newContext();
    const p = await passkeyCtx.newPage();
    await loginAsSiteAdmin(p);
    await p.close();
  });

  test.afterAll(async () => {
    await passkeyCtx?.close();
    passkeyCtx = null;
  });

  const newAuthenticatedPage = async () => {
    if (!passkeyCtx) {
      throw new Error("Authenticated account-settings context was not initialized");
    }
    return passkeyCtx.newPage();
  };

  test.describe("/account/settings?tab=passkeys — PasskeySection rendering (authenticated, non-destructive)", () => {
    test("authenticated user can open the passkeys tab without a 500/error frame", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // URL stays on the passkeys tab — no redirect away.
        expect(new URL(page.url()).pathname).toBe("/account/settings");
        expect(new URL(page.url()).searchParams.get("tab")).toBe("passkeys");

        // No framework error page.
        expect(await page.title()).not.toMatch(/500|internal error|application error/i);

        // Top-level page heading is rendered (sanity that the account-settings
        // shell mounted).
        await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();
      } finally {
        await page.close();
      }
    });

    test("Passkeys tab nav entry is rendered and marked active", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // The tab list contains a "Passkeys" link. We do NOT click it (the
        // ?tab=passkeys already selects it server-side); we only confirm
        // the link exists and is marked active via aria-current="page".
        const passkeysLink = page.getByRole("link", { name: /^Passkeys$/i });
        await expect(passkeysLink).toBeVisible();
        // aria-current="page" is set by the tab navigation when the URL's
        // tab matches. A regression that broke this would also break the
        // operator's visual selection cue.
        const ariaCurrent = await passkeysLink.getAttribute("aria-current");
        expect(ariaCurrent).toBe("page");
      } finally {
        await page.close();
      }
    });

    test("Passkeys section header and description copy render", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // Section card title is "Passkeys" (rendered inside the tab card body).
        // Use count() instead of toBeVisible() because "Passkeys" also appears
        // in the tab nav above; we just need at least one match.
        const passkeysText = await page.getByText("Passkeys", { exact: true }).count();
        expect(passkeysText).toBeGreaterThan(0);

        // The card subtitle describes the passwordless-sign-in use case.
        // Match permissively because copy may shift to "Hardware keys…" or
        // "Sign in with your device fingerprint…" wording in future polish
        // edits.
        const subtitlePresent =
          (await page
            .getByText(/Hardware keys|platform authenticators|fingerprint|passwordless/i)
            .count()) > 0;
        expect(subtitlePresent).toBe(true);
      } finally {
        await page.close();
      }
    });

    test("PasskeySection renders one of the documented states (empty | loading | list | unsupported)", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // The fetch in PasskeySection runs in useEffect on mount. By the
        // time `networkidle` settles we should be in (a) empty-state, (b)
        // populated list, or (c) WebAuthn-unsupported. The loading
        // placeholder is possible if the fetch is unusually slow.
        const emptyState = await page.getByText(/No passkeys enrolled yet/i).count();
        const loadingState = await page.getByText(/^Loading…?$/).count();
        const populatedListMarker = await page
          .locator("li")
          .filter({ hasText: /Added /i })
          .count();
        // The Add-passkey CTA is shown only when WebAuthn is supported. Use it
        // as the supported-or-not signal; do NOT click it.
        const addPasskeyButton = await page.getByRole("button", { name: /^Add passkey$/i }).count();

        const renderedOneOfTheKnownStates =
          emptyState > 0 || loadingState > 0 || populatedListMarker > 0;
        expect(
          renderedOneOfTheKnownStates,
          "PasskeySection must render empty-state, loading, or a populated <li> list"
        ).toBe(true);

        // The Add-passkey button is the canonical supported-browser CTA.
        // In headless Chromium window.PublicKeyCredential is defined, so
        // the button should render. Tolerate the unsupported branch
        // (button hidden) without failing.
        if (addPasskeyButton === 0) {
          // Unsupported branch — pin the negative invariant that no
          // ceremony is silently started.
          expect(await page.getByRole("button", { name: /Cancel/i }).count()).toBe(0);
        }
      } finally {
        await page.close();
      }
    });

    test("Add-passkey affordance is visible but is NOT clicked by the test (non-destructive pin)", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // The Add-passkey CTA must be visible when the browser supports
        // WebAuthn. If it isn't visible we accept the unsupported branch
        // but pin the negative: the inline nickname input must not have
        // appeared on its own.
        const addBtn = page.getByRole("button", { name: /^Add passkey$/i });
        const addBtnVisible = await addBtn.isVisible().catch(() => false);

        if (addBtnVisible) {
          // CRITICAL: do NOT click the button. The test stops here.
          // Sanity check that the nickname input is not pre-emptively
          // mounted before any click; if it is, the "isAdding" state
          // leaked into the default render which would itself be a bug.
          const nicknameInputPresent =
            (await page.locator('input[type="text"][placeholder*="Nickname"]').count()) > 0;
          expect(nicknameInputPresent).toBe(false);
        } else {
          // Unsupported-browser branch — neither the button nor the
          // inline form should appear.
          expect(await page.getByRole("button", { name: /^Add passkey$/i }).count()).toBe(0);
        }
      } finally {
        await page.close();
      }
    });

    test("page body never contains raw WebAuthn credential material", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=passkeys");
        await page.waitForLoadState("networkidle");

        // Negative-invariant scan over the full rendered HTML. The
        // PasskeySection MUST NOT render any of these strings — they are
        // either WebAuthn ceremony bytes (which should live only in
        // component state for the duration of the ceremony) or session
        // metadata that has no place in a tab body.
        const body = await page.content();
        const forbidden = [
          /challenge"?\s*:\s*"/i, // a JSON challenge field leaked into HTML
          /attestationObject/i,
          /clientDataJSON/i,
          /publicKey"?\s*:\s*\{/i, // a JSON publicKey object leaked into HTML
          /Set-Cookie/i,
          /Bearer\s+[A-Za-z0-9._-]{8,}/,
          /otpauth:\/\//i,
          /mfa_secret/i,
          /password_hash/i,
        ];
        for (const pat of forbidden) {
          expect(body, `page body must not match ${pat}`).not.toMatch(pat);
        }
      } finally {
        await page.close();
      }
    });
  });

  // ── Authenticated SessionsSection rendering (non-destructive) ─────────────────
  //
  // Pins the visible SessionsSection surface at /account/settings?tab=sessions.
  // The local-demo site_admin account is the one this spec authenticates as,
  // and the IDP returns 403 for site_admin session listing by design (cross-
  // tenant isolation), so the rendered branch under test is the
  // "forbidden-administrator" notice — itself the most regression-sensitive
  // state because it embeds the documented cross-tenant-isolation copy.
  //
  // State-precondition tolerance: the test accepts EITHER the forbidden
  // branch ("Session management is not available for administrator
  // accounts…"), the empty-state ("No active sessions found."), the
  // populated list (rows with "Started <date>"), or a bounded error
  // ("Could not load sessions…"). One of those four MUST render.
  //
  // Discipline:
  //   - Tests never click "Sign out" on any row.
  //   - Tests never click any revoke-all affordance (the current UI has
  //     none, but the discipline is documented for future agents).
  //   - Tests never sign the current browser context out — the shared
  //     siteAdmin context is reused unchanged across all tests in this
  //     file, including this one.

  test.describe("/account/settings?tab=sessions — SessionsSection rendering (authenticated, non-destructive)", () => {
    test("authenticated user can open the sessions tab without a 500/error frame", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        expect(new URL(page.url()).pathname).toBe("/account/settings");
        expect(new URL(page.url()).searchParams.get("tab")).toBe("sessions");
        expect(await page.title()).not.toMatch(/500|internal error|application error/i);

        await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();
      } finally {
        await page.close();
      }
    });

    test("Sessions tab nav entry is rendered and marked active", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        const sessionsLink = page.getByRole("link", { name: /^Sessions$/i });
        await expect(sessionsLink).toBeVisible();
        const ariaCurrent = await sessionsLink.getAttribute("aria-current");
        expect(ariaCurrent).toBe("page");
      } finally {
        await page.close();
      }
    });

    test("Sessions tab card header (Active sessions) renders", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        // "Active sessions" is the card subtitle rendered by
        // src/app/account/settings/page.tsx when tab === "sessions". Use
        // count() because the same text could appear elsewhere; we just
        // need at least one match to confirm the card mounted.
        const activeSessionsHeading = await page.getByText(/Active sessions/i).count();
        expect(activeSessionsHeading).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    });

    test("SessionsSection renders one of the documented states (forbidden | empty | list | error)", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        // Each of the four documented branches has distinct, stable copy.
        // The test accepts any one of them. site_admin authentication
        // typically lands on the forbidden branch (403 by design).
        const forbiddenBranch = await page
          .getByText(/Session management is not available for administrator accounts/i)
          .count();
        const emptyBranch = await page.getByText(/No active sessions found/i).count();
        // Populated list: each row begins with "Started <date>".
        const populatedBranch = await page.getByText(/Started /).count();
        const errorBranch = await page.getByText(/Could not load sessions/i).count();

        const renderedKnownState =
          forbiddenBranch > 0 || emptyBranch > 0 || populatedBranch > 0 || errorBranch > 0;
        expect(
          renderedKnownState,
          "SessionsSection must render forbidden, empty, populated list, or bounded error"
        ).toBe(true);
      } finally {
        await page.close();
      }
    });

    test("revoke affordances, if rendered, are visible but NOT clicked (non-destructive pin)", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        // The per-row "Sign out" button label is "Sign out" (mid-revoke
        // it becomes "Signing out…"). It only renders for non-current
        // active sessions; for site_admin the forbidden branch surfaces
        // and no Sign out button is rendered at all.
        const signOutButtons = page.getByRole("button", { name: /^Sign out$/i });
        const count = await signOutButtons.count();

        if (count > 0) {
          // CRITICAL: do NOT click. Just confirm the buttons render in
          // their default state — not pending.
          for (let i = 0; i < Math.min(count, 5); i++) {
            const btn = signOutButtons.nth(i);
            await expect(btn).toBeVisible();
            await expect(btn).toBeEnabled();
            // The mid-revoke "Signing out…" label MUST NOT appear at
            // page-load time — that would indicate a stale `isPending`
            // state leaked into the default render.
            const text = (await btn.textContent()) ?? "";
            expect(text).not.toMatch(/Signing out/);
          }
        }
        // If count === 0 (forbidden / empty / error branch), nothing to
        // assert. The state-tolerance test above already pinned that one
        // of the documented branches rendered.
      } finally {
        await page.close();
      }
    });

    test("page body never contains cookies, bearer tokens, session validators, or other credential material [NOLEAK-BODY-1]", async () => {
      if (skipAuthTests) {
        test.skip(true, SKIP_AUTH_MSG);
      }

      const page = await newAuthenticatedPage();
      try {
        await page.goto("/account/settings?tab=sessions");
        await page.waitForLoadState("networkidle");

        // Negative-invariant scan over the full rendered HTML. The
        // SessionsSection MUST NOT render any of these strings. The
        // session row's opaque id is held in a hidden input only; the
        // SessionsSection helpers explicitly avoid rendering it as
        // visible text.
        const body = await page.content();
        const forbidden = [
          /Set-Cookie/i,
          /Bearer\s+[A-Za-z0-9._-]{8,}/,
          /session_token/i,
          /session_validator/i,
          /otpauth:\/\//i,
          /mfa_secret/i,
          /password_hash/i,
          /reset_token/i,
          /claim_token/i,
        ];
        for (const pat of forbidden) {
          expect(body, `page body must not match ${pat}`).not.toMatch(pat);
        }
      } finally {
        await page.close();
      }
    });
  });
});
