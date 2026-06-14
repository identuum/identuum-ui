/**
 * Live-backend Playwright regression coverage for the OSS-to-CE
 * /upgrade wizard backup flow. Drives a real Chromium browser
 * against a source-build CE backend + UI + OSS-shaped throwaway
 * Postgres database. Verifies create, list, prune, apply, restart,
 * and the post-apply transition to /setup.
 *
 * Companion to e2e/upgrade-backup.spec.ts which exercises the same
 * wizard through browser-level fetch mocks. The live variant
 * catches regressions in the wire contract / the proxy route / the
 * runtime composition that the mocked variant cannot see.
 *
 * ── Opt-in gate ────────────────────────────────────────────────────
 *
 *   IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1 must be set, otherwise this
 *   spec self-skips. The standard `pnpm e2e` run stays fast and
 *   deterministic; the live variant is invoked explicitly:
 *
 *     ./e2e/scripts/upgrade-backup-live-up.sh
 *     . /tmp/idp-ce-upgrade-backup-playwright-20260617/live-env.sh
 *     npx playwright test e2e/upgrade-backup-live.spec.ts --reporter=list
 *     ./e2e/scripts/upgrade-backup-live-down.sh
 *
 *   The up.sh script also writes a `live-env.sh` that exports the
 *   env vars this spec consumes.
 *
 * ── Env contract ───────────────────────────────────────────────────
 *
 *   IDENTUUM_E2E_LIVE_UPGRADE_BACKUP   "1" — required gate.
 *   IDENTUUM_E2E_LIVE_IDP_PORT         host port the IDP container is
 *                                      reachable on (default: 7129).
 *   IDENTUUM_E2E_LIVE_UI_PORT          host port the UI container is
 *                                      reachable on (default: 7130).
 *                                      This MUST match the existing
 *                                      Playwright `baseURL` env
 *                                      (IDENTUUM_E2E_BASE_URL).
 *   IDENTUUM_E2E_LIVE_PROJECT          docker compose project name
 *                                      (default:
 *                                      idp-ce-upgrade-backup-playwright-20260617).
 *   IDENTUUM_E2E_LIVE_SMOKE_DIR        scratch dir written by up.sh.
 *   IDENTUUM_E2E_LIVE_UPGRADE_TOKEN_FILE
 *                                      mode-0600 file containing the
 *                                      upgrade-token plaintext. The
 *                                      spec reads it once at startup;
 *                                      the value is held in memory
 *                                      only and NEVER logged.
 *
 * ── SECURITY ───────────────────────────────────────────────────────
 *
 *   - The upgrade-token plaintext, the DB password, the DSN, and
 *     any backup body bytes MUST NOT appear in test names,
 *     assertion failure messages, console output, or screenshots.
 *   - The token is read into a closure-local constant and forwarded
 *     directly to the wizard input. No log statement and no
 *     screenshot path passes through it.
 *   - The spec NEVER prints the runtime-only token file path back
 *     into the page DOM or onto stdout in a form that would survive
 *     into Playwright's HTML report.
 *   - Backup contents are NEVER fetched or rendered.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LIVE_GATE = process.env.IDENTUUM_E2E_LIVE_UPGRADE_BACKUP === "1";
const IDP_PORT = process.env.IDENTUUM_E2E_LIVE_IDP_PORT ?? "7129";
// UI_PORT is consumed by the operator-side env contract (via
// IDENTUUM_E2E_BASE_URL → Playwright baseURL). The spec itself never
// reads it directly — the page.goto() calls use relative URLs against
// baseURL. Asserted at top-level so the env-contract surface stays
// visible to operators.
void process.env.IDENTUUM_E2E_LIVE_UI_PORT;
const PROJECT =
  process.env.IDENTUUM_E2E_LIVE_PROJECT ?? "idp-ce-upgrade-backup-playwright-20260617";
const SMOKE_DIR = process.env.IDENTUUM_E2E_LIVE_SMOKE_DIR ?? `/tmp/${PROJECT}`;
const TOKEN_FILE =
  process.env.IDENTUUM_E2E_LIVE_UPGRADE_TOKEN_FILE ?? `${SMOKE_DIR}/upgrade-token.txt`;
const IDP_BASE = `http://localhost:${IDP_PORT}`;

const IDP_CONTAINER = `${PROJECT}-idp`;

/**
 * loadUpgradeToken returns the upgrade-token plaintext for the
 * currently-running throwaway stack. Read once at module load so
 * the value never crosses a logging boundary. The caller forwards
 * it directly into a password-shaped input on the wizard.
 */
function loadUpgradeToken(): string {
  if (!LIVE_GATE) return "";
  const raw = readFileSync(TOKEN_FILE, "utf-8");
  return raw.replace(/[\r\n]+$/u, "");
}

function dockerExec(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
}

function dockerComposeExec(args: string[]): string {
  return dockerExec(["compose", "-p", PROJECT, ...args]);
}

interface BackupRow {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

function getBackupsList(): BackupRow[] {
  const body = execFileSync("curl", ["-sf", "--max-time", "5", `${IDP_BASE}/api/upgrade/backup`], {
    encoding: "utf-8",
  });
  const parsed = JSON.parse(body) as {
    backups?: { filename: string; size_bytes: number; created_at: string }[];
  };
  return (parsed.backups ?? []).map((b) => ({
    filename: b.filename,
    sizeBytes: b.size_bytes,
    createdAt: b.created_at,
  }));
}

test.describe("/upgrade — live-backend backup flow", () => {
  test.skip(!LIVE_GATE, "live-backend opt-in (IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1) not set");

  test.beforeAll(async () => {
    // Token file presence + non-empty body — refuse to proceed without
    // a captured token. up.sh writes a mode-0600 file; we cross-check
    // permissions here as defence-in-depth.
    const info = statSync(TOKEN_FILE);
    expect(info.size).toBeGreaterThan(40);
    expect(info.mode & 0o077).toBe(0); // owner-only access bits
  });

  test("redirects from / to /upgrade and renders the wizard", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/upgrade$/, { timeout: 15_000 });
    await expect(page.getByTestId("upgrade-wizard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("upgrade-state-title")).toContainText(/existing self-hosted/i);
  });

  test("backup automation is available; Create backup writes a real file", async ({ page }) => {
    await page.goto("/upgrade");
    await expect(page.getByTestId("upgrade-backup-automation-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("upgrade-backup-create")).toBeVisible();

    const before = getBackupsList().map((b) => b.filename);

    await page.getByTestId("upgrade-backup-create").click();
    await expect(page.getByTestId("upgrade-backup-create-ok")).toBeVisible({
      timeout: 30_000,
    });

    // Re-fetch the list via the backend directly. The new file must
    // be present, distinct from any pre-existing backups, and pass
    // the strict product-managed filename pattern.
    const after = getBackupsList();
    expect(after.length).toBeGreaterThan(before.length);
    const newRow = after.find((b) => !before.includes(b.filename));
    expect(newRow).toBeDefined();
    if (!newRow) return;
    expect(newRow.filename).toMatch(
      /^identuum-idp-ce-upgrade-backup-\d{8}T\d{6}Z-[0-9a-f]{8}\.sql$/
    );

    // Verify the file on disk: mode 0600, owner idp:idp, non-zero
    // size, plain-SQL pg_dump header. The header substring is a
    // SAFE fragment of the dump preamble (no user data); we ASSERT
    // it with a regex rather than echoing the body.
    const stat = dockerComposeExec([
      "exec",
      "-T",
      "identuum-idp",
      "stat",
      "-c",
      "%a %s %U:%G",
      `/app/data/backups/upgrade/${newRow.filename}`,
    ]);
    expect(stat).toMatch(/^600 \d+ idp:idp/);
    const sizeFromStat = Number.parseInt(stat.split(" ")[1], 10);
    expect(sizeFromStat).toBeGreaterThan(1024);

    const header = dockerComposeExec([
      "exec",
      "-T",
      "identuum-idp",
      "head",
      "-3",
      `/app/data/backups/upgrade/${newRow.filename}`,
    ]);
    expect(header).toMatch(/PostgreSQL database dump/);

    // The IDP container logs MUST NOT contain the DB password.
    const idpLogs = dockerComposeExec(["logs", "--no-color", "identuum-idp"]);
    expect(idpLogs).not.toContain("identuum_idp_ce_local_default");
  });

  test("Remove → Confirm prunes one backup and leaves the others intact", async ({ page }) => {
    // Ensure at least two backups exist so we have a pruning
    // candidate AND a survivor. Create one (or two) if the stack is
    // freshly booted.
    let backups = getBackupsList();
    while (backups.length < 2) {
      const res = execFileSync(
        "curl",
        [
          "-sf",
          "--max-time",
          "30",
          "-X",
          "POST",
          "-H",
          "Content-Type: application/json",
          "-d",
          "{}",
          `${IDP_BASE}/api/upgrade/backup`,
        ],
        { encoding: "utf-8" }
      );
      expect(res).toContain("backup_id");
      // pg_dump runs synchronously inside the request; small pause
      // so the next backup's filename timestamp is distinct.
      await page.waitForTimeout(1_100);
      backups = getBackupsList();
    }
    const target = backups[backups.length - 1]; // oldest survivor candidate
    const survivors = backups.filter((b) => b.filename !== target.filename);

    await page.goto("/upgrade");
    await expect(page.getByTestId(`upgrade-backup-list-row-${target.filename}`)).toBeVisible({
      timeout: 15_000,
    });

    // Step 1: Remove → row flips to pending-confirm.
    await page.getByTestId(`upgrade-backup-prune-request-${target.filename}`).click();
    await expect(page.getByTestId(`upgrade-backup-prune-confirm-${target.filename}`)).toBeVisible();
    await expect(page.getByTestId(`upgrade-backup-prune-cancel-${target.filename}`)).toBeVisible();

    // Step 2: Confirm → destructive POST fires.
    await page.getByTestId(`upgrade-backup-prune-confirm-${target.filename}`).click();
    await expect(page.getByTestId("upgrade-backup-prune-ok")).toContainText(target.filename, {
      timeout: 15_000,
    });

    // Verify on-disk side: target file gone, survivors still
    // present with unchanged size.
    const lsErr = (() => {
      try {
        dockerComposeExec([
          "exec",
          "-T",
          "identuum-idp",
          "stat",
          "-c",
          "%a",
          `/app/data/backups/upgrade/${target.filename}`,
        ]);
        return "exists";
      } catch {
        return "missing";
      }
    })();
    expect(lsErr).toBe("missing");

    for (const s of survivors) {
      const stat = dockerComposeExec([
        "exec",
        "-T",
        "identuum-idp",
        "stat",
        "-c",
        "%a %s %U:%G",
        `/app/data/backups/upgrade/${s.filename}`,
      ]);
      expect(stat).toMatch(/^600 \d+ idp:idp/);
    }

    // List API reflects the deletion.
    const after = getBackupsList().map((b) => b.filename);
    expect(after).not.toContain(target.filename);
    for (const s of survivors) {
      expect(after).toContain(s.filename);
    }
  });

  test("Apply → upgrade_complete; restart transitions the wizard to /setup", async ({ page }) => {
    // The token plaintext is held only in this closure-local
    // constant. It is forwarded directly into the password-shaped
    // input; no log statement, no screenshot path passes through it.
    const token = loadUpgradeToken();
    expect(token.length).toBeGreaterThan(40);

    await page.goto("/upgrade");

    // Tick the backup-confirmed checkbox (a Create may already have
    // set it; defensive re-check + click if needed).
    const checkbox = page.getByTestId("upgrade-backup-confirm");
    if (!(await checkbox.isChecked())) {
      await checkbox.check();
    }

    // Paste the token. Fill is a direct DOM mutation; the value
    // stays inside the input's controlled state and never enters
    // the Playwright log channel.
    await page.getByTestId("upgrade-token-input").fill(token);

    // Submit the apply.
    await page.getByTestId("upgrade-apply-submit").click();

    // Wait for the completed-state card.
    await expect(page.getByTestId("upgrade-complete-card")).toBeVisible({
      timeout: 60_000,
    });

    // Verify backend state directly: the wizard's apply call lands
    // the wire-stable `upgrade_complete` state. The probe transitions
    // to `ce_migrations_current` only AFTER the restart below.
    const statusBody = execFileSync(
      "curl",
      ["-sf", "--max-time", "5", `${IDP_BASE}/api/upgrade/status`],
      { encoding: "utf-8" }
    );
    expect(statusBody).toContain('"state":"upgrade_complete"');
    expect(statusBody).toContain('"ce_migrations_current":true');

    // The CE schema must coexist with the OSS goose ledger; the
    // OSS seeds from oss-shape.sql must have survived. We verify
    // through pg_dump-free SQL queries via the postgres container.
    const seedCheck = dockerComposeExec([
      "exec",
      "-T",
      "-e",
      "PGPASSWORD=identuum_idp_ce_local_default",
      "postgres",
      "psql",
      "-U",
      "identuum_idp",
      "-d",
      "identuum_idp",
      "-tA",
      "-c",
      "SELECT EXISTS(SELECT 1 FROM goose_db_version_ce) AS ce_ledger_exists, EXISTS(SELECT 1 FROM oauth_clients WHERE client_id='pw-live-smoke-client-1') AS oss_oauth_seed_survived, EXISTS(SELECT 1 FROM signing_keys WHERE kid='pw-live-smoke-kid-1') AS oss_kid_survived;",
    ]).trim();
    // tA output is pipe-separated bools.
    expect(seedCheck).toContain("t|t|t");

    // Restart the IDP container and verify the post-apply
    // transition to first-run setup.
    execFileSync("docker", ["restart", IDP_CONTAINER], { stdio: "ignore" });

    // Re-poll the IDP /healthz until ready (up to 60s).
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        execFileSync("curl", ["-sf", "--max-time", "2", `${IDP_BASE}/healthz`], {
          encoding: "utf-8",
        });
        ready = true;
        break;
      } catch {
        await page.waitForTimeout(1_000);
      }
    }
    expect(ready).toBe(true);

    // After restart: /api/upgrade/status is ce_migrations_current,
    // /api/setup/status is setup_required with
    // key_wrap_provider_ready=true.
    const upgradeAfter = execFileSync(
      "curl",
      ["-sf", "--max-time", "5", `${IDP_BASE}/api/upgrade/status`],
      { encoding: "utf-8" }
    );
    expect(upgradeAfter).toContain('"state":"ce_migrations_current"');

    const setupAfter = execFileSync(
      "curl",
      ["-sf", "--max-time", "5", `${IDP_BASE}/api/setup/status`],
      { encoding: "utf-8" }
    );
    expect(setupAfter).toContain('"state":"setup_required"');
    expect(setupAfter).toContain('"key_wrap_provider_ready":true');

    // UI root + login redirect to /setup.
    const rootRes = await page.request.get("/", { maxRedirects: 0 });
    expect(rootRes.status()).toBe(307);
    expect(rootRes.headers().location).toContain("/setup");

    const loginRes = await page.request.get("/login", { maxRedirects: 0 });
    expect(loginRes.status()).toBe(307);
    expect(loginRes.headers().location).toContain("/setup");

    // No DB password substring in IDP / postgres / UI logs.
    for (const svc of ["identuum-idp", "postgres", "identuum-ui"]) {
      const logs = dockerComposeExec(["logs", "--no-color", svc]);
      expect(logs).not.toContain("identuum_idp_ce_local_default");
    }
  });
});
