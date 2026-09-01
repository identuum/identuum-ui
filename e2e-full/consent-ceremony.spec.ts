/**
 * THE-CONSENT-CEREMONY (2026-08-28) — the session-driven OAuth ceremonies that
 * become reachable once the browser-login session cookie returns over plain
 * HTTP. THE-LAST-DEFECT fixed the CSRF cookie's transport; this slice fixes the
 * identuum_session cookie's transport the same way (writeSessionCookie /
 * cookieSecureForRequest, SESSION-COOKIE-TRANSPORT-SEC-1) so the session the
 * consent and end_session flows depend on actually comes back over http.
 *
 * Ceremony 1 — authorization code, single-use. Asserts the TRANSITION, not a
 * plausible last status:
 *   browser-login (honest CSRF) → a live identuum_session
 *   → GET /oauth/consent WITH that session renders the form (401 without it)
 *   → POST /oauth/consent {approve} mints an authorization code (302 → cb?code=)
 *   → POST /oauth/token redeems the code ONCE (200 + access_token)
 *   → the SAME code a second time is refused (invalid_grant).
 * The load-bearing fact is single-use: a code that mints a token on the first
 * exchange must be dead on the second. The AS MANDATES PKCE (S256) — /authorize
 * returns invalid_request without a code_challenge — so the ceremony carries a
 * real verifier/challenge pair, asserting that policy in passing.
 *
 * Ceremony 2 — the back-channel logout delivery row that end_session creates.
 * A delivery row is created ONLY by OIDC end_session, which needed a browser
 * session that was previously unmintable over http. With a session in hand,
 * end_session to a client carrying a (dead) backchannel_logout_uri inserts a
 * delivery row (delivered:false), which the site_admin admin surface can now
 * LIST/GET and REPLAY — the replay returning 202 {delivered:false} with audit
 * Outcome "delivery_failed". The delivery attempt runs on the 3s-timeout safe
 * client; the measured wall time of end_session is recorded as a harness note.
 */
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, firstLoginBearerAsync, observeRaw } from "../e2e/helpers/appliance-fixture";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const REDIRECT_URI = "https://ui.example.test/consent-cb";
const GHOST = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("consent ceremony (authorize → consent → code, single-use)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  let runId = "";
  let userEmail = "";
  let userPw = "";
  let clientId = "";
  let clientSecret = "";

  test("setup: org, org_user, and a confidential authorization_code client", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length).toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `consent-${Date.now().toString(36)}`;

    const c1 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `consent ${runId}`,
        slug: `${runId}`,
        domain: `${runId}.test`,
        admin_email: `admin@${runId}.test`,
      },
      site.bearer
    );
    expect(c1.status).toBe(201);
    const org = (c1.json.organization as { id?: string })?.id ?? "";
    expect(org.length).toBeGreaterThan(0);

    const rs = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org}/resend-activation`,
      {},
      site.bearer
    );
    expect(rs.status).toBe(200);
    const adminPw = `Adm!${runId}9wqX`;
    const act = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: rs.json.activation_token,
      password: adminPw,
    });
    expect(act.status).toBe(200);
    const orgAdmin = await firstLoginBearerAsync(IDP_BASE, `admin@${runId}.test`, adminPw);

    userEmail = `user@${runId}.test`;
    userPw = `Usr!${runId}3kpZ`;
    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: userEmail, password: userPw, role: "org_user", organization_id: org },
      orgAdmin.bearer
    );
    expect(uc.status).toBe(201);
    const uv = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${uc.json.id as string}`,
      { email_verified: true },
      orgAdmin.bearer
    );
    expect(uv.status).toBe(200);

    // A confidential authorization_code client (site_admin DCR). Confidential
    // (no token_endpoint_auth_method=none) → the response carries client_secret.
    const dcr = await api(
      IDP_BASE,
      "POST",
      "/api/v1/oauth/register",
      {
        client_name: `cc-${runId}`,
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile email",
      },
      site.bearer
    );
    expect(dcr.status, "site_admin DCR of a confidential client → 201").toBe(201);
    clientId = (dcr.json.client_id as string) ?? "";
    clientSecret = (dcr.json.client_secret as string) ?? "";
    expect(clientId.length, "client_id issued").toBeGreaterThan(0);
    expect(clientSecret.length, "confidential client → client_secret issued").toBeGreaterThan(0);
  });

  test("the ceremony: session-gated consent mints a single-use code", async ({ request }) => {
    // The AS MANDATES PKCE — /authorize returns invalid_request (400) without a
    // code_challenge. Drive a proper S256 exchange.
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const authQuery =
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent("openid")}&state=st-${runId}` +
      `&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    // ── Negative: consent WITHOUT a session → 401 login_required. Uses this
    // test's own (empty) jar before browser-login plants anything.
    const anon = await request.get(`${IDP_BASE}/api/v1/oauth/consent?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(anon.status(), "consent GET with no session → 401 login_required").toBe(401);
    observeRaw("GET", "/api/v1/oauth/consent", anon.status());

    // ── THE-PKCE-DECISION re-pins THE-CLOSURE-AUDIT's contract: an
    // anonymous INTERACTIVE authorize now sends the browser to the OP's OWN
    // login form (return_to carries the full authorize URL, so the ceremony
    // resumes where it began). prompt=none keeps the OIDC-required
    // error=login_required redirect to the client — both contracts pinned.
    const anonAuthz = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(anonAuthz.status(), "anonymous interactive authorize → 302").toBe(302);
    const anonAuthzLoc = anonAuthz.headers().location ?? "";
    expect(anonAuthzLoc, "…to the OP's own browser-login form").toContain(
      "/api/v1/auth/browser-login?return_to="
    );
    expect(
      decodeURIComponent(anonAuthzLoc.split("return_to=")[1] ?? ""),
      "…return_to carries the original authorize request"
    ).toContain("/api/v1/oauth/authorize?");
    observeRaw("GET", "/api/v1/oauth/authorize", anonAuthz.status());

    // prompt=none: no interaction allowed — OIDC requires the error
    // redirect to the client, never a login page.
    const anonNone = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?${authQuery}&prompt=none`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(anonNone.status(), "anonymous prompt=none authorize → 302 (redirect-safe)").toBe(302);
    const anonNoneLoc = anonNone.headers().location ?? "";
    expect(anonNoneLoc, "…to the registered redirect_uri").toContain(REDIRECT_URI);
    expect(new URL(anonNoneLoc).searchParams.get("error"), "…carrying error=login_required").toBe(
      "login_required"
    );
    expect(new URL(anonNoneLoc).searchParams.get("state"), "…state echoed").toBe(`st-${runId}`);

    // ── OIDC Core §3.1.2.1 (THE-PKCE-DECISION): the authorize endpoint also
    // accepts a form-serialized POST with identical semantics — the redirect
    // re-encodes every submitted parameter into a resumable GET URL.
    const postParams = Object.fromEntries(new URLSearchParams(authQuery));
    const anonPost = await request.post(`${IDP_BASE}/api/v1/oauth/authorize`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: postParams,
    });
    expect(anonPost.status(), "anonymous POST authorize → 302").toBe(302);
    const anonPostLoc = anonPost.headers().location ?? "";
    expect(anonPostLoc, "…to the OP's own browser-login form").toContain(
      "/api/v1/auth/browser-login?return_to="
    );
    expect(
      decodeURIComponent(anonPostLoc.split("return_to=")[1] ?? ""),
      "…return_to re-encodes the POSTed parameters as a GET authorize URL"
    ).toContain(`client_id=${clientId}`);
    observeRaw("POST", "/api/v1/oauth/authorize", anonPost.status());

    // ── Establish a browser-login session (honest CSRF double-submit).
    const form = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    expect(form.status(), "login form renders").toBe(200);
    const csrf = (await form.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(csrf, "login form embeds a CSRF token").toBeTruthy();
    const submit = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: { email: userEmail, password: userPw, [csrf?.[1] ?? "csrf_token"]: csrf?.[2] ?? "" },
    });
    expect(submit.status(), "browser-login → 303 (session established)").toBe(303);

    // ── The session must RETURN on the next request over http for consent to
    // be reachable — the identuum_session cookie is planted by CookieSessionService.
    const consentForm = await request.get(`${IDP_BASE}/api/v1/oauth/consent?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(
      consentForm.status(),
      "consent GET WITH the browser-login session → 200 (session cookie returned over http)"
    ).toBe(200);
    observeRaw("GET", "/api/v1/oauth/consent", consentForm.status());

    // ── THE-CLOSURE-AUDIT: GET /api/v1/sessions, the one endpoint no
    // evidence channel could see — the UI fetches it SERVER-side (a Next
    // server component → IdP, invisible to browser traces and to api()).
    // MEASURED (2026-08-31): despite the docgen golden labelling it
    // auth=session, the endpoint REFUSES the browser-login ceremony cookie
    // (401) — in practice it authenticates by BEARER (the UI's proxy lifts
    // the access_token cookie into Authorization). Both facts pinned; the
    // golden's auth label is reported as a docgen-accuracy finding.
    const cookieSessions = await request.get(`${IDP_BASE}/api/v1/sessions`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(
      cookieSessions.status(),
      "MEASURED: the ceremony cookie does NOT authenticate /sessions (golden says auth=session)"
    ).toBe(401);
    // MEASURED: site_admin is DELIBERATELY refused here too —
    // HandleListOwnSessions has an explicit IsSiteAdmin() → 403 branch (the
    // self-service surface follows the tenant-resource philosophy). Pinned.
    const saSessions = await api(IDP_BASE, "GET", "/api/v1/sessions", undefined, site.bearer);
    expect(saSessions.status, "site_admin bearer on the self-service list → 403").toBe(403);
    // The real positive: an ordinary user's bearer lists their own sessions.
    const ouLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expect(ouLogin.status, "ceremony org_user plain login → 200").toBe(200);
    const mySessions = await api(
      IDP_BASE,
      "GET",
      "/api/v1/sessions",
      undefined,
      ouLogin.json.access_token as string
    );
    expect(mySessions.status, "GET /sessions with the user's bearer → 200").toBe(200);
    expect(
      Array.isArray((mySessions.json as { sessions?: unknown[] }).sessions)
        ? ((mySessions.json as { sessions: unknown[] }).sessions?.length ?? -1)
        : -1,
      "…listing at least the caller's current session"
    ).toBeGreaterThan(0);

    // ── THE-PKCE-DECISION (DO-3): authorize WITH the session but WITHOUT
    // stored consent sends the INTERACTIVE browser to the OP's own consent
    // form carrying the full authorize query — no longer an error redirect
    // back to the client. prompt=none keeps the OIDC-required
    // consent_required error redirect, asserted right after.
    const preConsentAuthz = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(preConsentAuthz.status(), "authorize with session, no consent → 302").toBe(302);
    const preConsentLoc = preConsentAuthz.headers().location ?? "";
    expect(preConsentLoc, "…to the OP consent form").toMatch(/^\/api\/v1\/oauth\/consent\?/);
    expect(preConsentLoc, "…carrying the authorize query").toContain(`client_id=${clientId}`);
    observeRaw("GET", "/api/v1/oauth/authorize", preConsentAuthz.status());

    const preConsentNone = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?${authQuery}&prompt=none`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(preConsentNone.status(), "prompt=none with session, no consent → 302").toBe(302);
    expect(
      new URL(preConsentNone.headers().location ?? "").searchParams.get("error"),
      "…carrying error=consent_required (OIDC 3.1.2.6)"
    ).toBe("consent_required");
    const consentHtml = await consentForm.text();
    const consentCsrf = consentHtml.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(consentCsrf, "consent form embeds a CSRF token").toBeTruthy();
    expect(consentHtml, "consent form echoes the client_id hidden field").toContain(clientId);

    // ── Approve: the POST resumes the exact /authorize request and mints a code.
    const approve = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        action: "approve",
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        state: `st-${runId}`,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        [consentCsrf?.[1] ?? "csrf_token"]: consentCsrf?.[2] ?? "",
      },
    });
    expect(approve.status(), "consent approve → 302 back to the redirect_uri").toBe(302);
    const location = approve.headers().location ?? "";
    expect(location, "…redirecting to the registered redirect_uri").toContain(REDIRECT_URI);
    const code = new URL(location).searchParams.get("code") ?? "";
    expect(code.length, "an authorization code is present on the redirect").toBeGreaterThan(0);
    expect(new URL(location).searchParams.get("state"), "state echoed").toBe(`st-${runId}`);
    observeRaw("POST", "/api/v1/oauth/consent", approve.status());

    // ── THE-CLOSURE-AUDIT: with consent now STORED, authorize itself mints a
    // code straight through — the positive contract of GET /oauth/authorize
    // (ConsentService.Lookup Covered=true bypasses the gate). Fresh PKCE
    // pair so this second code stands alone; it is never redeemed — the
    // single-use redemption contract is proven on the FIRST code below.
    const v2 = randomBytes(32).toString("base64url");
    const ch2 = createHash("sha256").update(v2).digest("base64url");
    const directAuthz = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code&scope=${encodeURIComponent("openid")}&state=direct-${runId}` +
        `&code_challenge=${ch2}&code_challenge_method=S256`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(directAuthz.status(), "authorize with session + stored consent → 302").toBe(302);
    const directLoc = new URL(directAuthz.headers().location ?? "");
    expect(directLoc.searchParams.get("error"), "…no error").toBeNull();
    expect(
      (directLoc.searchParams.get("code") ?? "").length,
      "…authorize itself minted a code"
    ).toBeGreaterThan(0);
    expect(directLoc.searchParams.get("state"), "…state echoed").toBe(`direct-${runId}`);
    observeRaw("GET", "/api/v1/oauth/authorize", directAuthz.status());

    // ── THE-SECOND-LOGIN: forced re-authentication. The SAME authenticated,
    // consent-covered request with prompt=login must NOT mint a code — the
    // browser is sent back through the login ceremony, and the resumed
    // request in return_to no longer carries prompt=login (the ceremony
    // consumed it). A max_age still inside its window proceeds. Then the
    // second login is actually performed, and the FIRST session survives it:
    // the user's session count grows by exactly one, none is dropped.
    const reauthQuery =
      `client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent("openid")}&state=reauth-${runId}` +
      `&code_challenge=${ch2}&code_challenge_method=S256`;
    const promptLogin = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?${reauthQuery}&prompt=login`,
      {
        failOnStatusCode: false,
        maxRedirects: 0,
      }
    );
    expect(promptLogin.status(), "prompt=login with a live session → 302").toBe(302);
    const promptLoginLoc = promptLogin.headers().location ?? "";
    expect(promptLoginLoc, "…back through the login ceremony, never a code").toContain(
      "/api/v1/auth/browser-login?return_to="
    );
    const resumed = decodeURIComponent(promptLoginLoc.split("return_to=")[1] ?? "");
    expect(resumed, "…return_to resumes the authorize request").toContain(`client_id=${clientId}`);
    expect(resumed, "…without prompt=login (consumed by the ceremony)").not.toMatch(/prompt=login/);

    const freshEnough = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?${reauthQuery}&max_age=3600`,
      {
        failOnStatusCode: false,
        maxRedirects: 0,
      }
    );
    expect(freshEnough.status(), "max_age=3600 on a seconds-old session → 302").toBe(302);
    expect(
      (new URL(freshEnough.headers().location ?? "").searchParams.get("code") ?? "").length,
      "…still inside the window: a code, not a login"
    ).toBeGreaterThan(0);

    const sessionsBefore = (mySessions.json as { sessions: unknown[] }).sessions.length;
    const form2 = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    const csrf2 = (await form2.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(csrf2, "second login form embeds a CSRF token").toBeTruthy();
    const secondLogin = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: { email: userEmail, password: userPw, [csrf2?.[1] ?? "csrf_token"]: csrf2?.[2] ?? "" },
    });
    expect(secondLogin.status(), "second browser-login → 303 (a NEW session)").toBe(303);
    const afterSecond = await api(
      IDP_BASE,
      "GET",
      "/api/v1/sessions",
      undefined,
      ouLogin.json.access_token as string
    );
    expect(afterSecond.status, "GET /sessions after the second login → 200").toBe(200);
    expect(
      (afterSecond.json as { sessions: unknown[] }).sessions.length,
      "the second login ADDED a session and the first survived it (count grew by exactly one)"
    ).toBe(sessionsBefore + 1);
    // Consent is remembered per (user, client): the fresh session goes
    // straight to a code — the ceremony demanded only the login.
    const afterReauth = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${reauthQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(afterReauth.status(), "authorize on the fresh session → 302").toBe(302);
    expect(
      (new URL(afterReauth.headers().location ?? "").searchParams.get("code") ?? "").length,
      "…a code (consent remembered across the re-login)"
    ).toBeGreaterThan(0);

    // ── Redeem the code ONCE → 200 with an access token.
    const basic = {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    };
    const exchange = (extra?: Record<string, string>) =>
      request.post(`${IDP_BASE}/api/v1/oauth/token`, {
        failOnStatusCode: false,
        maxRedirects: 0,
        headers: basic,
        form: {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
          ...extra,
        },
      });
    const first = await exchange();
    expect(first.status(), "first code redemption → 200").toBe(200);
    const firstBody = (await first.json()) as { access_token?: string };
    expect((firstBody.access_token ?? "").length, "…with an access_token").toBeGreaterThan(0);

    // ── Control BEFORE the replay: the first access token works at userinfo.
    const bearer = { Authorization: `Bearer ${firstBody.access_token}` };
    const before = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
      failOnStatusCode: false,
      headers: bearer,
    });
    expect(before.status(), "first access token → userinfo 200 before any replay").toBe(200);

    // ── The TRANSITION: the SAME code a second time is refused.
    const second = await exchange();
    expect(second.status(), "second redemption of the same code → 400").toBe(400);
    const secondBody = (await second.json()) as { error?: string };
    expect(secondBody.error, "…as invalid_grant (single-use enforced)").toBe("invalid_grant");

    // ── THE-CODE-REUSE-REVOKER (RFC 6749 §4.1.2): the replay revoked what the
    // first exchange minted — the SAME access token now stops working.
    const after = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
      failOnStatusCode: false,
      headers: bearer,
    });
    expect(after.status(), "first access token → userinfo 401 after the code was replayed").toBe(
      401
    );
  });

  test("end_session mints a backchannel delivery row the admin surface lists + replays", async ({
    request,
  }) => {
    // TEST-NET-1 (RFC 5737): a syntactically valid https target that is
    // reserved and non-routable, so the delivery POST cannot succeed — the row
    // is inserted (before the POST) and then recorded unsent.
    const DEAD_BC_URI = "https://192.0.2.1/backchannel-logout";
    const POST_LOGOUT = "https://ui.example.test/logged-out";

    // A client carrying a (dead) backchannel_logout_uri AND a registered
    // post_logout_redirect_uri — the two things end_session needs to fire a
    // back-channel delivery.
    const dcr = await api(
      IDP_BASE,
      "POST",
      "/api/v1/oauth/register",
      {
        client_name: `bc-${runId}`,
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        backchannel_logout_uri: DEAD_BC_URI,
        post_logout_redirect_uris: [POST_LOGOUT],
      },
      site.bearer
    );
    expect(dcr.status, "DCR of a backchannel-logout client → 201").toBe(201);
    const bcClientId = (dcr.json.client_id as string) ?? "";
    expect(bcClientId.length).toBeGreaterThan(0);

    // Establish the browser session that was unmintable over http before the
    // session-cookie transport fix.
    const form = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    const csrf = (await form.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    const submit = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: { email: userEmail, password: userPw, [csrf?.[1] ?? "csrf_token"]: csrf?.[2] ?? "" },
    });
    expect(submit.status(), "browser-login → 303 (session established)").toBe(303);

    // end_session WITH the session + a client that has a backchannel_logout_uri
    // → a delivery row is inserted, then POSTed to the dead URI on the
    // 3-second-timeout safe client. Record the wall time as a harness note.
    const t0 = Date.now();
    const logout = await request.get(
      `${IDP_BASE}/api/v1/oidc/logout?client_id=${encodeURIComponent(bcClientId)}` +
        `&post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT)}&state=lo-${runId}`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    const logoutMs = Date.now() - t0;
    expect(logout.status(), "end_session with a session + client → 302").toBe(302);
    expect(logout.headers().location ?? "", "…to the post_logout_redirect_uri").toContain(
      POST_LOGOUT
    );
    observeRaw("GET", "/api/v1/oidc/logout", logout.status());
    // Harness note: the interactive delivery does AT MOST ONE POST and never
    // sleeps, so end_session blocks up to the client's 3s timeout on a
    // dead-but-routable target. Recorded, not asserted (the exact wall time is
    // a property of how the appliance's network fails the connection).
    // eslint-disable-next-line no-console
    console.log(
      `[harness] end_session backchannel delivery wall time: ${logoutMs}ms (3s-timeout client)`
    );

    // The admin surface now LISTS a real delivery row (before this, the table
    // was empty and only the 400/404/403 refusal branches were reachable).
    const listRes = await api(
      IDP_BASE,
      "GET",
      `/api/v1/admin/backchannel-logout-deliveries?client_id=${encodeURIComponent(bcClientId)}`,
      undefined,
      site.bearer
    );
    expect(listRes.status, "admin list → 200").toBe(200);
    const rows =
      (listRes.json.deliveries as Array<{
        id: string;
        client_id: string;
        status: string;
        delivered_at?: string;
      }>) ?? [];
    expect(rows.length, "end_session created exactly one delivery row for this client").toBe(1);
    const row = rows[0];
    expect(row.client_id, "row is for our client").toBe(bcClientId);
    expect(row.delivered_at ?? null, "delivery to the dead URI did NOT succeed").toBeNull();
    expect(["pending", "failed"], "row is unsent (retry-pending or permanently failed)").toContain(
      row.status
    );

    // The single-row read branch.
    const getRes = await api(
      IDP_BASE,
      "GET",
      `/api/v1/admin/backchannel-logout-deliveries/${row.id}`,
      undefined,
      site.bearer
    );
    expect(getRes.status, "admin GET /:id → 200").toBe(200);
    expect(getRes.json.id, "…the same row").toBe(row.id);

    // REPLAY re-mints a fresh logout_token and re-attempts. The dead URI fails
    // again → 202 {delivered:false} (audit Outcome "delivery_failed"). This is
    // the outbound branch batch 3 could only trace from source.
    const replay = await api(
      IDP_BASE,
      "POST",
      `/api/v1/admin/backchannel-logout-deliveries/${row.id}/replay`,
      {},
      site.bearer
    );
    expect(replay.status, "replay of a dead-target delivery → 202").toBe(202);
    expect(replay.json.delivered, "…delivered:false").toBe(false);

    // Replay of a non-existent delivery id → 404 (the admin not-found branch).
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          `/api/v1/admin/backchannel-logout-deliveries/${GHOST}/replay`,
          {},
          site.bearer
        )
      ).status,
      "replay of a ghost delivery id → 404"
    ).toBe(404);
  });
});
