import { writeFileSync } from "node:fs";

const RUN_END_FILE = "/tmp/identuum-run-end.json";

/**
 * Playwright global teardown — THE-ALL-GREEN-SUITE (2026-08-08).
 *
 * Teardown deliberately PRESERVES the fixture envelope and leaves the appliance
 * running. Credentials are meant to be stable across runs: the next
 * global-setup validates the saved envelope (its site_admin login) and reuses
 * it when still valid, rebuilding only when absent or invalid. Deleting the
 * envelope here would force a rebuild every run — the churn this slice removes.
 *
 * The e2e appliance is volume-less, so whenever a rebuild IS needed the next
 * global-setup's `down`+`up` gives a fresh DB — no teardown work, and never a
 * `docker compose down -v`.
 *
 * The only durable action is recording the run-end timestamp for the inter-run
 * recovery gap. No fixture JSON is read; no secret is logged.
 */
export default async function globalTeardown() {
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}
