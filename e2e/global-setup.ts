import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoComposeLeftovers,
  assertOwnedComposeConfig,
  buildFixtureEnvelope,
  composeCommand,
  composeLifecycleEnv,
  fixtureLifecycleOwner,
  readSetupCode,
  SECONDARY_COMPOSE_PROJECT,
  SECONDARY_OWNER_ENV,
  totpLoginWorks,
} from "./helpers/appliance-fixture";
import {
  fixtureDirectory,
  isDynamicFixtureModeRequested,
  loadSiteAdminFixture,
  resolveFixturePath,
} from "./helpers/fixture";

/**
 * Playwright global setup — runs once before any test or webServer starts.
 *
 * Two responsibilities:
 *   1. Ensure config/ui-runtime.json exists (write a minimal no-secrets config
 *      when absent; fail loudly on corrupt/unconfigured).
 *   2. Dynamic-fixture mode (opt-in): bring up the RELEASED appliance and build
 *      the org/admin/user fixtures against its HTTP API.
 *
 * THE RELEASED-APPLIANCE HARNESS (THE-RELEASED-CONTRACT, 2026-08-08). This
 * dropped every pre-split assumption the census flagged (UI-DRIFT-HARNESS-
 * PRESPLIT + SEEDED-COUPLING): no /app/identuum probe, no /e2e-auth bind mount,
 * no `make local-restart`, no owner-seeded credentials. From NOTHING, a fresh
 * clone with Docker reaches an authenticated green run — the appliance is the
 * published ghcr.io/identuum/identuum-idp-oss image the compose file pins
 * (digest-pinned default) on a throwaway DB
 * (e2e/docker-compose.e2e.yml), and every credential is minted by this setup
 * against the released API and written to the fixture envelope the specs
 * already consume.
 *
 * LIFECYCLE OWNERSHIP (OSS-MINT-GUARD-2, C4). Under the e2e-full harness
 * (IDENTUUM_E2E_FIXTURE_OWNER=outer) the outer runner owns the appliance:
 * reuse of its fixture is mandatory and anything else is a refusal, before any
 * Compose call. Standalone, this setup creates its own project
 * identuum-ui-e2e (-p on every call, resolved config validated, leftovers
 * refused) and marks it as its own for global-teardown.
 */

const MINIMAL_E2E_CONFIG = {
  configured: true,
  ui_origin: "http://localhost:7104",
  idp: { enabled: true, public_base_url: "http://localhost:7113" },
  ag: { enabled: false, public_base_url: "" },
};

const RUN_END_FILE = "/tmp/identuum-run-end.json";
const INTER_RUN_RECOVERY_MS = 5_000;

// The released appliance the fixtures are built against.
const IDP_BASE_URL = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";
const E2E_COMPOSE_FILE = path.join(__dirname, "docker-compose.e2e.yml");
// The Docker Compose SERVICE name in e2e/docker-compose.e2e.yml (a compose-file
// label, not the product/repo name). It IS identuum-idp-oss — the released OSS
// appliance — kept explicit here so it can never be mistaken for the retired
// pre-split `identuum-idp` monolith.
const IDP_SERVICE = "identuum-idp-oss";

export default async function globalSetup() {
  try {
    const data = JSON.parse(fs.readFileSync(RUN_END_FILE, "utf-8")) as { endMs: number };
    const elapsed = Date.now() - data.endMs;
    if (elapsed < INTER_RUN_RECOVERY_MS) {
      await new Promise((r) => setTimeout(r, INTER_RUN_RECOVERY_MS - elapsed));
    }
  } catch {
    /* no previous run */
  }

  const configFile =
    process.env.IDENTUUM_UI_CONFIG_FILE ?? path.join(process.cwd(), "config", "ui-runtime.json");

  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(MINIMAL_E2E_CONFIG, null, 2)}\n`, "utf-8");
    console.log("\n[e2e setup] config/ui-runtime.json was missing — wrote minimal config.");
  } else {
    let cfg: { configured?: boolean } = {};
    try {
      cfg = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    } catch {
      throw new Error(`[e2e setup] ${configFile} is not valid JSON. Fix or delete it.`);
    }
    if (!cfg.configured) {
      throw new Error(`[e2e setup] ${configFile} has configured=false. Delete it to regenerate.`);
    }
  }

  if (isDynamicFixtureModeRequested()) {
    await orchestrateReleasedApplianceFixture();
  }
}

/**
 * REUSE-OR-REBUILD. Credentials stop churning between runs
 * (THE-ALL-GREEN-SUITE): if a valid envelope exists AND its site_admin can
 * still log in against the running appliance, reuse both — the envelope file is
 * left untouched (mtime unchanged) and no `down`/`up` runs. Only when the
 * envelope is absent OR its credentials no longer authenticate does this
 * (standalone only) create a fresh appliance of its own and build a new
 * envelope — refusing, never removing, an existing identuum-ui-e2e stack;
 * outer-owned, it refuses instead. This is why reuse must
 * NOT `down` a healthy appliance: the saved credentials exist only inside the
 * appliance that minted them.
 *
 * NOTE: the isolated e2e ui-runtime config (localhost-only, no
 * host.docker.internal) is written and wired to the webServer in
 * playwright.config.ts — Playwright launches the webServer before this
 * globalSetup runs, so a config chosen here would arrive too late.
 */
async function orchestrateReleasedApplianceFixture(): Promise<void> {
  const owner = fixtureLifecycleOwner();
  const hostFixtureDir = fixtureDirectory();
  fs.mkdirSync(hostFixtureDir, { recursive: true, mode: 0o700 });
  const fixturePath = resolveFixturePath();

  // OUTER-OWNED (C4): the outer runner provisioned this appliance and its
  // fixture and alone owns their lifecycle. Reuse is mandatory: anything that
  // does not validate is a refusal here, before any Compose discovery or
  // startup — never a second appliance of this invocation's own.
  if (owner === "outer") {
    const refuse = (why: string) =>
      new Error(`[e2e setup] outer-owned harness: ${why}; refusing (no appliance of its own).`);
    if (!process.env.IDENTUUM_IDP_BASE_URL) throw refuse("IDENTUUM_IDP_BASE_URL is not set");
    if (!fs.existsSync(fixturePath)) throw refuse("the provisioned fixture is missing");
    if (!(await idpHealthy())) throw refuse(`the IdP at ${IDP_BASE_URL} is not healthy`);
    const sa = safeLoadSiteAdmin();
    if (!sa) throw refuse("the provisioned fixture is malformed");
    if (!(await totpLoginWorks(IDP_BASE_URL, sa.email, sa.password, sa.totpSecret))) {
      throw refuse("the fixture's site_admin cannot sign in");
    }
    process.stdout.write("[e2e setup] outer-owned harness: reusing its provisioned fixture.\n");
    return;
  }

  // Fast path: a saved envelope whose site_admin still authenticates against a
  // healthy appliance. No appliance churn, no credential regeneration.
  if (fs.existsSync(fixturePath) && (await idpHealthy())) {
    const sa = safeLoadSiteAdmin();
    if (sa && (await totpLoginWorks(IDP_BASE_URL, sa.email, sa.password, sa.totpSecret))) {
      process.stdout.write(
        "[e2e setup] reusing the existing valid fixture (credentials stable).\n"
      );
      return;
    }
    process.stdout.write("[e2e setup] saved fixture is stale/invalid — rebuilding.\n");
  }

  const compose = composeCommand(E2E_COMPOSE_FILE);
  if (!compose) {
    throw new Error(
      "[e2e setup] neither `docker compose` nor `docker-compose` is available; " +
        "dynamic-fixture mode needs Docker Compose to run the released appliance."
    );
  }
  const [prog, ...pre] = compose;

  // STANDALONE (C4): create this invocation's OWN appliance. The resolved
  // config must be project identuum-ui-e2e alone (C1), and nothing of that
  // project may exist yet: a leftover stack is refused, never removed by
  // assumption (ruling Q2(b)). `up` on an empty project gives a guaranteed
  // setup_required appliance on fresh storage — no named volume, and the
  // postgres image's anonymous volume is created new by this `up`.
  assertOwnedComposeConfig(compose, SECONDARY_COMPOSE_PROJECT);
  assertNoComposeLeftovers(E2E_COMPOSE_FILE, SECONDARY_COMPOSE_PROJECT);
  process.stdout.write(
    "[e2e setup] creating a fresh released appliance (compose-default image)...\n"
  );
  // Recorded BEFORE `up`: a partial start is still this invocation's to remove.
  process.env[SECONDARY_OWNER_ENV] = String(process.pid);
  try {
    execFileSync(prog, [...pre, "up", "-d"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: composeLifecycleEnv(),
    });
  } catch (err) {
    throw new Error(
      `[e2e setup] could not start the e2e appliance stack via ${E2E_COMPOSE_FILE}. ` +
        `Is Docker running? Underlying error: ${(err as Error).message}`
    );
  }
  await waitForIdpHealthy(90_000);

  const setupCode = readSetupCode(compose, IDP_SERVICE);
  const runId = randomRunId();
  process.stdout.write("[e2e setup] building org/admin/user fixtures via the released API...\n");
  const envelope = await buildFixtureEnvelope(IDP_BASE_URL, runId, setupCode);

  fs.writeFileSync(fixturePath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(fixturePath, 0o600);
  } catch {
    /* bind-mount platforms may reject chmod; the file is gitignored regardless */
  }
  process.stdout.write(`[e2e setup] fixture ready (run ${runId}).\n`);
}

/** loadSiteAdminFixture, swallowing a malformed-envelope throw as "no reuse". */
function safeLoadSiteAdmin(): { email: string; password: string; totpSecret: string } | null {
  try {
    return loadSiteAdminFixture();
  } catch {
    return null;
  }
}

async function idpHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${IDP_BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForIdpHealthy(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await idpHealthy()) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `[e2e setup] released appliance did not become healthy at ${IDP_BASE_URL}/health`
  );
}

function randomRunId(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 12; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}
