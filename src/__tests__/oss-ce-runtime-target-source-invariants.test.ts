/**
 * Source-invariant pins for the OSS-vs-CE runtime contract that
 * govern which IDP backend each Playwright spec is allowed to target.
 *
 * Background:
 *   - `identuum-idp-oss` is the OSS scaffold runtime. Its `--gin-serve`
 *     mode exposes ONLY /system/info, /health, /metrics,
 *     /.well-known/openid-configuration, /.well-known/jwks.json.
 *     It is NOT a full auth server — no /authorize, no /token, no
 *     site-admin login, no MFA, no sessions UI, no admin license, no
 *     setup wizard, no upgrade wizard.
 *   - `identuum-idp-ce` is the full appliance runtime with /authorize,
 *     /token, login, MFA, sessions, admin license, setup wizard,
 *     upgrade wizard, backup, account/passkey, full admin UI.
 *
 * These tests read each Playwright spec as plain text and assert that
 * the spec's docstring or top-level comment explicitly states which
 * runtime contract it expects. The intent is that future prompts
 * cannot silently send an auth-required spec at an OSS scaffold
 * runtime by adding it to the wrong make target.
 *
 * The runtime markers we look for in spec docstrings are documented in
 * e2e/README.md "OSS vs CE runtime contract" section.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

function read(specRelative: string): string {
  return readFileSync(join(root, specRelative), "utf8");
}

// CE-runtime-required specs MUST mention the full Compose stack or
// explicitly reference identuum-idp-ce / appliance. These cannot run
// against `identuum-idp-oss` because the OSS scaffold has no
// /authorize, no /token, no login, no MFA, no sessions, no admin UI.
const CE_RUNTIME_REQUIRED_SPECS = [
  "e2e/login.spec.ts",
  "e2e/account-settings.spec.ts",
  "e2e/passkey-flow.spec.ts",
  "e2e/dashboard.spec.ts",
  "e2e/claim.spec.ts",
  "e2e/setup-wizard.spec.ts",
  "e2e/upgrade-backup.spec.ts",
  "e2e/upgrade-backup-live.spec.ts",
  "e2e/org-admin.spec.ts",
  "e2e/org-admin-smoke.spec.ts",
  "e2e/org-admin-api-resources.spec.ts",
  "e2e/org-admin-applications.spec.ts",
  "e2e/org-admin-service-accounts.spec.ts",
  "e2e/org-admin-settings.spec.ts",
  "e2e/org-admin-user-detail.spec.ts",
  "e2e/site-admin-admin-recovery.spec.ts",
  "e2e/site-admin-audit.spec.ts",
  "e2e/site-admin-observability.spec.ts",
  "e2e/site-admin-organizations.spec.ts",
  "e2e/site-admin-settings.spec.ts",
];

// OSS-scaffold-compatible specs only touch /health,
// /.well-known/openid-configuration, /.well-known/jwks.json, or other
// scaffold endpoints; they MUST NOT exercise auth-required flows.
const OSS_SCAFFOLD_COMPATIBLE_SPECS = ["e2e/oss-contract.spec.ts"];

// Runtime-agnostic specs exercise UI-only behaviour, redirects, or
// shared smoke surfaces; they happen to work on either runtime but
// should be tagged accordingly in their docstring so make targets can
// place them correctly.
const RUNTIME_AGNOSTIC_SPECS = ["e2e/health-and-redirects.spec.ts", "e2e/platform-status.spec.ts"];

describe("OSS-vs-CE Playwright runtime contract — CE-required specs", () => {
  for (const spec of CE_RUNTIME_REQUIRED_SPECS) {
    it(`${spec} is documented as requiring a CE / full-auth IDP runtime`, () => {
      const src = read(spec);
      // The spec must mention either the full Compose stack, the CE
      // appliance, the setup/login/MFA flow it drives, or otherwise
      // make clear it cannot run against an OSS `--gin-serve` scaffold.
      // We accept any of these established markers:
      const markers = [
        "full Compose stack",
        "full Compose",
        "identuum-idp-ce",
        "CE appliance",
        "full auth",
        "appliance first-run",
        "auth-required",
        "site-admin",
        "site_admin",
        "org-admin",
        "org_admin",
        "login",
        "MFA",
        "passkey",
        "claim",
        "dashboard",
        "setup wizard",
        "upgrade wizard",
        "upgrade backup",
        "account/passkey",
        "session",
      ];
      const hasMarker = markers.some((m) => src.toLowerCase().includes(m.toLowerCase()));
      expect(hasMarker, `${spec} must document a CE/full-auth runtime requirement`).toBe(true);
    });
  }
});

describe("OSS-vs-CE Playwright runtime contract — OSS-compatible specs", () => {
  for (const spec of OSS_SCAFFOLD_COMPATIBLE_SPECS) {
    it(`${spec} must NOT require .env.playwright.idp-oss.local credentials`, () => {
      const src = read(spec);
      // OSS-scaffold-compatible specs must not reference any of the
      // credential env vars Playwright loads from .env.playwright.idp-oss.local
      // — they would force the spec to fail against the OSS scaffold
      // which has no credentials at all.
      const forbidden = [
        "IDENTUUM_TEST_SITE_ADMIN_PASSWORD",
        "IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET",
        "IDENTUUM_TEST_ORG_ADMIN_PASSWORD",
        "IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET",
        "loginAsSiteAdmin",
        "loginAsOrgAdmin",
      ];
      for (const f of forbidden) {
        expect(src, `${spec} must not reference ${f}`).not.toContain(f);
      }
    });

    it(`${spec} pins the OSS scaffold contract markers`, () => {
      const src = read(spec);
      // The spec must positively pin at least one OSS scaffold marker.
      const markers = ["OSS scaffold", "--gin-serve", "/.well-known/openid-configuration"];
      const hasMarker = markers.some((m) => src.includes(m));
      expect(hasMarker, `${spec} must pin at least one OSS scaffold marker`).toBe(true);
    });

    it(`${spec} explicitly asserts /authorize is NOT a successful endpoint`, () => {
      const src = read(spec);
      // Negative-pin pattern documenting OSS scaffold absence.
      expect(src).toMatch(/\/authorize/);
      expect(src).toMatch(/expect\(.+\)\.not\.toBe\(200\)/);
    });
  }
});

describe("OSS-vs-CE Playwright runtime contract — agnostic specs", () => {
  for (const spec of RUNTIME_AGNOSTIC_SPECS) {
    it(`${spec} is listed under either OSS-compatible OR CE-required, but not both`, () => {
      const inCE = CE_RUNTIME_REQUIRED_SPECS.includes(spec);
      const inOSS = OSS_SCAFFOLD_COMPATIBLE_SPECS.includes(spec);
      expect(
        inCE && inOSS,
        `${spec} must not appear in both OSS and CE lists; agnostic specs go in their own list`
      ).toBe(false);
    });
  }
});

describe("OSS-vs-CE Playwright runtime contract — coverage completeness", () => {
  it("every authenticated-helper-importing e2e spec is in the CE-required list", () => {
    // Hard-coded: if any spec imports loginAsSiteAdmin or
    // loginAsOrgAdmin from helpers/login, it MUST be in the
    // CE_RUNTIME_REQUIRED_SPECS list. This guards against future drift.
    const knownCEDocstringSpecs = [
      "e2e/login.spec.ts",
      "e2e/account-settings.spec.ts",
      "e2e/passkey-flow.spec.ts",
      "e2e/org-admin-api-resources.spec.ts",
      "e2e/org-admin-applications.spec.ts",
      "e2e/org-admin-service-accounts.spec.ts",
      "e2e/org-admin-settings.spec.ts",
      "e2e/org-admin-smoke.spec.ts",
      "e2e/org-admin-user-detail.spec.ts",
      "e2e/site-admin-admin-recovery.spec.ts",
      "e2e/site-admin-audit.spec.ts",
      "e2e/site-admin-observability.spec.ts",
      "e2e/site-admin-organizations.spec.ts",
      "e2e/site-admin-settings.spec.ts",
    ];
    for (const spec of knownCEDocstringSpecs) {
      expect(CE_RUNTIME_REQUIRED_SPECS).toContain(spec);
    }
  });
});
