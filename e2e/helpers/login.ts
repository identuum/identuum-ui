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

import type { BrowserContext, Page } from "@playwright/test";
import { generateTOTP } from "./totp";
import { statSync } from "node:fs";

// ── Site-admin credentials (canonical names only) ─────────────────────────────

/**
 * Resolved site_admin credentials. Exported so the login UI spec can drive
 * the email/password/TOTP steps without re-reading process.env directly —
 * keeping a single source of truth.
 *
 * Never log these values.
 */
export const SITE_ADMIN_EMAIL =
  process.env.IDENTUUM_TEST_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
export const SITE_ADMIN_PASSWORD = process.env.IDENTUUM_TEST_SITE_ADMIN_PASSWORD ?? "";
export const SITE_ADMIN_TOTP_SECRET = process.env.IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET ?? "";

/** True when site_admin auth env vars are absent. */
export const skipAuthTests = !SITE_ADMIN_PASSWORD || !SITE_ADMIN_TOTP_SECRET;

/** Standard skip message — reuse across specs for consistent operator guidance. */
export const SKIP_AUTH_MSG =
  "Set IDENTUUM_TEST_SITE_ADMIN_PASSWORD and IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET to run this test";

// ── Org-admin credentials ─────────────────────────────────────────────────────

const ORG_ADMIN_EMAIL = process.env.IDENTUUM_TEST_ORG_ADMIN_EMAIL ?? "";
const ORG_ADMIN_PASSWORD = process.env.IDENTUUM_TEST_ORG_ADMIN_PASSWORD ?? "";
const ORG_ADMIN_TOTP_SECRET = process.env.IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET ?? "";

/** True when org_admin auth env vars are absent. */
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

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

  await page.goto("/");
  await page.waitForURL(/\/login/);

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

  await page.goto("/");
  await page.waitForURL(/\/login/);

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
    // 90s explicit timeout — coordinated with the 180s beforeAll budget
    await page.waitForURL(successPattern, { timeout: 90_000 });
  }
}
