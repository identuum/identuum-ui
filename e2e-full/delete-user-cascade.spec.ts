/**
 * THE-DISPOSABLE-HARNESS proof spec (2026-08-28).
 *
 * CENSUS ROW: DELETE /api/v1/users/:id (`delete_user`) — DESTRUCTIVE,
 * partition NEITHER in wiki/platform/behavioral-census.md: reached by no
 * Playwright spec and no Go e2e test. Chosen because one flow exercises the
 * unreached destructive row THREE ways the census says nobody does:
 *   1. the destructive action itself — an org_admin soft-deletes their own
 *      org's user (200 {"deleted": id}); since THE-GUARDED-DELETE the route
 *      uses the scoped guard, so this is the actor the model empowers,
 *   2. its OWN error branch — a second DELETE of the same user returns 404
 *      (HandleDeleteUser collapses every non-forbidden service error to
 *      "not found"),
 *   3. the cascade it promises — the deleted user's live bearer must be
 *      rejected (401) on the very next request, and a fresh login with the
 *      deleted user's credentials must be refused (401).
 * En route it also behaviorally reaches two more census-NEITHER destructive
 * rows: POST /api/v1/organizations/:id/resend-activation and
 * POST /api/v1/auth/organizations/activate (durable-token consumption).
 *
 * DESTRUCTIVE BY DESIGN: this spec deletes a user and consumes one-shot
 * activation tokens. It runs ONLY inside the e2e-full disposable harness
 * (scripts/full-run.sh), which fast-cleans the OSS dev stack's postgres
 * volume before AND after. It must never run in the dev loop — the project
 * is not even registered unless IDENTUUM_E2E_FULL=1.
 *
 * Shared helpers, not forked: api() and firstLoginBearerAsync() come from
 * e2e/helpers/appliance-fixture.ts.
 */
import { expect, test } from "@playwright/test";
import {
  api,
  assertActivationEnvelope,
  expectHonestAuthBody,
  firstLoginBearerAsync,
} from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";

test.describe("delete-user cascade (census row: DELETE /api/v1/users/:id)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  test("soft-delete destroys, second delete 404s, cascade kills bearer and login", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(
      adminPassword.length,
      "harness must export IDENTUUM_E2E_FULL_ADMIN_PASSWORD"
    ).toBeGreaterThan(0);

    // site_admin: fresh DB, so this is always a first login → TOTP enrolment.
    const site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);

    // Tenant org + pending org_admin in one request (201 + activation_token).
    const runId = `full-${Date.now().toString(36)}`;
    const orgAdminEmail = `admin@${runId}.test`;
    const orgAdminPassword = `Adm-${runId}-9wq!X${runId.length}`;
    const created = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `e2e-full ${runId}`,
        slug: runId,
        domain: `${runId}.test`,
        admin_email: orgAdminEmail,
      },
      site.bearer
    );
    expect(created.status, "create org+admin → 201").toBe(201);
    const orgId =
      (created.json.id as string) ?? (created.json.organization as { id?: string })?.id ?? "";
    expect(orgId.length).toBeGreaterThan(0);

    // Re-issue the activation token via the census-NEITHER destructive row
    // (durable-token rotation: the create-time token is superseded).
    const resend = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgId}/resend-activation`,
      {},
      site.bearer
    );
    expect(resend.status, "resend-activation → 200").toBe(200);
    const activationToken = resend.json.activation_token as string;
    expect(activationToken.length).toBeGreaterThan(0);
    // THE-UNUSABLE-TOKEN: a second, independent site asserting the envelope
    // contract — link-or-honest-refusal, never a bare token.
    assertActivationEnvelope(resend.json, activationToken, "delete-cascade resend");

    // Consume it (census-NEITHER destructive row: one-shot activation).
    const activate = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: activationToken,
      password: orgAdminPassword,
    });
    expect(activate.status, "activation consume → 200").toBe(200);

    // org_admin first login → TOTP enrolment → bearer.
    const orgAdmin = await firstLoginBearerAsync(IDP_BASE, orgAdminEmail, orgAdminPassword);

    // org_admin creates + verifies the victim org_user.
    const victimEmail = `victim@${runId}.test`;
    const victimPassword = `Usr-${runId}-3kp!Z${runId.length}`;
    const victim = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: victimEmail, password: victimPassword, role: "org_user", organization_id: orgId },
      orgAdmin.bearer
    );
    expect(victim.status, "create victim → 201").toBe(201);
    const victimId = victim.json.id as string;
    expect(victimId.length).toBeGreaterThan(0);
    const verified = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${victimId}`,
      { email_verified: true },
      orgAdmin.bearer
    );
    expect(verified.status, "verify victim email → 200").toBe(200);

    // The victim logs in and holds a LIVE bearer. MEASURED (run 4): with the
    // org's default mfa_policy an org_user login is a plain 200 + access
    // token — no TOTP demand, unlike admins (firstLoginBearerAsync is the
    // ADMIN first-login shape and got 200 where it demanded 401+session_id).
    const victimLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: victimEmail,
      password: victimPassword,
    });
    expect(victimLogin.status, "victim plain login → 200").toBe(200);
    const victimBearer = (victimLogin.json.access_token as string) ?? "";
    expect(victimBearer.length).toBeGreaterThan(0);
    const preDelete = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, victimBearer);
    expect(preDelete.status, "victim bearer valid pre-delete → 200").toBe(200);

    // ── THE ROW: DELETE /api/v1/users/:id ────────────────────────────────
    // The org_admin destroys their OWN org's user — the actor
    // AdminPermissionsModel.md empowers with day-to-day user control
    // (USERS-DELETE-ORGADMIN-SCOPED-1, THE-GUARDED-DELETE). The route now
    // uses the scoped guard, so this reaches DeleteUserForActor's org_admin
    // same-org branch that was previously unreachable dead code. The
    // cross-org refusal is pinned in the idp-oss Go teeth test.
    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/users/${victimId}`,
      undefined,
      orgAdmin.bearer
    );
    expect(del.status, "org_admin soft-delete of a same-org user → 200").toBe(200);
    expect(del.json.deleted, "response names the deleted id").toBe(victimId);

    // Its OWN error branch: deleting the already-deleted user is NOT 2xx.
    const delAgain = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/users/${victimId}`,
      undefined,
      site.bearer
    );
    // THE-SESSION-REJECTION-ROOT-CAUSE (AUTH-503): the IdP now answers a store
    // error as 503 with a correlation id and a verdict as 401 with a reason,
    // so the former second-probe diagnostic is gone. Whatever the status, an
    // auth refusal here must be honest: a 401 names its verdict, a 503 carries
    // the id that joins it to the IdP's ERROR log. The 404 assertion stands.
    if (delAgain.status === 401 || delAgain.status === 503) {
      expectHonestAuthBody(
        delAgain.status,
        delAgain.json as Record<string, unknown>,
        "second delete"
      );
    }
    expect(delAgain.status, "second delete of the same user → 404").toBe(404);

    // The cascade: the victim's live bearer dies with the delete…
    const postDelete = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, victimBearer);
    expect(postDelete.status, "victim bearer revoked by delete cascade → 401").toBe(401);

    // …and the deleted account cannot log back in.
    const reLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: victimEmail,
      password: victimPassword,
    });
    expect(reLogin.status, "deleted user login refused → 401").toBe(401);
    expect(reLogin.json.session_id, "and no enrolment session is offered").toBeUndefined();
  });
});
