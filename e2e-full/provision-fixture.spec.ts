/**
 * THE-UI-PROVISIONER — seeds the dev-loop fixture against the RUNNING e2e-full
 * appliance, so the ~40 already-existing but env-gated dev-loop specs light up
 * when full-run.sh runs them after the API suite.
 *
 * This is a PROVISIONER, not a coverage test. It runs ONLY when
 * IDENTUUM_E2E_PROVISION=1 (set by full-run.sh in a dedicated invocation AFTER
 * the API suite); in the normal oss-full API run it self-skips, so it never
 * changes that suite's behavior.
 *
 * It does NOT add a second bootstrap path: it reuses the site_admin the harness
 * already bootstrapped and the API suite already MFA-enrolled (siteAdminSession
 * captures + retains the server-minted secret in e2e-full/.auth), then reuses
 * the canonical seedFixtureFromSiteAdmin producer to create the org / org_admin
 * / org_user (all TOTP-enrolled) / OAuth clients and assemble the SAME envelope
 * every dev-loop spec's loader already consumes. Nothing here is a fork.
 *
 * The envelope is written to e2e/.auth/e2e-org-admin-fixture.json (0600,
 * gitignored). No secret is ever logged.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { api, seedFixtureFromSiteAdmin } from "../e2e/helpers/appliance-fixture";
import { fixtureDirectory, resolveFixturePath, validateFixture } from "../e2e/helpers/fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";

// 12 lowercase-hex run id, matching the fixture loader's RUN_ID_PATTERN.
function randomRunId(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 12; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

test.describe.configure({ mode: "serial" });

test.describe("provision the dev-loop fixture (opt-in)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_PROVISION !== "1",
    "provisioner runs only when IDENTUUM_E2E_PROVISION=1 (full-run.sh's dedicated invocation)"
  );

  test("seed org_admin + org_user + clients from the bootstrapped site_admin", async () => {
    const bootstrapPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(
      bootstrapPassword.length,
      "the harness must pass the bootstrap password"
    ).toBeGreaterThan(0);

    // Reuse the harness's ONE bootstrap: the API suite already logged this
    // site_admin in and enrolled MFA; siteAdminSession returns its bearer AND
    // the captured server-minted TOTP secret from e2e-full/.auth.
    const siteAdmin = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, bootstrapPassword);
    expect(siteAdmin.bearer.length, "site_admin bearer").toBeGreaterThan(0);
    expect(siteAdmin.totpSecret.length, "captured site_admin TOTP secret").toBeGreaterThan(0);

    // The wizard-path setup creates an ADMIN-LESS "E2E System Bootstrap" org
    // that SA-ORG-COPY-1's admin-less state asserts against. The CLI bootstrap
    // the harness reuses creates no such org, so seed the equivalent: an
    // ACTIVE org with NO org_admin (site_admin creates it and delegates
    // nobody). NOTE: active + admin_email together are refused loudly by the
    // create handler (with admin_email the org is born INACTIVE by design), so
    // this seed carries no admin_email — the org is plainly admin-less, which
    // is the state the census specs need. 409/duplicate on a re-run is fine.
    const bootstrapOrg = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: "E2E System Bootstrap",
        slug: "e2e-bootstrap",
        domain: "e2e-bootstrap.test",
        active: true,
      },
      siteAdmin.bearer
    );
    expect(
      [201, 409].includes(bootstrapOrg.status),
      `seed admin-less bootstrap org → ${bootstrapOrg.status} (want 201 fresh / 409 already-seeded)`
    ).toBe(true);

    const runId = randomRunId();
    const envelope = await seedFixtureFromSiteAdmin(IDP_BASE, runId, {
      bearer: siteAdmin.bearer,
      email: SITE_ADMIN_EMAIL,
      password: bootstrapPassword,
      totpSecret: siteAdmin.totpSecret,
    });

    // Validate BEFORE writing: the loader's invariants (marker, schema, reserved
    // e2e-<runID> prefixes, credential presence) must hold, or a dev-loop spec
    // would throw on import.
    const asOrgAdmin = validateFixture(envelope, "<in-memory>");
    expect(asOrgAdmin.email).toBe(`admin@e2e-${runId}.test`);

    const path = resolveFixturePath();
    mkdirSync(fixtureDirectory(), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Bind-mount platforms may reject chmod; the file is gitignored regardless.
    }
    // Non-secret confirmation only — never the credentials.
    process.stdout.write(`[provision] dev-loop fixture written (run ${runId}).\n`);
  });
});
