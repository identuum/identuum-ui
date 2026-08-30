/**
 * THE-ORGANIZATION-SWEEP (2026-08-28) — batch 1 of the census complement.
 *
 * Covers ALL 22 organizations-family rows that behavioral-census.md listed
 * as NEITHER (8 DESTRUCTIVE, 10 SAFE-MUTATING, 4 SAFE-READ), each with at
 * least one asserted NON-2xx branch — the 122-of-133 gap this suite exists
 * for. Every status here is MEASURED live (probe runs of 2026-08-28), not
 * intended; where live behavior surprised, it is pinned and the surprise is
 * recorded in the wiki (sweep section of platform/disposable-harness.md).
 *
 * Session sharing: ONE site_admin login (via the e2e-full session helper —
 * TOTP enrolment happens once per fresh DB, in whichever spec file runs
 * first) and ONE activated org_admin, reused across every request in this
 * file. Serial by --workers=1.
 *
 * Measured behaviors deliberately pinned:
 *  - domain verify on a .test domain → 503 "dns lookup failed": the happy
 *    200 needs real DNS the disposable environment cannot provide.
 *  - adding a role scope with an EMPTY body → 403, not 400 (the zero UUID
 *    binds, then resource ownership fails first).
 *  - restore of a live org → 404 (nothing deleted to restore).
 *  - org_admin PUT of own-org protocol settings → 200 (matches the docgen
 *    auth annotation site_admin|org_admin).
 *  - export-candidates is tenant-scoped for org_admin (own org only).
 */
import { expect, test } from "@playwright/test";
import { api, firstLoginBearerAsync } from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("organizations sweep (22 census rows, every one with a non-2xx)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  let orgAdmin = { bearer: "", totpSecret: "" };
  let runId = "";
  let org1 = "";

  test("setup: shared session + activated tenant org", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length, "harness must export the bootstrap password").toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `sweep-${Date.now().toString(36)}`;

    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `sweep1 ${runId}`,
        slug: `${runId}-1`,
        domain: `${runId}-1.test`,
        admin_email: `admin@${runId}-1.test`,
      },
      site.bearer
    );
    expect(created.status, "create org+pending admin → 201").toBe(201);
    org1 = (created.json.organization as { id?: string })?.id ?? "";
    expect(org1.length).toBeGreaterThan(0);

    // ROW resend-activation (D): happy on a pending org — re-issues the token.
    const resend = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/resend-activation`,
      {},
      site.bearer
    );
    expect(resend.status, "resend-activation on pending org → 200").toBe(200);
    const token = resend.json.activation_token as string;
    expect(token.length).toBeGreaterThan(0);

    const adminPw = `Adm!${runId}9wqX`;
    const activate = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token,
      password: adminPw,
    });
    expect(activate.status, "activation consume → 200").toBe(200);
    orgAdmin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}-1.test`, adminPw);
  });

  test("domains: add, primary, verify, delete — and their error branches", async () => {
    // ROW POST /organizations/:id/domains (SM)
    const add = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains`,
      { domain: `extra-${runId}.test` },
      orgAdmin.bearer
    );
    expect(add.status, "domain add → 201").toBe(201);
    const domId = (add.json.organization_domain as { id?: string })?.id ?? "";
    expect(domId.length).toBeGreaterThan(0);
    expect(
      (add.json.verification_token as string).length,
      "add returns the verification token + TXT record pair"
    ).toBeGreaterThan(0);
    const addBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains`,
      {},
      orgAdmin.bearer
    );
    expect(addBad.status, "domain add without a domain → 400").toBe(400);

    // ROW POST .../domains/:domain_id/primary (SM)
    const primary = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/primary`,
      {},
      orgAdmin.bearer
    );
    expect(primary.status, "set primary → 200").toBe(200);

    // ROW POST .../domains/:domain_id/verify (D) — MEASURED: the DNS TXT
    // lookup for a .test domain fails wholesale, so the live answer is 503
    // "dns lookup failed". The 200 branch needs real DNS the environment
    // cannot build — recorded as unreachable in the wiki.
    const verify = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/verify`,
      {},
      orgAdmin.bearer
    );
    expect(verify.status, "verify on a .test domain → 503 (dns lookup failed)").toBe(503);
    expect(verify.json.error).toBe("dns lookup failed");

    // ROW DELETE .../domains/:domain_id (D)
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/domains/${domId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(del.status, "domain delete → 200").toBe(200);
    const delAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/domains/${domId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAgain.status, "second domain delete → 404").toBe(404);
    const primaryGone = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/domains/${domId}/primary`,
      {},
      orgAdmin.bearer
    );
    expect(primaryGone.status, "primary on a deleted domain → 404").toBe(404);
  });

  test("identity provider: full CRUD and its error branches", async () => {
    // ROW GET /organizations/:id/identity-provider (SR) — 404 before create.
    const getBefore = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(getBefore.status, "get with none configured → 404").toBe(404);

    // ROW POST /organizations/:id/identity-provider (SM)
    const createBadType = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/identity-provider`,
      { type: "carrier-pigeon", name: "x", slug: "x", config: {} },
      orgAdmin.bearer
    );
    expect(createBadType.status, "create with an unknown type → 400").toBe(400);
    const create = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/identity-provider`,
      {
        type: "oidc",
        name: "Sweep IdP",
        slug: `sweep-${runId}`,
        config: {
          issuer_url: "https://accounts.example.test",
          client_id: "sweep-client",
          client_secret: "sweep-secret-not-real",
          redirect_uris: ["https://ui.example.test/callback"],
        },
      },
      orgAdmin.bearer
    );
    expect(create.status, "create OIDC provider → 201").toBe(201);

    const get = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(get.status, "get configured provider → 200").toBe(200);

    // ROW PUT /organizations/:id/identity-provider (SM) — a PUT is the whole
    // document: name-only is refused on the issuer validation, full passes.
    const updateBad = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/identity-provider`,
      { name: "Sweep IdP 2" },
      orgAdmin.bearer
    );
    expect(updateBad.status, "name-only update → 400 (issuer required)").toBe(400);
    const update = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/identity-provider`,
      {
        type: "oidc",
        name: "Sweep IdP 2",
        slug: `sweep-${runId}`,
        config: {
          issuer_url: "https://accounts.example.test",
          client_id: "sweep-client",
          client_secret: "sweep-secret-not-real",
          redirect_uris: ["https://ui.example.test/callback"],
        },
      },
      orgAdmin.bearer
    );
    expect(update.status, "full-document update → 200").toBe(200);

    // ROW DELETE /organizations/:id/identity-provider (D)
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(del.status, "delete provider → 200").toBe(200);
    const delAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/identity-provider`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAgain.status, "second delete → 404").toBe(404);
  });

  test("protocol settings: upsert and its refusals", async () => {
    // ROW PUT /organizations/:id/protocol-settings (SM)
    const put = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      { dynamic_client_registration_enabled: true, scim_enabled: false },
      site.bearer
    );
    expect(put.status, "site_admin upsert → 200").toBe(200);
    expect(put.json.source, "explicit settings report their source").toBe("explicit");
    const putEmpty = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      {},
      site.bearer
    );
    expect(putEmpty.status, "empty upsert → 400 (both fields required)").toBe(400);
    const putOrgAdmin = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/protocol-settings`,
      { dynamic_client_registration_enabled: false, scim_enabled: false },
      orgAdmin.bearer
    );
    expect(
      putOrgAdmin.status,
      "org_admin upsert of OWN org → 200 (docgen: site_admin|org_admin)"
    ).toBe(200);
  });

  test("org roles + scopes: full CRUD and error branches", async () => {
    // THE-INVERTED-GUARD: api-resources answer to the org's own org_admin.
    const resource = await api(
      IDP_BASE,
      "POST",
      "/api/v1/api-resources",
      {
        organization_id: org1,
        name: `sweep-res-${runId}`,
        audience: `https://api.${runId}.test`,
        token_ttl_secs: 3600,
        scopes: [{ Name: "read" }],
      },
      orgAdmin.bearer
    );
    expect(resource.status, "api-resource for scope binding → 201").toBe(201);
    const resId = (resource.json.api_resource as { id?: string })?.id ?? "";
    expect(resId.length).toBeGreaterThan(0);

    // ROW POST /organizations/:id/roles (SM)
    const role = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      { name: `sweep-role-${runId}` },
      orgAdmin.bearer
    );
    expect(role.status, "role create → 201").toBe(201);
    const roleId = (role.json.id as string) ?? "";
    expect(roleId.length).toBeGreaterThan(0);
    const roleBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles`,
      {},
      orgAdmin.bearer
    );
    expect(roleBad.status, "role create without a name → 400").toBe(400);

    // ROW GET /organizations/:id/roles/:role_id (SR)
    const get = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(get.status, "role get → 200").toBe(200);

    // ROW PUT /organizations/:id/roles/:role_id (SM)
    const update = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      { name: `sweep-role2-${runId}` },
      orgAdmin.bearer
    );
    expect(update.status, "role update → 200").toBe(200);

    // ROW POST .../roles/:role_id/scopes (SM)
    const scopeAdd = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes`,
      { resource_id: resId, scope_name: "read" },
      orgAdmin.bearer
    );
    expect(scopeAdd.status, "scope add → 200").toBe(200);
    // MEASURED: an empty body BINDS (zero UUID) and fails on resource
    // ownership first — 403, not 400.
    const scopeAddBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes`,
      {},
      orgAdmin.bearer
    );
    expect(scopeAddBad.status, "scope add with empty body → 403 (zero UUID not owned)").toBe(403);

    // ROW DELETE .../roles/:role_id/scopes/:scope_name (D)
    const scopeDel = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes/read`,
      undefined,
      orgAdmin.bearer
    );
    expect(scopeDel.status, "scope remove → 200").toBe(200);

    // ROW DELETE /organizations/:id/roles/:role_id (D)
    const roleDel = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(roleDel.status, "role delete → 200").toBe(200);
    const getGone = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(getGone.status, "role get after delete → 404").toBe(404);
    const updateGone = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      { name: "ghost" },
      orgAdmin.bearer
    );
    expect(updateGone.status, "role update after delete → 404").toBe(404);
    const roleDelAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(roleDelAgain.status, "second role delete → 404").toBe(404);
    const scopeDelGone = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org1}/roles/${roleId}/scopes/read`,
      undefined,
      orgAdmin.bearer
    );
    expect(scopeDelGone.status, "scope remove on a deleted role → 404").toBe(404);
  });

  test("service accounts: create, bundle, refusals", async () => {
    // ROW POST /organizations/:id/service-accounts (SM)
    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      { name: `sweep-sa-${runId}` },
      orgAdmin.bearer
    );
    expect(sa.status, "service-account create → 201").toBe(201);
    const saBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts`,
      {},
      orgAdmin.bearer
    );
    expect(saBad.status, "service-account create without a name → 400").toBe(400);

    // ROW POST /organizations/:id/service-accounts/with-client (SM)
    const bundle = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts/with-client`,
      {
        service_account: { name: `sweep-sab-${runId}` },
        client: { name: `sweep-sab-client-${runId}` },
      },
      orgAdmin.bearer
    );
    expect(bundle.status, "bundle create → 201").toBe(201);
    const bundleBad = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/service-accounts/with-client`,
      {},
      orgAdmin.bearer
    );
    expect(bundleBad.status, "bundle create with empty body → 400").toBe(400);
  });

  test("lifecycle: delete, restore, and the reads — with their refusals", async () => {
    const c2 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      { name: `sweep2 ${runId}`, slug: `${runId}-2`, domain: `${runId}-2.test`, active: true },
      site.bearer
    );
    expect(c2.status).toBe(201);
    const org2 = (c2.json.id as string) ?? (c2.json.organization as { id?: string })?.id ?? "";
    expect(org2.length).toBeGreaterThan(0);

    // ROW DELETE /organizations/:id (D)
    const delAsOrgAdmin = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org2}`,
      undefined,
      orgAdmin.bearer
    );
    expect(delAsOrgAdmin.status, "org delete by org_admin (other org) → 403").toBe(403);
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${org2}`,
      undefined,
      site.bearer
    );
    expect(del.status, "org soft-delete → 200").toBe(200);

    // ROW POST /organizations/:id/restore (D)
    const restore = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org2}/restore`,
      {},
      site.bearer
    );
    expect(restore.status, "org restore → 200").toBe(200);
    const restoreAgain = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org2}/restore`,
      {},
      site.bearer
    );
    expect(restoreAgain.status, "restore of a live org → 404 (nothing deleted to restore)").toBe(
      404
    );
    const delGhost = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/organizations/${GHOST}`,
      undefined,
      site.bearer
    );
    expect(delGhost.status, "delete of a nonexistent org → 404").toBe(404);

    // ROW resend-activation error branch: an ACTIVE org refuses re-issue.
    const resendActive = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/resend-activation`,
      {},
      site.bearer
    );
    expect(resendActive.status, "resend-activation on an active org → 409").toBe(409);

    // ROW GET /organizations/:id/admin-recovery-candidates (SR)
    const rec = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${org1}/admin-recovery-candidates`,
      undefined,
      site.bearer
    );
    expect(rec.status, "recovery candidates → 200").toBe(200);
    const recBad = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/not-a-uuid/admin-recovery-candidates",
      undefined,
      site.bearer
    );
    expect(recBad.status, "recovery candidates with a malformed id → 400").toBe(400);

    // ROW GET /organizations/export-candidates (SR)
    const exp = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/export-candidates",
      undefined,
      site.bearer
    );
    expect(exp.status, "export candidates (site_admin) → 200").toBe(200);
    const expOrgAdmin = await api(
      IDP_BASE,
      "GET",
      "/api/v1/organizations/export-candidates",
      undefined,
      orgAdmin.bearer
    );
    expect(expOrgAdmin.status, "export candidates (org_admin) → 200, tenant-scoped").toBe(200);
    expect(
      (expOrgAdmin.json.organizations as unknown[]).length,
      "org_admin sees exactly their own org"
    ).toBe(1);
    const expNoAuth = await api(IDP_BASE, "GET", "/api/v1/organizations/export-candidates");
    expect(expNoAuth.status, "export candidates unauthenticated → 401").toBe(401);
  });
});
