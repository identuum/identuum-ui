import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  fixtureDirectory,
  isDynamicFixtureModeRequested,
  resolveFixturePath,
} from "./helpers/fixture";

const RUN_END_FILE = "/tmp/identuum-run-end.json";
const ORG_HANDLE_FILE = path.join(fixtureDirectory(), "e2e-fixture-org.json");

/**
 * Playwright global teardown — THE-RELEASED-CONTRACT (2026-08-08).
 *
 * Pre-split machinery is gone (no /app/identuum, no /e2e-auth, no monolith
 * compose path). The disposable-appliance model makes teardown trivial:
 * global-setup RECREATES a fresh volume-less appliance on every dynamic run
 * (`down` then `up`), so the fixture organization is reset wholesale on the
 * next run — there is nothing to soft-delete here, and no `down -v` is ever
 * used (the Postgres has no named volume). Teardown only removes the local
 * fixture files and records the run-end timestamp for the inter-run gap.
 *
 * The e2e appliance is deliberately LEFT RUNNING so a developer can inspect it
 * after a run; the next dynamic run's `down`+`up` recreates it fresh.
 *
 * SECURITY: never reads the fixture JSON credentials; only local file cleanup
 * and a timestamp write.
 */
export default async function globalTeardown() {
  if (isDynamicFixtureModeRequested()) {
    for (const f of [resolveFixturePath(), ORG_HANDLE_FILE]) {
      try {
        if (existsSync(f)) rmSync(f, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}
