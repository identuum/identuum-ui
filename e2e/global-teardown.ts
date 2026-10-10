import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertOwnedComposeConfig,
  composeCommand,
  composeLifecycleEnv,
  fixtureLifecycleOwner,
  SECONDARY_COMPOSE_PROJECT,
  SECONDARY_OWNER_ENV,
} from "./helpers/appliance-fixture";
import { isDynamicFixtureModeRequested, resolveFixturePath } from "./helpers/fixture";

const RUN_END_FILE = "/tmp/identuum-run-end.json";
const E2E_COMPOSE_FILE = path.join(__dirname, "docker-compose.e2e.yml");

/**
 * Playwright global teardown — THE-ALL-GREEN-SUITE (2026-08-08), ownership
 * scoped since OSS-MINT-GUARD-2 (C4).
 *
 * OUTER-OWNED (IDENTUUM_E2E_FIXTURE_OWNER=outer, set by
 * e2e-full/scripts/full-run.sh for its dev-loop phases): the outer runner owns
 * the appliance and the fixture. This teardown makes NO Compose call and
 * removes no fixture file; the runner tears its own project down.
 *
 * STANDALONE, DEFAULT: tear down only an appliance THIS invocation started
 * (global-setup marks it in this runner process before `up`), with a plain
 * `docker compose -p identuum-ui-e2e down` — NO `-v`, which the repo
 * forbids — and remove the fixture envelope whose credentials belonged to it.
 * `down` removes the containers and the network. The postgres image declares
 * VOLUME /var/lib/postgresql and the compose file mounts nothing there, so
 * that data sits in an ANONYMOUS volume which plain `down` leaves behind:
 * the next `up` starts on fresh storage, but the old data stays orphaned
 * until an operator removes it. A stack this invocation merely reused is not
 * torn down, and its envelope is kept.
 *
 * OPT-IN keep: IDENTUUM_E2E_KEEP_APPLIANCE=true keeps even an owned
 * appliance and its envelope after the run, so a quick re-run reuses stable
 * credentials. It is a keep switch, not an ownership signal.
 *
 * SECURITY: never reads the fixture JSON credentials; only compose lifecycle,
 * local file cleanup, and a timestamp write.
 */
export default async function globalTeardown() {
  const owned = process.env[SECONDARY_OWNER_ENV] === String(process.pid);
  if (
    isDynamicFixtureModeRequested() &&
    fixtureLifecycleOwner() === "standalone" &&
    owned &&
    process.env.IDENTUUM_E2E_KEEP_APPLIANCE !== "true"
  ) {
    tearDownOwnAppliance();
    removeLocalFixtureFiles();
  }
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}

function tearDownOwnAppliance(): void {
  const compose = composeCommand(E2E_COMPOSE_FILE, SECONDARY_COMPOSE_PROJECT);
  if (!compose) return;
  const [prog, ...pre] = compose;
  try {
    assertOwnedComposeConfig(compose, SECONDARY_COMPOSE_PROJECT);
    // No `-v`: containers and network go; the image's anonymous volume stays
    // (see the header).
    process.stdout.write("[e2e teardown] tearing down this run's e2e appliance...\n");
    execFileSync(prog, [...pre, "down"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: composeLifecycleEnv(),
    });
    delete process.env[SECONDARY_OWNER_ENV];
  } catch (err) {
    process.stderr.write(
      `[e2e teardown] appliance down failed (non-fatal): ${(err as Error).message}\n`
    );
  }
}

function removeLocalFixtureFiles(): void {
  try {
    const f = resolveFixturePath();
    if (existsSync(f)) rmSync(f, { force: true });
  } catch {
    /* best-effort */
  }
}
