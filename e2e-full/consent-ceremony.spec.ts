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
import { generateTOTP } from "../e2e/helpers/totp";
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
  let orgAdminBearer = "";
  let userId = "";
  let orgId = "";
  let userTotpSecret = "";

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
    orgId = org;

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
    orgAdminBearer = orgAdmin.bearer;

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
    userId = uc.json.id as string;
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

  // THE-CLAIMS-PARAMETER (OIDC Core §5.5): a client asking for `name` through
  // the claims parameter gets it at userinfo ONLY after the user consented to
  // that claim; the same user's code minted WITHOUT the claims request (and
  // without the profile scope) carries no name.
  test("claims parameter: consented name reaches userinfo; unrequested/unconsented does not", async ({
    request,
  }) => {
    // Give the user a truthful name to release (the OP never fabricates one).
    const named = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${userId}`,
      { name: `Ceremony User ${runId}` },
      orgAdminBearer
    );
    expect(named.status, "org_admin sets the user's display name").toBe(200);

    // Each test owns a fresh cookie jar: establish the browser-login session
    // for THIS request context (honest CSRF double-submit), as the first
    // ceremony did.
    const loginForm = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    expect(loginForm.status(), "login form renders").toBe(200);
    const loginCsrf = (await loginForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    expect(loginCsrf, "login form embeds a CSRF token").toBeTruthy();
    const login = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        email: userEmail,
        password: userPw,
        [loginCsrf?.[1] ?? "csrf_token"]: loginCsrf?.[2] ?? "",
      },
    });
    expect(login.status(), "browser-login → 303 (session established)").toBe(303);

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    // shoe_size is NOT an emittable claim on this OP (phone_number became one in THE-ADDRESS-PHONE-CLAIMS) (the profile family,
    // email and email_verified are) — the unknown one must never be listed.
    const claims = JSON.stringify({ userinfo: { name: { essential: true }, shoe_size: null } });
    const authQuery =
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=openid&state=cl-${runId}` +
      `&code_challenge=${codeChallenge}&code_challenge_method=S256` +
      `&claims=${encodeURIComponent(claims)}`;

    // The stored consent covers scope openid but NOT the name claim → the
    // signed-in user is sent to consent again (an unconsented claim never lands).
    const authz = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(authz.status(), "authorize with an unconsented claim → 302").toBe(302);
    const toConsent = authz.headers().location ?? "";
    expect(toConsent, "…to the OP consent form").toMatch(/^\/api\/v1\/oauth\/consent\?/);
    expect(toConsent, "…carrying the claims parameter").toContain("claims=");

    // The consent page lists the emittable claim and never the unknown one.
    const consentForm = await request.get(`${IDP_BASE}${toConsent}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(consentForm.status(), "consent form renders for the claims request").toBe(200);
    const consentHtml = await consentForm.text();
    expect(consentHtml, "consent page lists the requested name claim").toContain(
      "name (shared with the application)"
    );
    // The hidden field echoes the raw parameter (so approval resumes the
    // request); the LIST never shows an unknown claim.
    expect(consentHtml, "unknown claims are never listed").not.toContain("<li>shoe_size");
    const consentCsrf = consentHtml.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(consentCsrf, "consent form embeds a CSRF token").toBeTruthy();

    const approve = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        action: "approve",
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        state: `cl-${runId}`,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        claims,
        [consentCsrf?.[1] ?? "csrf_token"]: consentCsrf?.[2] ?? "",
      },
    });
    expect(approve.status(), "consent approve with claims → 302").toBe(302);
    const code = new URL(approve.headers().location ?? "").searchParams.get("code") ?? "";
    expect(code.length, "a code is minted under the consented claims").toBeGreaterThan(0);

    const basic = {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    };
    const exchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      headers: basic,
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
    });
    expect(exchange.status(), "exchange → 200").toBe(200);
    const tokens = (await exchange.json()) as { access_token?: string };
    const withClaims = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(withClaims.status(), "userinfo → 200").toBe(200);
    const info = (await withClaims.json()) as { name?: string; email?: string };
    expect(info.name, "userinfo carries the consented name claim").toBe(`Ceremony User ${runId}`);
    expect(info.email, "…and nothing that was neither scoped nor requested").toBeUndefined();

    // Negative: the SAME user, a code minted WITHOUT the claims request (scope
    // openid only) → the token carries no claim names → no name at userinfo.
    const plainVerifier = randomBytes(32).toString("base64url");
    const plainChallenge = createHash("sha256").update(plainVerifier).digest("base64url");
    const plainAuthz = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid` +
        `&state=pl-${runId}&code_challenge=${plainChallenge}&code_challenge_method=S256`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(
      plainAuthz.status(),
      "authorize without claims (consent stored) → 302 to the client"
    ).toBe(302);
    const plainCode = new URL(plainAuthz.headers().location ?? "").searchParams.get("code") ?? "";
    expect(plainCode.length, "a code is minted straight through").toBeGreaterThan(0);
    const plainExchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      headers: basic,
      form: {
        grant_type: "authorization_code",
        code: plainCode,
        redirect_uri: REDIRECT_URI,
        code_verifier: plainVerifier,
      },
    });
    expect(plainExchange.status(), "plain exchange → 200").toBe(200);
    const plainTokens = (await plainExchange.json()) as { access_token?: string };
    const plainInfo = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${plainTokens.access_token}` },
    });
    expect(plainInfo.status(), "userinfo → 200").toBe(200);
    expect(
      ((await plainInfo.json()) as { name?: string }).name,
      "no claims request, no profile scope → no name, even though consent exists and the user has one"
    ).toBeUndefined();
  });

  // THE-PROFILE-CLAIMS: the user sets OIDC §5.1 profile fields on their own
  // profile; a client consented to scope=profile receives exactly the SET
  // fields (+ name, updated_at) at userinfo and never an unset one.
  test("profile scope: set profile fields reach userinfo; unset fields are absent", async ({
    request,
  }) => {
    // Self-service profile write with the user's own bearer.
    const ouLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expect(ouLogin.status, "org_user login → 200").toBe(200);
    const ouBearer = ouLogin.json.access_token as string;
    const put = await api(
      IDP_BASE,
      "PUT",
      "/api/v1/profile",
      { given_name: "Ceremony", locale: "en-GB", website: "https://ceremony.example" },
      ouBearer
    );
    expect(put.status, "PUT /profile (self-service) → 200").toBe(200);
    expect((put.json as { given_name?: string }).given_name).toBe("Ceremony");
    const badPut = await api(
      IDP_BASE,
      "PUT",
      "/api/v1/profile",
      { website: "not a url" },
      ouBearer
    );
    expect(badPut.status, "a malformed website → 400 naming the field").toBe(400);
    expect(String((badPut.json as { message?: string }).message ?? "")).toContain("website");

    // Browser-login session for this request context, then authorize with
    // scope=openid profile — the stored consent covers openid (+ the name
    // claim), not the profile scope → consent page → approve.
    const loginForm = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    const loginCsrf = (await loginForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    const login = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        email: userEmail,
        password: userPw,
        [loginCsrf?.[1] ?? "csrf_token"]: loginCsrf?.[2] ?? "",
      },
    });
    expect(login.status(), "browser-login → 303").toBe(303);
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const authQuery =
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent("openid profile")}&state=pf-${runId}` +
      `&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    const authz = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(authz.status(), "authorize with the unconsented profile scope → 302").toBe(302);
    const toConsent = authz.headers().location ?? "";
    expect(toConsent, "…to the OP consent form").toMatch(/^\/api\/v1\/oauth\/consent\?/);
    const consentForm = await request.get(`${IDP_BASE}${toConsent}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const consentCsrf = (await consentForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    const approve = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        action: "approve",
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "openid profile",
        state: `pf-${runId}`,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        [consentCsrf?.[1] ?? "csrf_token"]: consentCsrf?.[2] ?? "",
      },
    });
    expect(approve.status(), "consent approve → 302").toBe(302);
    const code = new URL(approve.headers().location ?? "").searchParams.get("code") ?? "";
    expect(code.length, "a code is minted under the profile scope").toBeGreaterThan(0);
    const exchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
    });
    expect(exchange.status(), "exchange → 200").toBe(200);
    const tokens = (await exchange.json()) as { access_token?: string };
    const info = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(info.status(), "userinfo → 200").toBe(200);
    const claims = (await info.json()) as Record<string, unknown>;
    expect(claims.given_name, "set given_name released under profile").toBe("Ceremony");
    expect(claims.locale, "set locale released").toBe("en-GB");
    expect(claims.website, "set website released").toBe("https://ceremony.example");
    expect(claims.name, "name released under profile").toBe(`Ceremony User ${runId}`);
    expect(typeof claims.updated_at, "updated_at is a number under profile").toBe("number");
    for (const unset of [
      "family_name",
      "middle_name",
      "picture",
      "gender",
      "birthdate",
      "zoneinfo",
    ]) {
      expect(claims[unset], `unset ${unset} is ABSENT — never a placeholder`).toBeUndefined();
    }
    expect(claims.email, "email not scoped → absent").toBeUndefined();
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

  // THE-HONEST-ACR (OIDC Core §3.1.2.1 acr_values). The id_token acr is the
  // context ACTUALLY performed. A password-level session asked for the
  // password+TOTP rung is (a) refused with unmet_authentication_requirements
  // while the user has no TOTP enrolled — no code, no token — and (b) sent
  // through the OP's step-up ceremony once enrolled: the SAME session records
  // the uplift, the resumed authorize mints, and the id_token carries the
  // TOTP rung with amr [pwd otp]. LAST in this describe: it enrols the user
  // in TOTP, which changes what a later password-only login would need.
  test("acr_values: TOTP rung → step-up on an enrolled user, refusal without enrolment; id_token acr is the performed context", async ({
    request,
  }) => {
    const MFA = "urn:identuum:loa:mfa";
    const PASSWORD = "urn:identuum:loa:password";

    // Discovery advertises exactly the two honest contexts.
    const disco = await request.get(`${IDP_BASE}/.well-known/openid-configuration`, {
      failOnStatusCode: false,
    });
    expect(disco.status()).toBe(200);
    expect(
      ((await disco.json()) as { acr_values_supported?: string[] }).acr_values_supported,
      "acr_values_supported is exactly [password, mfa, phishing-resistant] (THE-PHISHING-RESISTANT-ACR)"
    ).toEqual([PASSWORD, MFA, "urn:identuum:loa:phishing-resistant"]);

    // S1: a PASSWORD-level browser session (honest CSRF), established BEFORE
    // the user enrols in TOTP.
    const loginForm = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    const loginCsrf = (await loginForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    expect(loginCsrf, "login form embeds a CSRF token").toBeTruthy();
    const login = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        email: userEmail,
        password: userPw,
        [loginCsrf?.[1] ?? "csrf_token"]: loginCsrf?.[2] ?? "",
      },
    });
    expect(login.status(), "browser-login (password only) → 303").toBe(303);

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const acrQuery =
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=openid&state=acr-${runId}` +
      `&code_challenge=${challenge}&code_challenge_method=S256` +
      `&acr_values=${encodeURIComponent(MFA)}`;

    // ── Negative FIRST: the user has NO TOTP enrolled → the TOTP rung cannot
    // be performed → the honest OIDC error to the client, never a code.
    const unmet = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${acrQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(unmet.status(), "acr_values=mfa, password session, no TOTP → 302").toBe(302);
    const unmetLoc = new URL(unmet.headers().location ?? "");
    expect(unmetLoc.origin + unmetLoc.pathname, "…to the registered redirect_uri").toBe(
      REDIRECT_URI
    );
    expect(unmetLoc.searchParams.get("error"), "…error=unmet_authentication_requirements").toBe(
      "unmet_authentication_requirements"
    );
    expect(unmetLoc.searchParams.get("code"), "…and NO code").toBeNull();
    expect(unmetLoc.searchParams.get("state"), "…state echoed").toBe(`acr-${runId}`);

    // ── Enrol the user in TOTP through the pending-MFA login flow: the org
    // policy is set to required for the enrolment and restored afterwards.
    const requirePolicy = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${orgId}`,
      { mfa_policy: "required" },
      site.bearer
    );
    expect(requirePolicy.status, "site_admin sets org mfa_policy=required").toBe(200);
    const pending = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expect(pending.status, "password login under mfa_policy=required → 401 + pending session").toBe(
      401
    );
    const pendingId = (pending.json as { session_id?: string }).session_id ?? "";
    expect(pendingId.length).toBeGreaterThan(0);
    const init = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa/enroll/initiate", {
      session_id: pendingId,
    });
    expect(init.status, "enroll/initiate → 200").toBe(200);
    const totpSecret = (init.json as { secret?: string }).secret ?? "";
    userTotpSecret = totpSecret;
    expect(totpSecret.length).toBeGreaterThan(0);
    let complete = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
      session_id: pendingId,
      code: generateTOTP(totpSecret, 0),
    });
    if (complete.status !== 200) {
      await new Promise((r) => setTimeout(r, 1000));
      complete = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
        session_id: pendingId,
        code: generateTOTP(totpSecret, 1),
      });
    }
    expect(complete.status, "enroll/complete → 200 (user now TOTP-enrolled)").toBe(200);
    const restorePolicy = await api(
      IDP_BASE,
      "PUT",
      `/api/v1/organizations/${orgId}`,
      { mfa_policy: "optional" },
      site.bearer
    );
    expect(restorePolicy.status, "org mfa_policy restored to optional").toBe(200);

    // ── S1 is STILL a password-level session. The same request now finds a
    // user who CAN perform the TOTP rung → the OP's step-up ceremony.
    const toStepUp = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${acrQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(toStepUp.status(), "acr_values=mfa, password session, TOTP enrolled → 302").toBe(302);
    const stepUpLoc = toStepUp.headers().location ?? "";
    expect(stepUpLoc, "…to the OP step-up ceremony, never a code").toMatch(
      /^\/api\/v1\/auth\/step-up\?return_to=/
    );
    const returnTo = decodeURIComponent(stepUpLoc.split("return_to=")[1] ?? "");
    expect(returnTo, "…return_to resumes the authorize request").toContain(
      `acr_values=${encodeURIComponent(MFA)}`
    );

    // prompt=none can never get an interactive step-up: the OIDC error instead.
    const noneStepUp = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?${acrQuery}&prompt=none`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(noneStepUp.status()).toBe(302);
    expect(
      new URL(noneStepUp.headers().location ?? "").searchParams.get("error"),
      "prompt=none needing a step-up → error=login_required to the client"
    ).toBe("login_required");

    const stepUpForm = await request.get(`${IDP_BASE}${stepUpLoc}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(stepUpForm.status(), "step-up form renders for the live session").toBe(200);
    observeRaw("GET", "/api/v1/auth/step-up", stepUpForm.status());
    const stepUpHtml = await stepUpForm.text();
    expect(stepUpHtml, "…asking for the authenticator code").toContain('name="totp_code"');
    const stepUpCsrf = stepUpHtml.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    expect(stepUpCsrf, "step-up form embeds a CSRF token").toBeTruthy();

    // A WRONG code never uplifts: back to the form with error=invalid_code.
    const wrong = await request.post(`${IDP_BASE}/api/v1/auth/step-up`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        totp_code: "000000",
        return_to: returnTo,
        [stepUpCsrf?.[1] ?? "csrf_token"]: stepUpCsrf?.[2] ?? "",
      },
    });
    expect(wrong.status(), "wrong code → 303").toBe(303);
    expect(wrong.headers().location ?? "", "…back to the form, error=invalid_code").toContain(
      "/api/v1/auth/step-up?error=invalid_code"
    );
    const stillPassword = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${acrQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(stillPassword.headers().location ?? "", "…the session is still password-level").toMatch(
      /^\/api\/v1\/auth\/step-up\?return_to=/
    );

    // The RIGHT code uplifts the SAME session and resumes the authorize URL.
    const reForm = await request.get(`${IDP_BASE}${stepUpLoc}`, { failOnStatusCode: false });
    const reCsrf = (await reForm.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
    let stepped = await request.post(`${IDP_BASE}/api/v1/auth/step-up`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        totp_code: generateTOTP(totpSecret, 0),
        return_to: returnTo,
        [reCsrf?.[1] ?? "csrf_token"]: reCsrf?.[2] ?? "",
      },
    });
    if ((stepped.headers().location ?? "").includes("error=invalid_code")) {
      // Straddled a 30s TOTP boundary: one retry on the next window.
      await new Promise((r) => setTimeout(r, 1000));
      const again = await request.get(`${IDP_BASE}${stepUpLoc}`, { failOnStatusCode: false });
      const againCsrf = (await again.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
      stepped = await request.post(`${IDP_BASE}/api/v1/auth/step-up`, {
        failOnStatusCode: false,
        maxRedirects: 0,
        form: {
          totp_code: generateTOTP(totpSecret, 1),
          return_to: returnTo,
          [againCsrf?.[1] ?? "csrf_token"]: againCsrf?.[2] ?? "",
        },
      });
    }
    expect(stepped.status(), "verified code → 303").toBe(303);
    expect(stepped.headers().location ?? "", "…back to the authorize request").toBe(returnTo);
    observeRaw("POST", "/api/v1/auth/step-up", stepped.status());

    // The resumed authorize now mints: the session performed the TOTP rung.
    const resumed = await request.get(`${IDP_BASE}${returnTo}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(resumed.status(), "resumed authorize after step-up → 302").toBe(302);
    const resumedLoc = new URL(resumed.headers().location ?? "");
    expect(resumedLoc.searchParams.get("error"), "…no error").toBeNull();
    const code = resumedLoc.searchParams.get("code") ?? "";
    expect(code.length, "…a code").toBeGreaterThan(0);

    const exchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect(exchange.status(), "exchange → 200").toBe(200);
    const tokens = (await exchange.json()) as { id_token?: string };
    const idToken = tokens.id_token ?? "";
    expect(idToken.split(".").length, "an id_token is issued").toBe(3);
    const idClaims = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { acr?: string; amr?: string[] };
    expect(idClaims.acr, "id_token acr is the TOTP rung the session PERFORMED").toBe(MFA);
    expect(idClaims.amr ?? [], "…amr carries pwd and otp").toEqual(
      expect.arrayContaining(["pwd", "otp"])
    );

    // The uplifted session also satisfies the LOWER password rung (rank).
    const v3 = randomBytes(32).toString("base64url");
    const ch3 = createHash("sha256").update(v3).digest("base64url");
    const lower = await request.get(
      `${IDP_BASE}/api/v1/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid` +
        `&state=low-${runId}&code_challenge=${ch3}&code_challenge_method=S256` +
        `&acr_values=${encodeURIComponent(PASSWORD)}`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(
      (new URL(lower.headers().location ?? "").searchParams.get("code") ?? "").length,
      "acr_values=password on the uplifted session → a code straight through"
    ).toBeGreaterThan(0);
  });

  // THE-PHISHING-RESISTANT-ACR. The third honest context. A real browser
  // (CDP virtual authenticator) on the RP origin — the issuer's own origin,
  // http://localhost:7113 in the harness, which the WebAuthn service always
  // lists as an allowed origin. Order: (1) password+TOTP browser session in
  // the page; (2) while the user holds NO passkey, acr_values=phishing-resistant
  // → honest refusal to the client, no code; (3) register a passkey through
  // the real WebAuthn ceremony; (4) the SAME session asks again → the passkey
  // step-up page → assertion → uplift → the resumed authorize mints and the
  // id_token carries the phishing-resistant rung; (5) the uplifted session
  // satisfies the LOWER mfa and password requests straight through.
  test("acr_values: phishing-resistant → passkey step-up on a passkey user, refusal on a TOTP-only user, lower rungs covered", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(240_000);
    const PR = "urn:identuum:loa:phishing-resistant";
    const MFA = "urn:identuum:loa:mfa";
    const PASSWORD = "urn:identuum:loa:password";
    const IDP_ORIGIN = process.env.IDENTUUM_E2E_FULL_IDP_ORIGIN ?? "http://localhost:7113";
    expect(userTotpSecret.length, "the TOTP secret enrolled by the previous test").toBeGreaterThan(
      0
    );
    // TOTP replay protection refuses a code used twice: wait for a fresh
    // 30-second window before every TOTP use after the first.
    const nextTotpWindow = () =>
      new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 750));
    // The describe's client redirects to an unroutable test host, and a browser
    // navigation follows the OP's 302 there WITHOUT consulting page.route
    // (Chromium follows redirects of an intercepted request internally —
    // MEASURED: page.goto → net::ERR_NAME_NOT_RESOLVED). So this test registers
    // ITS OWN client whose redirect_uri is a page the OP itself serves on the
    // RP origin (/health): the browser lands there with ?code= and the URL can
    // be read. Non-navigating authorize probes use page.request — the page's
    // own cookie jar — with redirects disabled and read the Location header.
    const LOCAL_CB = `${IDP_ORIGIN}/health`;
    const dcr2 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/oauth/register",
      {
        client_name: `pr-${runId}`,
        redirect_uris: [LOCAL_CB],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "openid",
      },
      site.bearer
    );
    expect(dcr2.status, "DCR of the passkey-ceremony client → 201").toBe(201);
    const client2 = (dcr2.json.client_id as string) ?? "";
    const client2Secret = (dcr2.json.client_secret as string) ?? "";
    expect(client2.length).toBeGreaterThan(0);
    const authorizeURL = (acr: string, state: string) => {
      const v = randomBytes(32).toString("base64url");
      const ch = createHash("sha256").update(v).digest("base64url");
      return {
        verifier: v,
        challenge: ch,
        url:
          `${IDP_ORIGIN}/api/v1/oauth/authorize?client_id=${encodeURIComponent(client2)}` +
          `&redirect_uri=${encodeURIComponent(LOCAL_CB)}&response_type=code&scope=openid` +
          `&state=${state}&code_challenge=${ch}&code_challenge_method=S256` +
          (acr ? `&acr_values=${encodeURIComponent(acr)}` : ""),
      };
    };
    const locationOf = async (url: string, what: string) => {
      const r = await page.request.get(url, { failOnStatusCode: false, maxRedirects: 0 });
      expect(r.status(), `${what} → 302`).toBe(302);
      return r.headers().location ?? "";
    };

    // ── (1) password + TOTP browser-login in the PAGE → an mfa-rung session.
    await page.goto(`${IDP_ORIGIN}/api/v1/auth/browser-login`);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPw);
    await page.fill('input[name="totp_code"]', generateTOTP(userTotpSecret, 0));
    await page.click('button[type="submit"]');
    await page.waitForLoadState("domcontentloaded");

    // Consent for the new client, once, through the OP consent form with the
    // page's session (approve resumes the request and mints a code we ignore).
    const consentReq = authorizeURL("", `pr-consent-${runId}`);
    const consentLoc = await locationOf(
      consentReq.url,
      "authorize with no consent for the new client"
    );
    expect(consentLoc, "…to the OP consent form").toMatch(/^\/api\/v1\/oauth\/consent\?/);
    const consentForm = await page.request.get(`${IDP_ORIGIN}${consentLoc}`, {
      failOnStatusCode: false,
    });
    expect(consentForm.status(), "consent form renders for the page session").toBe(200);
    const consentCsrf = (await consentForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    expect(consentCsrf, "consent form embeds a CSRF token").toBeTruthy();
    const approve = await page.request.post(`${IDP_ORIGIN}/api/v1/oauth/consent`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        action: "approve",
        response_type: "code",
        client_id: client2,
        redirect_uri: LOCAL_CB,
        scope: "openid",
        state: `pr-consent-${runId}`,
        code_challenge: consentReq.challenge,
        code_challenge_method: "S256",
        [consentCsrf?.[1] ?? "csrf_token"]: consentCsrf?.[2] ?? "",
      },
    });
    expect(approve.status(), "consent approve → 302").toBe(302);
    expect(approve.headers().location ?? "", "…to the client with a code").toContain(
      `${LOCAL_CB}?`
    );

    // ── (2) NO passkey yet: the phishing-resistant rung cannot be performed.
    const unmetURL = new URL(
      await locationOf(
        authorizeURL(PR, `pr-unmet-${runId}`).url,
        "acr_values=phishing-resistant, TOTP-only user"
      )
    );
    expect(unmetURL.origin + unmetURL.pathname, "…to the client's redirect_uri").toBe(LOCAL_CB);
    expect(
      unmetURL.searchParams.get("error"),
      "TOTP-only user → unmet_authentication_requirements"
    ).toBe("unmet_authentication_requirements");
    expect(unmetURL.searchParams.get("code"), "…and NO code").toBeNull();

    // ── (3) The user's bearer (fresh TOTP window), then a real passkey
    // registration through the WebAuthn ceremony on the RP origin.
    await nextTotpWindow();
    const pending = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expect(pending.status, "TOTP-enrolled JSON login → 401 pending").toBe(401);
    const verify = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa", {
      session_id: (pending.json as { session_id?: string }).session_id ?? "",
      code: generateTOTP(userTotpSecret, 0),
    });
    expect(verify.status, "TOTP verify → 200 bearer").toBe(200);
    const bearer = (verify.json as { access_token?: string }).access_token ?? "";
    expect(bearer.length).toBeGreaterThan(0);

    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable", { enableUI: false });
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(`${IDP_ORIGIN}/api/v1/auth/browser-login`); // any document on the RP origin
    const registered = await page.evaluate(async (token) => {
      const b64uToBuf = (s: string) => {
        const b = s.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
      };
      const bufToB64u = (buf: ArrayBuffer) => {
        let bin = "";
        for (const byte of new Uint8Array(buf)) bin += String.fromCharCode(byte);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const begin = await fetch("/api/v1/webauthn/register/begin", {
        method: "POST",
        headers: auth,
        body: "{}",
      });
      if (!begin.ok) return { step: "begin", status: begin.status };
      // biome-ignore lint/suspicious/noExplicitAny: raw ceremony options
      const b: any = await begin.json();
      const pk = b.publicKey;
      pk.challenge = b64uToBuf(pk.challenge);
      pk.user.id = b64uToBuf(pk.user.id);
      // biome-ignore lint/suspicious/noExplicitAny: raw ceremony options
      pk.excludeCredentials = (pk.excludeCredentials ?? []).map((c: any) => ({
        ...c,
        id: b64uToBuf(c.id),
      }));
      const cred = (await navigator.credentials.create({ publicKey: pk })) as PublicKeyCredential;
      const r = cred.response as AuthenticatorAttestationResponse;
      const body = {
        id: cred.id,
        rawId: bufToB64u(cred.rawId),
        type: cred.type,
        response: {
          attestationObject: bufToB64u(r.attestationObject),
          clientDataJSON: bufToB64u(r.clientDataJSON),
        },
      };
      const fin = await fetch(
        `/api/v1/webauthn/register/finish?session_id=${encodeURIComponent(b.session_id)}&nickname=acr-e2e`,
        { method: "POST", headers: auth, body: JSON.stringify(body) }
      );
      return { step: "finish", status: fin.status };
    }, bearer);
    expect(registered, "passkey registered through the real WebAuthn ceremony").toEqual({
      step: "finish",
      status: 200,
    });

    // ── (4) The SAME mfa-rung session asks for the phishing-resistant rung:
    // the passkey step-up page, the assertion, the uplift, the resumed mint.
    const stepUp = authorizeURL(PR, `pr-${runId}`);
    const stepUpLoc = await locationOf(stepUp.url, "acr_values=phishing-resistant, passkey held");
    expect(stepUpLoc, "…to the OP passkey step-up ceremony, never a code").toMatch(
      /^\/api\/v1\/auth\/step-up\/passkey\?return_to=/
    );
    const finishResp = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/v1/auth/step-up/passkey?")
    );
    const pr = await page.goto(`${IDP_ORIGIN}${stepUpLoc}`);
    expect(pr?.status(), "passkey step-up page renders for the live session").toBe(200);
    observeRaw("GET", "/api/v1/auth/step-up/passkey", pr?.status() ?? 0);
    const fr = await finishResp;
    expect(fr.status(), "verified assertion → 200 (uplift recorded)").toBe(200);
    observeRaw("POST", "/api/v1/auth/step-up/passkey", fr.status());
    await page.waitForURL(
      (u) => u.origin === IDP_ORIGIN && u.pathname === "/health" && u.searchParams.has("code")
    );
    const minted = new URL(page.url());
    expect(minted.searchParams.get("error"), "…no error").toBeNull();
    const code = minted.searchParams.get("code") ?? "";
    expect(code.length, "…a code after the passkey step-up").toBeGreaterThan(0);
    expect(minted.searchParams.get("state"), "…state echoed").toBe(`pr-${runId}`);

    const exchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      headers: {
        Authorization: `Basic ${Buffer.from(`${client2}:${client2Secret}`).toString("base64")}`,
      },
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: LOCAL_CB,
        code_verifier: stepUp.verifier,
      },
    });
    expect(exchange.status(), "exchange → 200").toBe(200);
    const idToken = ((await exchange.json()) as { id_token?: string }).id_token ?? "";
    const idClaims = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { acr?: string; amr?: string[] };
    expect(idClaims.acr, "id_token acr is the phishing-resistant rung the session PERFORMED").toBe(
      PR
    );
    expect(idClaims.amr ?? [], "…amr still records the password+TOTP login").toEqual(
      expect.arrayContaining(["pwd", "otp"])
    );

    // ── (5) Ranking covers downward: the uplifted session satisfies mfa and
    // password requests without any ceremony.
    for (const [acr, state] of [
      [MFA, `pr-low-mfa-${runId}`],
      [PASSWORD, `pr-low-pw-${runId}`],
    ] as const) {
      const low = new URL(await locationOf(authorizeURL(acr, state).url, `acr_values=${acr}`));
      expect(low.origin + low.pathname, `${acr}: to the client`).toBe(LOCAL_CB);
      expect(low.searchParams.get("error"), `${acr}: no error`).toBeNull();
      expect(
        (low.searchParams.get("code") ?? "").length,
        `${acr}: a code straight through`
      ).toBeGreaterThan(0);
    }
  });

  // THE-ADDRESS-PHONE-CLAIMS: the user sets a phone number and SOME address
  // members on their own profile; a client consented to scope=address phone
  // receives the structured address (exactly the set members) plus
  // phone_number and phone_number_verified=false at userinfo; an unset
  // member is absent; a consentless request (scope openid only) carries
  // neither; the claims parameter releases phone_number alone.
  test("address + phone: set, consent, userinfo carries them; unset absent; consentless carries neither", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const nextTotpWindow = () =>
      new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 750));
    expect(userTotpSecret.length, "the TOTP secret enrolled earlier").toBeGreaterThan(0);

    // ── The user's bearer (TOTP-enrolled JSON login) → self-service PUT.
    await nextTotpWindow();
    const pending = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    expect(pending.status, "TOTP-enrolled JSON login → 401 pending").toBe(401);
    const verify = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa", {
      session_id: (pending.json as { session_id?: string }).session_id ?? "",
      code: generateTOTP(userTotpSecret, 0),
    });
    expect(verify.status, "TOTP verify → 200 bearer").toBe(200);
    const ouBearer = (verify.json as { access_token?: string }).access_token ?? "";

    const put = await api(
      IDP_BASE,
      "PUT",
      "/api/v1/profile",
      {
        phone_number: "+442079460000",
        address_street_address: "1 Ceremony Way",
        address_locality: "London",
        address_postal_code: "SW1A 1AA",
        address_country: "United Kingdom",
      },
      ouBearer
    );
    expect(put.status, "PUT /profile with phone + partial address → 200").toBe(200);
    expect((put.json as { phone_number?: string }).phone_number).toBe("+442079460000");
    expect(
      (put.json as { address_region?: string }).address_region,
      "region never set"
    ).toBeUndefined();
    const badPhone = await api(
      IDP_BASE,
      "PUT",
      "/api/v1/profile",
      { phone_number: "020 7946 0000" },
      ouBearer
    );
    expect(badPhone.status, "non-E.164 phone → 400 naming the field").toBe(400);
    expect(String((badPhone.json as { message?: string }).message ?? "")).toContain("phone_number");

    // ── A client registered for the address + phone scopes.
    const dcr = await api(
      IDP_BASE,
      "POST",
      "/api/v1/oauth/register",
      {
        client_name: `ap-${runId}`,
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "openid address phone",
      },
      site.bearer
    );
    expect(dcr.status, "DCR of the address/phone client → 201").toBe(201);
    const apClient = (dcr.json.client_id as string) ?? "";
    const apSecret = (dcr.json.client_secret as string) ?? "";
    const basic = {
      Authorization: `Basic ${Buffer.from(`${apClient}:${apSecret}`).toString("base64")}`,
    };

    // ── Browser-login session for this request context (password + TOTP,
    // fresh window).
    await nextTotpWindow();
    const loginForm = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
    });
    const loginCsrf = (await loginForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    const login = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        email: userEmail,
        password: userPw,
        totp_code: generateTOTP(userTotpSecret, 0),
        [loginCsrf?.[1] ?? "csrf_token"]: loginCsrf?.[2] ?? "",
      },
    });
    expect(login.status(), "browser-login (password + TOTP) → 303").toBe(303);

    // The ceremony: authorize → consent form (scopes listed) → approve → code
    // → token → userinfo. Returns the userinfo body.
    const ceremony = async (scope: string, state: string, claims?: string) => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const q =
        `client_id=${encodeURIComponent(apClient)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}` +
        `&code_challenge=${challenge}&code_challenge_method=S256` +
        (claims ? `&claims=${encodeURIComponent(claims)}` : "");
      const authz = await request.get(`${IDP_BASE}/api/v1/oauth/authorize?${q}`, {
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      expect(authz.status(), `${state}: authorize → 302`).toBe(302);
      let loc = authz.headers().location ?? "";
      let code = "";
      if (loc.startsWith("/api/v1/oauth/consent?")) {
        const form = await request.get(`${IDP_BASE}${loc}`, { failOnStatusCode: false });
        expect(form.status(), `${state}: consent form`).toBe(200);
        const html = await form.text();
        const csrf = html.match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
        const approve = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
          failOnStatusCode: false,
          maxRedirects: 0,
          form: {
            action: "approve",
            response_type: "code",
            client_id: apClient,
            redirect_uri: REDIRECT_URI,
            scope,
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            ...(claims ? { claims } : {}),
            [csrf?.[1] ?? "csrf_token"]: csrf?.[2] ?? "",
          },
        });
        expect(approve.status(), `${state}: approve → 302`).toBe(302);
        loc = approve.headers().location ?? "";
        return { html, userinfo: await exchangeAndUserinfo(loc) };
      }
      code = new URL(loc).searchParams.get("code") ?? "";
      expect(code.length, `${state}: a code`).toBeGreaterThan(0);
      return { html: "", userinfo: await exchangeAndUserinfo(loc) };
      async function exchangeAndUserinfo(location: string) {
        const c = new URL(location).searchParams.get("code") ?? "";
        expect(c.length, `${state}: code on the redirect`).toBeGreaterThan(0);
        const exchange = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
          failOnStatusCode: false,
          headers: basic,
          form: {
            grant_type: "authorization_code",
            code: c,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          },
        });
        expect(exchange.status(), `${state}: exchange → 200`).toBe(200);
        const tokens = (await exchange.json()) as { access_token?: string };
        const info = await request.get(`${IDP_BASE}/api/v1/oidc/userinfo`, {
          failOnStatusCode: false,
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        expect(info.status(), `${state}: userinfo → 200`).toBe(200);
        return (await info.json()) as Record<string, unknown>;
      }
    };

    // ── Consented to address + phone: exactly the set members, verified=false.
    const full = await ceremony("openid address phone", `ap-${runId}`);
    // MEASURED (first mint): the OP consent page lists requested scopes by
    // NAME (<li>address</li>), not by domain.ScopeDescriptions text.
    expect(full.html, "consent page lists the address scope").toContain("<li>address</li>");
    expect(full.html, "consent page lists the phone scope").toContain("<li>phone</li>");
    const address = full.userinfo.address as Record<string, string> | undefined;
    expect(address, "userinfo carries the structured address").toEqual({
      street_address: "1 Ceremony Way",
      locality: "London",
      postal_code: "SW1A 1AA",
      country: "United Kingdom",
    });
    expect(full.userinfo.phone_number, "userinfo carries phone_number").toBe("+442079460000");
    expect(
      full.userinfo.phone_number_verified,
      "phone_number_verified is false — never true, no verification event exists"
    ).toBe(false);
    expect(full.userinfo.email, "email not scoped → absent").toBeUndefined();
    expect(full.userinfo.name, "name not scoped → absent").toBeUndefined();

    // ── Consentless for these claims (scope openid only): neither lands.
    const plain = await ceremony("openid", `ap-plain-${runId}`);
    for (const k of ["address", "phone_number", "phone_number_verified"]) {
      expect(plain.userinfo[k], `${k} without its scope → absent`).toBeUndefined();
    }

    // ── Claims parameter: phone_number alone (consented) → the phone pair,
    // never the address.
    const viaClaims = await ceremony(
      "openid",
      `ap-claims-${runId}`,
      JSON.stringify({ userinfo: { phone_number: null } })
    );
    expect(viaClaims.userinfo.phone_number, "claims parameter releases phone_number").toBe(
      "+442079460000"
    );
    expect(viaClaims.userinfo.phone_number_verified).toBe(false);
    expect(viaClaims.userinfo.address, "address not requested → absent").toBeUndefined();
  });
});
