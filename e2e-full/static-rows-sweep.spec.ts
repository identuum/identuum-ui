/**
 * THE-PROBES-THAT-STAY — the standing static-rows sweep.
 *
 * The behavioral census's 23 static-only rows (13 PAGE-LOAD + 10 INTERACTION)
 * were one-shot-probed by THE-UNFIRED-ROWS / THE-REMAINING-CLICKS; a one-shot
 * probe is a claim about one commit. This sweep re-asserts, EVERY harness run,
 * the exact status + shape each probe measured — including the two rows those
 * slices opened (121: the GET itself is fine; 126: the measured
 * different-contract verdict is pinned as-is). Runs as its own gate-witness
 * phase AFTER the provisioner (it needs the org_admin envelope); the
 * static-rows-from-run.mjs step then requires the full committed row set to
 * have PASSED — a skipped or deleted row test reads as STATIC ROWS DRIFT, so
 * this spec self-skipping can never read green (the STALE-SPEC-COPY lesson).
 *
 * Side effects, stated: every mutating row is asserted with a benign-FAILING
 * payload (wrong current password, empty MFA proof, random UUIDs, invalid
 * body, invite-shaped bulk row that the backend refuses per row) EXCEPT
 * [ROW 21] recovery-codes/regenerate, which really rotates the fixture
 * org_admin's recovery codes — confined to THIS disposable appliance (torn
 * down at run end; codes are never used by any harness login, which are all
 * TOTP). No durable fixture is ever mutated. No secret, code, or token value
 * is logged or asserted by value.
 */

import { expect, test } from "@playwright/test";
import { api } from "../e2e/helpers/appliance-fixture";
import { loadOrgAdminFixture, loadOrgUserFixture } from "../e2e/helpers/fixture";
import { generateTOTP } from "../e2e/helpers/totp";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const RAND = "00000000-0000-7000-0000-0000000000bb";

// biome-ignore lint/suspicious/noExplicitAny: raw API JSON
type Json = any;

async function bearerFor(email: string, password: string, totpSecret: string): Promise<string> {
  const login = await api(IDP_BASE, "POST", "/api/v1/auth/login", { email, password });
  if (login.status !== 401 || !login.json.session_id) {
    throw new Error(`org_admin login: want 401+session_id (mfa_required), got ${login.status}`);
  }
  for (let win = 0; win <= 2; win++) {
    const v = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa", {
      session_id: login.json.session_id,
      code: generateTOTP(totpSecret, win),
    });
    if (v.status === 200 && v.json.access_token) return v.json.access_token as string;
    // TOTP replay protection refuses a consumed code; walk windows forward.
  }
  throw new Error("org_admin login: no TOTP window accepted (replay guard)");
}

test.describe.configure({ mode: "serial" });

test.describe("static census rows, asserted live every run (opt-in phase)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_STATIC_ROWS !== "1",
    "static-rows sweep runs only in full-run.sh's dedicated phase (needs the provisioned envelope)"
  );

  let sa = "";
  let oa = "";
  let ou = "";
  let orgId = "";
  let myId = "";
  let saId = "";

  test.beforeAll(async () => {
    const bootstrapPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    if (!bootstrapPassword) throw new Error("harness must pass the bootstrap password");
    sa = (await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, bootstrapPassword)).bearer;

    const fx = loadOrgAdminFixture();
    if (!fx) throw new Error("org_admin envelope missing — phase must run after the provisioner");
    oa = await bearerFor(fx.email, fx.password, fx.totpSecret);

    // THE-ROLE-CENSUS T4-1: the org_user is the third credential type the
    // suite must cover — the fixture org's REQUIRED MFA policy means it is
    // TOTP-enrolled like the admins, so the same login helper applies.
    const ufx = loadOrgUserFixture();
    if (!ufx) throw new Error("org_user envelope missing — phase must run after the provisioner");
    ou = await bearerFor(ufx.email, ufx.password, ufx.totpSecret);

    const prof = await api(IDP_BASE, "GET", "/api/v1/profile", undefined, oa);
    if (prof.status !== 200) throw new Error(`profile bootstrap read: ${prof.status}`);
    const pj = prof.json as Json;
    orgId = String(pj.organization_id ?? pj.user?.organization_id ?? "");
    myId = String(pj.id ?? pj.user?.id ?? "");
    if (!orgId || !myId) throw new Error("profile did not yield org/user ids");
  });

  // ── org_admin reads ──
  test("[ROW 82] GET /profile — 200, identity shape", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/profile", undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("email");
    expect(r.json).toHaveProperty("role");
  });

  test("[ROW 9] GET /audit/events — 200 {events,has_more}", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/audit/events?limit=5", undefined, oa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.events)).toBe(true);
    expect(r.json).toHaveProperty("has_more");
  });

  test("[ROW 22] GET /me/mfa/status — 200, status shape", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/me/mfa/status", undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("mfa_enabled");
    expect(r.json).toHaveProperty("totp_enrolled");
  });

  test("[ROW 36] GET /clients — 200 for org_admin (own org), 403 for site_admin (THE-CLIENTS-GUARD)", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, oa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.clients)).toBe(true);
    expect(r.json).toHaveProperty("total");
    // THE-CLIENTS-GUARD (2026-08-30): site_admin had listed EVERY org's
    // clients (unscoped) before the fix — now refused. Pinned every run.
    const refused = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, sa);
    expect(refused.status).toBe(403);
  });

  test("[ROW 39] GET /clients/:id — 200 full client shape (real id)", async () => {
    const list = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, oa);
    const id = (list.json as Json).clients?.[0]?.id;
    expect(id, "provisioner seeds at least one OAuth client").toBeTruthy();
    const r = await api(IDP_BASE, "GET", `/api/v1/clients/${id}`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("client_id");
    expect(r.json).toHaveProperty("redirect_uris");
  });

  test("[ROW 61] GET /organizations/:id/domains — 200 org_admin, 403 site_admin (THE-REMAINING-FOUR)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/organizations/${orgId}/domains`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("organization_domains");
    const refused = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/domains`,
      undefined,
      sa
    );
    expect(refused.status).toBe(403);
  });

  test("[ROW 84] GET /organizations/:id/roles — 200 org_admin, 403 site_admin (THE-REMAINING-FOUR)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/organizations/${orgId}/roles`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("roles");
    const refused = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/roles`,
      undefined,
      sa
    );
    expect(refused.status).toBe(403);
  });

  test("[ROW 91] GET /users/:id/roles — 200 org_admin, 403 site_admin (THE-REMAINING-FOUR)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/users/${myId}/roles`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("roles");
    const refused = await api(IDP_BASE, "GET", `/api/v1/users/${myId}/roles`, undefined, sa);
    expect(refused.status).toBe(403);
  });

  test("[ROW 94] GET /scope-templates — 200 org_admin, 403 site_admin (THE-SCOPE-TEMPLATES)", async () => {
    // THE-SCOPE-TEMPLATES (2026-08-30): owner ruling flipped this from
    // site_admin-only to the org's own org_admin. org_admin now READS its
    // templates (200); site_admin — which used to be the only allowed role —
    // is refused.
    const r = await api(IDP_BASE, "GET", "/api/v1/scope-templates", undefined, oa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.scope_templates)).toBe(true);
    const refused = await api(IDP_BASE, "GET", "/api/v1/scope-templates", undefined, sa);
    expect(refused.status).toBe(403);
  });

  test("[ROW 99] GET /organizations/:id/service-accounts — 200 org_admin, 403 site_admin (THE-REMAINING-FOUR)", async () => {
    const r = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/service-accounts`,
      undefined,
      oa
    );
    expect(r.status).toBe(200);
    const refused = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/service-accounts`,
      undefined,
      sa
    );
    expect(refused.status).toBe(403);
  });

  test("[ROW 118] GET /users — 200 paged list", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/users?limit=1", undefined, oa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.users)).toBe(true);
  });

  test("[ROW 121] GET /users/:id — 200 (own id; the row THE-REMAINING-CLICKS opened via its dead resend wire)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/users/${myId}`, undefined, oa);
    expect(r.status).toBe(200);
    expect(String((r.json as Json).id ?? (r.json as Json).user?.id)).toBe(myId);
  });

  // ── org_admin mutating rows, benign-failing payloads ──
  test("[ROW 12] POST /auth/change-password — 403 on wrong current password (enforcing; nothing changed)", async () => {
    const r = await api(
      IDP_BASE,
      "POST",
      "/api/v1/auth/change-password",
      { current_password: "Wrong!Password123", new_password: "NeverApplied!123" },
      oa
    );
    expect(r.status).toBe(403);
    expect(r.json).toHaveProperty("error");
  });

  test("[ROW 20] POST /me/mfa/disable — 403 on empty proof (enforcing; MFA stays on)", async () => {
    const r = await api(IDP_BASE, "POST", "/api/v1/me/mfa/disable", { code: "", password: "" }, oa);
    expect(r.status).toBe(403);
    expect(r.json).toHaveProperty("error");
  });

  test("[ROW 21] POST /me/mfa/recovery-codes/regenerate — 200 (REALLY rotates; disposable appliance only)", async () => {
    const r = await api(
      IDP_BASE,
      "POST",
      "/api/v1/me/mfa/recovery-codes/regenerate",
      undefined,
      oa
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.recovery_codes)).toBe(true);
    expect(Number(r.json.count)).toBeGreaterThan(0);
  });

  test("[ROW 102] DELETE /service-accounts/:id — 404 JSON on unknown id (mounted, scoped; nothing deleted)", async () => {
    const r = await api(IDP_BASE, "DELETE", `/api/v1/service-accounts/${RAND}`, undefined, oa);
    expect(r.status).toBe(404);
    expect(r.json).toHaveProperty("error");
  });

  test("[ROW 107] POST /revoke — 200 for an unknown session_id (anti-enumeration contract; nothing revoked)", async () => {
    const r = await api(IDP_BASE, "POST", "/api/v1/revoke", { session_id: RAND }, oa);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
  });

  test("[ROW 126] POST /users/bulk — 200 synchronous, invite-shaped row refused per-row, created_count 0 (the measured different-contract verdict, pinned)", async () => {
    const r = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users/bulk",
      { users: [{ email: "static-rows-sweep@example.com", name: "Never Created" }] },
      oa
    );
    expect(r.status).toBe(200);
    expect(r.json.created_count).toBe(0);
    expect(r.json.failed_count).toBe(1);
    expect(r.json).not.toHaveProperty("job_id");
  });

  // ── site_admin rows ──
  // THE-INVERTED-GUARD (2026-08-30): rows 3/4 flipped WITH the guard. The
  // api-resources surface answers to the org's own org_admin now;
  // site_admin — the only role the old guard admitted — is 403-refused
  // (AdminPermissionsModel.md). Both directions pinned per row.
  test("[ROW 3] GET /api-resources — 200 for org_admin, 403 for site_admin (the inverted guard, fixed)", async () => {
    const own = await api(IDP_BASE, "GET", "/api/v1/api-resources", undefined, oa);
    expect(own.status).toBe(200);
    expect(Array.isArray(own.json.api_resources)).toBe(true);
    const refused = await api(IDP_BASE, "GET", "/api/v1/api-resources", undefined, sa);
    expect(refused.status).toBe(403);
    expect(refused.json).toHaveProperty("error");
  });

  test("[ROW 4] POST /api-resources — 400 for org_admin invalid body (validating), 403 for site_admin (nothing created)", async () => {
    const invalid = await api(IDP_BASE, "POST", "/api/v1/api-resources", {}, oa);
    expect(invalid.status).toBe(400);
    expect(invalid.json).toHaveProperty("error");
    const refused = await api(IDP_BASE, "POST", "/api/v1/api-resources", {}, sa);
    expect(refused.status).toBe(403);
  });

  test("[ROW 42] GET /keys — 200 {count,keys} (site_admin)", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/keys", undefined, sa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.keys)).toBe(true);
  });

  test("[ROW 75] GET /organizations/:id — 200 full org shape (site_admin)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/organizations/${orgId}`, undefined, sa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("domain");
    expect(r.json).toHaveProperty("active");
  });

  test("[ROW 70] GET /organizations/:id/protocol-settings — 200 org_admin, 403 site_admin (THE-REMAINING-FOUR)", async () => {
    // THE-REMAINING-FOUR (2026-08-30): protocol-settings are the org's own —
    // org_admin reads them, site_admin (which used to be admitted here) is
    // now refused.
    const r = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/protocol-settings`,
      undefined,
      oa
    );
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("organization_id");
    const refused = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/protocol-settings`,
      undefined,
      sa
    );
    expect(refused.status).toBe(403);
  });

  // ── THE-PER-VERB-SWEEP (2026-08-30) ──
  // The census rows above pin ONE representative verb per tenant-resource
  // family (mostly the read). A family is not closed because its read is: a
  // guard change could re-admit site_admin on a write nobody re-probed. This
  // sweep pins the WHOLE verb surface — 45 verbs across 9 families — asserting
  // site_admin is 403 on EVERY one, every harness run. It is registered in
  // static-rows.json as [ROW 200], so deleting the block reads as STATIC ROWS
  // DRIFT; the length assertion makes shrinking the matrix fail too.
  //
  // Every probe fires against a REAL org (orgId). For eight of the nine
  // families the refusal is a group gate, a first-line handler gate, or an
  // authz-first service check that runs BEFORE any resource lookup, so a
  // random-UUID resource id still yields the authority 403, never an
  // incidental 404. The exception is the service-accounts ID-scoped surface,
  // which fetches the SA BEFORE authorizing (unknown id → 404, see [ROW 102]);
  // those five verbs are probed against a REAL org_admin-created SA so their
  // 403 is the authority refusal. site_admin is refused before any mutation,
  // so that SA is never modified or deleted. identity-provider is included:
  // its route guard admits site_admin, but the handler gate
  // denySiteAdminTenantIDP refuses site_admin on all four IDP verbs by design
  // — proven live here, not assumed from the guard.
  test.beforeAll(async () => {
    const created = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgId}/service-accounts`,
      { name: "per-verb-sweep-sa" },
      oa
    );
    if (created.status !== 201 || !(created.json as Json).id) {
      throw new Error(`per-verb sweep needs a real SA; org_admin create → ${created.status}`);
    }
    saId = String((created.json as Json).id);
  });

  type Probe = {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
  };

  // The 45-verb tenant-resource battery. ONE builder, consumed by BOTH
  // refusal sweeps ([ROW 200] site_admin, [ROW 201] org_user) so the two
  // principals are proven against the IDENTICAL verb surface — a verb added
  // for one is automatically probed for the other. Built at test time
  // because orgId/myId/saId resolve in beforeAll.
  function tenantResourceProbes(): Probe[] {
    return [
      // api-resources (6)
      { method: "GET", path: "/api/v1/api-resources" },
      { method: "GET", path: `/api/v1/api-resources/${RAND}` },
      { method: "POST", path: "/api/v1/api-resources", body: {} },
      { method: "PUT", path: `/api/v1/api-resources/${RAND}`, body: {} },
      { method: "DELETE", path: `/api/v1/api-resources/${RAND}` },
      { method: "POST", path: `/api/v1/api-resources/${RAND}/secret/regenerate`, body: {} },
      // clients (6)
      { method: "GET", path: "/api/v1/clients" },
      { method: "GET", path: `/api/v1/clients/${RAND}` },
      { method: "POST", path: "/api/v1/clients", body: {} },
      { method: "PUT", path: `/api/v1/clients/${RAND}`, body: {} },
      { method: "DELETE", path: `/api/v1/clients/${RAND}` },
      { method: "POST", path: `/api/v1/clients/${RAND}/secret/regenerate`, body: {} },
      // scope-templates (5)
      { method: "GET", path: "/api/v1/scope-templates" },
      { method: "GET", path: `/api/v1/scope-templates/${RAND}` },
      { method: "POST", path: "/api/v1/scope-templates", body: {} },
      { method: "PUT", path: `/api/v1/scope-templates/${RAND}`, body: {} },
      { method: "DELETE", path: `/api/v1/scope-templates/${RAND}` },
      // organization domains (5)
      { method: "GET", path: `/api/v1/organizations/${orgId}/domains` },
      { method: "POST", path: `/api/v1/organizations/${orgId}/domains`, body: {} },
      { method: "POST", path: `/api/v1/organizations/${orgId}/domains/${RAND}/verify`, body: {} },
      { method: "DELETE", path: `/api/v1/organizations/${orgId}/domains/${RAND}` },
      { method: "POST", path: `/api/v1/organizations/${orgId}/domains/${RAND}/primary`, body: {} },
      // protocol-settings (2)
      { method: "GET", path: `/api/v1/organizations/${orgId}/protocol-settings` },
      { method: "PUT", path: `/api/v1/organizations/${orgId}/protocol-settings`, body: {} },
      // rbac org-roles (7)
      { method: "GET", path: `/api/v1/organizations/${orgId}/roles` },
      { method: "GET", path: `/api/v1/organizations/${orgId}/roles/${RAND}` },
      { method: "POST", path: `/api/v1/organizations/${orgId}/roles`, body: {} },
      { method: "PUT", path: `/api/v1/organizations/${orgId}/roles/${RAND}`, body: {} },
      { method: "DELETE", path: `/api/v1/organizations/${orgId}/roles/${RAND}` },
      { method: "POST", path: `/api/v1/organizations/${orgId}/roles/${RAND}/scopes`, body: {} },
      {
        method: "DELETE",
        path: `/api/v1/organizations/${orgId}/roles/${RAND}/scopes/probe:scope`,
      },
      // rbac user-roles (3)
      { method: "GET", path: `/api/v1/users/${myId}/roles` },
      { method: "POST", path: `/api/v1/users/${myId}/roles`, body: {} },
      { method: "DELETE", path: `/api/v1/users/${myId}/roles/${RAND}` },
      // service-accounts org-scoped (2)
      { method: "GET", path: `/api/v1/organizations/${orgId}/service-accounts` },
      { method: "POST", path: `/api/v1/organizations/${orgId}/service-accounts`, body: {} },
      // service-accounts ID-scoped (5) — REAL SA (fetch-first; unknown id 404s)
      { method: "GET", path: `/api/v1/service-accounts/${saId}` },
      { method: "PUT", path: `/api/v1/service-accounts/${saId}`, body: {} },
      { method: "DELETE", path: `/api/v1/service-accounts/${saId}` },
      { method: "POST", path: `/api/v1/service-accounts/${saId}/enable`, body: {} },
      { method: "POST", path: `/api/v1/service-accounts/${saId}/disable`, body: {} },
      // identity-provider (4) — handler gate denySiteAdminTenantIDP
      { method: "POST", path: `/api/v1/organizations/${orgId}/identity-provider`, body: {} },
      { method: "GET", path: `/api/v1/organizations/${orgId}/identity-provider` },
      { method: "PUT", path: `/api/v1/organizations/${orgId}/identity-provider`, body: {} },
      { method: "DELETE", path: `/api/v1/organizations/${orgId}/identity-provider` },
    ];
  }

  test("[ROW 200] per-verb site_admin refusal sweep — 45 tenant-resource verbs, all 403 (THE-PER-VERB-SWEEP)", async () => {
    const probes = tenantResourceProbes();
    expect(probes.length, "the pinned verb surface is 45; changing it is a deliberate edit").toBe(
      45
    );
    expect(saId, "the ID-scoped SA probes need a real service account").toBeTruthy();

    const admitted: string[] = [];
    for (const pr of probes) {
      const res = await api(IDP_BASE, pr.method, pr.path, pr.body, sa);
      if (res.status !== 403) admitted.push(`${pr.method} ${pr.path} → ${res.status}`);
    }
    expect(admitted, `site_admin was NOT refused (403) on: ${admitted.join("; ")}`).toEqual([]);
  });

  test("[ROW 201] per-verb org_user refusal sweep — the same 45 verbs, all 403 (THE-ROLE-CENSUS T4-1)", async () => {
    // AdminPermissionsModel.md: org_user is self-service only — it cannot
    // manage ANY organization resource. Every family refuses it before the
    // operative branch: the handler/service gates require IsOrgAdminOnly
    // (api-resources, clients, scope-templates, service-accounts — including
    // the fetch-first ID-scoped SA verbs, where the REAL saId proves the 403
    // is the authority refusal), and the route guards refuse non-org_admin
    // outright (domains, protocol-settings, rbac, identity-provider). A
    // denial that silently stops being enforced is the failure that matters
    // — this pins the entire negative surface for the thinnest principal,
    // every run, against the IDENTICAL battery [ROW 200] fires as
    // site_admin.
    const probes = tenantResourceProbes();
    expect(probes.length, "the pinned verb surface is 45; changing it is a deliberate edit").toBe(
      45
    );
    expect(ou, "the org_user bearer must have been minted in beforeAll").toBeTruthy();

    const admitted: string[] = [];
    for (const pr of probes) {
      const res = await api(IDP_BASE, pr.method, pr.path, pr.body, ou);
      if (res.status !== 403) admitted.push(`${pr.method} ${pr.path} → ${res.status}`);
    }
    expect(admitted, `org_user was NOT refused (403) on: ${admitted.join("; ")}`).toEqual([]);
  });
});
