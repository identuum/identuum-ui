import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { isDynamicFixtureModeRequested, resolveFixturePath } from "./helpers/fixture";

const RUN_END_FILE = "/tmp/identuum-run-end.json";

const IDP_COMPOSE_FILE =
  "/Users/odemir/Development/2025-11/identuum/identuum-idp/deployment/docker-compose.local.yml";
const IDP_SERVICE_NAME = "identuum-idp";
const IDP_CONTAINER_FIXTURE_PATH = "/e2e-auth/e2e-org-admin-fixture.json";

/**
 * Playwright global teardown.
 *
 * Two responsibilities, in order:
 *
 *   1. (Dynamic-mode opt-in) When IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true AND
 *      the host fixture file is present, purge the fixture organization via
 *      the IDP CLI's --e2e-purge-org-fixture command. On success the IDP CLI
 *      itself removes the host file; this teardown then verifies it is gone
 *      and leaves a belt-and-suspenders rmSync. On failure the host file is
 *      left in place and a non-secret warning is printed pointing the
 *      operator at the documented manual purge command.
 *
 *   2. Record the run-end timestamp to RUN_END_FILE so the next
 *      `npx playwright test` invocation can enforce the documented
 *      inter-run recovery gap. This step runs unconditionally — dynamic
 *      mode does not affect it.
 *
 * SECURITY: this teardown never reads the fixture JSON contents, never
 * captures the IDP CLI's stdout buffer (stdio: inherit only), never logs
 * the fixture file's path with credentials inlined. The only outputs are
 * non-secret status strings and the IDP CLI's own non-secret refusal
 * summary on stderr.
 */
export default async function globalTeardown() {
  // Dynamic-mode fixture purge — runs first so that even if RUN_END_FILE
  // write later fails, we have already cleaned up the disposable org.
  if (isDynamicFixtureModeRequested()) {
    await orchestrateDynamicFixturePurge();
  }

  // RUN_END_FILE bookkeeping — preserved exactly from the prior implementation.
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    // Ignore write failures
  }
}

async function orchestrateDynamicFixturePurge(): Promise<void> {
  const hostFixturePath = resolveFixturePath();
  if (!existsSync(hostFixturePath)) {
    // Nothing to purge. Either globalSetup never ran in dynamic mode this
    // session, or a previous teardown already cleaned up. No action needed.
    return;
  }

  process.stdout.write("[e2e teardown] dynamic mode: purging disposable org-admin fixture...\n");
  try {
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
  } catch (err) {
    process.stderr.write(
      `[e2e teardown] dynamic mode: IDP --e2e-purge-org-fixture failed; leaving host fixture file in place at ${hostFixturePath}. Inspect the DB and re-run the purge manually:\n  docker compose -f ${IDP_COMPOSE_FILE} exec -T ${IDP_SERVICE_NAME} /app/identuum --e2e-purge-org-fixture --fixture-file ${IDP_CONTAINER_FIXTURE_PATH} --confirm-e2e-purge\nUnderlying error: ${(err as Error).message}\n`
    );
    return;
  }

  // The IDP CLI unlinks the host file on RowsAffected==1; verify and do a
  // belt-and-suspenders rmSync if for any reason the file is still present.
  if (existsSync(hostFixturePath)) {
    try {
      rmSync(hostFixturePath, { force: true });
    } catch {
      // Best-effort — the DB row is gone at this point, so the surviving
      // file is harmless metadata that the next globalSetup will overwrite.
    }
  }
  process.stdout.write("[e2e teardown] dynamic mode: fixture purged.\n");
}
