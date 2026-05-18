import { writeFileSync } from "node:fs";

const RUN_END_FILE = "/tmp/identuum-run-end.json";

/**
 * Playwright global teardown — records the run-end timestamp so that the next
 * `npx playwright test` invocation can enforce a minimum inter-run recovery gap.
 * This prevents back-to-back runs from overloading the Docker containers.
 */
export default async function globalTeardown() {
  try {
    writeFileSync(RUN_END_FILE, JSON.stringify({ endMs: Date.now() }), "utf-8");
  } catch {
    // Ignore write failures
  }
}
