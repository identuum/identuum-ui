import fs from "node:fs";
import path from "node:path";

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
 * and credentials (IDENTUUM_TEST_PASSWORD + IDENTUUM_TEST_TOTP_SECRET).
 */

// Minimal runtime config written when none exists.
// Mirrors the shape expected by src/lib/runtime-config.ts.
// No internal_base_url: in non-Docker environments the Docker service name
// (identuum-idp) does not resolve; omitting it lets idpBaseUrl() fall back
// to public_base_url, which is also unreachable without Compose but fails
// safely via caught fetch errors in server actions.
const MINIMAL_E2E_CONFIG = {
  configured: true,
  ui_origin: "http://localhost:7114",
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
}
