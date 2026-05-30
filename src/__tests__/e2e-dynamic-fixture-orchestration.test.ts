/**
 * Source-text invariant tests for the dynamic Playwright fixture
 * orchestration in e2e/global-setup.ts + e2e/global-teardown.ts and the
 * compose bind mount in identuum-idp/deployment/docker-compose.local.yml.
 *
 * Why source-text rather than runtime tests:
 *   - The orchestration shells out to `docker compose exec` against the
 *     IDP container. Running it from Vitest would require a live Docker
 *     daemon AND a rebuilt IDP container, which is the wrong layer to
 *     gate the suite on. The actual orchestration is exercised by an
 *     opt-in Playwright run (`IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true npx
 *     playwright test e2e/org-admin-smoke.spec.ts --workers=1`).
 *   - These tests pin every load-bearing source invariant (dynamic-mode
 *     gate, container-side path, --confirm-e2e-purge flag, RUN_END_FILE
 *     preservation, no-console.log-of-JSON) so a regression in the
 *     orchestration code can be caught without standing up the whole
 *     stack.
 *
 * SECURITY:
 *   - Synthetic test inputs use only neutral placeholders.
 *   - The intentional negative-invariant blocklist patterns (audi /
 *     password / Bearer / Set-Cookie / etc.) are documented as
 *     regression sentries, not actual values.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(__dirname, "..", "..");
const IDP_COMPOSE_FILE = resolve(
  UI_ROOT,
  "..",
  "identuum-idp",
  "deployment",
  "docker-compose.local.yml"
);

function stripComments(src: string): string {
  // Strip /* … */ and single-line // comments so security-rule prose
  // does not trip the no-console.log / no-credential invariants.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("global-setup.ts source — dynamic-mode orchestration", () => {
  const RAW_SETUP_SRC = readFileSync(
    resolve(UI_ROOT, "e2e", "global-setup.ts"),
    "utf-8"
  );
  const SETUP_SRC = stripComments(RAW_SETUP_SRC);

  it("imports the dynamic-mode helpers from the fixture loader", () => {
    expect(SETUP_SRC).toMatch(
      /import\s*\{[\s\S]*?isDynamicFixtureModeRequested[\s\S]*?\}\s*from\s+["']\.\/helpers\/fixture["']/
    );
    expect(SETUP_SRC).toMatch(/resolveFixturePath/);
    expect(SETUP_SRC).toMatch(/fixtureDirectory/);
  });

  it("gates dynamic-mode work behind isDynamicFixtureModeRequested()", () => {
    expect(SETUP_SRC).toMatch(/if\s*\(\s*isDynamicFixtureModeRequested\s*\(\s*\)\s*\)/);
  });

  it("invokes the IDP create CLI with the container-side /e2e-auth output path", () => {
    expect(SETUP_SRC).toMatch(/--e2e-create-org-admin-fixture/);
    expect(SETUP_SRC).toMatch(/IDP_CONTAINER_FIXTURE_PATH/);
    expect(SETUP_SRC).toMatch(/\/e2e-auth\/e2e-org-admin-fixture\.json/);
  });

  it("targets the correct IDP compose service name", () => {
    expect(SETUP_SRC).toMatch(/identuum-idp/);
    expect(SETUP_SRC).toMatch(/\/app\/identuum/);
  });

  it("uses docker compose exec -T (no TTY) so the CLI never blocks on input", () => {
    expect(SETUP_SRC).toMatch(/"exec"/);
    expect(SETUP_SRC).toMatch(/"-T"/);
  });

  it("uses execFileSync with an argument array (no shell expansion)", () => {
    // A regression that switched to execSync with a shell-interpolated
    // string could allow path injection via env vars.
    expect(SETUP_SRC).toMatch(/execFileSync\s*\(\s*["']docker["']/);
    expect(SETUP_SRC).not.toMatch(/execSync\b/);
  });

  it("captures stdio: inherit so the IDP CLI's non-secret stderr reaches the operator", () => {
    expect(SETUP_SRC).toMatch(/stdio:\s*\[\s*["']ignore["'],\s*["']inherit["'],\s*["']inherit["']\s*\]/);
  });

  it("creates the host fixture directory with mode 0700", () => {
    expect(SETUP_SRC).toMatch(/mkdirSync\s*\([^)]*0o700/);
  });

  it("attempts to purge a stale fixture file before creating a new one", () => {
    expect(SETUP_SRC).toMatch(/stale fixture file/);
    expect(SETUP_SRC).toMatch(/runIDPPurgeFixture/);
  });

  it("fails fast (throws) when the IDP CLI fails — does NOT silently fall back to durable env mode", () => {
    expect(SETUP_SRC).toMatch(/throw new Error/);
    expect(SETUP_SRC).toMatch(/IDP --e2e-create-org-admin-fixture failed/);
  });

  it("preserves the existing runtime-config validator path verbatim", () => {
    // The MINIMAL_E2E_CONFIG / RUN_END_FILE / IDENTUUM_UI_CONFIG_FILE
    // logic must remain untouched.
    expect(SETUP_SRC).toMatch(/MINIMAL_E2E_CONFIG/);
    expect(SETUP_SRC).toMatch(/RUN_END_FILE/);
    expect(SETUP_SRC).toMatch(/IDENTUUM_UI_CONFIG_FILE/);
  });
});

// ── Dynamic-fixture preflight ───────────────────────────────────────────────

describe("global-setup.ts — dynamic-fixture preflight diagnostics", () => {
  const RAW_SETUP_SRC = readFileSync(
    resolve(UI_ROOT, "e2e", "global-setup.ts"),
    "utf-8"
  );
  const SETUP_SRC = stripComments(RAW_SETUP_SRC);

  it("declares runDynamicFixturePreflight and invokes it before runIDPCreateFixture", () => {
    // The preflight function must exist…
    expect(SETUP_SRC).toMatch(/function\s+runDynamicFixturePreflight\s*\(/);
    // …and it must be called BEFORE the create call inside the orchestration.
    const orchestrationBody = SETUP_SRC.match(
      /async\s+function\s+orchestrateDynamicFixtureCreate[\s\S]*?\n\}/
    )?.[0];
    expect(orchestrationBody).toBeTruthy();
    const preflightIdx = orchestrationBody?.indexOf("runDynamicFixturePreflight(") ?? -1;
    const createIdx = orchestrationBody?.indexOf("runIDPCreateFixture(") ?? -1;
    expect(preflightIdx, "preflight call must be present in orchestration").toBeGreaterThan(-1);
    expect(createIdx, "create call must be present in orchestration").toBeGreaterThan(-1);
    expect(preflightIdx, "preflight must precede create").toBeLessThan(createIdx);
  });

  it("checks /app/identuum exists in the IDP container", () => {
    expect(SETUP_SRC).toMatch(/"test",\s*"-x",\s*"\/app\/identuum"/);
    expect(SETUP_SRC).toMatch(/\/app\/identuum was not found in the IDP container/);
  });

  it("checks /e2e-auth exists in the IDP container", () => {
    expect(SETUP_SRC).toMatch(/"test",\s*"-d",\s*"\/e2e-auth"/);
    expect(SETUP_SRC).toMatch(/\/e2e-auth is not mounted in the IDP container/);
  });

  it("checks /e2e-auth is writable in the IDP container", () => {
    expect(SETUP_SRC).toMatch(/"test",\s*"-w",\s*"\/e2e-auth"/);
    expect(SETUP_SRC).toMatch(/is not writable/);
  });

  it("checks IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true via shell test (no value print)", () => {
    expect(SETUP_SRC).toMatch(
      /test\s+"\$IDENTUUM_E2E_FIXTURE_CLI_ENABLED"\s*=\s*"true"/
    );
    expect(SETUP_SRC).toMatch(
      /IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true is not present/
    );
  });

  it("checks the local insecure gate (IDENTUUM_IDP_INSECURE_DEV_MODE or INSECURE_MFA_BYPASS)", () => {
    expect(SETUP_SRC).toMatch(
      /test\s+"\$IDENTUUM_IDP_INSECURE_DEV_MODE"\s*=\s*"true"/
    );
    expect(SETUP_SRC).toMatch(
      /test\s+"\$IDENTUUM_IDP_INSECURE_MFA_BYPASS"\s*=\s*"true"/
    );
    expect(SETUP_SRC).toMatch(/neither IDENTUUM_IDP_INSECURE_DEV_MODE=true nor IDENTUUM_IDP_INSECURE_MFA_BYPASS=true/);
  });

  it("runs a bind-mount probe (container touch → host existsSync)", () => {
    // The probe name MUST be derived from Date.now() so concurrent runs
    // do not collide on the same path.
    expect(SETUP_SRC).toMatch(/Date\.now\(\)/);
    // touch is invoked with execFileSync via dockerExec — the probe path
    // MUST go through /e2e-auth so the bind-mount round-trip is exercised.
    expect(SETUP_SRC).toMatch(/"touch",\s*probeContainerPath/);
    expect(SETUP_SRC).toMatch(/probeContainerPath\s*=\s*`\/e2e-auth\//);
    // The host check must use fs.existsSync against the probe's host path.
    expect(SETUP_SRC).toMatch(/fs\.existsSync\s*\(\s*probeHostPath\s*\)/);
    expect(SETUP_SRC).toMatch(
      /\/e2e-auth is not connected to the UI e2e\/\.auth directory/
    );
  });

  it("cleans up the probe file via finally block (both host and container side)", () => {
    // The cleanup MUST run unconditionally, hence the `finally` block.
    const preflightBody = SETUP_SRC.match(
      /function\s+runDynamicFixturePreflight[\s\S]*?\n\}/
    )?.[0];
    expect(preflightBody).toBeTruthy();
    expect(preflightBody).toMatch(/finally\s*\{/);
    expect(preflightBody).toMatch(/fs\.rmSync\s*\(\s*probeHostPath/);
    expect(preflightBody).toMatch(/"rm",\s*"-f",\s*probeContainerPath/);
  });

  it("uses execFileSync (arg array), never execSync (shell string)", () => {
    // Every preflight shell-out must go through execFileSync via the
    // dockerExec helper. A regression that switched to execSync with
    // interpolated arguments would be caught here.
    expect(SETUP_SRC).toMatch(/execFileSync\s*\(/);
    expect(SETUP_SRC).not.toMatch(/\bexecSync\b/);
  });

  it("dockerExec helper closes stdin and pipes stdout (no env-dump leak)", () => {
    // `stdio: ["ignore", "pipe", "inherit"]` means: discard stdin,
    // capture stdout for the test-command exit code check, and inherit
    // stderr so the operator sees IDP-side warnings if anything goes
    // wrong. A regression that switched the capture to "inherit" would
    // leak the IDP's full env block to operator stdout when test commands
    // accidentally produced output.
    expect(SETUP_SRC).toMatch(
      /stdio:\s*\[\s*["']ignore["'],\s*["']pipe["'],\s*["']inherit["']\s*\]/
    );
  });

  it("preflight diagnostic messages name only non-secret variable names + fix commands", () => {
    // Every Error message in the preflight body must point at a fix
    // command (`make local-restart` is the canonical fix) and must NOT
    // interpolate any env value via `${process.env.…}` or `${IDP_…}`.
    const preflightBody = SETUP_SRC.match(
      /function\s+runDynamicFixturePreflight[\s\S]*?\n\}/
    )?.[0] ?? "";
    expect(preflightBody).toMatch(/make local-restart/);
    // No env-value interpolation in any Error message produced by the
    // preflight.
    expect(preflightBody).not.toMatch(/\$\{\s*process\.env\./);
    expect(preflightBody).not.toMatch(
      /\$\{\s*IDENTUUM_E2E_FIXTURE_CLI_ENABLED/
    );
    expect(preflightBody).not.toMatch(
      /\$\{\s*IDENTUUM_IDP_INSECURE_DEV_MODE/
    );
  });

  it("preflight does not console.log fixture JSON or credentials", () => {
    const preflightBody = SETUP_SRC.match(
      /function\s+runDynamicFixturePreflight[\s\S]*?\n\}/
    )?.[0] ?? "";
    expect(preflightBody).not.toMatch(/console\.log/);
    expect(preflightBody).not.toMatch(/console\.error/);
    // The preflight may use process.stdout.write for non-secret status —
    // the helper's two status lines ("running preflight diagnostics..."
    // and "preflight passed.") are the only writes allowed.
    const writeMatches = preflightBody.match(/process\.stdout\.write\s*\(/g) ?? [];
    expect(writeMatches.length).toBeLessThanOrEqual(2);
  });

  it("dockerExec helper does NOT print full container env (never invokes `env`/`printenv` without a variable name)", () => {
    // A regression that invoked `env` or `printenv` with no args would
    // dump every env var (including the unsuffixed `IDENTUUM_*` set) to
    // the operator's stdout — a leak vector for any future env addition.
    const preflightBody = SETUP_SRC.match(
      /function\s+runDynamicFixturePreflight[\s\S]*?\n\}/
    )?.[0] ?? "";
    // Bare `env` or `printenv` with no following identifier argument.
    expect(preflightBody).not.toMatch(/"env"\s*\]/);
    expect(preflightBody).not.toMatch(/"printenv"\s*\]/);
  });
});

describe("global-setup.ts source — security invariants", () => {
  const RAW_SETUP_SRC = readFileSync(
    resolve(UI_ROOT, "e2e", "global-setup.ts"),
    "utf-8"
  );
  const SETUP_SRC = stripComments(RAW_SETUP_SRC);

  it("contains no console.log of fixture JSON or secrets", () => {
    // console.log of arbitrary values is allowed (config status); the
    // assertion is that no console.log call references the fixture
    // payload or any credential-bearing identifier.
    const blocklist = [
      /console\.log\([^)]*fixture[^)]*\.password/i,
      /console\.log\([^)]*fixture[^)]*\.totp/i,
      /console\.log\([^)]*JSON\.stringify\s*\(\s*[^)]*fixture/i,
      /console\.log\([^)]*\bpassword\b[^)]*\)/i,
      /console\.log\([^)]*totp_secret/i,
    ];
    for (const pat of blocklist) {
      expect(SETUP_SRC).not.toMatch(pat);
    }
  });

  it("never reads the fixture file contents directly (no readFileSync of the fixture path)", () => {
    // The IDP CLI writes; the fixture loader reads. globalSetup must NOT
    // bypass the loader by reading the JSON itself.
    expect(SETUP_SRC).not.toMatch(/readFileSync\s*\(\s*hostFixturePath/);
    expect(SETUP_SRC).not.toMatch(/readFileSync\s*\(\s*resolveFixturePath/);
  });

  it("contains no real customer/fixture identifier", () => {
    expect(SETUP_SRC).not.toMatch(/\baudi\b/i);
    expect(SETUP_SRC).not.toMatch(/admin@audi/i);
  });

  it("contains no inlined credential-material literal", () => {
    const blocklist = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
    ];
    for (const pat of blocklist) {
      expect(SETUP_SRC).not.toMatch(pat);
    }
  });
});

describe("global-teardown.ts source — dynamic-mode purge orchestration", () => {
  const RAW_TEARDOWN_SRC = readFileSync(
    resolve(UI_ROOT, "e2e", "global-teardown.ts"),
    "utf-8"
  );
  const TEARDOWN_SRC = stripComments(RAW_TEARDOWN_SRC);

  it("imports the dynamic-mode helpers from the fixture loader", () => {
    expect(TEARDOWN_SRC).toMatch(
      /import\s*\{[\s\S]*?isDynamicFixtureModeRequested[\s\S]*?\}\s*from\s+["']\.\/helpers\/fixture["']/
    );
    expect(TEARDOWN_SRC).toMatch(/resolveFixturePath/);
  });

  it("gates dynamic-mode work behind isDynamicFixtureModeRequested()", () => {
    expect(TEARDOWN_SRC).toMatch(/if\s*\(\s*isDynamicFixtureModeRequested\s*\(\s*\)\s*\)/);
  });

  it("invokes --e2e-purge-org-fixture with --confirm-e2e-purge", () => {
    expect(TEARDOWN_SRC).toMatch(/--e2e-purge-org-fixture/);
    expect(TEARDOWN_SRC).toMatch(/--confirm-e2e-purge/);
  });

  it("targets the same container-side fixture path the IDP CLI was created with", () => {
    expect(TEARDOWN_SRC).toMatch(/\/e2e-auth\/e2e-org-admin-fixture\.json/);
  });

  it("preserves RUN_END_FILE bookkeeping unconditionally (runs after dynamic-mode purge)", () => {
    // Even if dynamic-mode purge is skipped or fails, the RUN_END_FILE
    // write MUST still execute so the next run honors the inter-run
    // recovery gap.
    expect(TEARDOWN_SRC).toMatch(/RUN_END_FILE/);
    expect(TEARDOWN_SRC).toMatch(/writeFileSync\s*\(\s*RUN_END_FILE/);
  });

  it("leaves the host fixture file in place when purge fails", () => {
    expect(TEARDOWN_SRC).toMatch(/leaving host fixture file in place/);
  });

  it("prints the manual purge command on failure for operator recovery", () => {
    expect(TEARDOWN_SRC).toMatch(/--e2e-purge-org-fixture --fixture-file/);
  });

  it("uses execFileSync with arg array (no shell expansion)", () => {
    expect(TEARDOWN_SRC).toMatch(/execFileSync\s*\(\s*["']docker["']/);
    expect(TEARDOWN_SRC).not.toMatch(/execSync\b/);
  });

  it("contains no real customer/fixture identifier", () => {
    expect(TEARDOWN_SRC).not.toMatch(/\baudi\b/i);
    expect(TEARDOWN_SRC).not.toMatch(/admin@audi/i);
  });

  it("contains no inlined credential-material literal", () => {
    const blocklist = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
    ];
    for (const pat of blocklist) {
      expect(TEARDOWN_SRC).not.toMatch(pat);
    }
  });
});

describe("docker-compose.local.yml — local-only E2E fixture bind mount", () => {
  const COMPOSE_SRC = readFileSync(IDP_COMPOSE_FILE, "utf-8");

  it("exposes the host UI .auth directory as /e2e-auth on the IDP service", () => {
    // The relative path is ../../identuum-ui/e2e/.auth because Docker
    // compose resolves bind-mount sources relative to the compose file
    // directory (identuum-idp/deployment/), not the workspace root.
    expect(COMPOSE_SRC).toMatch(
      /\$\{IDENTUUM_UI_E2E_AUTH_DIR:-\.\.\/\.\.\/identuum-ui\/e2e\/\.auth\}:\/e2e-auth:rw/
    );
  });

  it("sets IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true on the IDP service", () => {
    expect(COMPOSE_SRC).toMatch(/IDENTUUM_E2E_FIXTURE_CLI_ENABLED:\s*"true"/);
  });

  it("already sets IDENTUUM_IDP_INSECURE_DEV_MODE=true (required IDP gate)", () => {
    expect(COMPOSE_SRC).toMatch(/IDENTUUM_IDP_INSECURE_DEV_MODE:\s*"true"/);
  });

  it("scopes the bind mount comment to local/E2E only", () => {
    expect(COMPOSE_SRC).toMatch(/E2E fixture exchange directory/i);
    expect(COMPOSE_SRC).toMatch(/Local-only/i);
  });

  it("does NOT add the bind mount to any non-local section (paranoia)", () => {
    // The bind mount must not appear anywhere else in this file. Catches a
    // future refactor that accidentally duplicated it under another service.
    const matches = COMPOSE_SRC.match(/:\/e2e-auth/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe(".gitignore — e2e/.auth/ remains excluded", () => {
  const GITIGNORE_SRC = readFileSync(resolve(UI_ROOT, ".gitignore"), "utf-8");

  it("excludes e2e/.auth/ so the fixture JSON is never committed", () => {
    expect(GITIGNORE_SRC).toMatch(/^e2e\/\.auth\/?$/m);
  });
});
