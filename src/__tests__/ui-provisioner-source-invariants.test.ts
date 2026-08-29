/**
 * ui-provisioner-source-invariants.test.ts — UI-PROVISIONER-1
 *
 * THE-UI-PROVISIONER (2026-08-29): the e2e-full harness lights the ~40 dev-loop
 * specs that were dark ONLY for want of seeded identities. After the API suite,
 * full-run.sh provisions site_admin / org_admin / org_user against the running
 * appliance and runs the dev-loop suite under that env. These pins keep that
 * lighting-up from regressing into the three ways it could quietly break:
 *
 *   (a) a SECOND bootstrap path — the harness must reuse its ONE
 *       `identuum-idp bootstrap`, never add another;
 *   (b) the provisioner leaking into the API suite / a plain `pnpm e2e` — it
 *       must be OPT-IN (IDENTUUM_E2E_PROVISION=1) so default behavior is
 *       unchanged and the default-off gates are not weakened;
 *   (c) the dev-loop run forking its own producer — it must reuse the canonical
 *       seedFixtureFromSiteAdmin + the harness site_admin session.
 *
 * Source-invariant style (no process spawn, no network, no browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const fullRun = (): string => readFileSync(resolve(REPO, "e2e-full/scripts/full-run.sh"), "utf8");
const provisioner = (): string =>
  readFileSync(resolve(REPO, "e2e-full/provision-fixture.spec.ts"), "utf8");

describe("the e2e-full provisioner lights the dev-loop suite from one bootstrap [UI-PROVISIONER-1]", () => {
  it("full-run.sh keeps EXACTLY ONE bootstrap path (no second bootstrap) [UI-PROVISIONER-1]", () => {
    const sh = fullRun();
    const bootstraps = sh.match(/identuum-idp bootstrap/g) ?? [];
    expect(bootstraps.length, "exactly one `identuum-idp bootstrap` invocation").toBe(1);
  });

  it("full-run.sh provisions, then runs the dev-loop chromium suite, AFTER the API suite", () => {
    const sh = fullRun();
    const apiIdx = sh.indexOf("--project=oss-full --workers=1");
    const provIdx = sh.indexOf("IDENTUUM_E2E_PROVISION=1");
    const devloopIdx = sh.indexOf("IDENTUUM_E2E_USE_DYNAMIC_FIXTURE=true");
    expect(apiIdx, "the API (oss-full) suite runs").toBeGreaterThan(-1);
    expect(provIdx, "the provisioner invocation follows the API suite").toBeGreaterThan(apiIdx);
    expect(devloopIdx, "the provisioned dev-loop run follows the provisioner").toBeGreaterThan(
      provIdx
    );
    // The dev-loop run is the browser suite (chromium project), not the API suite.
    expect(
      sh.slice(devloopIdx),
      "the provisioned dev-loop run uses the chromium project"
    ).toContain("--project=chromium");
  });

  it("the provisioner spec is OPT-IN so the API suite and a plain pnpm e2e are unchanged", () => {
    const spec = provisioner();
    expect(spec, "self-skips unless the harness sets IDENTUUM_E2E_PROVISION=1").toContain(
      'process.env.IDENTUUM_E2E_PROVISION !== "1"'
    );
    expect(spec, "the guard is a test.skip").toMatch(/test\.skip\(/);
  });

  it("the provisioner reuses the canonical producer + harness session — not a fork", () => {
    const spec = provisioner();
    expect(spec, "reuses seedFixtureFromSiteAdmin (canonical envelope producer)").toContain(
      "seedFixtureFromSiteAdmin"
    );
    expect(
      spec,
      "reuses siteAdminSession (the harness's single bootstrap + captured secret)"
    ).toContain("siteAdminSession");
  });
});
