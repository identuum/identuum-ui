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
import { loadOrgAdminFixture } from "../e2e/helpers/fixture";
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
  let orgId = "";
  let myId = "";

  test.beforeAll(async () => {
    const bootstrapPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    if (!bootstrapPassword) throw new Error("harness must pass the bootstrap password");
    sa = (await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, bootstrapPassword)).bearer;

    const fx = loadOrgAdminFixture();
    if (!fx) throw new Error("org_admin envelope missing — phase must run after the provisioner");
    oa = await bearerFor(fx.email, fx.password, fx.totpSecret);

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

  test("[ROW 36] GET /clients — 200 paged list", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/clients", undefined, oa);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.clients)).toBe(true);
    expect(r.json).toHaveProperty("total");
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

  test("[ROW 61] GET /organizations/:id/domains — 200", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/organizations/${orgId}/domains`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("organization_domains");
  });

  test("[ROW 84] GET /organizations/:id/roles — 200", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/organizations/${orgId}/roles`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("roles");
  });

  test("[ROW 91] GET /users/:id/roles — 200 (own id)", async () => {
    const r = await api(IDP_BASE, "GET", `/api/v1/users/${myId}/roles`, undefined, oa);
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("roles");
  });

  test("[ROW 94] GET /scope-templates — 403 for org_admin (fenced read, UI renders its designed panel)", async () => {
    const r = await api(IDP_BASE, "GET", "/api/v1/scope-templates", undefined, oa);
    expect(r.status).toBe(403);
    expect(r.json).toHaveProperty("error");
  });

  test("[ROW 99] GET /organizations/:id/service-accounts — 200", async () => {
    const r = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/service-accounts`,
      undefined,
      oa
    );
    expect(r.status).toBe(200);
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

  test("[ROW 70] GET /organizations/:id/protocol-settings — 200 (site_admin)", async () => {
    const r = await api(
      IDP_BASE,
      "GET",
      `/api/v1/organizations/${orgId}/protocol-settings`,
      undefined,
      sa
    );
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("organization_id");
  });
});
