/**
 * Shared login helpers for authenticated E2E tests.
 *
 * Credential resolution is centralized here so individual specs never read
 * IDENTUUM_TEST_* env vars directly — that previously caused login.spec.ts
 * and helper-based specs to disagree about which credential set was active
 * when an operator had both legacy and canonical names defined locally.
 *
 * Canonical env vars (read these — and only these — directly):
 *   IDENTUUM_TEST_SITE_ADMIN_EMAIL        — defaults to "site_admin@system.local"
 *   IDENTUUM_TEST_SITE_ADMIN_PASSWORD
 *   IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET
 *
 *   IDENTUUM_TEST_ORG_ADMIN_EMAIL
 *   IDENTUUM_TEST_ORG_ADMIN_PASSWORD
 *   IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET   — optional (omit when MFA not enrolled)
 *
 * Legacy names (IDENTUUM_TEST_EMAIL / _PASSWORD / _TOTP_SECRET) are NOT
 * supported as aliases. If a local .env file still defines them they are
 * ignored. See e2e/README.md for migration instructions.
 *
 * Tests that need authentication should gate with:
 *   if (skipAuthTests) { test.skip(true, SKIP_AUTH_MSG); }
 *   if (skipOrgAdminTests) { test.skip(true, SKIP_ORG_ADMIN_MSG); }
 *
 * Specs that drive the login UI themselves (e.g. login.spec.ts) can import
 * the resolved constants below; the constants never appear in logs and are
 * not re-exported anywhere else.
 *
 * Does NOT print credentials, cookies, session headers, or TOTP codes.
 */

import { statSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { loadOrgAdminFixture, loadSiteAdminFixture } from "./fixture";
import { generateTOTP } from "./totp";

// ── Site-admin credentials ────────────────────────────────────────────────────
//
// Resolution precedence, mirroring the org_admin path:
//   1. The dynamic fixture the released-appliance harness mints in globalSetup
//      (THE-RELEASED-CONTRACT). This is what lets the site-admin specs
//      authenticate against the FRESH appliance the harness stood up.
//   2. IDENTUUM_TEST_SITE_ADMIN_* env vars (durable long-lived-stack mode).
//
// Whichever wins feeds the same three constants; the rest of the file is
// unaware. Never log the resolved values.

const dynamicSiteAdminFixture = loadSiteAdminFixture();

/**
 * Resolved site_admin credentials. Exported so the login UI spec can drive
 * the email/password/TOTP steps without re-reading process.env directly.
 */
export const SITE_ADMIN_EMAIL =
  dynamicSiteAdminFixture?.email ??
  process.env.IDENTUUM_TEST_SITE_ADMIN_EMAIL ??
  "site_admin@system.local";
export const SITE_ADMIN_PASSWORD =
  dynamicSiteAdminFixture?.password ?? process.env.IDENTUUM_TEST_SITE_ADMIN_PASSWORD ?? "";
export const SITE_ADMIN_TOTP_SECRET =
  dynamicSiteAdminFixture?.totpSecret ?? process.env.IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET ?? "";

/** True when site_admin auth env vars are absent. */
export const skipAuthTests = !SITE_ADMIN_PASSWORD || !SITE_ADMIN_TOTP_SECRET;

/** Standard skip message — reuse across specs for consistent operator guidance. */
export const SKIP_AUTH_MSG =
  "Set IDENTUUM_TEST_SITE_ADMIN_PASSWORD and IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET to run this test";

// ── Org-admin credentials ─────────────────────────────────────────────────────
//
// Resolution precedence:
//   1. Dynamic fixture file written by `identuum --e2e-create-org-admin-fixture`.
//      Loaded at module init via loadOrgAdminFixture(). The loader returns
//      null when the file is absent (durable-env mode); throws when the
//      file exists but is malformed.
//   2. IDENTUUM_TEST_ORG_ADMIN_EMAIL / _PASSWORD / _TOTP_SECRET env vars
//      (durable mode — see identuum-ui/docs/LOCAL_ORG_ADMIN_PLAYWRIGHT_FIXTURE.md).
//
// Whichever source wins is exposed to the rest of this module via the same
// three constants below; nothing else in the file knows the difference.
// Never log the resolved values — neither source is safe to print.

const dynamicOrgAdminFixture = loadOrgAdminFixture();

const ORG_ADMIN_EMAIL =
  dynamicOrgAdminFixture?.email ?? process.env.IDENTUUM_TEST_ORG_ADMIN_EMAIL ?? "";
const ORG_ADMIN_PASSWORD =
  dynamicOrgAdminFixture?.password ?? process.env.IDENTUUM_TEST_ORG_ADMIN_PASSWORD ?? "";
const ORG_ADMIN_TOTP_SECRET =
  dynamicOrgAdminFixture?.totpSecret ?? process.env.IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET ?? "";

/** True when org_admin auth credentials are absent from BOTH sources. */
export const skipOrgAdminTests = !ORG_ADMIN_EMAIL || !ORG_ADMIN_PASSWORD;

// ── Per-account TOTP cooldown ─────────────────────────────────────────────────
//
// Tracks the epoch-ms timestamp of the last successful TOTP login per account,
// keyed by the non-secret account identifier (email address).
//
// State is persisted to /tmp/identuum-totp-cooldown.json so that back-to-back
// `npx playwright test` invocations also respect the cooldown. Without this,
// the second run would use TOTP codes from the same windows as the first run.
//
// Do not store secrets or tokens here — only epoch-ms timestamps.

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

const COOLDOWN_FILE = "/tmp/identuum-totp-cooldown.json";

function loadCooldownState(): Map<string, number> {
  try {
    const raw = readFileSync(COOLDOWN_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveCooldownState(map: Map<string, number>): void {
  try {
    const obj = Object.fromEntries(map.entries());
    writeFileSync(COOLDOWN_FILE, JSON.stringify(obj), "utf-8");
  } catch {
    // Ignore write failures — cooldown state is best-effort
  }
}

// Load any persisted state from a previous run
const totpLastSuccessMs = loadCooldownState();

// How long to treat a TOTP window as "in use" for a given account.
// 31s = 30s window + 1s buffer. The cooldown only triggers when the last login
// was in the SAME 30-second TOTP window (not a fixed elapsed time), keeping
// the expected wait near-zero when no replay risk exists.
const TOTP_WINDOW_BUFFER_MS = 1_000;

/**
 * If the same account completed a TOTP login within the CURRENT 30-second
 * TOTP window, waits until the start of the next window plus a 1s buffer.
 *
 * Uses TOTP window boundaries (multiples of 30s since Unix epoch) rather than
 * a fixed elapsed time, so the wait is minimal when the account last logged in
 * at the beginning of the current window (~0-30s wait) vs. no wait when the
 * account last logged in in a previous window.
 *
 * NOTE: callers (loginAsSiteAdmin / loginAsOrgAdmin) must increase their
 * beforeAll timeout to at least 90s to accommodate up to ~31s wait here plus
 * the login flow itself (~8s).
 *
 * @param email  Non-secret stable account identifier (used as the cooldown key only).
 * @param page   Playwright Page for waitForTimeout (keeps timing in the test context).
 */
async function waitForSafeTOTPWindow(email: string, page: Page): Promise<void> {
  if (!email) return;
  const lastMs = totpLastSuccessMs.get(email);
  if (!lastMs) return; // First login for this account — no wait needed

  const windowNow = Math.floor(Date.now() / 1000 / 30);
  const windowThen = Math.floor(lastMs / 1000 / 30);

  if (windowNow === windowThen) {
    // Last login was in the current 30s TOTP window — wait until the next one
    const secondsIntoWindow = Math.floor(Date.now() / 1000) % 30;
    const msUntilNextWindow = (30 - secondsIntoWindow) * 1000 + TOTP_WINDOW_BUFFER_MS;
    await page.waitForTimeout(msUntilNextWindow);
  }
  // If last login was in a previous window, no wait needed
}

// ── Session state caching ─────────────────────────────────────────────────────
//
// Session cookies (access_token, refresh_token) are saved to /tmp after each
// successful login. Subsequent runs within the access_token's 15-minute TTL
// restore the cookies and skip TOTP entirely, eliminating back-to-back run
// failures.
//
// State files are in /tmp (ephemeral, not committed). They contain session
// cookies — do not log or print the file contents.

const SITE_ADMIN_SESSION_FILE = "/tmp/identuum-site-admin-session.json";
const ORG_ADMIN_SESSION_FILE = "/tmp/identuum-org-admin-session.json";
// Use saved session only if it is younger than this (access_token TTL is 900s)
const SESSION_MAX_AGE_MS = 600_000; // 10 minutes — well within the 900s access token TTL

/**
 * Tries to restore saved session cookies into the browser context.
 * Returns true if the state file exists, is recent, and cookies were added.
 * Does NOT verify the session is still valid server-side — that happens on first use.
 */
async function tryRestoreSession(ctx: BrowserContext, stateFile: string): Promise<boolean> {
  try {
    const stat = statSync(stateFile);
    if (Date.now() - stat.mtimeMs > SESSION_MAX_AGE_MS) return false; // too old
    const raw = readFileSync(stateFile, "utf-8");
    const state = JSON.parse(raw) as { cookies?: unknown[] };
    if (!state.cookies?.length) return false;
    // Type cast: cookies from storageState() are compatible with addCookies()
    await ctx.addCookies(state.cookies as Parameters<typeof ctx.addCookies>[0]);
    // Validate the restored session is still LIVE before trusting the fast
    // path. A saved session can be REVOKED server-side between runs — e.g. the
    // passkey spec's T4 logout (POST /api/v1/logout) revokes the site_admin
    // session, but the file written in that spec's beforeAll still holds the
    // now-revoked cookie. Without this check the revoked cookie sails through
    // and the next protected navigation bounces to /login (the Settings H1
    // never renders). ctx.request shares the context cookies and resolves the
    // relative path against the configured baseURL (origin-stable). NO cookie
    // or token value is read or printed.
    const probe = await ctx.request.get("/api/idp/api/v1/validate");
    if (!probe.ok()) {
      // Stale/revoked — drop cookies + the file so the caller falls through to
      // a FULL login and re-saves a fresh session.
      await ctx.clearCookies();
      try {
        unlinkSync(stateFile);
      } catch {
        // best-effort cleanup
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves the current browser context's cookies to a file for reuse in future runs.
 * The file is stored in /tmp and is NOT committed. Never log or print the path contents.
 */
async function saveSession(ctx: BrowserContext, stateFile: string): Promise<void> {
  try {
    const state = await ctx.storageState();
    writeFileSync(stateFile, JSON.stringify(state), "utf-8");
  } catch {
    // Ignore write failures — session cache is best-effort
  }
}

// ── Login helpers ─────────────────────────────────────────────────────────────

/**
 * Logs in as site_admin. Must only be called inside a test after checking skipAuthTests.
 *
 * Applies a per-account TOTP cooldown BEFORE starting any page interaction to
 * prevent replay failures when two spec files use the same site_admin account
 * in quick succession. Callers must set test.setTimeout to at least 90s in
 * their beforeAll hook to accommodate up to ~31s cooldown wait.
 */
export async function loginAsSiteAdmin(page: Page): Promise<void> {
  // Fast path: restore saved session cookies if available and recent.
  // This skips TOTP entirely for back-to-back runs within the access_token TTL.
  const ctx = page.context();
  const restored = await tryRestoreSession(ctx, SITE_ADMIN_SESSION_FILE);
  if (restored) return;

  // Full login with TOTP cooldown
  await waitForSafeTOTPWindow(SITE_ADMIN_EMAIL, page);

  // Navigate directly to the IDP login page. Do not use "/" — in a
  // split-runtime deployment the UI root redirects to /ag-admin/login,
  // not the IDP login page.
  await page.goto("/login");

  const emailInput = page.getByLabel("Email or domain");
  await emailInput.fill(SITE_ADMIN_EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();

  const passwordInput = page.getByLabel("Password");
  await passwordInput.waitFor({ state: "visible" });
  await passwordInput.fill(SITE_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await completeTOTPWithRetry(page, SITE_ADMIN_TOTP_SECRET, /\/site-admin/);

  // Save session for future runs and record TOTP cooldown
  await saveSession(ctx, SITE_ADMIN_SESSION_FILE);
  totpLastSuccessMs.set(SITE_ADMIN_EMAIL, Date.now());
  saveCooldownState(totpLastSuccessMs);
}

/**
 * Logs in as site_admin BUT tolerates an account where MFA has NOT been
 * enrolled. Mirrors the loginAsOrgAdmin MFA-optional pattern.
 *
 * Why this exists separately from `loginAsSiteAdmin`:
 *
 *   The dev compose stack's site_admin row is created with MFA already
 *   enrolled (the dev-fixture seed scripts mint a TOTP secret alongside
 *   the password). Every authenticated `/site-admin/*` Playwright spec
 *   targeting the dev stack therefore relies on the strict
 *   "TOTP step always appears" behaviour `loginAsSiteAdmin` enforces.
 *
 *   The CE customer-smoke stack's site_admin row is created by the
 *   bundled-UI M1 setup wizard, which DOES NOT enroll MFA — by
 *   appliance-install-UX design, MFA enrollment is a deferred operator
 *   step on `/account/settings` after first login. A customer-smoke
 *   stack whose operator has not yet enrolled site_admin MFA therefore
 *   skips the TOTP step entirely on login. `loginAsSiteAdmin` would
 *   hang waiting for the TOTP page that never renders; this variant
 *   handles both shapes.
 *
 * This function NEVER weakens MFA enforcement: it only tolerates the
 * absence of the TOTP step in flows where the row has no enrolled
 * secret. When the secret IS enrolled the function fills the TOTP
 * code exactly like `loginAsSiteAdmin` does.
 *
 * Callers must check `skipAuthTests` first (the canonical EMAIL +
 * PASSWORD gate). The TOTP_SECRET env var is OPTIONAL — when empty,
 * login completes after the password step iff the IDP did not render
 * a TOTP page.
 *
 * Used by `e2e/ce-customer-smoke-license-status.spec.ts`.
 */
export async function loginAsSiteAdminMFAOptional(page: Page): Promise<void> {
  // Fast path: restore saved session cookies if available.
  const ctx = page.context();
  const restored = await tryRestoreSession(ctx, SITE_ADMIN_SESSION_FILE);
  if (restored) return;

  // Full login with TOTP cooldown (no-op when TOTP_SECRET is empty).
  if (SITE_ADMIN_TOTP_SECRET) {
    await waitForSafeTOTPWindow(SITE_ADMIN_EMAIL, page);
  }

  await page.goto("/login");

  const emailInput = page.getByLabel("Email or domain");
  await emailInput.fill(SITE_ADMIN_EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();

  const passwordInput = page.getByLabel("Password");
  await passwordInput.waitFor({ state: "visible" });
  await passwordInput.fill(SITE_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // MFA-optional branch: only attempt to complete TOTP when (a) the
  // operator supplied a TOTP secret AND (b) the IDP actually rendered
  // the Verification code page within a short window.
  if (SITE_ADMIN_TOTP_SECRET) {
    const codeInput = page.getByLabel("Verification code");
    const hasTOTP = await codeInput
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (hasTOTP) {
      await completeTOTPWithRetry(page, SITE_ADMIN_TOTP_SECRET, /\/site-admin/);
      await saveSession(ctx, SITE_ADMIN_SESSION_FILE);
      totpLastSuccessMs.set(SITE_ADMIN_EMAIL, Date.now());
      saveCooldownState(totpLastSuccessMs);
      return;
    }
  }

  // No TOTP step rendered (or TOTP secret unset): wait for one of the
  // three observable post-password-submit outcomes:
  //
  //   (i)   `/site-admin/...` URL — login succeeded
  //   (ii)  TOTP "Verification code" input visible — MFA challenge
  //         appeared but the operator did not supply a TOTP secret
  //   (iii) Still on `/login` (with or without a non-secret error
  //         banner) — credential mismatch most likely
  //
  // We race the three signals via Promise.race so the failure path
  // emits ACTIONABLE diagnostic content (current URL + visible error
  // banner text if present + MFA-prompt-state) instead of an opaque
  // `waitForURL` timeout.
  //
  // Safety: this block prints ONLY (a) the post-submit URL (which is
  // not secret — it is the operator's own browser navigation state),
  // and (b) the visible inline error/banner text (the IDP's standard
  // login error messages — no credential or session material). It
  // NEVER prints email, password, TOTP code, cookies, JWT, or env
  // var values.
  const succeededPromise = page
    .waitForURL(/\/site-admin/, { timeout: 12000 })
    .then(() => "site-admin" as const)
    .catch(() => null);
  const totpPromptPromise = page
    .getByLabel("Verification code")
    .waitFor({ state: "visible", timeout: 12000 })
    .then(() => "totp" as const)
    .catch(() => null);
  const stillOnLoginPromise = page
    .waitForURL(/\/login(\?|$|\/)/, { timeout: 12000 })
    .then(() => "login" as const)
    .catch(() => null);

  const outcome = await Promise.race([succeededPromise, totpPromptPromise, stillOnLoginPromise]);

  if (outcome === "site-admin") {
    await saveSession(ctx, SITE_ADMIN_SESSION_FILE);
    return;
  }

  // Failure path. Collect SAFE observable evidence: the current URL
  // (browser navigation state) AND the visible error/banner text on
  // the page (the IDP's standard login error messages). No credential
  // value is read or printed.
  const observedURL = page.url();
  // Common non-secret banner / error selectors in the bundled UI:
  //   role="alert" — generic alert role (login form uses it for inline
  //                  "Invalid credentials" + "Account is disabled" +
  //                  similar messages).
  //   .text-red-* / .text-rose-* — Tailwind error-text classes used
  //                  by the bundled UI for inline form errors.
  // We use a `role="alert"` first-pass + a regex-text fallback so a
  // banner-shape rename can't silently break the diagnostic.
  let bannerText = "";
  try {
    const alertText = await page.getByRole("alert").first().textContent({ timeout: 1000 });
    bannerText = (alertText ?? "").trim();
  } catch {
    // No alert role visible — try the fallback.
  }
  if (!bannerText) {
    try {
      const errish = await page
        .locator("text=/invalid|incorrect|wrong|denied|locked|disabled|policy|MFA|verification/i")
        .first()
        .textContent({ timeout: 1000 });
      bannerText = (errish ?? "").trim();
    } catch {
      // No error-shaped text visible.
    }
  }
  const bannerLine = bannerText
    ? `Visible inline error/banner: "${bannerText}"`
    : "Visible inline error/banner: <none>";

  let outcomeLabel: string;
  switch (outcome) {
    case "totp":
      outcomeLabel =
        "the IDP rendered a TOTP Verification-code prompt, but IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET is empty. " +
        "Either supply the TOTP secret in the env file OR remove MFA from the site_admin row.";
      break;
    case "login":
      outcomeLabel =
        "still on /login after the Sign-in click. The most likely cause is a credential mismatch " +
        "with the site_admin row — no credential value is referenced in this report.";
      break;
    default:
      outcomeLabel =
        "neither /site-admin nor a TOTP prompt nor /login navigation appeared within 12 seconds. " +
        "The IDP may be slow or unreachable; verify with `curl ${IDP_BASE_URL}/api/setup/status`.";
      break;
  }

  throw new Error(
    `[loginAsSiteAdminMFAOptional] post-password observable diagnostic — outcome: ${outcomeLabel} Observed URL: ${observedURL} ${bannerLine} MFA prompt detected: ${outcome === "totp"}.`
  );
}

/**
 * Logs in as org_admin. Must only be called inside a test after checking skipOrgAdminTests.
 *
 * Handles optional TOTP: if IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET is set and the TOTP
 * verification step appears (MFA enrolled), it fills the code automatically.
 * If the org has MFA policy=optional and the user has not enrolled, the TOTP step
 * is skipped and login completes after the password step.
 *
 * Applies the same per-account TOTP cooldown as loginAsSiteAdmin. Callers must set
 * test.setTimeout to at least 90s in their beforeAll hook.
 */
export async function loginAsOrgAdmin(page: Page): Promise<void> {
  // Fast path: restore saved session cookies if available and recent.
  const ctx = page.context();
  const restored = await tryRestoreSession(ctx, ORG_ADMIN_SESSION_FILE);
  if (restored) return;

  // Full login with TOTP cooldown
  await waitForSafeTOTPWindow(ORG_ADMIN_EMAIL, page);

  // Navigate directly to the IDP login page. Do not use "/" — in a
  // split-runtime deployment the UI root redirects to /ag-admin/login,
  // not the IDP login page.
  await page.goto("/login");

  const emailInput = page.getByLabel("Email or domain");
  await emailInput.fill(ORG_ADMIN_EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();

  const passwordInput = page.getByLabel("Password");
  await passwordInput.waitFor({ state: "visible" });
  await passwordInput.fill(ORG_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Handle TOTP step if the org has MFA enrolled (optional — check with short timeout)
  if (ORG_ADMIN_TOTP_SECRET) {
    const codeInput = page.getByLabel("Verification code");
    const hasTOTP = await codeInput
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (hasTOTP) {
      await completeTOTPWithRetry(page, ORG_ADMIN_TOTP_SECRET, /\/org-admin/);
      await saveSession(ctx, ORG_ADMIN_SESSION_FILE);
      totpLastSuccessMs.set(ORG_ADMIN_EMAIL, Date.now());
      saveCooldownState(totpLastSuccessMs);
      return;
    }
  }

  await page.waitForURL(/\/org-admin/, { timeout: 10000 });
  if (ORG_ADMIN_EMAIL) {
    await saveSession(ctx, ORG_ADMIN_SESSION_FILE);
    totpLastSuccessMs.set(ORG_ADMIN_EMAIL, Date.now());
    saveCooldownState(totpLastSuccessMs);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Fills the TOTP verification code and waits for the success URL.
 * If the TOTP code is rejected (TOTP replay protection — same code already used
 * in the current 30-second window), waits for the next window and retries once.
 *
 * The proactive per-account cooldown in loginAsSiteAdmin / loginAsOrgAdmin
 * should prevent replay in normal combined-suite runs. This retry is a
 * fallback for unexpected replay (e.g., leftover state from a previous process).
 */
async function completeTOTPWithRetry(
  page: Page,
  secret: string,
  successPattern: RegExp
): Promise<void> {
  const codeInput = page.getByLabel("Verification code");
  await codeInput.waitFor({ state: "visible" });
  await codeInput.fill(generateTOTP(secret));
  await page.getByRole("button", { name: "Verify" }).click();

  // Wait up to 8 seconds for successful navigation. If still on TOTP page,
  // the code was rejected (replay protection). Wait for the next TOTP window
  // and retry with the new code.
  const navigated = await page
    .waitForURL(successPattern, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (!navigated) {
    // The 8s window might have been too short for a slow server response.
    // Wait for the window boundary — but first check if we already succeeded
    // (slow first-attempt navigation completing during the wait).
    const msToNextWindow = (30 - (Math.floor(Date.now() / 1000) % 30) + 2) * 1000;
    await page.waitForTimeout(msToNextWindow);

    // Re-check: maybe the first TOTP was correct and the navigation completed
    // while we were waiting (server was slow but eventually responded).
    // Use a 5s window to catch the completion reliably.
    const alreadyDone = await page
      .waitForURL(successPattern, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (alreadyDone) return;

    // First TOTP was genuinely rejected. Check if the TOTP input is still present.
    const inputAfterWait = page.getByLabel("Verification code");
    const inputVisible = await inputAfterWait.isVisible().catch(() => false);
    if (!inputVisible) {
      // Page left the TOTP step without navigating to success — likely back to login.
      // Do a final check in case the navigation just completed.
      const lateSuccess = await page
        .waitForURL(successPattern, { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (lateSuccess) return;
      throw new Error(
        "TOTP retry: MFA input gone and success URL not reached; partial session may have expired"
      );
    }
    await inputAfterWait.fill(generateTOTP(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    // Race the success navigation against a persistent rejection banner so a
    // wrong TOTP SECRET fails FAST with an actionable diagnostic instead of
    // burning the whole test-timeout budget on an opaque `waitForURL`
    // timeout. After TWO fresh-code attempts in DIFFERENT 30-second windows,
    // a visible "Invalid verification code" banner means the codes
    // themselves are being rejected — i.e. the configured TOTP secret does
    // not match the secret enrolled on the target account (NOT replay, NOT a
    // slow server). The Playwright TOTP generator (RFC 6238 / SHA-1 / 6-digit
    // / 30s, e2e/helpers/totp.ts) is correct and the password was already
    // accepted (the MFA step rendered), so the cause is upstream of this
    // helper. We surface a SAFE, actionable diagnostic — NO secret, code,
    // cookie, or env value is read or printed.
    const successWins = page
      .waitForURL(successPattern, { timeout: 90_000 })
      .then(() => "success" as const)
      .catch(() => "timeout" as const);
    const rejectionWins = page
      .getByText(/invalid verification code/i)
      .first()
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(() => "rejected" as const)
      .catch(() => "timeout" as const);
    const winner = await Promise.race([successWins, rejectionWins]);
    if (winner === "rejected") {
      throw new Error(
        "TOTP verification code REJECTED by the IDP after two fresh-code attempts in different 30-second windows. " +
          "The Playwright TOTP generator (RFC 6238 / SHA-1 / 6-digit / 30s, e2e/helpers/totp.ts) is correct and the password was accepted (the MFA step rendered), " +
          "so the most likely cause is that the configured TOTP secret (e.g. IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET in identuum-ui/.env.playwright.idp-ce.local) does NOT match the TOTP secret currently enrolled on the target account. " +
          "Remediate per identuum-idp-ce/docs/CE_CUSTOMER_SMOKE_RUNBOOK.md: re-enroll the authenticator at /account/settings?tab=mfa and capture the NEW base32 secret, OR reset MFA via /admin/users/{id}/mfa/reset, then update the overlay file. " +
          "NO credential, secret, code, cookie, or env value is read or printed by this diagnostic."
      );
    }
    if (winner === "timeout") {
      // Neither success nor a rejection banner within the window — fall back
      // to a final bounded wait so a genuinely slow navigation still
      // completes (or throws a normal, bounded timeout).
      await page.waitForURL(successPattern, { timeout: 5000 });
    }
  }
}
