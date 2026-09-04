import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// ── Local env autoload ────────────────────────────────────────────────────────
// Reads .env.playwright.idp-oss.local (gitignored) before tests run.
// Shell-provided env vars always take precedence — existing values are not overwritten.
// Silently skipped in CI or when the file is absent.
//
// The customer-smoke overlay (`.env.playwright.idp-ce.local`) is
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

// ── Credential-overlay contract (strict, no fallback) ─────────────────────────
// Each customer-smoke runtime reads its credentials from EXACTLY ONE overlay
// file, with no fallback to any other env file:
//   - OSS customer-smoke → ONLY .env.playwright.idp-oss.local
//   - CE  customer-smoke → ONLY .env.playwright.idp-ce.local
//   - normal dev runs    → .env.playwright.idp-oss.local (unchanged behaviour)
// A missing required credential variable in the SELECTED overlay fails fast HERE
// (config evaluation, before any webServer/browser boot) with a message naming
// the missing variable and its required file — the value itself is never read,
// logged, or interpolated.
const OSS_CRED_FILE = ".env.playwright.idp-oss.local";
const CE_CRED_FILE = ".env.playwright.idp-ce.local";
const REQUIRED_SITE_ADMIN_KEYS = [
  "IDENTUUM_TEST_SITE_ADMIN_EMAIL",
  "IDENTUUM_TEST_SITE_ADMIN_PASSWORD",
  "IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET",
];

function requireCredentialsOrFail(file: string, keys: string[]): void {
  const missing = keys.filter((k) => {
    const v = process.env[k];
    return v === undefined || v.trim() === "";
  });
  if (missing.length > 0) {
    // Variable NAMES only — no credential value is read, printed, or interpolated.
    throw new Error(
      `[credential-contract] missing required credential variable(s): ${missing.join(", ")}. These MUST be defined in ${file} (no fallback to any other env file). Set them in that file and re-run. No credential value is printed.`
    );
  }
}

if (process.env.IDENTUUM_E2E_CE_CUSTOMER_SMOKE === "1") {
  // CE customer-smoke: ONLY the CE overlay — never falls back to the dev-stack file.
  loadEnvFile(CE_CRED_FILE, false);
  requireCredentialsOrFail(CE_CRED_FILE, REQUIRED_SITE_ADMIN_KEYS);
} else if (process.env.IDENTUUM_E2E_OSS_CUSTOMER_SMOKE === "1") {
  // OSS customer-smoke: ONLY the dev-stack overlay — never falls back to the
  // CE overlay (the former `.env.playwright.oss.local` + dual-load is removed).
  loadEnvFile(OSS_CRED_FILE, false);
  requireCredentialsOrFail(OSS_CRED_FILE, REQUIRED_SITE_ADMIN_KEYS);
} else {
  loadEnvFile(OSS_CRED_FILE, false);
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
 * Authenticated test credentials (.env.playwright.idp-oss.local — gitignored, never commit):
 *   Credentials are loaded automatically from .env.playwright.idp-oss.local if present.
 *   Site-admin vars (canonical):   IDENTUUM_TEST_SITE_ADMIN_EMAIL / _PASSWORD / _TOTP_SECRET
 *   Org-admin vars:                IDENTUUM_TEST_ORG_ADMIN_EMAIL / _PASSWORD / _TOTP_SECRET
 *   Legacy IDENTUUM_TEST_EMAIL / _PASSWORD / _TOTP_SECRET are no longer read.
 *   Authenticated tests self-skip when credentials are absent.
 *   Run authenticated tests with --workers=1. The REASON is test isolation,
 *   not TOTP: this said "TOTP replay protection rejects concurrent logins
 *   that generate the same 30-second code" until 2026-09-04, and that is not
 *   true of this server — both login paths end in a pure RFC 6238 window
 *   match with no once-only bookkeeping, so two logins may legitimately mint
 *   the same code. What --workers=1 actually protects is GLOBAL FAULT
 *   INJECTION — measured in THE-SHARED-FIXTURE (2026-09-04), and NOT the
 *   tenant or the storage state, which are per-context or uniquely named:
 *   e2e/unavailable-not-expired.spec.ts rewrites the UI's RUNTIME CONFIG
 *   FILE to repoint idp.internal_base_url at a 503 stub, then restores it.
 *   The dev server is ONE process reading ONE config file, so for those
 *   seconds every worker sees the IdP as unavailable — and the product is
 *   RIGHT to render the unavailable state in place instead of signing anyone
 *   out (UNAVAILABLE-NOT-EXPIRED-1, "an outage is not a sign-out"). A
 *   concurrent "unauthenticated -> /login" assertion then waits for a
 *   redirect that must not come; with an explicit waitForURL it times out
 *   after 90s, which is how the mechanism was finally identified.
 *   Fixing it needs a per-worker UI server + config file, or request-scoped
 *   fault injection — not per-worker fixtures.
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
// SINGLE SOURCE for the UI port and base URL (THE-RELEASED-CONTRACT,
// 2026-08-08). These were two independent env vars — IDENTUUM_E2E_PORT drove
// the webServer while IDENTUUM_E2E_BASE_URL drove page.goto — and the census
// found them diverged: a gitignored env file set the base URL to :7114 while
// the webServer defaulted to :7104, so every browser test hit a port with no
// server (ERR_CONNECTION_REFUSED, the whole default run red). They now derive
// from ONE authoritative value: if a base URL is given its port wins and the
// webServer follows it; otherwise the port (or the 7104 default) composes the
// base URL. Divergence is no longer expressible.
const e2eBaseURLRaw = process.env.IDENTUUM_E2E_BASE_URL;
const e2ePort = e2eBaseURLRaw
  ? new URL(e2eBaseURLRaw).port || "7104"
  : (process.env.IDENTUUM_E2E_PORT ?? "7104");
const e2eBaseURL = e2eBaseURLRaw ?? `http://localhost:${e2ePort}`;

// Export the suite's ONE authoritative UI origin for the appliance compose
// (docker-compose.e2e.yml interpolates it into IDENTUUM_IDP_UI_PUBLIC_BASE_URL,
// the IdP's allowed WebAuthn origin). Config-eval runs in the SAME process as
// globalSetup, so the `up` it execs inherits this. Without it, a local env
// file that moves the suite's port breaks every passkey finish on origin
// validation (clientDataJSON origin ≠ appliance's allowed UI origin).
process.env.IDENTUUM_E2E_UI_ORIGIN = new URL(e2eBaseURL).origin;

// Isolated e2e ui-runtime config, wired AT CONFIG-EVAL TIME (THE-RELEASED-
// CONTRACT). Playwright launches the webServer BEFORE globalSetup runs, so a
// config file chosen inside globalSetup arrives too late — the freshly spawned
// `next dev` has already bound its env. When dynamic-fixture mode is on and the
// operator has not pinned their own config, write a localhost-only config and
// hand it to the dev server via webServer.env below. This replaces the standing
// config/ui-runtime.json whose internal_base_url points at host.docker.internal
// — resolvable under OrbStack/Docker-Desktop, ENOTFOUND from a host-side dev
// server under colima (the census's owner-local-residue class).
const dynamicFixtureMode = process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE === "true";
const idpBaseForE2E = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";
let e2eConfigFile = process.env.IDENTUUM_UI_CONFIG_FILE;
if (dynamicFixtureMode && !e2eConfigFile) {
  e2eConfigFile = resolve(__dirname, "e2e", ".auth", "ui-runtime.e2e.json");
  mkdirSync(dirname(e2eConfigFile), { recursive: true });
  writeFileSync(
    e2eConfigFile,
    `${JSON.stringify(
      {
        configured: true,
        ui_origin: e2eBaseURL,
        idp: { enabled: true, public_base_url: idpBaseForE2E },
        ag: { enabled: false, public_base_url: "" },
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  process.env.IDENTUUM_UI_CONFIG_FILE = e2eConfigFile;
}

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
    // THE-DISPOSABLE-HARNESS: the e2e-full suite — a SECOND suite, not a
    // wider first one. Its specs destroy their own environment (the OSS dev
    // stack, volume included), so the project is registered ONLY when the
    // harness entry point (e2e-full/scripts/full-run.sh via `make e2e-full`)
    // sets IDENTUUM_E2E_FULL=1. A plain `pnpm e2e` never sees it; the specs
    // additionally self-skip without the flag. Serial because the specs
    // share one appliance and one tenant fixture — NOT because of TOTP: this
    // said "TOTP replay protection rejects concurrent logins minting the same
    // 30-second code" until 2026-09-04, and the server has no such
    // protection (both login paths are a plain RFC 6238 window match). The
    // real constraint was measured three times. The dev-loop suite cannot
    // parallelise while one of its specs repoints the shared UI runtime
    // config at a 503 stub. e2e-full's api-suite looked safe at --workers=2
    // on three consecutive green runs and was NOT: its specs share one
    // site_admin seed file, written non-atomically on first enrolment, so a
    // second worker reads no file or half a file. It cost four red mints and
    // is back at 1 — see full-run.sh for both halves of the race.
    ...(process.env.IDENTUUM_E2E_FULL === "1"
      ? [
          {
            name: "oss-full",
            testDir: "./e2e-full",
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
  // THE-AUTH-SWEEP: the e2e-full harness is API-only against the appliance
  // and never navigates the UI, so under IDENTUUM_E2E_FULL=1 the webServer
  // is omitted entirely — measured twice: a next-dev orphan from a previous
  // run holds the .next/dev lock while listening IPv6-only, the IPv4 reuse
  // probe misses it, the fresh spawn refuses, and the harness dies before
  // its first request. No webServer, no flake class, faster runs. The
  // dev-loop path (flag unset) is byte-identical to before.
  ...(process.env.IDENTUUM_E2E_FULL === "1"
    ? {}
    : {
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
          // CI: always start fresh to avoid stale state between test runs. In dynamic
          // mode DO NOT reuse — a standing dev server carries the operator's
          // host.docker.internal config; force a fresh spawn that reads the isolated
          // e2e config below.
          reuseExistingServer: !process.env.CI && !dynamicFixtureMode,
          timeout: 60_000,
          // Hand the spawned `next dev` the isolated config from birth (see above);
          // globalSetup runs too late to influence it.
          ...(e2eConfigFile ? { env: { IDENTUUM_UI_CONFIG_FILE: e2eConfigFile } } : {}),
        },
      }),
});
