import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// ── Local env autoload ────────────────────────────────────────────────────────
// Reads .env.playwright.local (gitignored) before tests run.
// Shell-provided env vars always take precedence — existing values are not overwritten.
// Silently skipped in CI or when the file is absent.
//
// The customer-smoke overlay (`.env.playwright.customer-smoke.local`) is
// loaded AFTER the canonical file when the `IDENTUUM_E2E_CE_CUSTOMER_SMOKE`
// env var is set (which the `pnpm e2e:ce-customer-smoke` script does).
// This keeps customer-smoke site_admin credentials in a separate
// gitignored file from the dev-stack credentials — the two stacks
// typically have different first-run-wizard outputs. Both files honour
// the same "don't overwrite already-set keys" precedence rule, so the
// dev-stack file wins on shared key names by default, and the
// customer-smoke overlay only fills in values the dev-stack file does
// NOT carry. To force the customer-smoke values over the dev-stack
// values for a single run, set IDENTUUM_E2E_CE_CUSTOMER_SMOKE_OVERRIDE=1
// (the overlay then takes precedence over the canonical file).
function loadEnvFile(filename: string, override: boolean): void {
  try {
    const envFile = resolve(__dirname, filename);
    const lines = readFileSync(envFile, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!key) continue;
      if (override || !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // File absent — silent skip.
  }
}

if (process.env.IDENTUUM_E2E_CE_CUSTOMER_SMOKE === "1") {
  // Customer-smoke mode: the overlay loads FIRST and wins for keys it
  // defines, so the operator does NOT need to set any extra precedence
  // flag. The canonical dev-stack file still loads after and fills in
  // any keys the overlay does not define. This is the inverse of the
  // normal-dev-mode default below — normal Playwright runs continue to
  // see the dev-stack credentials win, so the existing authed specs
  // (site-admin-observability, site-admin-organizations, etc.) are
  // unchanged.
  loadEnvFile(".env.playwright.customer-smoke.local", false);
  loadEnvFile(".env.playwright.local", false);
} else if (process.env.IDENTUUM_E2E_OSS_CUSTOMER_SMOKE === "1") {
  // OSS customer-smoke mode (mirror of the CE block above): targets the
  // identuum-idp-oss dev runtime on 127.0.0.1:7113 + the UI dev server
  // on 127.0.0.1:7114. Loads `.env.playwright.oss.local` FIRST so OSS
  // site_admin credentials (different first-run-wizard output than the
  // CE customer-smoke stack) take precedence for keys it defines; the
  // canonical dev-stack file still loads after and fills in any keys
  // the OSS overlay does not carry. Used by the `pnpm
  // e2e:oss-customer-smoke-passkey` script to close the IDP OSS passkey
  // parity gap left after the IDP OSS verification-floor closure.
  loadEnvFile(".env.playwright.oss.local", false);
  loadEnvFile(".env.playwright.local", false);
} else {
  loadEnvFile(".env.playwright.local", false);
}

/**
 * Playwright E2E configuration for identuum-ui.
 *
 * Prerequisites (first time):
 *   pnpm e2e:install        # installs Chromium browser binary
 *
 * Running tests:
 *   pnpm e2e
 *
 *   The runner auto-starts `pnpm dev` (port 7104) when no server is already
 *   listening there. When the local Docker Compose stack is already running,
 *   the existing server at http://localhost:7104 is reused instead.
 *
 * Runtime config:
 *   e2e/global-setup.ts runs before any test and ensures config/ui-runtime.json
 *   exists. If the file is missing it writes a minimal no-secrets config
 *   (localhost URLs only) so the environment is always explicit, not silently
 *   degraded. A corrupt or configured=false file causes a hard failure with a
 *   clear message. Safe-state tests (/claim, /verify-email) tolerate an
 *   unreachable IdP. The login test requires the full Compose stack.
 *
 * Authenticated test credentials (.env.playwright.local — gitignored, never commit):
 *   Credentials are loaded automatically from .env.playwright.local if present.
 *   Site-admin vars (canonical):   IDENTUUM_TEST_SITE_ADMIN_EMAIL / _PASSWORD / _TOTP_SECRET
 *   Org-admin vars:                IDENTUUM_TEST_ORG_ADMIN_EMAIL / _PASSWORD / _TOTP_SECRET
 *   Legacy IDENTUUM_TEST_EMAIL / _PASSWORD / _TOTP_SECRET are no longer read.
 *   Authenticated tests self-skip when credentials are absent.
 *   Run authenticated tests with --workers=1 — TOTP replay protection rejects
 *   concurrent logins that generate the same 30-second code.
 *
 * CI:
 *   Set CI=true (most CI systems do this automatically). The runner always
 *   starts a fresh pnpm dev server. global-setup.ts auto-creates
 *   config/ui-runtime.json if absent — no manual CI setup step needed.
 */
// Port + base URL overrides for environments where the canonical
// :7104 is held by an outdated Compose UI container (so a freshly
// rebuilt dev server cannot bind it without stopping unrelated
// containers). The defaults reproduce the existing contract; when
// IDENTUUM_E2E_PORT is set, the dev server starts on that port and
// baseURL is composed automatically — useful for one-spec smoke runs
// that need source-fresh code without touching the standing dev
// container.
const e2ePort = process.env.IDENTUUM_E2E_PORT ?? "7104";
const e2eBaseURL = process.env.IDENTUUM_E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // 90s: accommodates up to ~31s TOTP cooldown wait in beforeAll hooks when the same
  // account logs in across spec files in a combined run. Individual tests complete well
  // under 30s; the extra headroom only adds wait time for genuine failures.
  timeout: 90_000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: e2eBaseURL,
    headless: true,
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${e2ePort}`,
    // Probe the running server via 127.0.0.1 (NOT `localhost`) and the
    // /api/health endpoint, NOT the e2eBaseURL root.
    //
    // Why 127.0.0.1 rather than localhost: macOS resolves `localhost`
    // to IPv6 ::1 first; the Docker UI container publishes
    // `127.0.0.1:7104->7104/tcp` (IPv4 only). Playwright's
    // reuseExistingServer probe hitting http://localhost:7104 lands on
    // ::1, gets connection-refused, and falls through to spawning
    // `pnpm exec next dev --port 7104` — which then cannot bind
    // because the port is held by the container, and the spawn times
    // out at 60s. Probing the IPv4 literal avoids the resolution
    // ambiguity entirely.
    //
    // Why /api/health rather than the root: the UI's root path
    // 307-redirects to /login. The /api/health endpoint returns a
    // deterministic 200 with a tiny JSON body — a more reliable
    // existing-server signal that does not depend on session-cookie
    // semantics or auth state.
    //
    // baseURL (used by page.goto in specs) remains e2eBaseURL so
    // existing string assertions like
    //   expect(...).toBe('http://localhost:7104/callback')
    // continue to match unchanged.
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    // Local: reuse an already-running server (Compose stack or manual pnpm dev).
    // CI: always start fresh to avoid stale state between test runs.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
