/**
 * THE-ADMIN-RESET (T-R2a, 2026-08-30) — TEST-spec R2: "admin reset without
 * customer data loss", proven live on the POPULATED appliance.
 *
 * Runs as the LAST witnessed phase (nothing after it may depend on
 * site_admin credentials, which this scenario rotates). The product path is
 * the one the OPERATOR-GUIDE documents: `identuum-idp recover-site-admin`
 * inside the appliance container, driven here via docker compose exec with
 * the run-local IDENTUUM_IDP_RECOVER_SITE_ADMIN_PASSWORD (never printed,
 * never asserted by value).
 *
 * What it proves, in order:
 *   1. PRE: the seeded tenant inventory is present BY ID (org active,
 *      org_admin + org_user logins work, both fixture OAuth clients and the
 *      fixture api-resource exist, the primary domain is listed).
 *   2. RESET: recover-site-admin exits 0 (password reset, MFA disabled,
 *      secret + recovery codes cleared — the measured CLI contract).
 *   3. POST, site_admin: the OLD password is refused; the NEW password goes
 *      through the first-login TOTP enrolment (MFA was reset) to a live
 *      bearer that exercises site_admin authority.
 *   4. POST, customer data: every item from (1) is STILL present by id and
 *      both tenant logins still work — the reset touched exactly one row.
 *   5. MEASURED, pinned as-is: whether site_admin sessions minted BEFORE
 *      the reset survive it. recoverSiteAdminCore updates the user row only
 *      — it revokes nothing — so a pre-reset bearer stays live until token
 *      expiry. Pinned at the measured value with this comment as the flag:
 *      an operator recovering a COMPROMISED admin would want those sessions
 *      dead. Reported as a product finding (wiki queue), not fixed here.
 *
 * DESTRUCTIVE BY DESIGN: rotates the appliance's site_admin credentials.
 * Disposable-harness only (IDENTUUM_E2E_ADMIN_RESET=1, set by full-run.sh's
 * dedicated phase); the appliance is torn down at run end.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { api, expectStatus, firstLoginBearerAsync } from "../e2e/helpers/appliance-fixture";
import { loadOrgAdminFixture, loadOrgUserFixture } from "../e2e/helpers/fixture";
import {
  refusedAfterFreshStepMessage,
  unconsumedTOTP,
  unconsumedTOTPAfterFreshStep,
} from "../e2e/helpers/totp";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";

// biome-ignore lint/suspicious/noExplicitAny: raw API JSON
type Json = any;

async function totpBearer(email: string, password: string, secret: string): Promise<string> {
  const login = await api(IDP_BASE, "POST", "/api/v1/auth/login", { email, password });
  if (login.status !== 401 || !login.json.session_id) {
    throw new Error(`${email}: want 401+session_id (mfa_required), got ${login.status}`);
  }
  // THE-SUITE-THAT-REPLAYED: one code from an unconsumed window, then exactly
  // one retry from a fresh step; a second refusal is a wrong seed, said so.
  const verify = (code: string) =>
    api(IDP_BASE, "POST", "/api/v1/auth/login/mfa", { session_id: login.json.session_id, code });
  let v = await verify(await unconsumedTOTP(secret, email));
  if (!(v.status === 200 && v.json.access_token)) {
    v = await verify(await unconsumedTOTPAfterFreshStep(secret, email));
  }
  if (v.status === 200 && v.json.access_token) return v.json.access_token as string;
  throw new Error(`${refusedAfterFreshStepMessage(email, email)} Last verify status: ${v.status}.`);
}

test.describe.configure({ mode: "serial" });

test.describe("admin reset without customer data loss (destructive, last phase)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_ADMIN_RESET !== "1",
    "admin-reset runs only as full-run.sh's dedicated LAST phase (it rotates site_admin credentials)"
  );

  test("recover-site-admin rotates exactly one row: site_admin resets, every tenant resource survives", async () => {
    test.setTimeout(180_000);
    const oldPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    const newPassword = process.env.IDENTUUM_E2E_RECOVERED_ADMIN_PASSWORD ?? "";
    const idpDir = process.env.IDENTUUM_E2E_IDP_DIR ?? "";
    expect(oldPassword.length, "harness must pass the bootstrap password").toBeGreaterThan(0);
    expect(newPassword.length, "harness must pass the run-local recovery password").toBeGreaterThan(
      0
    );
    expect(idpDir.length, "harness must pass IDENTUUM_E2E_IDP_DIR").toBeGreaterThan(0);

    const fx = loadOrgAdminFixture();
    const ufx = loadOrgUserFixture();
    expect(fx, "org_admin envelope present").toBeTruthy();
    expect(ufx, "org_user envelope present").toBeTruthy();
    if (!fx || !ufx) return;

    // ── 1. PRE: seeded tenant inventory, by id ──────────────────────────
    const oa = await totpBearer(fx.email, fx.password, fx.totpSecret);
    const prof = await api(IDP_BASE, "GET", "/api/v1/profile", undefined, oa);
    expectStatus(prof, 200);
    const orgId = String(
      (prof.json as Json).organization_id ?? (prof.json as Json).user?.organization_id
    );

    const clientsPre = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, oa);
    expectStatus(clientsPre, 200);
    const clientIdsPre = ((clientsPre.json as Json).clients ?? []).map((c: Json) => String(c.id));
    const resourcesPre = await api(IDP_BASE, "GET", "/api/v1/api-resources", undefined, oa);
    expectStatus(resourcesPre, 200);
    const resourceIdsPre = ((resourcesPre.json as Json).api_resources ?? []).map((r: Json) =>
      String(r.id)
    );
    const domainsPre = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/domains`,
      undefined,
      oa
    );
    expectStatus(domainsPre, 200);
    expect(clientIdsPre.length, "provisioner seeded OAuth clients").toBeGreaterThan(0);
    expect(resourceIdsPre.length, "provisioner seeded an api-resource").toBeGreaterThan(0);

    // A site_admin session minted BEFORE the reset (for the measured pin in 5).
    const preResetSite = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, oldPassword);

    // ── 2. RESET via the product CLI (password via env, never printed) ──
    // The harness's OWN project (full-run.sh exports it; the app container is
    // named after it) — never a default that would name the dev stack's.
    const project = process.env.IDENTUUM_IDP_COMPOSE_PROJECT ?? "";
    expect(project, "the harness exports its own Compose project").toBe("identuum-e2e");
    const dsn = execFileSync(
      "docker",
      ["inspect", project, "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
      { encoding: "utf8" }
    )
      .split("\n")
      .find((l) => l.startsWith("IDENTUUM_IDP_OSS_DB="))
      ?.slice("IDENTUUM_IDP_OSS_DB=".length);
    expect(dsn, "appliance DB DSN resolvable from the container env").toBeTruthy();
    const out = execFileSync(
      "docker",
      [
        "compose",
        "-p",
        project,
        "-f",
        `${idpDir}/deployment/docker-compose.dev.yml`,
        "--profile",
        "app",
        "exec",
        "-T",
        "-e",
        "IDENTUUM_IDP_RECOVER_SITE_ADMIN_PASSWORD",
        "app",
        "/app/identuum-idp",
        "recover-site-admin",
        String(dsn),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, IDENTUUM_IDP_RECOVER_SITE_ADMIN_PASSWORD: newPassword },
      }
    );
    expect(out, "CLI confirms the reset").toContain("site_admin password updated");
    expect(out, "CLI confirms the MFA reset").toContain("mfa_reset=true");

    // ── 3. POST: old password dead; new password → first-login enrolment ──
    const oldLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: SITE_ADMIN_EMAIL,
      password: oldPassword,
    });
    expectStatus(oldLogin, 401, "old site_admin password refused after reset");
    expect(oldLogin.json.session_id, "and no MFA session is opened for it").toBeFalsy();

    const recovered = await firstLoginBearerAsync(IDP_BASE, SITE_ADMIN_EMAIL, newPassword);
    const validate = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, recovered.bearer);
    expectStatus(validate, 200, "recovered site_admin bearer is live");
    const orgRead = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}`,
      undefined,
      recovered.bearer
    );
    expectStatus(orgRead, 200, "recovered site_admin exercises org-lifecycle authority");
    expect((orgRead.json as Json).active, "the tenant org is still active").toBe(true);

    // ── 4. POST: customer data intact, by id; tenant logins unaffected ──
    const oa2 = await totpBearer(fx.email, fx.password, fx.totpSecret);
    const clientsPost = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, oa2);
    expectStatus(clientsPost, 200);
    const clientIdsPost = ((clientsPost.json as Json).clients ?? []).map((c: Json) => String(c.id));
    for (const id of clientIdsPre) {
      expect(clientIdsPost, `client ${id} survived the reset`).toContain(id);
    }
    const resourcesPost = await api(IDP_BASE, "GET", "/api/v1/api-resources", undefined, oa2);
    const resourceIdsPost = ((resourcesPost.json as Json).api_resources ?? []).map((r: Json) =>
      String(r.id)
    );
    for (const id of resourceIdsPre) {
      expect(resourceIdsPost, `api-resource ${id} survived the reset`).toContain(id);
    }
    const domainsPost = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/domains`,
      undefined,
      oa2
    );
    expectStatus(domainsPost, 200);
    expect(
      ((domainsPost.json as Json).organization_domains ?? []).length,
      "domain rows survived the reset"
    ).toBe(((domainsPre.json as Json).organization_domains ?? []).length);

    const ouLogin = await totpBearer(ufx.email, ufx.password, ufx.totpSecret);
    const ouValidate = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, ouLogin);
    expectStatus(ouValidate, 200, "org_user login and session unaffected");

    // ── 5. MEASURED PIN: pre-reset site_admin sessions SURVIVE the reset ──
    // recoverSiteAdminCore updates the user row only — nothing revokes the
    // old sessions, so a bearer minted before the reset stays live to token
    // expiry. Pinned as measured; flagged as a product finding (an operator
    // recovering a COMPROMISED admin needs those sessions dead). If this
    // flips to 401, the product started revoking on recover — update this
    // pin AND close the finding.
    const preResetValidate = await api(
      IDP_BASE,
      "GET",
      "/api/v1/validate",
      undefined,
      preResetSite.bearer
    );
    expect(
      preResetValidate.status,
      "MEASURED: pre-reset site_admin session survives recover-site-admin (finding: no revocation on admin reset)"
    ).toBe(200);
  });
});
