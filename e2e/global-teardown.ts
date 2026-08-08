import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeCommand } from "./helpers/appliance-fixture";
import { isDynamicFixtureModeRequested, resolveFixturePath } from "./helpers/fixture";

const RUN_END_FILE = "/tmp/identuum-run-end.json";
const E2E_COMPOSE_FILE = path.join(__dirname, "docker-compose.e2e.yml");

/**
 * Playwright global teardown — THE-ALL-GREEN-SUITE (2026-08-08).
 *
 * DEFAULT: leave NO trace. When the run finishes, the disposable e2e appliance
 * stack is torn down (`docker compose down`). Its Postgres is volume-less, so
 * `down` — with NO `-v`, which the repo forbids — destroys the database and
 * every row the tests created: the fixture org, its org_admin/org_user, the
 * seeded clients/api-resource/service-account, and all audit rows. Nothing
 * survives in any database. The local fixture envelope is removed too.
 *
 * OPT-IN reuse: set IDENTUUM_E2E_KEEP_APPLIANCE=true to KEEP the appliance and
 * the envelope after the run, so a quick re-run reuses stable credentials
 * (Order A). This trades the no-trace guarantee for local iteration speed and
 * is off by default.
 *
 * SECURITY: never reads the fixture JSON credentials; only compose lifecycle,
 * local file cleanup, and a timestamp write.
 */
export default async function globalTeardown() {
  if (isDynamicFixtureModeRequested() && process.env.IDENTUUM_E2E_KEEP_APPLIANCE !== "true") {
    tearDownAppliance();
    removeLocalFixtureFiles();
  }
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}

function tearDownAppliance(): void {
  const compose = composeCommand(E2E_COMPOSE_FILE);
  if (!compose) return;
  const [prog, ...pre] = compose;
  try {
    // No `-v`: the Postgres is volume-less, so `down` alone leaves no database
    // and no data — a full clean without ever touching a named volume.
    process.stdout.write("[e2e teardown] tearing down the e2e appliance (no trace left)...\n");
    execFileSync(prog, [...pre, "down"], { stdio: ["ignore", "inherit", "inherit"] });
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
