/**
 * THE-TOKEN-SWEEP (2026-08-28) — batch 4 of 7, CLOSES the census.
 *
 * Covers the final 20 census-NEITHER rows: oauth (5), oidc (4), keys (5),
 * service-accounts (4), webauthn (2). Every row a measured non-2xx; green.
 *
 * KEY MECHANICS PINNED (all measured live):
 *  - client_credentials JWTs are minted by a SERVICE-ACCOUNT-BOUND client
 *    (the with-client bundle); a plain OAuth client is unauthorized_client
 *    for that grant. Client auth is the client's EXACTLY-registered method
 *    (P0-7) — here client_secret_basic on the bundle client.
 *  - Item 3, the key/token transition: a token minted before rotation stays
 *    active THROUGH the rotation (the old key is retired but still in JWKS),
 *    then flips to active:false once the old key is DEPRECATED + DELETED, and
 *    its kid vanishes from JWKS. Deprecating+deleting the active signing key
 *    invalidates EVERY token signed by it — admin session bearers included
 *    (correct rotation semantics: rotate to a new active key first, then
 *    retire the old; this spec re-acquires site_admin after the rotate so its
 *    fresh bearer is signed by the new key). The keys block runs LAST.
 *  - oauth consent is browser-cookie gated (401 login_required over plain
 *    HTTP — the BROWSER-LOGIN-PLAINHTTP-1 family); its happy path is
 *    environment-unreachable.
 *  - webauthn register/finish needs a real authenticator that does not exist
 *    here — the happy path is environment-unreachable, attestation is NOT
 *    faked; only begin and the refusals are asserted.
 *
 * Setup note: org admins are created via /users (not the activation path)
 * and enrolled with a fresh login+initiate per TOTP window — under the
 * five-file load the Docker VM clock drifts and the one-shot
 * enrollment-complete needs a clean session per code attempt.
 */
import { expect, test } from "@playwright/test";
import { api } from "../e2e/helpers/appliance-fixture";
import { generateTOTP } from "../e2e/helpers/totp";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = process.env.IDENTUUM_E2E_FULL_IDP_BASE ?? "http://127.0.0.1:7113";
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const GHOST = "00000000-0000-0000-0000-00000000dead";

test.describe.configure({ mode: "serial" });

test.describe("token sweep (20 census rows — closes the census)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
  let site = { bearer: "", totpSecret: "" };
  let runId = "";
  let org = "";
  let orgBearer = "";
  let userBearer = "";
  let m2mId = "";
  let m2mSecret = "";
  const basic = (id: string, sec: string) => ({
    Authorization: `Basic ${Buffer.from(`${id}:${sec}`).toString("base64")}`,
  });

  // A fresh login+initiate per window: enrollment-complete is one-shot per
  // session and host/container clocks drift under the five-file load.
  const enrollBearer = async (email: string, password: string): Promise<string> => {
    for (const win of [0, -1, 1, -2, 2]) {
      const l = await api(IDP_BASE, "POST", "/api/v1/auth/login", { email, password });
      const sid = (l.json as { session_id?: string }).session_id ?? "";
      if (l.status !== 401 || !sid) continue;
      const init = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa/enroll/initiate", {
        session_id: sid,
      });
      const secret = (init.json as { secret?: string }).secret ?? "";
      if (init.status !== 200 || !secret) continue;
      const c = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
        session_id: sid,
        code: generateTOTP(secret, win),
      });
      if (c.status === 200) {
        const b = (c.json.access_token as string) ?? "";
        if (b) return b;
      }
    }
    throw new Error(`enrollBearer failed for ${email}`);
  };

  test("setup: session, org, org_admin, org_user, M2M bundle client", async () => {
    expect(adminPassword.length).toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `tok-${Date.now().toString(36)}`;
    const c1 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `tok ${runId}`,
        slug: `${runId}`,
        domain: `${runId}.test`,
        active: true,
        mfa_policy: "optional",
      },
      site.bearer
    );
    expect(c1.status).toBe(201);
    org = (c1.json.id as string) ?? "";
    const oaEmail = `oa@${runId}.test`;
    const adminPw = `Adm!${runId}9wqX`;
    const oaC = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: oaEmail, password: adminPw, role: "org_admin", organization_id: org },
      site.bearer
    );
    await api(
      IDP_BASE,
      "PUT",
      `/api/v1/users/${oaC.json.id}`,
      { email_verified: true },
      site.bearer
    );
    orgBearer = await enrollBearer(oaEmail, adminPw);
    const userEmail = `u@${runId}.test`;
    const userPw = `Usr!${runId}3kpZ`;
    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      { email: userEmail, password: userPw, role: "org_user", organization_id: org },
      orgBearer
    );
    await api(IDP_BASE, "PUT", `/api/v1/users/${uc.json.id}`, { email_verified: true }, orgBearer);
    const ul = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: userEmail,
      password: userPw,
    });
    userBearer = (ul.json.access_token as string) ?? "";
    expect(userBearer.length).toBeGreaterThan(0);
    const bundle = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org}/service-accounts/with-client`,
      {
        service_account: { name: `m2m-${runId}` },
        client: { name: `m2mcl-${runId}`, allowed_audiences: [`https://api.${runId}.test`] },
      },
      site.bearer
    );
    expect(bundle.status).toBe(201);
    m2mId = (bundle.json.client as { client_id?: string })?.client_id ?? "";
    m2mSecret = (bundle.json.client_secret as string) ?? "";
    expect(m2mId.length).toBeGreaterThan(0);
  });

  test("oauth token + introspection + revoke", async ({ request }) => {
    const post = (path: string, form: Record<string, string>, headers?: Record<string, string>) =>
      request.post(`${IDP_BASE}${path}`, {
        form,
        failOnStatusCode: false,
        maxRedirects: 0,
        headers,
      });

    // client_credentials is the census-NEITHER token path (authorize/token are
    // DIRECT-covered). Mint a real JWT via the M2M bundle client.
    const mint = await post(
      "/api/v1/oauth/token",
      { grant_type: "client_credentials" },
      basic(m2mId, m2mSecret)
    );
    expect(mint.status(), "client_credentials mint → 200").toBe(200);
    const accessToken = ((await mint.json()) as { access_token?: string }).access_token ?? "";
    expect(accessToken.length).toBeGreaterThan(0);
    expect(
      (
        await post(
          "/api/v1/oauth/token",
          { grant_type: "client_credentials" },
          basic(m2mId, "wrong")
        )
      ).status(),
      "bad client secret → 401"
    ).toBe(401);
    expect(
      (
        await post("/api/v1/oauth/token", { grant_type: "password" }, basic(m2mId, m2mSecret))
      ).status(),
      "unsupported grant → 400"
    ).toBe(400);

    // ROW POST /oauth/introspection (SR): client-auth-gated.
    const iActive = await post(
      "/api/v1/oauth/introspection",
      { token: accessToken },
      basic(m2mId, m2mSecret)
    );
    expect(iActive.status()).toBe(200);
    expect(
      ((await iActive.json()) as { active?: boolean }).active,
      "minted token → active:true"
    ).toBe(true);
    const iGarbage = await post(
      "/api/v1/oauth/introspection",
      { token: "deadbeef" },
      basic(m2mId, m2mSecret)
    );
    expect(iGarbage.status()).toBe(200);
    expect(
      ((await iGarbage.json()) as { active?: boolean }).active,
      "garbage token → active:false (oracle)"
    ).toBe(false);
    expect(
      (await post("/api/v1/oauth/introspection", {}, basic(m2mId, m2mSecret))).status(),
      "empty token → 400"
    ).toBe(400);
    expect(
      (await post("/api/v1/oauth/introspection", { token: "x" })).status(),
      "no client auth → 401"
    ).toBe(401);

    // ROW POST /oauth/revoke (D): idempotent 200, empty → 400, no auth → 401.
    expect(
      (await post("/api/v1/oauth/revoke", { token: "deadbeef" }, basic(m2mId, m2mSecret))).status(),
      "revoke any token → 200 (idempotent)"
    ).toBe(200);
    expect(
      (await post("/api/v1/oauth/revoke", {}, basic(m2mId, m2mSecret))).status(),
      "revoke empty → 400"
    ).toBe(400);
    expect(
      (await post("/api/v1/oauth/revoke", { token: "x" })).status(),
      "revoke no client auth → 401"
    ).toBe(401);
  });

  test("oauth register (DCR) + consent (browser-gated)", async ({ request }) => {
    // ROW POST /oauth/register (SM)
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/oauth/register",
          { client_name: `dcr-${runId}`, redirect_uris: ["https://ui.example.test/cb"] },
          site.bearer
        )
      ).status,
      "site_admin DCR → 201"
    ).toBe(201);
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/oauth/register",
          { client_name: "x", redirect_uris: ["https://ui.example.test/cb"] },
          orgBearer
        )
      ).status,
      "org_admin DCR → 403"
    ).toBe(403);
    expect(
      (
        await api(IDP_BASE, "POST", "/api/v1/oauth/register", {
          client_name: "x",
          redirect_uris: ["https://ui.example.test/cb"],
        })
      ).status,
      "unauthenticated DCR → 401"
    ).toBe(401);
    const badJson = await request.post(`${IDP_BASE}/api/v1/oauth/register`, {
      form: { notjson: "x" },
      failOnStatusCode: false,
      headers: { Authorization: `Bearer ${site.bearer}` },
    });
    expect(badJson.status(), "non-JSON DCR body → 400").toBe(400);

    // ROW GET + POST /oauth/consent (SR/SM): browser-session gated. A request
    // with no identuum_session → login_required 401 (asserted here). The happy
    // consent screen needs an authenticated browser session; the full
    // authorize→consent→PKCE-code→single-use ceremony is now pinned in
    // consent-ceremony.spec.ts (THE-CONSENT-CEREMONY), reachable once the
    // session cookie became transport-adaptive (SESSION-COOKIE-TRANSPORT-SEC-1).
    const getConsent = await request.get(
      `${IDP_BASE}/api/v1/oauth/consent?client_id=x&redirect_uri=${encodeURIComponent("https://ui.example.test/cb")}`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(getConsent.status(), "consent GET without a session → 401").toBe(401);
    const postConsent = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
      form: { client_id: "x", decision: "accept" },
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(postConsent.status(), "consent POST without a session → 401").toBe(401);
  });

  test("oidc userinfo + logout + frontchannel-logout", async ({ request }) => {
    // ROW GET + POST /oidc/userinfo (SR): bearer required.
    expect(
      (await api(IDP_BASE, "GET", "/api/v1/oidc/userinfo", undefined, userBearer)).status,
      "userinfo GET with bearer → 200"
    ).toBe(200);
    expect(
      (await api(IDP_BASE, "GET", "/api/v1/oidc/userinfo")).status,
      "userinfo GET no bearer → 401"
    ).toBe(401);
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/oidc/userinfo", {}, userBearer)).status,
      "userinfo POST with bearer → 200"
    ).toBe(200);
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/oidc/userinfo", {})).status,
      "userinfo POST no bearer → 401"
    ).toBe(401);

    // ROW GET /oidc/logout (D): bare → 204; a post_logout_redirect_uri not
    // registered to a REAL client → 400 (a nonexistent client_id just skips
    // redirect validation and 204s — the client must exist for the refusal).
    const logoutClient = await api(
      IDP_BASE,
      "POST",
      "/api/v1/clients",
      { name: `lc-${runId}`, redirect_uris: ["https://ui.example.test/cb"] },
      site.bearer
    );
    const logoutClientId = (logoutClient.json.client as { client_id?: string })?.client_id ?? "";
    const logoutBare = await request.get(`${IDP_BASE}/api/v1/oidc/logout`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(logoutBare.status(), "logout bare → 204").toBe(204);
    const logoutBadRedir = await request.get(
      `${IDP_BASE}/api/v1/oidc/logout?post_logout_redirect_uri=${encodeURIComponent("https://evil.test/x")}&client_id=${logoutClientId}`,
      { failOnStatusCode: false, maxRedirects: 0 }
    );
    expect(logoutBadRedir.status(), "logout with an unregistered redirect → 400").toBe(400);

    // ROW GET /oidc/frontchannel-logout (D): the iframe endpoint always
    // renders 200 and clears the cookie — no non-2xx on the bare path, so the
    // row is the documented 200-only shape (its logout family's non-2xx is the
    // end_session 400 above).
    const fcl = await request.get(`${IDP_BASE}/api/v1/oidc/frontchannel-logout`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(fcl.status(), "frontchannel-logout iframe → 200").toBe(200);
  });

  test("service-accounts — CRUD, cross-tenant, refusals", async () => {
    const orgB =
      (
        (
          await api(
            IDP_BASE,
            "POST",
            "/api/v1/organizations",
            {
              name: `tokB ${runId}`,
              slug: `${runId}b`,
              domain: `${runId}b.test`,
              active: true,
              mfa_policy: "optional",
            },
            site.bearer
          )
        ).json as { id?: string }
      ).id ?? "";
    const sa = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${org}/service-accounts`,
      { name: `sa-${runId}` },
      orgBearer
    );
    expect(sa.status).toBe(201);
    const saId = (sa.json as { id?: string }).id ?? "";
    const saB = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgB}/service-accounts`,
      { name: `sab-${runId}` },
      site.bearer
    );
    const saIdB = (saB.json as { id?: string }).id ?? "";

    // ROW GET /service-accounts/:id (SR)
    expect(
      (await api(IDP_BASE, "GET", `/api/v1/service-accounts/${saId}`, undefined, orgBearer)).status,
      "own SA get → 200"
    ).toBe(200);
    expect(
      (await api(IDP_BASE, "GET", `/api/v1/service-accounts/${saIdB}`, undefined, orgBearer))
        .status,
      "cross-tenant SA get → 404"
    ).toBe(404);
    expect(
      (await api(IDP_BASE, "GET", `/api/v1/service-accounts/${GHOST}`, undefined, orgBearer))
        .status,
      "ghost SA get → 404"
    ).toBe(404);
    expect(
      (await api(IDP_BASE, "GET", "/api/v1/service-accounts/not-a-uuid", undefined, orgBearer))
        .status,
      "malformed id → 400"
    ).toBe(400);

    // ROW PUT /service-accounts/:id (SM)
    expect(
      (
        await api(
          IDP_BASE,
          "PUT",
          `/api/v1/service-accounts/${saId}`,
          { name: `sa2-${runId}`, description: "y" },
          orgBearer
        )
      ).status,
      "SA update (no role) → 200"
    ).toBe(200);
    expect(
      (
        await api(
          IDP_BASE,
          "PUT",
          `/api/v1/service-accounts/${saId}`,
          { role: "not-a-role" },
          orgBearer
        )
      ).status,
      "SA update with an invalid role → 400"
    ).toBe(400);
    expect(
      (await api(IDP_BASE, "PUT", `/api/v1/service-accounts/${saIdB}`, { name: "x" }, orgBearer))
        .status,
      "cross-tenant SA update → 404"
    ).toBe(404);

    // ROW POST /service-accounts/:id/disable (D) + /enable (SM)
    expect(
      (await api(IDP_BASE, "POST", `/api/v1/service-accounts/${saId}/disable`, {}, orgBearer))
        .status,
      "disable → 204"
    ).toBe(204);
    expect(
      (await api(IDP_BASE, "POST", `/api/v1/service-accounts/${saIdB}/disable`, {}, orgBearer))
        .status,
      "cross-tenant disable → 404"
    ).toBe(404);
    expect(
      (await api(IDP_BASE, "POST", `/api/v1/service-accounts/${saId}/enable`, {}, orgBearer))
        .status,
      "re-enable → 204"
    ).toBe(204);
    expect(
      (await api(IDP_BASE, "POST", `/api/v1/service-accounts/${GHOST}/enable`, {}, orgBearer))
        .status,
      "enable a ghost SA → 404"
    ).toBe(404);
  });

  test("webauthn register — begin reachable, finish env-unreachable", async ({ request }) => {
    // ROW POST /webauthn/register/begin (SM)
    const begin = await api(IDP_BASE, "POST", "/api/v1/webauthn/register/begin", {}, userBearer);
    expect(begin.status, "begin with a user bearer → 200").toBe(200);
    expect(
      (begin.json as { publicKey?: unknown }).publicKey,
      "…returns creation options"
    ).toBeTruthy();
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/webauthn/register/begin", {})).status,
      "begin without a bearer → 401"
    ).toBe(401);

    // ROW POST /webauthn/register/finish (SM): the happy path needs a real
    // authenticator that does not exist here — attestation is NOT faked. Only
    // the refusals are asserted.
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/webauthn/register/finish", {}, userBearer)).status,
      "finish without a session_id → 400"
    ).toBe(400);
    const finishBad = await request.post(
      `${IDP_BASE}/api/v1/webauthn/register/finish?session_id=deadbeef`,
      { data: {}, failOnStatusCode: false, headers: { Authorization: `Bearer ${userBearer}` } }
    );
    expect(finishBad.status(), "finish with a bogus session → 400").toBe(400);
  });

  test("keys — CRUD and the token/rotation transition (runs LAST)", async ({ request }) => {
    test.setTimeout(60_000);
    const post = (path: string, form: Record<string, string>, headers?: Record<string, string>) =>
      request.post(`${IDP_BASE}${path}`, {
        form,
        failOnStatusCode: false,
        maxRedirects: 0,
        headers,
      });
    const jwks = async () =>
      (
        (
          (await (
            await request.get(`${IDP_BASE}/.well-known/jwks.json`, { failOnStatusCode: false })
          ).json()) as { keys?: Array<{ kid: string }> }
        ).keys ?? []
      ).map((k) => k.kid);

    // ROW POST /keys/generate (SM): org_admin cannot → 403.
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/keys/generate",
          { algorithm: "EdDSA", state: "active" },
          orgBearer
        )
      ).status,
      "org_admin generate → 403"
    ).toBe(403);

    const keysList = await api(IDP_BASE, "GET", "/api/v1/keys", undefined, site.bearer);
    const activeKid =
      ((keysList.json as { keys?: Array<{ kid: string; state?: string }> }).keys ?? []).find(
        (k) => k.state === "active"
      )?.kid ?? "";
    expect(activeKid.length).toBeGreaterThan(0);
    expect((await jwks()).includes(activeKid), "the active kid is in JWKS before").toBe(true);

    // Item 3: a token minted BEFORE rotation, active:true.
    const preMint = await post(
      "/api/v1/oauth/token",
      { grant_type: "client_credentials" },
      basic(m2mId, m2mSecret)
    );
    const preAccess = ((await preMint.json()) as { access_token?: string }).access_token ?? "";
    expect(preAccess.length).toBeGreaterThan(0);
    const preIntro = await post(
      "/api/v1/oauth/introspection",
      { token: preAccess },
      basic(m2mId, m2mSecret)
    );
    expect(
      ((await preIntro.json()) as { active?: boolean }).active,
      "pre-rotation token → active:true"
    ).toBe(true);

    // ROW POST /keys/generate (SM)
    const gen = await api(
      IDP_BASE,
      "POST",
      "/api/v1/keys/generate",
      { algorithm: "EdDSA", state: "active" },
      site.bearer
    );
    expect(gen.status, "generate → 201").toBe(201);
    const newKid = (gen.json.kid as string) ?? "";
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/keys/generate",
          { algorithm: "ROT13", state: "active" },
          site.bearer
        )
      ).status,
      "unknown algorithm → 400"
    ).toBe(400);

    // ROW POST /keys/rotate (D)
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/keys/rotate", {}, site.bearer)).status,
      "rotate empty body → 400"
    ).toBe(400);
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/keys/rotate",
          { old_kid: activeKid, new_kid: newKid, deprecate_days: 1 },
          site.bearer
        )
      ).status,
      "rotate → 200"
    ).toBe(200);
    // Still active right after rotation — the old key is retired but in JWKS.
    const postRotate = await post(
      "/api/v1/oauth/introspection",
      { token: preAccess },
      basic(m2mId, m2mSecret)
    );
    expect(
      ((await postRotate.json()) as { active?: boolean }).active,
      "after rotate the pre-token is still active:true"
    ).toBe(true);

    // Re-acquire site_admin — its fresh bearer is signed by the NEW active key
    // and survives deprecating the OLD one (which kills every token still
    // signed by the old key, admin bearers included).
    const site2 = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);

    // ROW POST /keys/deprecate (D)
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/keys/deprecate", {}, site2.bearer)).status,
      "deprecate empty body → 400"
    ).toBe(400);
    expect(
      (
        await api(
          IDP_BASE,
          "POST",
          "/api/v1/keys/deprecate",
          { kid: activeKid, expires_at: "2020-01-01T00:00:00Z" },
          site2.bearer
        )
      ).status,
      "deprecate the old kid → 200"
    ).toBe(200);

    // ROW DELETE /keys/expired (D)
    expect(
      (await api(IDP_BASE, "DELETE", "/api/v1/keys/expired", undefined, site2.bearer)).status,
      "purge deprecated-past-expiry → 200"
    ).toBe(200);

    // THE TRANSITION: the pre-rotation token is now dead and its kid is gone.
    const postDelete = await post(
      "/api/v1/oauth/introspection",
      { token: preAccess },
      basic(m2mId, m2mSecret)
    );
    expect(
      ((await postDelete.json()) as { active?: boolean }).active,
      "after deprecate+delete the pre-token → active:false"
    ).toBe(false);
    const kidsAfter = await jwks();
    expect(kidsAfter.includes(activeKid), "the old kid is GONE from JWKS").toBe(false);
    expect(kidsAfter.includes(newKid), "the new kid remains").toBe(true);

    // ROW POST /keys/reload (SM): 501 in OSS (KeyManager not relocated).
    expect(
      (await api(IDP_BASE, "POST", "/api/v1/keys/reload", {}, site2.bearer)).status,
      "reload → 501 (not implemented in OSS)"
    ).toBe(501);
  });
});
