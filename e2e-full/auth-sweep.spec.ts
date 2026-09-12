/**
 * THE-AUTH-SWEEP (2026-08-28) — batch 2 of the census complement.
 *
 * Covers the 13 auth-family + 5 me-family census-NEITHER rows as CEREMONY
 * CHAINS, not CRUD: state transitions are asserted (a superseded activation
 * token stops previewing, a revoked sibling session stops validating, a
 * one-shot token burns on second use, an aged refresh-token reuse is
 * detected as theft), and every reachable non-2xx branch is pinned from
 * live measurement.
 *
 * Measured behaviors deliberately pinned (wiki: disposable-harness batch 2):
 *  - browser-login submit: the honest CSRF chain now SUCCEEDS (303 → /, sets
 *    identuum_session) since THE-LAST-DEFECT made the CSRF cookie's Secure
 *    flag transport-adaptive (CSRF-COOKIE-TRANSPORT-SECURE-1); a JSON submit
 *    with no CSRF token/cookie still 403s csrf_failed.
 *  - refresh-token reuse WITHIN 10s → 200 with the current session's tokens
 *    (sessionRotationGraceWindow: deliberate double-click tolerance);
 *    reuse AFTER the window → theft response.
 *  - password reset validates password shape BEFORE token validity (P0-9:
 *    a policy-invalid password must never burn a valid link), so a garbage
 *    token with a policy-failing password reads weak_password.
 *  - claim/validate is oracle-hardened: 200 {valid:false} for every failure
 *    mode — no non-2xx exists on the token axis, and OSS has no claim-mint
 *    endpoint, so valid:true is unreachable here (findings, not skips).
 */
import { expect, test } from "@playwright/test";
import { api, expectStatus, firstLoginBearerAsync } from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST_ID = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("auth+me sweep (18 census rows, ceremonies as chains)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  let orgAdmin = { bearer: "", totpSecret: "" };
  let runId = "";
  let org1 = "";
  let userEmail = "";
  let userPw = "";

  const login = async () => {
    const r = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expectStatus(r, 200, "org_user plain login → 200");
    return {
      bearer: (r.json.access_token as string) ?? "",
      refresh: (r.json.refresh_token as string) ?? "",
    };
  };

  test("setup: shared session, tenant org, org_user", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length).toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `auth-${Date.now().toString(36)}`;
    const c1 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `auth1 ${runId}`,
        slug: `${runId}-1`,
        domain: `${runId}-1.test`,
        admin_email: `admin@${runId}-1.test`,
      },
      site.bearer
    );
    expectStatus(c1, 201);
    org1 = (c1.json.organization as { id?: string })?.id ?? "";
    const rs = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/resend-activation`,
      {},
      site.bearer
    );
    expectStatus(rs, 200);
    const adminPw = `Adm!${runId}9wqX`;
    const act = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: rs.json.activation_token,
      password: adminPw,
    });
    expectStatus(act, 200);
    orgAdmin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}-1.test`, adminPw);
    userEmail = `user@${runId}-1.test`;
    userPw = `Usr!${runId}3kpZ`;
    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: userEmail, password: userPw, role: "org_user", organization_id: org1 },
      orgAdmin.bearer
    );
    expectStatus(uc, 201);
    const uv = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${uc.json.id as string}`,
      { email_verified: true },
      orgAdmin.bearer
    );
    expectStatus(uv, 200);
  });

  test("browser-login: form renders, honest CSRF submit logs in", async ({ request }) => {
    // ROW GET /auth/browser-login (SR): anonymous form. MEASURED: always
    // 200 — no non-2xx is reachable on this row (static anonymous form).
    const form = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    expect(form.status(), "login form renders → 200").toBe(200);
    const html = await form.text();
    const csrf = html.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(csrf, "the form embeds a CSRF token field").toBeTruthy();

    // ROW POST /auth/browser-login (SM). The honest CSRF chain (parsed token
    // + the cookie the GET set, both carried by the request context's jar)
    // now SUCCEEDS: since THE-LAST-DEFECT the CSRF cookie is Secure=false over
    // http://localhost (CSRF-COOKIE-TRANSPORT-SECURE-1), so it returns on the
    // POST and the double-submit verify passes — the row's happy path,
    // previously environment-unreachable (BROWSER-LOGIN-PLAINHTTP-1 FIXED).
    const submit = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: { email: userEmail, password: userPw, [csrf?.[1] ?? "csrf_token"]: csrf?.[2] ?? "" },
    });
    expect(submit.status(), "honest CSRF chain → 303 (login established)").toBe(303);
    expect(submit.headers().location, "…redirecting to the app root").toBe("/");
    expect(
      submit.headers()["set-cookie"] ?? "",
      "…and planting the identuum_session cookie"
    ).toContain("identuum_session=");
    // A JSON submit carries NO CSRF token/cookie → still 403 csrf_failed (the
    // refusal branch that stays reachable).
    const noCsrf = await api(IDP_BASE, "POST", "/api/v1/auth/browser-login", {
      email: userEmail,
      password: userPw,
    });
    expectStatus(noCsrf, 403, "JSON submit without CSRF → 403");
    expect(noCsrf.json.error).toBe("csrf_failed");
  });

  test("session refresh: rotation, 10s grace, aged reuse reads as theft", async () => {
    test.setTimeout(120_000);
    // ROW POST /auth/session/refresh (SM)
    const s1 = await login();
    const r1 = await api(IDP_BASE, "POST", "/api/v1/auth/session/refresh", {
      refresh_token: s1.refresh,
    });
    expectStatus(r1, 200, "refresh → 200");
    const rt2 = (r1.json.refresh_token as string) ?? "";
    expect(rt2.length).toBeGreaterThan(0);

    // Immediate reuse of the OLD token: MEASURED 200 — the deliberate
    // 10s sessionRotationGraceWindow (double-click tolerance).
    const graceReuse = await api(IDP_BASE, "POST", "/api/v1/auth/session/refresh", {
      refresh_token: s1.refresh,
    });
    expectStatus(graceReuse, 200, "reuse within the 10s grace window → 200");

    // Aged reuse: wait out the grace window, then present the burned token
    // — the transition item 2 demands: one-shot burns once, the second use
    // AFTER grace is detected.
    await new Promise((r) => setTimeout(r, 11_000));
    const theft = await api(IDP_BASE, "POST", "/api/v1/auth/session/refresh", {
      refresh_token: s1.refresh,
    });
    expectStatus(theft, 401, "aged reuse of a rotated token → 401");
    expect(theft.json.error).toBe("refresh_reuse_detected");

    // MEASURED: theft detection revokes the SESSION, not just the refresh
    // lineage — the access token issued alongside the stolen refresh token
    // is dead on the next request (fail-closed; pre-theft the old access
    // token still validated 200 in the probe runs).
    const oldAccess = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, s1.bearer);
    expectStatus(oldAccess, 401, "access token dies with the theft-revoked session → 401");

    const garbage = await api(IDP_BASE, "POST", "/api/v1/auth/session/refresh", {
      refresh_token: "deadbeef",
    });
    expectStatus(garbage, 401, "garbage refresh token → 401");
    expect(garbage.json.error).toBe("invalid_grant");
  });

  test("me/sessions + the three revokes: transitions, strict no-body, dead bearers", async () => {
    const sA = await login();
    const sB = await login();

    // ROW GET /me/sessions (SR)
    const list = await api(IDP_BASE, "GET", "/api/v1/me/sessions", undefined, sA.bearer);
    expectStatus(list, 200, "own session list → 200");
    expect(
      (list.json.sessions as unknown[]).length,
      "both live sessions are listed"
    ).toBeGreaterThanOrEqual(2);

    // ROW POST /me/sessions/revoke-others (D) — strict no-body contract.
    const withBody = await api(
      IDP_BASE,
      "POST",
      "/api/v1/me/sessions/revoke-others",
      {},
      sA.bearer
    );
    expectStatus(withBody, 400, "revoke-others WITH a body → 400 (strict no-body)");
    const others = await api(
      IDP_BASE,
      "POST",
      "/api/v1/me/sessions/revoke-others",
      undefined,
      sA.bearer
    );
    expectStatus(others, 204, "revoke-others → 204");
    const bDead = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, sB.bearer);
    expectStatus(bDead, 401, "sibling session died with revoke-others → 401");
    const aAlive = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, sA.bearer);
    expectStatus(aAlive, 200, "the revoking session survives → 200");

    // ROW POST /me/sessions/revoke-current (D)
    const current = await api(
      IDP_BASE,
      "POST",
      "/api/v1/me/sessions/revoke-current",
      undefined,
      sA.bearer
    );
    expectStatus(current, 204, "revoke-current → 204");
    const aDead = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, sA.bearer);
    expectStatus(aDead, 401, "the session is gone on the very next request → 401");
    const listDead = await api(IDP_BASE, "GET", "/api/v1/me/sessions", undefined, sA.bearer);
    expectStatus(listDead, 401, "session list with the dead bearer → 401");

    // ROW POST /me/sessions/revoke-all (D)
    const sC = await login();
    const all = await api(IDP_BASE, "POST", "/api/v1/me/sessions/revoke-all", undefined, sC.bearer);
    expectStatus(all, 204, "revoke-all → 204");
    const cDead = await api(IDP_BASE, "GET", "/api/v1/validate", undefined, sC.bearer);
    expectStatus(cDead, 401, "own session included in revoke-all → 401");
    const deadRevoke = await api(
      IDP_BASE,
      "POST",
      "/api/v1/me/sessions/revoke-all",
      undefined,
      sC.bearer
    );
    expectStatus(deadRevoke, 401, "revoke-all with a dead bearer → 401");
    const unauth = await api(IDP_BASE, "GET", "/api/v1/me/sessions");
    expectStatus(unauth, 401, "session list unauthenticated → 401");
  });

  test("me/roles: read + unauth branch", async () => {
    const s = await login();
    // ROW GET /me/roles (SR)
    const roles = await api(IDP_BASE, "GET", "/api/v1/me/roles", undefined, s.bearer);
    expectStatus(roles, 200, "own roles → 200");
    const unauth = await api(IDP_BASE, "GET", "/api/v1/me/roles");
    expectStatus(unauth, 401, "own roles unauthenticated → 401");
  });

  test("claim/validate: oracle-hardened, mint-less on OSS", async () => {
    // ROW GET /auth/claim/validate (SR). MEASURED: every failure mode is a
    // 200 with valid:false (oracle hardening) — NO non-2xx exists on the
    // token axis, and GenerateClaimToken has no OSS HTTP caller, so
    // valid:true is unreachable in this environment. Both recorded as
    // findings, not skips.
    const garbage = await api(IDP_BASE, "GET", "/api/v1/auth/claim/validate?token=deadbeefdead");
    expectStatus(garbage, 200, "garbage token → 200 (oracle-hardened)");
    expect(garbage.json.valid, "…and valid:false").toBe(false);
    const missing = await api(IDP_BASE, "GET", "/api/v1/auth/claim/validate");
    expectStatus(missing, 200, "missing token → the same 200 shape");
    expect(missing.json.valid).toBe(false);
  });

  test("activation token chain: preview, supersede, consume, burn", async () => {
    const c3 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `auth3 ${runId}`,
        slug: `${runId}-3`,
        domain: `${runId}-3.test`,
        admin_email: `admin@${runId}-3.test`,
      },
      site.bearer
    );
    expectStatus(c3, 201);
    const org3 = (c3.json.organization as { id?: string })?.id ?? "";
    const t1 = c3.json.activation_token as string;

    // ROW GET /auth/organizations/activate/:token (SR)
    const preview1 = await api(IDP_BASE, "GET", `/api/v1/auth/organizations/activate/${t1}`);
    expectStatus(preview1, 200, "preview of a live token → 200");
    expect(preview1.json.email, "preview names the pending admin").toBe(`admin@${runId}-3.test`);

    // resend SUPERSEDES: the old token stops previewing — the transition.
    const rs3 = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org3}/resend-activation`,
      {},
      site.bearer
    );
    expectStatus(rs3, 200);
    const t2 = rs3.json.activation_token as string;
    const preview1After = await api(IDP_BASE, "GET", `/api/v1/auth/organizations/activate/${t1}`);
    expectStatus(preview1After, 400, "superseded token previews → 400");
    expect(preview1After.json.error).toBe("invalid_token");
    const previewGarbage = await api(
      IDP_BASE,
      "GET",
      "/api/v1/auth/organizations/activate/nonsense"
    );
    expectStatus(previewGarbage, 400, "garbage token previews → 400");

    // Consume, then prove the burn BOTH ways: preview and second consume.
    const consume = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: t2,
      password: `Adm!${runId}3x9Q`,
    });
    expectStatus(consume, 200, "consume → 200");
    const previewBurned = await api(IDP_BASE, "GET", `/api/v1/auth/organizations/activate/${t2}`);
    expectStatus(previewBurned, 400, "consumed token previews → 400");
    const consumeAgain = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: t2,
      password: `Adm!${runId}3x9Q`,
    });
    expectStatus(consumeAgain, 400, "second consume of a one-shot token → 400");
    expect(consumeAgain.json.error).toBe("invalid_token");
  });

  test("password reset pair: anti-enumeration, ordering, refusals", async () => {
    // ROW POST /auth/password/reset-request (SM) — anti-enumeration: the
    // known-user and ghost answers must be INDISTINGUISHABLE (the pair IS
    // the assertion).
    const known = await api(IDP_BASE, "POST", "/api/v1/auth/password/reset-request", {
      email: userEmail,
    });
    const ghost = await api(IDP_BASE, "POST", "/api/v1/auth/password/reset-request", {
      email: `ghost@${runId}.test`,
    });
    expectStatus(known, 200, "known email → 200");
    expectStatus(ghost, 200, "ghost email → the same 200");
    expect(JSON.stringify(ghost.json), "…with a byte-identical body").toBe(
      JSON.stringify(known.json)
    );

    // ROW POST /auth/password/reset (D). The raw token exists only in the
    // email SMTP never sends here — the happy path is environment-
    // unreachable (finding). MEASURED refusals: an absent token reads
    // invalid_reset_token; with a token present the password gate runs
    // FIRST (P0-9: a policy-invalid password must never burn a valid link),
    // so garbage-token requests read weak_password.
    const missing = await api(IDP_BASE, "POST", "/api/v1/auth/password/reset", {});
    expectStatus(missing, 400);
    expect(missing.json.error).toBe("invalid_reset_token");
    const garbage = await api(IDP_BASE, "POST", "/api/v1/auth/password/reset", {
      token: "deadbeef",
      password: `Nw!Str0ng-${runId}-pQz7x`,
    });
    expectStatus(garbage, 400);
    expect(garbage.json.error).toBe("weak_password");
  });

  test("verify-email pair: refusals and the anti-enumeration resend", async () => {
    // ROW GET /auth/verify-email (SM) — the raw token is emailed; SMTP is
    // dead here, so the happy path is environment-unreachable (finding).
    const garbage = await api(IDP_BASE, "GET", "/api/v1/auth/verify-email?token=deadbeef");
    expectStatus(garbage, 400, "garbage token → 400");
    expect(garbage.json.error).toBe("invalid_token");
    const missing = await api(IDP_BASE, "GET", "/api/v1/auth/verify-email");
    expectStatus(missing, 400, "missing token → 400");
    expect(missing.json.error).toBe("invalid_request");

    // ROW POST /auth/resend-verification (SM) — anti-enumeration pair.
    const known = await api(IDP_BASE, "POST", "/api/v1/auth/resend-verification", {
      email: userEmail,
    });
    const ghost = await api(IDP_BASE, "POST", "/api/v1/auth/resend-verification", {
      email: `ghost@${runId}.test`,
    });
    expectStatus(known, 200);
    expectStatus(ghost, 200);
    expect(JSON.stringify(ghost.json), "indistinguishable bodies").toBe(JSON.stringify(known.json));
  });

  test("upstream OIDC login + callback: discovery-dead upstream, state burn", async ({
    request,
  }) => {
    const idp = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org1}/identity-provider`,
      {
        type: "oidc",
        name: "Auth IdP",
        slug: `auth-${runId}`,
        config: {
          issuer_url: "https://accounts.example.test",
          client_id: "auth-client",
          client_secret: "not-real",
          redirect_uris: ["https://ui.example.test/callback"],
        },
      },
      orgAdmin.bearer
    );
    expectStatus(idp, 201);
    const provId = (idp.json.identity_provider as { id?: string })?.id ?? "";
    expect(provId.length).toBeGreaterThan(0);

    // ROW GET /auth/idp/:id/login (SR). MEASURED: the endpoint performs
    // upstream DISCOVERY server-side before redirecting, so with an
    // unresolvable issuer the answer is 502 — the happy 302 needs a real
    // upstream the environment cannot provide (finding).
    const loginStart = await request.get(`${IDP_BASE}/api/v1/auth/idp/${provId}/login`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(loginStart.status(), "login initiation with a dead upstream → 502").toBe(502);
    const ghostProv = await request.get(`${IDP_BASE}/api/v1/auth/idp/${GHOST_ID}/login`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(ghostProv.status(), "unknown provider → 404").toBe(404);

    // ROW GET /auth/idp/:id/callback (SM): a state nobody minted is refused
    // — the one-time-state contract's refusal branch.
    const badState = await request.get(
      `${IDP_BASE}/api/v1/auth/idp/${provId}/callback?code=x&state=bogus`,
      { maxRedirects: 0, failOnStatusCode: false }
    );
    expect(badState.status(), "unminted state → 400").toBe(400);
  });

  test("webauthn login pair: anti-enumeration begin, refused finish", async () => {
    // ROW POST /auth/login/webauthn/begin (SM) — MEASURED: known and ghost
    // users get the SAME 200 ceremony shape (anti-enumeration: a fake
    // ceremony is minted for unknown emails).
    const known = await api(IDP_BASE, "POST", "/api/v1/auth/login/webauthn/begin", {
      email: userEmail,
    });
    const ghost = await api(IDP_BASE, "POST", "/api/v1/auth/login/webauthn/begin", {
      email: `ghost@${runId}.test`,
    });
    expectStatus(known, 200, "begin (known) → 200");
    expectStatus(ghost, 200, "begin (ghost) → the same 200");
    expect(Object.keys(ghost.json).sort(), "identical response shape").toEqual(
      Object.keys(known.json).sort()
    );
    const noEmail = await api(IDP_BASE, "POST", "/api/v1/auth/login/webauthn/begin", {});
    expectStatus(noEmail, 400, "begin without an email → 400");

    // ROW POST /auth/login/webauthn/finish (SM): no authenticator exists in
    // this environment, so the happy path is unreachable (finding); the
    // refusal branch is the row's live measurement.
    const finish = await api(
      IDP_BASE,
      "POST",
      "/api/v1/auth/login/webauthn/finish?session_id=deadbeef",
      {}
    );
    expectStatus(finish, 401, "finish with an unminted session → 401");
    expect(finish.json.error).toBe("invalid_credentials");
  });
});
