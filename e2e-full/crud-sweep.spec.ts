/**
 * THE-CRUD-SWEEP (2026-08-28) — batch 3 of the census complement.
 *
 * Covers the 19 CRUD-shaped census-NEITHER rows across five families —
 * users (5), clients (3), api-resources (4), scope-templates (4), admin
 * backchannel (3) — every row with a measured non-2xx, and CROSS-TENANT
 * asserted on every org-scoped resource (org_admin of A against org B's
 * row, recording WHICH status: a 404 hiding a 403 is the audi.de class).
 *
 * Auth scoping (docgen, verified): admin/*, api-resources/*,
 * scope-templates/* are the org-own org_admin’s (site_admin → 403, THE-SCOPE-TEMPLATES); users/restore is site_admin-only;
 * clients/* and users roles/approve/reset-mfa are site_admin|org_admin.
 *
 * MEASURED behaviors pinned (findings recorded in the wiki, suite stays
 * green — a defect is a queue row, never a red spec):
 *  - user restore RECOVERS a soft-deleted user (200 {"restored": id}) —
 *    RestoreUserForActor now reads through the deleted-inclusive admin
 *    lookup (USER-RESTORE-DEAD-1 FIXED, rule RESTORE-RECOVERS-DELETED-1).
 *    The route stays site_admin-only; cross-tenant refusal is pinned in the
 *    Go teeth test.
 *  - approve + reset-mfa on a NONEXISTENT user id → 404 (the repo not-found
 *    now maps to the service sentinel; USER-APPROVE-RESETMFA-GHOST-500-1
 *    FIXED, rule USER-NOTFOUND-MAPPING-1). The cross-tenant case still 404s.
 *  - role unassign authorizes on the ROLE, not the user: a cross-tenant
 *    user id is a harmless 200 no-op (the binding can't cross tenants);
 *    role ASSIGN checks the user's tenant and 403s — an asymmetry, not a
 *    leak.
 *  - client delete is documented-idempotent (200 even cross-tenant),
 *    while client put cross-tenant 404s — both scope the WHERE to the
 *    actor's org, so B's client SURVIVES A's cross-tenant delete (asserted).
 *  - admin backchannel replay's outbound-delivery path
 *    (202 delivered:false / 409 client_gone / 503) is
 *    ENVIRONMENT-UNREACHABLE: a delivery row is created only by
 *    OIDC end_session, which needs an `identuum_session` cookie (browser
 *    login — CSRF-dead over plain HTTP, BROWSER-LOGIN-PLAINHTTP-1) or a
 *    signed id_token_hint (authorize/consent, same gate). Source: the
 *    backchannel HTTP client has a 3s timeout, so a live replay to a dead
 *    target would block ~3s and record delivered:false. Here only the
 *    empty-table branches (400/404/403) are reachable.
 */
import { expect, test } from "@playwright/test";
import { api, firstLoginBearerAsync } from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("crud sweep (19 census rows, cross-tenant on every owned row)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  const A = { id: "", bearer: "" };
  const B = { id: "", bearer: "" };
  let runId = "";
  let uId = "";
  let uIdB = "";
  let resId = "";
  let roleId = "";

  const mkOrg = async (n: string) => {
    const c = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `${n} ${runId}`,
        slug: `${runId}-${n}`,
        domain: `${runId}-${n}.test`,
        admin_email: `admin@${runId}-${n}.test`,
      },
      site.bearer
    );
    expect(c.status).toBe(201);
    const id = (c.json.organization as { id?: string })?.id ?? "";
    const rs = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${id}/resend-activation`,
      {},
      site.bearer
    );
    const pw = `Adm!${runId}${n}9wqX`;
    await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: (rs.json as { activation_token?: string }).activation_token,
      password: pw,
    });
    const admin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}-${n}.test`, pw);
    return { id, bearer: admin.bearer };
  };

  test("setup: shared session, two tenant orgs, a user in each", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length).toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `crud-${Date.now().toString(36)}`;
    const a = await mkOrg("a");
    A.id = a.id;
    A.bearer = a.bearer;
    const b = await mkOrg("b");
    B.id = b.id;
    B.bearer = b.bearer;

    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      {
        email: `u@${runId}-a.test`,
        password: `Usr!${runId}3kpZ`,
        role: "org_user",
        organization_id: A.id,
      },
      A.bearer
    );
    expect(uc.status).toBe(201);
    uId = uc.json.id as string;
    await api(IDP_BASE, "PUT", `/api/v1/users/${uId}`, { email_verified: true }, A.bearer);
    const ucB = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      {
        email: `u@${runId}-b.test`,
        password: `Usr!${runId}3kpZ`,
        role: "org_user",
        organization_id: B.id,
      },
      B.bearer
    );
    expect(ucB.status).toBe(201);
    uIdB = ucB.json.id as string;

    // THE-INVERTED-GUARD: api-resources answer to the org's own org_admin.
    const ar = await api(
      IDP_BASE,
      "POST",
      "/api/v1/api-resources",
      {
        organization_id: A.id,
        name: `res-${runId}`,
        audience: `https://api.${runId}.test`,
        token_ttl_secs: 3600,
        scopes: [{ Name: "read" }],
      },
      A.bearer
    );
    expect(ar.status).toBe(201);
    resId = (ar.json.api_resource as { id?: string })?.id ?? "";
    const role = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${A.id}/roles`,
      { name: `role-${runId}` },
      A.bearer
    );
    expect(role.status).toBe(201);
    roleId = (role.json.id as string) ?? "";
  });

  test("users/:id/roles — assign, unassign, cross-tenant", async () => {
    // ROW POST /users/:id/roles (SM)
    const assign = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${uId}/roles`,
      { role_id: roleId },
      A.bearer
    );
    expect(assign.status, "role assign → 200").toBe(200);
    const badBody = await api(IDP_BASE, "POST", `/api/v1/users/${uId}/roles`, {}, A.bearer);
    expect(badBody.status, "assign without role_id → 400").toBe(400);
    const ghostUser = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${GHOST}/roles`,
      { role_id: roleId },
      A.bearer
    );
    expect(ghostUser.status, "assign to a nonexistent user → 400").toBe(400);
    const xtenant = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${uIdB}/roles`,
      { role_id: roleId },
      A.bearer
    );
    expect(xtenant.status, "assign A's role to B's user → 403 (assign checks user tenant)").toBe(
      403
    );

    // ROW DELETE /users/:id/roles/:role_id (D)
    const unassign = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/users/${uId}/roles/${roleId}`,
      undefined,
      A.bearer
    );
    expect(unassign.status, "unassign → 200").toBe(200);
    const ghostRole = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/users/${uId}/roles/${GHOST}`,
      undefined,
      A.bearer
    );
    expect(ghostRole.status, "unassign a nonexistent role → 404").toBe(404);
    const unassignXtenant = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/users/${uIdB}/roles/${roleId}`,
      undefined,
      A.bearer
    );
    expect(
      unassignXtenant.status,
      "unassign against B's user → 200 no-op (unassign authorizes on the role, not the user)"
    ).toBe(200);
  });

  test("users/:id/approve — not-pending, ghost-500, cross-tenant", async () => {
    // ROW POST /users/:id/approve (SM). MEASURED: the happy 200 needs a
    // pending self-registered user (public registration + approval-required
    // org), not built here — the error branches are the coverage.
    const notPending = await api(IDP_BASE, "POST", `/api/v1/users/${uId}/approve`, {}, A.bearer);
    expect(notPending.status, "approve a non-pending user → 409").toBe(409);
    const badId = await api(IDP_BASE, "POST", "/api/v1/users/not-a-uuid/approve", {}, A.bearer);
    expect(badId.status, "malformed id → 400").toBe(400);
    const xtenant = await api(IDP_BASE, "POST", `/api/v1/users/${uIdB}/approve`, {}, A.bearer);
    expect(xtenant.status, "approve B's user → 404 (anti-enumeration)").toBe(404);
    const ghost = await api(IDP_BASE, "POST", `/api/v1/users/${GHOST}/approve`, {}, A.bearer);
    expect(
      ghost.status,
      "approve a nonexistent user → 404 (repo not-found now maps to the service sentinel, USER-NOTFOUND-MAPPING-1)"
    ).toBe(404);
  });

  test("users/:id/recovery/reset-mfa — happy, ghost-500, cross-tenant", async () => {
    // ROW POST /users/:id/recovery/reset-mfa (D)
    const ok = await api(IDP_BASE, "POST", `/api/v1/users/${uId}/recovery/reset-mfa`, {}, A.bearer);
    expect(ok.status, "reset-mfa on an own-tenant user → 200").toBe(200);
    const xtenant = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${uIdB}/recovery/reset-mfa`,
      {},
      A.bearer
    );
    expect(xtenant.status, "reset-mfa on B's user → 404 (anti-enumeration)").toBe(404);
    const ghost = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${GHOST}/recovery/reset-mfa`,
      {},
      A.bearer
    );
    expect(
      ghost.status,
      "reset-mfa on a nonexistent user → 404 (same fix, USER-NOTFOUND-MAPPING-1)"
    ).toBe(404);
  });

  test("users/:id/restore — recovers a soft-deleted user (RESTORE-RECOVERS-DELETED-1)", async () => {
    // ROW POST /users/:id/restore (D). Soft-delete the user, then restore:
    // the fix reads through the deleted-inclusive admin lookup, so restore
    // now recovers the row (happy path 200 {"restored": <id>}). Authorization
    // is unchanged — the route stays site_admin-only (org_admin → 403), and
    // the service-level cross-tenant refusal is pinned in the Go teeth test
    // TestRestoreUserForActor_CrossTenantStillRefused.
    const del = await api(IDP_BASE, "DELETE", `/api/v1/users/${uId}`, undefined, site.bearer);
    expect(del.status, "soft-delete → 200").toBe(200);
    const restore = await api(IDP_BASE, "POST", `/api/v1/users/${uId}/restore`, {}, site.bearer);
    expect(restore.status, "restore of a soft-deleted user → 200 (recovered)").toBe(200);
    expect(restore.json.restored, "response names the restored id").toBe(uId);
    const ghost = await api(IDP_BASE, "POST", `/api/v1/users/${GHOST}/restore`, {}, site.bearer);
    expect(ghost.status, "restore of a nonexistent user → 404").toBe(404);
    const orgAdmin = await api(IDP_BASE, "POST", `/api/v1/users/${uId}/restore`, {}, A.bearer);
    expect(orgAdmin.status, "restore by org_admin (site_admin-only route) → 403").toBe(403);
  });

  test("clients — put/regen/delete, cross-tenant scoped, B survives", async () => {
    const cl = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      { name: `cl-${runId}`, redirect_uris: ["https://ui.example.test/cb"] },
      A.bearer
    );
    expect(cl.status).toBe(201);
    const clId = (cl.json.client as { id?: string })?.id ?? "";
    const clB = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      { name: `clb-${runId}`, redirect_uris: ["https://ui.example.test/cb"] },
      B.bearer
    );
    expect(clB.status).toBe(201);
    const clIdB = (clB.json.client as { id?: string })?.id ?? "";

    // ROW PUT /clients/:id (SM)
    const put = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${clId}`,
      { name: `cl2-${runId}` },
      A.bearer
    );
    expect(put.status, "own client update → 200").toBe(200);
    const putXtenant = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${clIdB}`,
      { name: "x" },
      A.bearer
    );
    expect(putXtenant.status, "update B's client → 404 (scoped, anti-enumeration)").toBe(404);
    const putGhost = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/clients/${GHOST}`,
      { name: "x" },
      A.bearer
    );
    expect(putGhost.status, "update a nonexistent client → 404").toBe(404);

    // ROW POST /clients/:id/secret/regenerate (D)
    const regen = await api(
      IDP_BASE,
      "POST",
      `/api/v1/clients/${clId}/secret/regenerate`,
      {},
      A.bearer
    );
    expect(regen.status, "own client secret rotate → 200").toBe(200);
    const regenXtenant = await api(
      IDP_BASE,
      "POST",
      `/api/v1/clients/${clIdB}/secret/regenerate`,
      {},
      A.bearer
    );
    expect(regenXtenant.status, "rotate B's client secret → 404").toBe(404);

    // ROW DELETE /clients/:id (D) — idempotent by ruling (P3-14): 200 even
    // cross-tenant, but the WHERE scopes to the actor's org so B's client
    // is untouched.
    const delXtenant = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/clients/${clIdB}`,
      undefined,
      A.bearer
    );
    expect(delXtenant.status, "delete B's client → 200 (idempotent no-op, scoped WHERE)").toBe(200);
    const bSurvives = await api(IDP_BASE, "GET", `/api/v1/clients/${clIdB}`, undefined, B.bearer);
    expect(bSurvives.status, "…and B's client SURVIVES (no cross-tenant delete) → 200").toBe(200);
    const del = await api(IDP_BASE, "DELETE", `/api/v1/clients/${clId}`, undefined, A.bearer);
    expect(del.status, "own client delete → 200").toBe(200);
    const badId = await api(IDP_BASE, "DELETE", "/api/v1/clients/not-a-uuid", undefined, A.bearer);
    expect(badId.status, "malformed id → 400").toBe(400);
  });

  test("api-resources — org_admin CRUD in its own org; site_admin 403; cross-org reads as miss", async () => {
    // THE-INVERTED-GUARD (2026-08-30): this test pinned the OLD world
    // (site_admin CRUD, org_admin 403). AdminPermissionsModel.md is law:
    // the surface answers to the org's own org_admin, site_admin is
    // refused, and a foreign org's id is indistinguishable from a miss.
    // ROW GET /api-resources/:id (SR)
    const get = await api(IDP_BASE, "GET", `/api/v1/api-resources/${resId}`, undefined, A.bearer);
    expect(get.status, "own org_admin get → 200").toBe(200);
    const getSite = await api(
      IDP_BASE,
      "GET",
      `/api/v1/api-resources/${resId}`,
      undefined,
      site.bearer
    );
    expect(getSite.status, "site_admin get (tenant-owned surface) → 403").toBe(403);
    const getForeign = await api(
      IDP_BASE,
      "GET",
      `/api/v1/api-resources/${resId}`,
      undefined,
      B.bearer
    );
    expect(getForeign.status, "ANOTHER org's admin → 404, never a confirming 403").toBe(404);
    const getGhost = await api(
      IDP_BASE,
      "GET",
      `/api/v1/api-resources/${GHOST}`,
      undefined,
      A.bearer
    );
    expect(getGhost.status, "get nonexistent → 404").toBe(404);

    // ROW PUT /api-resources/:id (SM)
    const put = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/api-resources/${resId}`,
      { name: `res2-${runId}`, audience: `https://api.${runId}.test`, token_ttl_secs: 7200 },
      A.bearer
    );
    expect(put.status, "own update → 200").toBe(200);
    const putGhost = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/api-resources/${GHOST}`,
      { name: "x", audience: "https://x.test", token_ttl_secs: 3600 },
      A.bearer
    );
    expect(putGhost.status, "update nonexistent → 404").toBe(404);

    // ROW POST /api-resources/:id/secret/regenerate (D)
    const regen = await api(
      IDP_BASE,
      "POST",
      `/api/v1/api-resources/${resId}/secret/regenerate`,
      {},
      A.bearer
    );
    expect(regen.status, "own secret rotate → 200").toBe(200);
    const regenGhost = await api(
      IDP_BASE,
      "POST",
      `/api/v1/api-resources/${GHOST}/secret/regenerate`,
      {},
      A.bearer
    );
    expect(regenGhost.status, "rotate nonexistent → 404").toBe(404);

    // ROW DELETE /api-resources/:id (D)
    const delSite = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/api-resources/${resId}`,
      undefined,
      site.bearer
    );
    expect(delSite.status, "site_admin delete → 403").toBe(403);
    // A FOREIGN org's admin gets the documented idempotent success — and
    // the row SURVIVES: the org-scoped DELETE cannot match it.
    const delForeign = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/api-resources/${resId}`,
      undefined,
      B.bearer
    );
    expect(delForeign.status, "foreign delete → idempotent 200, confirms nothing").toBe(200);
    const survived = await api(
      IDP_BASE,
      "GET",
      `/api/v1/api-resources/${resId}`,
      undefined,
      A.bearer
    );
    expect(survived.status, "the row SURVIVES the foreign delete").toBe(200);
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/api-resources/${resId}`,
      undefined,
      A.bearer
    );
    expect(del.status, "own delete → 200").toBe(200);
    const badId = await api(
      IDP_BASE,
      "DELETE",
      "/api/v1/api-resources/not-a-uuid",
      undefined,
      A.bearer
    );
    expect(badId.status, "malformed id → 400").toBe(400);
  });

  test("scope-templates — org_admin CRUD in its own org; site_admin 403; cross-org 404; reserved prefix refused", async () => {
    // THE-SCOPE-TEMPLATES (2026-08-30): owner ruling — scope templates are a
    // tenant's own resource. org_admin manages its own; site_admin is refused;
    // a foreign template reads as a miss; and the reserved-prefix bound
    // (system:/keys:/backups:), unwired until this slice, is now enforced.
    const create = await api(
      IDP_BASE,
      "POST",
      "/api/v1/scope-templates",
      { name: `st-${runId}`, scopes: ["read", "write"] },
      A.bearer
    );
    expect(create.status, "own org_admin create -> 201").toBe(201);
    const stId = (create.json.id as string) ?? "";
    expect(stId.length).toBeGreaterThan(0);
    const createSite = await api(
      IDP_BASE,
      "POST",
      "/api/v1/scope-templates",
      { name: `sts-${runId}`, scopes: ["read"] },
      site.bearer
    );
    expect(createSite.status, "site_admin create (tenant resource) -> 403").toBe(403);
    const createReserved = await api(
      IDP_BASE,
      "POST",
      "/api/v1/scope-templates",
      { name: `str-${runId}`, scopes: ["system:admin"] },
      A.bearer
    );
    expect(createReserved.status, "org_admin reserved-prefix create -> 400").toBe(400);
    const createBad = await api(IDP_BASE, "POST", "/api/v1/scope-templates", {}, A.bearer);
    expect(createBad.status, "empty body -> 400").toBe(400);

    const get = await api(IDP_BASE, "GET", `/api/v1/scope-templates/${stId}`, undefined, A.bearer);
    expect(get.status, "own get -> 200").toBe(200);
    const getGhost = await api(
      IDP_BASE,
      "GET",
      `/api/v1/scope-templates/${GHOST}`,
      undefined,
      A.bearer
    );
    expect(getGhost.status, "get nonexistent -> 404").toBe(404);
    const getForeign = await api(
      IDP_BASE,
      "GET",
      `/api/v1/scope-templates/${stId}`,
      undefined,
      B.bearer
    );
    expect(getForeign.status, "ANOTHER org admin -> 404, never a confirming 403").toBe(404);
    const getSite = await api(
      IDP_BASE,
      "GET",
      `/api/v1/scope-templates/${stId}`,
      undefined,
      site.bearer
    );
    expect(getSite.status, "site_admin get (tenant resource) -> 403").toBe(403);

    const put = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/scope-templates/${stId}`,
      { name: `st2-${runId}`, scopes: ["read"] },
      A.bearer
    );
    expect(put.status, "own update -> 200").toBe(200);
    const putReserved = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/scope-templates/${stId}`,
      { scopes: ["keys:rotate"] },
      A.bearer
    );
    expect(putReserved.status, "org_admin reserved-prefix update -> 400").toBe(400);
    const putGhost = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/scope-templates/${GHOST}`,
      { name: "x", scopes: ["read"] },
      A.bearer
    );
    expect(putGhost.status, "update nonexistent -> 404").toBe(404);

    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/scope-templates/${stId}`,
      undefined,
      A.bearer
    );
    expect(del.status, "own delete -> 200").toBe(200);
    const badId = await api(
      IDP_BASE,
      "DELETE",
      "/api/v1/scope-templates/not-a-uuid",
      undefined,
      A.bearer
    );
    expect(badId.status, "malformed id -> 400").toBe(400);
  });

  test("admin backchannel deliveries — list, get, replay (outbound unreachable)", async () => {
    // ROW GET /admin/backchannel-logout-deliveries (SR)
    const list = await api(
      IDP_BASE,
      "GET",
      "/api/v1/admin/backchannel-logout-deliveries",
      undefined,
      site.bearer
    );
    expect(list.status, "list → 200").toBe(200);
    const listOrgAdmin = await api(
      IDP_BASE,
      "GET",
      "/api/v1/admin/backchannel-logout-deliveries",
      undefined,
      A.bearer
    );
    expect(listOrgAdmin.status, "org_admin list (site_admin-only) → 403").toBe(403);

    // ROW GET /admin/backchannel-logout-deliveries/:id (SR)
    const getGhost = await api(
      IDP_BASE,
      "GET",
      `/api/v1/admin/backchannel-logout-deliveries/${GHOST}`,
      undefined,
      site.bearer
    );
    expect(getGhost.status, "get nonexistent → 404").toBe(404);
    const getBadId = await api(
      IDP_BASE,
      "GET",
      "/api/v1/admin/backchannel-logout-deliveries/not-a-uuid",
      undefined,
      site.bearer
    );
    expect(getBadId.status, "malformed id → 400").toBe(400);

    // ROW POST /admin/backchannel-logout-deliveries/:id/replay (D). The
    // outbound-delivery branch (202/409/503) is environment-unreachable: no
    // delivery row can be created without the OIDC end_session ceremony
    // (see the file header). The empty-table branches are the coverage.
    const replayGhost = await api(
      IDP_BASE,
      "POST",
      `/api/v1/admin/backchannel-logout-deliveries/${GHOST}/replay`,
      {},
      site.bearer
    );
    expect(replayGhost.status, "replay a nonexistent delivery → 404").toBe(404);
    const replayBadId = await api(
      IDP_BASE,
      "POST",
      "/api/v1/admin/backchannel-logout-deliveries/not-a-uuid/replay",
      {},
      site.bearer
    );
    expect(replayBadId.status, "replay malformed id → 400").toBe(400);
    const replayOrgAdmin = await api(
      IDP_BASE,
      "POST",
      `/api/v1/admin/backchannel-logout-deliveries/${GHOST}/replay`,
      {},
      A.bearer
    );
    expect(replayOrgAdmin.status, "org_admin replay → 403").toBe(403);
  });
});
