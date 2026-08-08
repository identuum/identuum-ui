/**
 * Source-text invariant tests for the dynamic Playwright fixture
 * orchestration: e2e/global-setup.ts + e2e/global-teardown.ts +
 * e2e/helpers/appliance-fixture.ts + e2e/docker-compose.e2e.yml.
 *
 * THE-RELEASED-CONTRACT / THE-ALL-GREEN-SUITE (2026-08-08): the producer
 * builds fixtures against the RELEASED identuum-idp-oss appliance over its
 * HTTP API. Every pre-split monolith assumption is BANNED below as a
 * negative sentry (the old pins asserted them as required; the machinery
 * they pinned was deleted).
 *
 * Why source-text rather than runtime tests:
 *   - The orchestration shells out to docker compose against a live
 *     appliance; Vitest is the wrong layer to stand that up. The real
 *     path is exercised by the opt-in Playwright dynamic-fixture runs.
 *   - These pins catch load-bearing regressions (mode gate, service
 *     name, no `down -v`, no secret logging, reuse probe) without
 *     Docker.
 *
 * SECURITY: synthetic placeholders only; the banned-pattern lists are
 * regression sentries, not values.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(__dirname, "..", "..");

function stripComments(src: string): string {
  // Strip /* … */ and single-line // comments so security-rule prose
  // does not trip the negative sentries.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const RAW_SETUP_SRC = readFileSync(resolve(UI_ROOT, "e2e", "global-setup.ts"), "utf-8");
const SETUP_SRC = stripComments(RAW_SETUP_SRC);
const RAW_TEARDOWN_SRC = readFileSync(resolve(UI_ROOT, "e2e", "global-teardown.ts"), "utf-8");
const TEARDOWN_SRC = stripComments(RAW_TEARDOWN_SRC);
const RAW_PRODUCER_SRC = readFileSync(
  resolve(UI_ROOT, "e2e", "helpers", "appliance-fixture.ts"),
  "utf-8"
);
const PRODUCER_SRC = stripComments(RAW_PRODUCER_SRC);
const COMPOSE_SRC = readFileSync(resolve(UI_ROOT, "e2e", "docker-compose.e2e.yml"), "utf-8");

describe("global-setup.ts source — released-appliance orchestration", () => {
  it("imports the dynamic-mode helpers from the fixture loader", () => {
    expect(SETUP_SRC).toMatch(
      /import\s*\{[\s\S]*?isDynamicFixtureModeRequested[\s\S]*?\}\s*from\s+["']\.\/helpers\/fixture["']/
    );
    expect(SETUP_SRC).toMatch(/resolveFixturePath/);
    expect(SETUP_SRC).toMatch(/fixtureDirectory/);
  });

  it("imports the released-API producer helpers (no CLI producer)", () => {
    expect(SETUP_SRC).toMatch(
      /import\s*\{[\s\S]*?buildFixtureEnvelope[\s\S]*?\}\s*from\s+["']\.\/helpers\/appliance-fixture["']/
    );
    expect(SETUP_SRC).toMatch(/composeCommand/);
    expect(SETUP_SRC).toMatch(/readSetupCode/);
    expect(SETUP_SRC).toMatch(/totpLoginWorks/);
  });

  it("gates dynamic-mode work behind isDynamicFixtureModeRequested()", () => {
    expect(SETUP_SRC).toMatch(/if\s*\(\s*isDynamicFixtureModeRequested\s*\(\s*\)\s*\)/);
  });

  it("targets the correct IDP compose service name (identuum-idp-oss, never the retired monolith)", () => {
    expect(SETUP_SRC).toMatch(/IDP_SERVICE\s*=\s*["']identuum-idp-oss["']/);
    expect(SETUP_SRC).not.toMatch(/["']identuum-idp["']/);
  });

  it("REUSES a still-valid envelope: existence + health + a site_admin TOTP login probe before any rebuild", () => {
    expect(SETUP_SRC).toMatch(/fs\.existsSync\(fixturePath\)/);
    expect(SETUP_SRC).toMatch(/idpHealthy\s*\(\s*\)/);
    expect(SETUP_SRC).toMatch(/totpLoginWorks\s*\(/);
  });

  it("rebuild path recreates a FRESH appliance with down THEN up -d (volume-less DB, never -v)", () => {
    expect(SETUP_SRC).toMatch(/\[\s*\.\.\.pre,\s*["']down["']\s*\]/);
    expect(SETUP_SRC).toMatch(/\[\s*\.\.\.pre,\s*["']up["'],\s*["']-d["']\s*\]/);
  });

  it("writes the envelope with restrictive mode 0600", () => {
    expect(SETUP_SRC).toMatch(/mode:\s*0o600/);
  });

  it("mints a 12-lowercase-hex run id", () => {
    expect(SETUP_SRC).toMatch(/for\s*\(let i = 0; i < 12; i\+\+\)/);
    expect(SETUP_SRC).toMatch(/0123456789abcdef/);
  });

  it("never console.logs the envelope (the only sink is the 0600 file write)", () => {
    expect(SETUP_SRC).not.toMatch(/console\.log\([^)]*envelope/i);
    expect(SETUP_SRC).not.toMatch(/JSON\.stringify\(envelope[^)]*\)[\s\S]{0,40}console/);
  });

  it("uses execFileSync with an argument array (no shell expansion)", () => {
    expect(SETUP_SRC).toMatch(/execFileSync\(prog,\s*\[/);
    expect(SETUP_SRC).not.toMatch(/execSync\(/);
  });
});

describe("appliance-fixture.ts source — released-API producer", () => {
  it("auto-detects Docker Compose v2 with a v1 fallback", () => {
    expect(PRODUCER_SRC).toMatch(
      /\[\s*["']docker["'],\s*\[\s*["']compose["'],\s*["']version["']\s*\]\s*\]/
    );
    expect(PRODUCER_SRC).toMatch(/\[\s*["']docker-compose["'],\s*\[\s*["']version["']\s*\]\s*\]/);
  });

  it("reads the setup code by exec'ing the RELEASED binary path with -T (no TTY)", () => {
    expect(PRODUCER_SRC).toMatch(/["']exec["'],\s*["']-T["']/);
    expect(PRODUCER_SRC).toMatch(/\/app\/identuum-idp/);
    expect(PRODUCER_SRC).toMatch(/show-setup-code/);
  });

  it("uses execFileSync with argument arrays (no shell expansion, no execSync)", () => {
    expect(PRODUCER_SRC).toMatch(/execFileSync\(/);
    expect(PRODUCER_SRC).not.toMatch(/execSync\(/);
  });

  it("creates the org ACTIVE with a required MFA policy (all three credential types TOTP-enrol)", () => {
    expect(PRODUCER_SRC).toMatch(/active:\s*true/);
    expect(PRODUCER_SRC).toMatch(/mfa_policy:\s*["']required["']/);
  });

  it("passwords are transparent not-a-secret placeholders", () => {
    expect(PRODUCER_SRC).toMatch(/not-a-secret/);
  });

  it("seeds the sample + confidential clients under the reserved names", () => {
    expect(PRODUCER_SRC).toMatch(/E2E Sample Application \$\{runId\}/);
    expect(PRODUCER_SRC).toMatch(/E2E Confidential Application \$\{runId\}/);
  });

  it("the envelope carries NO client/resource secret fields (one-time secrets are discarded)", () => {
    expect(PRODUCER_SRC).not.toMatch(/client_secret\s*:/);
    expect(PRODUCER_SRC).not.toMatch(/resource_secret\s*:/);
  });

  it("never console.logs at all (progress lines go to process.stdout, non-secret)", () => {
    expect(PRODUCER_SRC).not.toMatch(/console\.log\(/);
  });
});

describe("global-teardown.ts source — no-trace default", () => {
  it("default path tears the appliance down (down, NEVER -v) and removes the envelope", () => {
    expect(TEARDOWN_SRC).toMatch(/\[\s*\.\.\.pre,\s*["']down["']\s*\]/);
    expect(TEARDOWN_SRC).toMatch(/removeLocalFixtureFiles/);
  });

  it("keep-appliance reuse is an explicit opt-in env flag", () => {
    expect(TEARDOWN_SRC).toMatch(/IDENTUUM_E2E_KEEP_APPLIANCE/);
  });

  it("still writes the RUN_END_FILE timestamp for inter-run recovery pacing", () => {
    expect(TEARDOWN_SRC).toMatch(/RUN_END_FILE/);
    expect(TEARDOWN_SRC).toMatch(/endMs/);
  });

  it("never reads the fixture JSON credentials (compose lifecycle + file removal only)", () => {
    expect(TEARDOWN_SRC).not.toMatch(/readFileSync[^\n]*fixture/i);
    expect(TEARDOWN_SRC).not.toMatch(/JSON\.parse/);
  });
});

describe("docker-compose.e2e.yml — released appliance stack", () => {
  it("runs the PUBLISHED identuum-idp-oss image", () => {
    expect(COMPOSE_SRC).toMatch(/image:\s*ghcr\.io\/identuum\/identuum-idp-oss:/);
  });

  it("the Postgres service is volume-less by design (fresh DB via plain down)", () => {
    expect(COMPOSE_SRC).not.toMatch(/^\s*volumes:/m);
  });

  it("the WebAuthn UI origin follows the suite's authoritative baseURL via env interpolation", () => {
    expect(COMPOSE_SRC).toMatch(/IDENTUUM_IDP_UI_PUBLIC_BASE_URL:\s*"\$\{IDENTUUM_E2E_UI_ORIGIN/);
  });

  it("relaxes the per-IP rate limits via the image's documented env knobs (enforcement stays on)", () => {
    expect(COMPOSE_SRC).toMatch(/IDENTUUM_IDP_RATE_LIMIT_LOGIN_REQUESTS/);
    expect(COMPOSE_SRC).toMatch(/IDENTUUM_IDP_RATE_LIMIT_REGISTER_REQUESTS/);
  });
});

describe("negative sentries — the pre-split monolith contract stays dead", () => {
  // The compose header's PROSE deliberately names the banned patterns
  // ("WITHOUT docker compose down -v", "no /app/identuum probe") — strip
  // YAML comments so documentation cannot trip the code sentries.
  const COMPOSE_CODE = COMPOSE_SRC.replace(/^\s*#.*$/gm, "");
  const ALL = SETUP_SRC + PRODUCER_SRC + TEARDOWN_SRC + COMPOSE_CODE;

  it("no `down -v` / volume destruction anywhere in the orchestration", () => {
    expect(ALL).not.toMatch(/down["'\s,\]]*-v/);
    expect(ALL).not.toMatch(/docker\s+volume\s+rm/);
  });

  it("no bare /app/identuum monolith binary (the released binary is /app/identuum-idp)", () => {
    expect(ALL).not.toMatch(/\/app\/identuum(?!-idp)/);
  });

  it("no /e2e-auth bind-mount contract", () => {
    expect(ALL).not.toMatch(/\/e2e-auth/);
  });

  it("no monolith fixture CLI flags", () => {
    expect(ALL).not.toMatch(/--e2e-create-org-admin-fixture/);
    expect(ALL).not.toMatch(/--e2e-purge-org-fixture/);
    expect(ALL).not.toMatch(/--confirm-e2e-purge/);
  });

  it("no insecure-mode bypass flags", () => {
    expect(ALL).not.toMatch(/INSECURE_MFA_BYPASS/);
    expect(ALL).not.toMatch(/IDENTUUM_E2E_FIXTURE_CLI_ENABLED/);
  });

  it("no machine-specific absolute paths", () => {
    expect(ALL).not.toMatch(/\/Users\/[a-z]/);
  });
});
