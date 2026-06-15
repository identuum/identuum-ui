import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  fixtureDirectory,
  isDynamicFixtureModeRequested,
  resolveFixturePath,
} from "./helpers/fixture";

/**
 * Playwright global setup — runs once before any test or webServer starts.
 *
 * Responsibilities:
 *   1. Locate config/ui-runtime.json (respects IDENTUUM_UI_CONFIG_FILE env var).
 *   2. If missing: write a minimal no-secrets config so the environment is
 *      explicit rather than silently degraded.
 *   3. If present: parse and validate it, failing loudly on corrupt/unconfigured state.
 *
 * The minimal config written here contains only localhost URLs — no secrets.
 * Safe-state E2E tests (/claim, /verify-email) degrade gracefully when the IdP
 * is unreachable, so they pass under this config.
 * The login test requires the full Compose stack (real IdP at localhost:7113)
 * and credentials (IDENTUUM_TEST_SITE_ADMIN_PASSWORD + _TOTP_SECRET).
 */

// Minimal runtime config written when none exists.
// Mirrors the shape expected by src/lib/runtime-config.ts.
// No internal_base_url: in non-Docker environments the Docker service name
// (identuum-idp) does not resolve; omitting it lets idpBaseUrl() fall back
// to public_base_url, which is also unreachable without Compose but fails
// safely via caught fetch errors in server actions.
const MINIMAL_E2E_CONFIG = {
  configured: true,
  ui_origin: "http://localhost:7104",
  idp: { enabled: true, public_base_url: "http://localhost:7113" },
  ag: { enabled: false, public_base_url: "" },
};

const RUN_END_FILE = "/tmp/identuum-run-end.json";
// 5s is a minimal breathing gap between test runs.
// When the IdP container runs with E2E_DISABLE_ADAPTIVE_ENFORCEMENT=true
// (see identuum-idp/deployment/docker-compose.local.yml), no velocity counter
// accumulates and no step-up enforcement fires, so no large gap is needed.
// The 5s gap lets in-flight server responses drain before the next run starts.
const INTER_RUN_RECOVERY_MS = 5_000;

export default async function globalSetup() {
  // Enforce a minimum gap between test runs to allow Docker containers to stabilize.
  // Without this, back-to-back runs cause transient Docker DNS/connection failures.
  try {
    const data = JSON.parse(fs.readFileSync(RUN_END_FILE, "utf-8")) as { endMs: number };
    const elapsed = Date.now() - data.endMs;
    if (elapsed < INTER_RUN_RECOVERY_MS) {
      const waitMs = INTER_RUN_RECOVERY_MS - elapsed;
      process.stdout.write(
        `\n[e2e setup] Waiting ${Math.ceil(waitMs / 1000)}s for server recovery between runs...\n`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  } catch {
    // No previous run recorded — start immediately
  }

  const configFile =
    process.env.IDENTUUM_UI_CONFIG_FILE ?? path.join(process.cwd(), "config", "ui-runtime.json");

  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(MINIMAL_E2E_CONFIG, null, 2)}\n`, "utf-8");
    console.log("\n[e2e setup] config/ui-runtime.json was missing — wrote minimal config.");
    console.log(`[e2e setup]   path : ${configFile}`);
    console.log(
      `[e2e setup]   IdP  : ${MINIMAL_E2E_CONFIG.idp.public_base_url} (not required to be running)`
    );
    console.log(
      "[e2e setup] Safe-state tests will pass. Login test needs the full Compose stack.\n"
    );
    return;
  }

  // Config exists — parse and validate.
  // biome-ignore lint/suspicious/noExplicitAny: intentional loose parse of unknown JSON shape
  let cfg: any;
  try {
    cfg = JSON.parse(fs.readFileSync(configFile, "utf-8"));
  } catch {
    throw new Error(
      `[e2e setup] ${configFile} is not valid JSON.\nFix the file or delete it — global setup will write a minimal E2E config on the next run.`
    );
  }
  if (!cfg.configured) {
    throw new Error(
      `[e2e setup] ${configFile} has configured=false.\nRun the UI setup wizard, or delete the file so global setup writes a minimal E2E config.`
    );
  }

  const idpTag = cfg.idp?.enabled ? `enabled (${cfg.idp.public_base_url ?? "no URL"})` : "disabled";
  console.log(`\n[e2e setup] runtime config OK — IdP: ${idpTag}\n`);

  // ── Dynamic org-admin fixture orchestration ────────────────────────────────
  // Opt-in via IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true. When unset, this block is
  // a no-op and the durable env-vars mode (or absent-fixture skip) is preserved.
  if (isDynamicFixtureModeRequested()) {
    await orchestrateDynamicFixtureCreate();
  }
}

// ── Dynamic-mode fixture orchestration helpers ───────────────────────────────
//
// SECURITY: this code shells out to the IDP container's CLI but NEVER passes
// secrets on the command line, NEVER reads the fixture JSON contents, and
// NEVER logs anything beyond non-secret status (run progress, refusal reason
// strings, paths). The fixture material lives only inside the JSON file the
// IDP writes; the file's mode is 0600.

const IDP_COMPOSE_FILE =
  "/Users/odemir/Development/2025-11/identuum/identuum-idp/deployment/docker-compose.local.yml";
const IDP_SERVICE_NAME = "identuum-idp";
const IDP_CONTAINER_FIXTURE_PATH = "/e2e-auth/e2e-org-admin-fixture.json";

async function orchestrateDynamicFixtureCreate(): Promise<void> {
  const hostFixturePath = resolveFixturePath();
  const hostFixtureDir = fixtureDirectory();

  // Ensure the host-side fixture directory exists with restrictive mode.
  // The compose bind mount maps this directory into the IDP container at
  // /e2e-auth; the IDP CLI writes the JSON there.
  try {
    fs.mkdirSync(hostFixtureDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(hostFixtureDir, 0o700);
    } catch {
      // chmod failures are non-fatal on bind-mount-backed paths on some
      // platforms (macOS Docker Desktop); the directory is still gitignored
      // and not a security boundary by itself.
    }
  } catch (err) {
    throw new Error(
      `[e2e setup] dynamic mode: failed to create host fixture directory ${hostFixtureDir}: ${(err as Error).message}`
    );
  }

  // Run the dynamic-fixture preflight BEFORE attempting create. Each check
  // throws with a clear non-secret message naming the exact fix step.
  runDynamicFixturePreflight(hostFixtureDir);

  // If a stale host fixture file is present, attempt to purge it via the IDP
  // CLI before re-creating. If purge fails we fail closed rather than silently
  // overwriting — a stale fixture may reference a real DB row the operator
  // needs to clean up first.
  if (fs.existsSync(hostFixturePath)) {
    process.stdout.write(
      "[e2e setup] dynamic mode: stale fixture file present — attempting purge before re-create.\n"
    );
    try {
      runIDPPurgeFixture();
    } catch (err) {
      throw new Error(
        `[e2e setup] dynamic mode: stale fixture file at ${hostFixturePath} could not be purged. ` +
          `Inspect the DB and remove manually with --e2e-purge-org-fixture. Underlying error: ${(err as Error).message}`
      );
    }
    // Belt-and-suspenders: if purge succeeded but the host file still exists,
    // remove it before recreating to avoid the IDP refusing on output-exists.
    if (fs.existsSync(hostFixturePath)) {
      try {
        fs.rmSync(hostFixturePath, { force: true });
      } catch (err) {
        throw new Error(
          `[e2e setup] dynamic mode: could not remove stale fixture file ${hostFixturePath}: ${(err as Error).message}`
        );
      }
    }
  }

  process.stdout.write("[e2e setup] dynamic mode: creating disposable org-admin fixture...\n");
  try {
    runIDPCreateFixture();
  } catch (err) {
    throw new Error(
      `[e2e setup] dynamic mode: IDP --e2e-create-org-admin-fixture failed. Ensure the IDP container is rebuilt with the new CLI/migration (make local-restart from identuum-idp) and that the compose env has IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true + IDENTUUM_IDP_INSECURE_DEV_MODE=true. Underlying error: ${(err as Error).message}`
    );
  }

  if (!fs.existsSync(hostFixturePath)) {
    throw new Error(
      `[e2e setup] dynamic mode: IDP CLI reported success but ${hostFixturePath} is missing. Verify the compose bind mount of ../identuum-ui/e2e/.auth into /e2e-auth is in place and the IDP container was restarted after the compose change.`
    );
  }
  process.stdout.write("[e2e setup] dynamic mode: fixture created.\n");
}

/**
 * Shells out to the IDP container to run --e2e-create-org-admin-fixture.
 * Uses execFileSync with an arg array (no shell expansion) so paths/args
 * cannot be injected. Inherits stderr so non-secret refusal reasons reach
 * the operator; explicitly discards stdout via `stdio: ["ignore", "inherit",
 * "inherit"]` so the IDP CLI's non-secret summary is visible but no JSON is
 * captured into a buffer this code might accidentally log.
 */
function runIDPCreateFixture(): void {
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      IDP_COMPOSE_FILE,
      "exec",
      "-T",
      IDP_SERVICE_NAME,
      "/app/identuum",
      "--e2e-create-org-admin-fixture",
      "--output",
      IDP_CONTAINER_FIXTURE_PATH,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
}

/**
 * Shells out to the IDP container to run --e2e-purge-org-fixture against
 * the fixture file currently at IDP_CONTAINER_FIXTURE_PATH. The IDP CLI
 * itself requires --confirm-e2e-purge AND validates the marker column in
 * SQL; this orchestration just passes the documented flag.
 */
function runIDPPurgeFixture(): void {
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      IDP_COMPOSE_FILE,
      "exec",
      "-T",
      IDP_SERVICE_NAME,
      "/app/identuum",
      "--e2e-purge-org-fixture",
      "--fixture-file",
      IDP_CONTAINER_FIXTURE_PATH,
      "--confirm-e2e-purge",
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
}

// ── Dynamic-fixture preflight ────────────────────────────────────────────────
//
// Runs once before the IDP CLI create call to give the operator a precise
// non-secret diagnosis when the local stack drifts out of sync with the
// orchestration code (e.g. forgotten `make local-restart` after pulling a
// new compose file, missing bind mount, missing env gate).
//
// SECURITY:
//   - Every shell-out uses execFileSync with an arg array. No env value or
//     filename is interpolated into a shell command string.
//   - For env-presence checks, the helper invokes `sh -c 'test "$X" = "true"'`
//     with a FIXED LITERAL shell-command string — the only operator-supplied
//     piece is the IDP container's own env, which the test command compares
//     for exact equality without ever printing the value.
//   - For the bind-mount probe, the helper invokes `touch` with a fixed
//     filename suffix derived from Date.now() so two concurrent preflights
//     do not collide. The probe file is empty (no content payload).
//   - On any failure, the throw message names the missing piece + the exact
//     fix command. No env values, no container env dump, no fixture content.

const PREFLIGHT_PROBE_PREFIX = "preflight-probe-";

interface PreflightCheckResult {
  ok: boolean;
  stdout: string;
}

/**
 * Runs `docker compose ... exec -T identuum-idp <argv...>` and returns
 * exit success + captured stdout. Stdin is closed; stderr is inherited
 * so operator-visible errors reach the terminal without being captured
 * into a buffer this code might log.
 */
function dockerExec(argv: string[]): PreflightCheckResult {
  try {
    const buf = execFileSync(
      "docker",
      ["compose", "-f", IDP_COMPOSE_FILE, "exec", "-T", IDP_SERVICE_NAME, ...argv],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    return { ok: true, stdout: buf.toString("utf-8") };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * Runs the dynamic-fixture preflight inside the IDP container. Throws on
 * the first failed check with a clear non-secret diagnostic message.
 */
function runDynamicFixturePreflight(hostFixtureDir: string): void {
  process.stdout.write("[e2e setup] dynamic mode: running preflight diagnostics...\n");

  // 1. The IDP binary must exist at /app/identuum. Implicitly verifies that
  //    docker compose can address the IDP service (any docker compose exec
  //    failure short-circuits here too).
  if (!dockerExec(["test", "-x", "/app/identuum"]).ok) {
    throw new Error(
      "Dynamic fixture preflight failed: /app/identuum was not found in the IDP container. " +
        "Rebuild/restart the local IDP container (cd identuum-idp && make local-restart)."
    );
  }

  // 2. The /e2e-auth bind-mount directory must exist and be writable inside
  //    the container.
  if (!dockerExec(["test", "-d", "/e2e-auth"]).ok) {
    throw new Error(
      "Dynamic fixture preflight failed: /e2e-auth is not mounted in the IDP container. " +
        "Run `make local-restart` from identuum-idp after pulling compose changes."
    );
  }
  if (!dockerExec(["test", "-w", "/e2e-auth"]).ok) {
    throw new Error(
      "Dynamic fixture preflight failed: /e2e-auth exists in the IDP container but is not writable. " +
        "Inspect the bind-mount permissions or rerun `make local-restart` from identuum-idp."
    );
  }

  // 3. The fixture-CLI env gate must be set to the literal "true". The
  //    `sh -c 'test "$X" = "true"'` form returns exit code only — the value
  //    is NEVER printed to stdout.
  if (!dockerExec(["sh", "-c", 'test "$IDENTUUM_E2E_FIXTURE_CLI_ENABLED" = "true"']).ok) {
    throw new Error(
      "Dynamic fixture preflight failed: IDENTUUM_E2E_FIXTURE_CLI_ENABLED=true is not present in the IDP container. " +
        "Run `make local-restart` from identuum-idp."
    );
  }

  // 4. One of the accepted insecure local gates must be set. The IDP
  //    appconfig validation requires this — the CLI would otherwise refuse
  //    at first invocation. Checking here gives a clearer up-front error.
  const insecureDev = dockerExec(["sh", "-c", 'test "$IDENTUUM_IDP_INSECURE_DEV_MODE" = "true"']);
  const insecureMFA = dockerExec(["sh", "-c", 'test "$IDENTUUM_IDP_INSECURE_MFA_BYPASS" = "true"']);
  if (!insecureDev.ok && !insecureMFA.ok) {
    throw new Error(
      "Dynamic fixture preflight failed: neither IDENTUUM_IDP_INSECURE_DEV_MODE=true nor IDENTUUM_IDP_INSECURE_MFA_BYPASS=true is present in the IDP container. " +
        "One of these is required to gate the fixture CLI; run `make local-restart` from identuum-idp."
    );
  }

  // 5. Host fixture directory existence — already created above; re-verify.
  if (!fs.existsSync(hostFixtureDir)) {
    throw new Error(
      `Dynamic fixture preflight failed: host fixture directory ${hostFixtureDir} is missing. Reinvoke globalSetup or create the directory manually with mode 0700.`
    );
  }

  // 6. Bind-mount probe — confirms that the host directory the loader will
  //    read from is the same directory the IDP container writes to. Probe
  //    name uses Date.now() so concurrent preflights do not collide.
  const probeName = `${PREFLIGHT_PROBE_PREFIX}${Date.now()}`;
  const probeContainerPath = `/e2e-auth/${probeName}`;
  const probeHostPath = path.join(hostFixtureDir, probeName);
  let containerProbeCreated = false;
  try {
    const touch = dockerExec(["touch", probeContainerPath]);
    if (!touch.ok) {
      throw new Error(
        "Dynamic fixture preflight failed: could not create probe file in /e2e-auth inside the IDP container. " +
          "Check container permissions on the bind-mounted directory."
      );
    }
    containerProbeCreated = true;
    if (!fs.existsSync(probeHostPath)) {
      throw new Error(
        "Dynamic fixture preflight failed: /e2e-auth is not connected to the UI e2e/.auth directory. " +
          "Check IDENTUUM_UI_E2E_AUTH_DIR or rerun `make local-restart` from identuum-idp."
      );
    }
  } finally {
    // Always clean up the probe, whether the check passed or threw.
    // Removing on the host removes it inside the container (same inode
    // via the bind mount). Belt-and-suspenders: also try a container-side
    // rm so a path-resolution mismatch does not leave a stray file.
    try {
      if (fs.existsSync(probeHostPath)) {
        fs.rmSync(probeHostPath, { force: true });
      }
    } catch {
      // Non-fatal — fall through to the container-side cleanup.
    }
    if (containerProbeCreated) {
      // Use a container-side rm with -f so a non-existent file does not
      // surface as an error. The dockerExec helper swallows non-zero
      // exits already, so this is best-effort.
      dockerExec(["rm", "-f", probeContainerPath]);
    }
  }

  process.stdout.write("[e2e setup] dynamic mode: preflight passed.\n");
}
