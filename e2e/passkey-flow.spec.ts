/**
 * WebAuthn/passkey full ceremony E2E — CDP virtual authenticator.
 *
 * Uses the CDP WebAuthn.* domain via BrowserContext.newCDPSession(page).
 * Chromium only — CDP virtual authenticator is not available in Firefox/WebKit.
 * playwright.config.ts configures Chromium as the sole project.
 *
 * KNOWN BACKEND BLOCKER (as of 2026-06-05):
 *   identuum-idp-oss/cmd/identuum-idp/main.go does not set UIPublicBaseURL in
 *   WebAuthnServiceConfig. RPOrigins = ["http://localhost:7113"] only.
 *   Browser ceremonies originate from http://localhost:7114 (the UI port).
 *   go-webauthn v0.15.0 compares url.URL.Host strings exactly:
 *     "localhost:7113" ≠ "localhost:7114" → all FINISH calls rejected.
 *
 *   Required one-line fix in identuum-idp-oss/cmd/identuum-idp/main.go
 *   inside the WebAuthnServiceConfig block (~line 685-703):
 *     UIPublicBaseURL: "http://localhost:7114"
 *   (or derive from WEBAUTHN_UI_BASE_URL env var / config flag).
 *
 *   The WebAuthnService.normalizeUIOriginForRPID helper already handles this
 *   correctly — it is only missing the wiring call in main.go.
 *
 * Security discipline:
 *   - No WebAuthn challenge blobs, attestation bytes, or assertion material printed.
 *   - CDP credential IDs are opaque strings — not logged.
 *   - Virtual authenticator holds no real key material.
 */

import type { BrowserContext, CDPSession, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { SITE_ADMIN_EMAIL, SKIP_AUTH_MSG, loginAsSiteAdmin, skipAuthTests } from "./helpers/login";

const VIRTUAL_AUTHENTICATOR_OPTS = {
  options: {
    protocol: "ctap2" as const,
    transport: "internal" as const,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
};

const TEST_PASSKEY_NICKNAME = "Playwright test key";

test.describe("passkey ceremony — CDP virtual authenticator", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let ctx: BrowserContext;
  let page: Page;
  let cdp: CDPSession;
  let authenticatorId: string;

  test.beforeAll(async ({ browser }) => {
    // Login helper may wait up to ~31s for TOTP cooldown + retry window.
    // Mirror the 180s used by account-settings.spec.ts beforeAll.
    test.setTimeout(180_000);

    ctx = await browser.newContext();
    page = await ctx.newPage();

    // Log in BEFORE attaching the virtual authenticator.
    // With automaticPresenceSimulation: true, the virtual authenticator
    // intercepts ANY navigator.credentials.get() call — including WebAuthn
    // step-up requests that the login page issues after password submission.
    // That would bypass TOTP and navigate directly to /site-admin, leaving
    // completeTOTPWithRetry waiting forever for a TOTP input that never shows.
    if (!skipAuthTests) {
      await loginAsSiteAdmin(page);
    }

    // Attach CDP session and add virtual authenticator AFTER login so
    // ceremonies only affect the passkey management flow (T2 and T4).
    cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable", { enableUI: false });
    const result = await cdp.send("WebAuthn.addVirtualAuthenticator", VIRTUAL_AUTHENTICATOR_OPTS);
    authenticatorId = result.authenticatorId;
  });

  test.afterAll(async () => {
    await page?.close().catch(() => {});
    await ctx?.close().catch(() => {});
  });

  test("T1 — clean slate: no passkeys at test start", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Clear CDP-side credentials from any previous test run.
    await cdp.send("WebAuthn.clearCredentials", { authenticatorId });

    // Delete backend-side passkeys left by previous runs.
    await page.evaluate(async () => {
      const r = await fetch("/api/idp/api/v1/webauthn/credentials", {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) return;
      // biome-ignore lint/suspicious/noExplicitAny: raw API response
      const creds: any[] = await r.json().catch(() => []);
      if (!Array.isArray(creds)) return;
      for (const cred of creds) {
        await fetch(
          `/api/idp/api/v1/webauthn/credentials/${encodeURIComponent(cred.id as string)}`,
          { method: "DELETE", credentials: "include" }
        );
      }
    });

    await page.goto("/account/settings?tab=passkeys");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("No passkeys enrolled yet.")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("T2 — register a passkey", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    await page.goto("/account/settings?tab=passkeys");
    await page.waitForLoadState("networkidle");

    // Click "Add passkey" to reveal the inline registration form.
    await page.getByRole("button", { name: "Add passkey" }).click();

    // Enter a nickname (optional but useful for later locator in T3/T5).
    const nicknameInput = page.locator('input[placeholder*="Nickname"]');
    await expect(nicknameInput).toBeVisible();
    await nicknameInput.fill(TEST_PASSKEY_NICKNAME);

    // Arm the CDP listener BEFORE clicking "Add" so the event is not missed.
    // navigator.credentials.create() is handled synchronously by the virtual
    // authenticator (automaticPresenceSimulation: true — no user interaction needed).
    const credentialAdded = new Promise<void>((resolve) => {
      cdp.once("WebAuthn.credentialAdded", () => resolve());
    });

    // Click "Add" — triggers the WebAuthn create() ceremony.
    await page.getByRole("button", { name: "Add" }).click();

    // CDP event confirms the ceremony completed on the browser side.
    await credentialAdded;

    // Success banner — proves the backend accepted the attestation.
    // NOTE: this step WILL FAIL until UIPublicBaseURL is wired in main.go.
    // The error will be a classifyPasskeyEnrollmentError message, not a crash.
    await expect(page.getByText("Passkey added successfully.")).toBeVisible({
      timeout: 10_000,
    });

    // Credential row must appear in the passkeys list.
    await expect(page.locator("li").filter({ hasText: TEST_PASSKEY_NICKNAME })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("T3 — credential persists after page reload", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Navigate away and back to force a fresh server-side list fetch.
    await page.goto("/site-admin");
    await page.goto("/account/settings?tab=passkeys");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("li").filter({ hasText: TEST_PASSKEY_NICKNAME })).toBeVisible({
      timeout: 5_000,
    });

    // Guard: page body must not contain any raw ceremony material.
    const body = await page.content();
    const forbidden = [/attestationObject/i, /clientDataJSON/i, /"challenge"\s*:/i];
    for (const pattern of forbidden) {
      expect(body, `page body must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  test("T4 — sign in with registered passkey", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // Log out of the current session.
    await page.evaluate(async () => {
      await fetch("/api/idp/api/v1/logout", {
        method: "POST",
        credentials: "include",
      });
    });

    await page.goto("/login");
    await page.waitForURL(/\/login/, { timeout: 10_000 });

    // Enter the site-admin email so handlePasskeyLogin() has a subject to look up.
    await page.getByLabel("Email or domain").fill(SITE_ADMIN_EMAIL);

    // Arm the CDP listener BEFORE clicking so the event is not missed.
    const credentialAsserted = new Promise<void>((resolve) => {
      cdp.once("WebAuthn.credentialAsserted", () => resolve());
    });

    // Click "Sign in with passkey" — triggers navigator.credentials.get().
    const passkeyBtn = page.getByRole("button", {
      name: /^Sign in with passkey$/i,
    });
    await expect(passkeyBtn).toBeVisible();
    await passkeyBtn.click();

    // CDP event confirms the assertion ceremony completed on the browser side.
    await credentialAsserted;

    // site_admin should be routed to /site-admin after successful authentication.
    // NOTE: this step WILL FAIL until UIPublicBaseURL is wired in main.go.
    await page.waitForURL(/\/site-admin/, { timeout: 15_000 });
    expect(page.url()).toContain("/site-admin");
  });

  test("T5 — delete registered passkey", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // T4 leaves us on /site-admin after passkey login. Navigate to passkeys tab.
    await page.goto("/account/settings?tab=passkeys");
    await page.waitForLoadState("networkidle");

    const credRow = page.locator("li").filter({ hasText: TEST_PASSKEY_NICKNAME });
    await expect(credRow).toBeVisible({ timeout: 5_000 });

    // The remove button carries aria-label="Remove passkey".
    await credRow.getByRole("button", { name: "Remove passkey" }).click();

    // Row should disappear after deletion.
    await expect(credRow).not.toBeVisible({ timeout: 5_000 });

    // Empty-state copy should return.
    await expect(page.getByText("No passkeys enrolled yet.")).toBeVisible({
      timeout: 5_000,
    });
  });
});
