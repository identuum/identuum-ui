import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RULE: SEED-NEVER-OUTLIVES-APPLIANCE-1
 *
 * The site_admin TOTP seed under e2e-full/.auth/ is valid ONLY for the
 * appliance that issued it, and the harness destroys that appliance with
 * `down --volumes` at the start of every run. A seed therefore can never
 * legitimately survive into the next run — but the file persisted, the
 * fallback in siteAdminSession read it across appliances, and the resulting
 * codes matched no window. It cost THREE red mints and two prompts chasing a
 * "replay guard" that this server does not have.
 *
 * Two things keep that closed, and this pins both:
 *   1. the harness DELETES the seed at run start, so the fallback can never
 *      read across appliances;
 *   2. the failure, if it ever happens again, is LOUD — it names the stale
 *      seed and carries the enrolment error that actually failed, instead of
 *      being swallowed by a bare catch.
 */
const UI_ROOT = resolve(__dirname, "..", "..");
const runner = () => readFileSync(resolve(UI_ROOT, "e2e-full/scripts/full-run.sh"), "utf-8");
const session = () => readFileSync(resolve(UI_ROOT, "e2e-full/helpers/session.ts"), "utf-8");

const SEED = "full-site-admin-totp";

// NOT ledger-bound, deliberately: this slice was told to keep the floors
// identical, so no rule was declared and FLOOR stays 65. The guard still runs
// — vitest is a `make verify` target — but it carries no ledger row and no
// recorded red-proof. Giving it one is a one-line follow-up, and until then
// this comment is the only thing saying so.
describe("the e2e site_admin seed never outlives its appliance", () => {
  it("the harness deletes the seed at RUN START, before the stack is destroyed", () => {
    const sh = runner();
    const rmIdx = sh.indexOf(`rm -f "$UI_DIR/e2e-full/.auth/${SEED}"`);
    expect(
      rmIdx,
      "run start must delete the seed; without it the fallback reads across appliances"
    ).toBeGreaterThan(-1);

    // It must come BEFORE the teardown that destroys the appliance, so the
    // ordering reads as "this seed belongs to a stack that is about to die".
    const downIdx = sh.indexOf("--profile app down --volumes");
    expect(downIdx, "the harness must still destroy the stack").toBeGreaterThan(-1);
    expect(rmIdx, "the seed is deleted at run start, ahead of the teardown").toBeLessThan(downIdx);
  });

  it("the fallback names a STALE SEED and carries the enrolment error, never a replay guard", () => {
    const src = session();
    expect(src, "the enrolment error must be BOUND, not swallowed").toContain("catch (enrolErr)");
    expect(src, "the failure must carry what actually failed").toContain(
      "THE ENROLMENT PATH FAILED FIRST"
    );
    expect(src, "the diagnosis must say stale, not replayed").toContain("stale, not replayed");
    expect(
      src,
      "no bare `catch {` may survive on this path — a silent cleanup failure is how the next run inherits the bad seed"
    ).not.toMatch(/}\s*catch\s*\{/);
  });

  it("the unusable seed is still removed on failure, so the next run re-enrols", () => {
    expect(session(), "the failing path must remove the seed it could not use").toContain(
      "unlinkSync(SECRET_FILE)"
    );
  });
});
