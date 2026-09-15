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
 *
 * THE-SUITE-THAT-REPLAYED (2026-09-13): the fallback used to ALSO delete the
 * seed on a miss. Under identuum-idp-oss's single-use TOTP guard that miss
 * was a consumed window, not a stale seed, and the deletion took four later
 * specs down with a missing-file error — the diagnosis destroyed by the
 * failure it explained. Mechanism 1 is what keeps a seed from outliving its
 * appliance; the fallback now presents only never-presented windows, retries
 * once from a fresh step, and on refusal fails loudly and DELETES NOTHING.
 */
const UI_ROOT = resolve(__dirname, "..", "..");
const runner = () => readFileSync(resolve(UI_ROOT, "e2e-full/scripts/full-run.sh"), "utf-8");
const session = () => readFileSync(resolve(UI_ROOT, "e2e-full/helpers/session.ts"), "utf-8");

const SEED = "full-site-admin-totp";

// LEDGER-BOUND (THE-PARALLEL-RITUAL, 2026-09-04). P-056 shipped this guard
// with no ledger row and said so here; that follow-up is now taken. The rule
// is SEED-NEVER-OUTLIVES-APPLIANCE-1 in RULE-FLOOR.md, armed against this file
// with a recorded mutation red-proof, so a guard that stops guarding is caught
// by the ledger rather than by the next three red mints.
describe("the e2e site_admin seed never outlives its appliance [SEED-NEVER-OUTLIVES-APPLIANCE-1]", () => {
  it("the harness deletes the seed at RUN START, before the stack is destroyed [SEED-NEVER-OUTLIVES-APPLIANCE-1]", () => {
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

  it("the failing path presents only unconsumed windows, retries once from a fresh step, and deletes NOTHING", () => {
    const src = session();
    // The ledger is keyed by the USER, like the appliance's guard
    // (THE-ELEVEN-MISMATCHES): every code names whose it is.
    expect(src, "every presented code must come from a window this user has not used").toContain(
      "unconsumedTOTP(secret, email)"
    );
    expect(src, "a refusal gets exactly one retry, from a fresh step").toContain(
      "unconsumedTOTPAfterFreshStep(secret, email)"
    );
    expect(src, "the failure must say the seed was left in place").toContain(
      "Seed file left in place"
    );
    expect(
      src,
      "the fallback must NOT delete the seed on a miss — that destroyed the diagnosis and four later specs"
    ).not.toContain("unlinkSync(");
  });
});
