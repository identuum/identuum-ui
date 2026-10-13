/**
 * UI-0913-D (v0.9.13 D6) — the self-service and reset-link cells the role
 * matrix did not have: MFA self-setup, the caller's own consents, and the
 * admin reset link with its public pair.
 *
 * Runs in the api-suite phase (IDENTUUM_E2E_FULL=1, before the provisioner),
 * so it builds its OWN run-local organization the way consent-ceremony.spec.ts
 * does: a fresh org (default MFA policy, not required), its activated
 * org_admin, a throwaway org_user for the MFA ceremony, a throwaway member
 * for the reset link, and a confidential client with refresh_token. The
 * shared provisioner users are never touched here.
 *
 * Who can reach what, from the OSS code at ad0f7a1:
 *  - IsMFARequiredForUser (internal/service/local_login_service.go:216-228)
 *    makes every site_admin and org_admin MFA-required, so an admin that is
 *    not enrolled cannot get a bearer (local_login_service.go:405-413: the
 *    login answers with the enrolment step, a session-class route). An admin
 *    bearer is therefore always an ENROLLED admin, and InitiateSelf /
 *    CompleteSelf answer 409 mfa_already_enrolled BEFORE the password, the
 *    proof budget or the pending row (internal/service/mfa_self_enroll.go
 *    :47-55, :85-93). The admin cells are that 409: no state changes and no
 *    throttle budget is spent, so the shared site_admin is safe to use.
 *  - Only an org_user in an organization whose policy is not "required" can
 *    run the whole ceremony: initiate with the password, complete with a
 *    computed code, then disable with a fresh code
 *    (mfa_enrollment_service.go:876-963: a code is the only proof; the
 *    password is never consulted).
 *
 * Redaction (AGENTS.md §G live-walk rule): the TOTP secret, the otpauth URL,
 * every code, the recovery codes, the reset link, its token and every bearer
 * stay in local variables. No assertion message carries them: messages are
 * fixed text plus status codes, and expectStatus() prints bodies only through
 * redactForLog (secret, otpauth, code, token, password keys -> "[redacted]").
 * redactForLog does not know reset_url, so a reset-link refusal is checked on
 * its error code alone (refusal()): an unexpected 200 never prints the link.
 */
import { createHash, randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  api,
  expectStatus,
  firstLoginBearerAsync,
  observeRaw,
} from "../e2e/helpers/appliance-fixture";
import { unconsumedTOTP, unconsumedTOTPAfterFreshStep } from "../e2e/helpers/totp";
import { harnessIdpBase } from "./helpers/harness";
import { siteAdminSession } from "./helpers/session";

const IDP_BASE = harnessIdpBase();
const SITE_ADMIN_EMAIL = process.env.IDENTUUM_IDP_BOOTSTRAP_EMAIL ?? "site_admin@system.local";
const REDIRECT_URI = "https://ui.example.test/me-consents-cb";
const GHOST_CLIENT = "e2e-no-such-client-0000000000000000";

// biome-ignore lint/suspicious/noExplicitAny: raw API JSON
type Json = any;

/** A browser-login session in this request context (honest CSRF double-submit). */
async function browserLogin(request: APIRequestContext, email: string, password: string) {
  const form = await request.get(`${IDP_BASE}/api/v1/auth/browser-login`, {
    failOnStatusCode: false,
  });
  expect(form.status(), "login form renders").toBe(200);
  const csrf = (await form.text()).match(/name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i);
  expect(csrf, "login form embeds a CSRF token").toBeTruthy();
  const submit = await request.post(`${IDP_BASE}/api/v1/auth/browser-login`, {
    failOnStatusCode: false,
    maxRedirects: 0,
    form: { email, password, [csrf?.[1] ?? "csrf_token"]: csrf?.[2] ?? "" },
  });
  expect(submit.status(), "browser-login → 303 (session established)").toBe(303);
}

/** A response reduced to its status and error code, for a failure message. */
function refusal(res: { status: number; json: Json }) {
  return { status: res.status, json: { error: res.json.error } };
}

// Serial: a failed test skips the rest. The org_user MFA ceremony therefore
// runs LAST, so a failure in it skips nothing, and the consent and reset-link
// tests (which sign the same org_user in by password) never meet it enrolled.
test.describe.configure({ mode: "serial" });

test.describe("self-service MFA setup, own consents, admin reset link (UI-0913-D)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FULL !== "1",
    "e2e-full runs only inside the disposable harness (make e2e-full)"
  );

  let site = { bearer: "", totpSecret: "" };
  let runId = "";
  let orgId = "";
  let oaEmail = "";
  let oaBearer = "";
  let ouEmail = "";
  let ouPw = "";
  let memberId = "";
  let memberEmail = "";
  let clientId = "";
  let clientSecret = "";

  test("setup: run-local org, org_admin, throwaway org_user, reset member, refresh client", async () => {
    const adminPassword = process.env.IDENTUUM_E2E_FULL_ADMIN_PASSWORD ?? "";
    expect(adminPassword.length, "harness passes the bootstrap password").toBeGreaterThan(0);
    site = await siteAdminSession(IDP_BASE, SITE_ADMIN_EMAIL, adminPassword);
    runId = `selfsvc-${Date.now().toString(36)}`;

    // No mfa_policy in the create: the org keeps the default (not required),
    // so the throwaway org_user signs in on its password alone.
    const c1 = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `self-service ${runId}`,
        slug: runId,
        domain: `${runId}.test`,
        admin_email: `admin@${runId}.test`,
      },
      site.bearer
    );
    expectStatus(c1, 201, "site_admin creates the run-local org");
    orgId = ((c1.json.organization as Json)?.id as string) ?? "";
    expect(orgId.length, "org id issued").toBeGreaterThan(0);

    const rs = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgId}/resend-activation`,
      {},
      site.bearer
    );
    expectStatus(rs, 200, "activation re-issued");
    const adminPw = `Adm!${runId}7wqX`;
    const act = await api(IDP_BASE, "POST", "/api/v1/auth/organizations/activate", {
      token: rs.json.activation_token,
      password: adminPw,
    });
    expectStatus(act, 200, "org_admin activated");
    oaEmail = `admin@${runId}.test`;
    // The org_admin enrols TOTP through the sign-in step (admins are always
    // MFA-required); the secret stays inside this spec.
    oaBearer = (await firstLoginBearerAsync(IDP_BASE, oaEmail, adminPw)).bearer;

    ouEmail = `mfa-user@${runId}.test`;
    ouPw = `Usr!${runId}4kpZ`;
    const uc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      {
        email: ouEmail,
        password: ouPw,
        role: "org_user",
        organization_id: orgId,
        must_change_password: false,
      },
      oaBearer
    );
    expectStatus(uc, 201, "throwaway org_user created");

    memberEmail = `reset-member@${runId}.test`;
    const mc = await api(
      IDP_BASE,
      "POST",
      "/api/v1/users",
      {
        email: memberEmail,
        password: `Mbr!${runId}8hjQ`,
        role: "org_user",
        organization_id: orgId,
        must_change_password: false,
      },
      oaBearer
    );
    expectStatus(mc, 201, "throwaway reset member created");
    memberId = (mc.json.id as string) ?? "";
    expect(memberId.length, "member id issued").toBeGreaterThan(0);

    // Confidential client that may mint a refresh token: the token endpoint
    // issues one only when the consumed scope holds offline_access, the client
    // allows refresh_token and is not public (internal/handlers/token.go:511).
    const dcr = await api(
      IDP_BASE,
      "POST",
      "/api/v1/oauth/register",
      {
        client_name: `cc-${runId}`,
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid offline_access",
      },
      site.bearer
    );
    expectStatus(dcr, 201, "site_admin DCR of a confidential refresh client");
    clientId = (dcr.json.client_id as string) ?? "";
    clientSecret = (dcr.json.client_secret as string) ?? "";
    expect(clientId.length, "client_id issued").toBeGreaterThan(0);
    expect(clientSecret.length, "client_secret issued").toBeGreaterThan(0);
  });

  test("MFA setup, admins: an admin bearer is always enrolled → 409 before any proof", async () => {
    for (const [label, bearer] of [
      ["site_admin", site.bearer],
      ["org_admin", oaBearer],
    ] as const) {
      // Empty password on purpose: the 409 precedes the password check and
      // the proof budget (mfa_self_enroll.go:53-55), so nothing is spent.
      const init = await api(
        IDP_BASE,
        "POST",
        "/api/v1/mfa/setup/initiate",
        { password: "" },
        bearer
      );
      expectStatus(init, 409, `${label} initiate`);
      expect(init.json.error, `${label} initiate → mfa_already_enrolled`).toBe(
        "mfa_already_enrolled"
      );
      const comp = await api(
        IDP_BASE,
        "POST",
        "/api/v1/mfa/setup/complete",
        { code: "000000" },
        bearer
      );
      expectStatus(comp, 409, `${label} complete`);
      expect(comp.json.error, `${label} complete → mfa_already_enrolled`).toBe(
        "mfa_already_enrolled"
      );
    }
  });

  // ── GET /api/v1/me/consents, DELETE /api/v1/me/consents/:client_id ───────
  // OSS-0913-A (D3), internal/handlers/me_consents.go at ad0f7a1: the list is
  // one entry per client_id; DELETE → 204 and ends that client's refresh
  // tokens for the caller first; no active consent, another user's, an
  // unknown or a deleted client_id → 404 {"error":"not_found"}. A request
  // body or a user_id query is 400, so DELETE is sent without a body.
  test("own consents, org_user: allow, list, remove, refresh refused, second remove 404", async ({
    request,
  }) => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const scope = "openid offline_access";
    const authQuery =
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent(scope)}&state=st-${runId}` +
      `&code_challenge=${challenge}&code_challenge_method=S256`;

    await browserLogin(request, ouEmail, ouPw);
    const consentForm = await request.get(`${IDP_BASE}/api/v1/oauth/consent?${authQuery}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(consentForm.status(), "consent form with the session → 200").toBe(200);
    const consentCsrf = (await consentForm.text()).match(
      /name="([^"]*csrf[^"]*)"[^>]*value="([^"]+)"/i
    );
    expect(consentCsrf, "consent form embeds a CSRF token").toBeTruthy();
    const approve = await request.post(`${IDP_BASE}/api/v1/oauth/consent`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: {
        action: "approve",
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope,
        state: `st-${runId}`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        [consentCsrf?.[1] ?? "csrf_token"]: consentCsrf?.[2] ?? "",
      },
    });
    expect(approve.status(), "consent approve → 302").toBe(302);
    const code = new URL(approve.headers().location ?? "").searchParams.get("code") ?? "";
    expect(code.length > 0, "a code on the redirect (not printed)").toBe(true);

    const basic = {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    };
    const tok = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      headers: basic,
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect(tok.status(), "code redemption → 200").toBe(200);
    const refresh = ((await tok.json()) as { refresh_token?: string }).refresh_token ?? "";
    // Mint triage (UI-0913-D-REVIEW F3): red here is a spec premise first (the
    // scope was clamped, or refresh is not wired); red at the DCR above means
    // DCR refused offline_access; red at "refresh after remove" is a product bug.
    expect(refresh.length > 0, "offline_access → a refresh token (not printed)").toBe(true);

    const login = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: ouEmail,
      password: ouPw,
    });
    expectStatus(login, 200, "org_user bearer for the /me calls");
    const ou = login.json.access_token as string;

    const list = await api(IDP_BASE, "GET", "/api/v1/me/consents", undefined, ou);
    expectStatus(list, 200, "org_user lists own consents");
    const rows = (list.json.consents as Json[]) ?? [];
    expect(
      rows.some((r: Json) => r.client_id === clientId),
      "the consent just given is listed"
    ).toBe(true);

    const del = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/me/consents/${encodeURIComponent(clientId)}`,
      undefined,
      ou
    );
    expectStatus(del, 204, "org_user removes the consent");

    const after = await api(IDP_BASE, "GET", "/api/v1/me/consents", undefined, ou);
    expectStatus(after, 200, "list after remove");
    expect(
      ((after.json.consents as Json[]) ?? []).some((r: Json) => r.client_id === clientId),
      "the removed consent is gone"
    ).toBe(false);

    const grant = await request.post(`${IDP_BASE}/api/v1/oauth/token`, {
      failOnStatusCode: false,
      maxRedirects: 0,
      headers: basic,
      form: { grant_type: "refresh_token", refresh_token: refresh },
    });
    expect(grant.status(), "refresh after remove → 400").toBe(400);
    expect(
      ((await grant.json()) as { error?: string }).error,
      "refresh after remove → invalid_grant"
    ).toBe("invalid_grant");

    const again = await api(
      IDP_BASE,
      "DELETE",
      `/api/v1/me/consents/${encodeURIComponent(clientId)}`,
      undefined,
      ou
    );
    expectStatus(again, 404, "second remove of the same client");
  });

  test("own consents, admins: list 200, remove of an unknown client 404", async () => {
    for (const [label, bearer] of [
      ["site_admin", site.bearer],
      ["org_admin", oaBearer],
    ] as const) {
      // site_admin: RegisterMeConsentRoutes mounts the routes behind
      // RequireAuthenticated alone and meConsentCaller refuses no role, so
      // a site_admin lists its own (empty) consents like any user.
      const list = await api(IDP_BASE, "GET", "/api/v1/me/consents", undefined, bearer);
      expectStatus(list, 200, `${label} lists own consents`);
      const del = await api(
        IDP_BASE,
        "DELETE",
        `/api/v1/me/consents/${GHOST_CLIENT}`,
        undefined,
        bearer
      );
      expectStatus(del, 404, `${label} removes an unknown client`);
      expect(del.json.error, `${label} unknown client → not_found`).toBe("not_found");
    }
  });

  // ── POST /api/v1/users/:id/recovery/reset-link + the public pair ────────
  // OSS-0913-B (D9, owner Q-D9 (a)), internal/handlers/user_reset_link.go
  // and auth_reset_link.go at ad0f7a1. The appliance sets
  // IDENTUUM_IDP_UI_PUBLIC_BASE_URL (full-run.sh:935), so the link can be
  // built. The public pair sits under the password-reset limiter (10 per 15
  // min per IP, auth_lifecycle.go resetGroup); with auth-sweep's 4 calls this
  // test's 3 keep the phase at 7.
  test("reset link: org_admin 200 once, second use refused; org_user and site_admin refused", async () => {
    const issue = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${memberId}/recovery/reset-link`,
      {},
      oaBearer
    );
    expectStatus(issue, 200, "org_admin issues a reset link for a member");
    const link = (issue.json.reset_url as string) ?? "";
    expect(link.length > 0, "a reset link is answered (not printed)").toBe(true);
    expect(Object.hasOwn(issue.json, "token"), "no bare token field beside the link").toBe(false);
    const token = new URL(link).searchParams.get("token") ?? "";
    expect(token.length > 0, "the link carries its token (not printed)").toBe(true);

    // Not through api(): its call ring (apiCallLog) and the matrix log write
    // the path verbatim, and this path carries the live token in its query.
    // observeRaw records the TEMPLATE path, which covers the class cell and
    // the closure entry without the token.
    const valid = await fetch(
      `${IDP_BASE}/api/v1/auth/reset-link/validate?token=${encodeURIComponent(token)}`
    );
    expect(valid.status, "validate a fresh link → 200").toBe(200);
    observeRaw("GET", "/api/v1/auth/reset-link/validate", valid.status);
    expect(((await valid.json()) as { valid?: boolean }).valid, "fresh link is valid").toBe(true);

    const newPw = `Rst!${runId}2mnB`;
    const use = await api(IDP_BASE, "POST", "/api/v1/auth/reset-link", {
      token,
      new_password: newPw,
    });
    expectStatus(use, 200, "first use of the link");
    expect(use.json.success, "first use → success").toBe(true);

    const reuse = await api(IDP_BASE, "POST", "/api/v1/auth/reset-link", {
      token,
      new_password: `${newPw}x`,
    });
    expectStatus(reuse, 400, "second use of the same link");
    expect(reuse.json.error, "second use → invalid_token").toBe("invalid_token");

    // The link set the member's password: it signs in with the new one.
    const memberLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: memberEmail,
      password: newPw,
    });
    expectStatus(memberLogin, 200, "member signs in with the password set through the link");

    const ouLogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: ouEmail,
      password: ouPw,
    });
    expectStatus(ouLogin, 200, "org_user bearer");
    const byUser = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${memberId}/recovery/reset-link`,
      {},
      ouLogin.json.access_token as string
    );
    expectStatus(refusal(byUser), 403, "org_user may not issue a reset link");
    expect(byUser.json.error, "org_user → forbidden").toBe("forbidden");

    // D-025: PasswordResetLinkTargetForActor runs refuseSiteAdminTenantUser
    // for a site_admin, so a tenant member answers 403 forbidden.
    const bySite = await api(
      IDP_BASE,
      "POST",
      `/api/v1/users/${memberId}/recovery/reset-link`,
      {},
      site.bearer
    );
    expectStatus(refusal(bySite), 403, "site_admin may not issue a link for a tenant user");
    expect(bySite.json.error, "site_admin → forbidden").toBe("forbidden");
  });

  // ── POST /api/v1/mfa/setup/initiate and /complete ─────────────────────────
  test("MFA setup, org_user: wrong password 401, initiate 200, complete 200, again 409, disable 204", async () => {
    const login = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: ouEmail,
      password: ouPw,
    });
    expectStatus(login, 200, "throwaway org_user password login (policy not required)");
    const ou = login.json.access_token as string;

    // One wrong password on the THROWAWAY user only: one recorded miss on its
    // own budget, far from the limit; no shared user is involved.
    const wrong = await api(
      IDP_BASE,
      "POST",
      "/api/v1/mfa/setup/initiate",
      { password: "Not-The-Password-1!" },
      ou
    );
    expectStatus(wrong, 401, "initiate with a wrong password");
    expect(wrong.json.error, "wrong password → invalid_proof").toBe("invalid_proof");

    const init = await api(IDP_BASE, "POST", "/api/v1/mfa/setup/initiate", { password: ouPw }, ou);
    expectStatus(init, 200, "initiate with the current password");
    const secret = (init.json.secret as string) ?? "";
    expect(secret.length > 0, "initiate answers a secret (value not printed)").toBe(true);
    expect(
      String(init.json.otpauth_url ?? "").startsWith("otpauth://"),
      "initiate answers an otpauth URL (value not printed)"
    ).toBe(true);

    const empty = await api(IDP_BASE, "POST", "/api/v1/mfa/setup/complete", { code: "" }, ou);
    expectStatus(empty, 400, "complete without a code");
    expect(empty.json.error, "no code → code_required").toBe("code_required");

    // F1 (UI-0913-D-REVIEW): once complete has answered 200 the throwaway is
    // enrolled, and the disable below runs whatever fails between here and
    // it. A clean-up failure never hides the first failure: both are
    // reported, the first one first.
    let enrolled = false;
    let failure: unknown;
    try {
      let done = await api(
        IDP_BASE,
        "POST",
        "/api/v1/mfa/setup/complete",
        { code: await unconsumedTOTP(secret, ouEmail) },
        ou
      );
      if (done.status !== 200) {
        done = await api(
          IDP_BASE,
          "POST",
          "/api/v1/mfa/setup/complete",
          { code: await unconsumedTOTPAfterFreshStep(secret, ouEmail) },
          ou
        );
      }
      enrolled = done.status === 200;
      expectStatus(done, 200, "complete with a computed code");
      const codes = done.json.recovery_codes;
      expect(
        Array.isArray(codes) && codes.length > 0,
        "complete answers recovery codes (not printed)"
      ).toBe(true);

      const status = await api(IDP_BASE, "GET", "/api/v1/me/mfa/status", undefined, ou);
      expectStatus(status, 200, "mfa status after setup");
      expect(status.json.mfa_enabled, "MFA is on after complete").toBe(true);

      const again = await api(
        IDP_BASE,
        "POST",
        "/api/v1/mfa/setup/initiate",
        { password: ouPw },
        ou
      );
      expectStatus(again, 409, "initiate when already enrolled");
      expect(again.json.error, "→ mfa_already_enrolled").toBe("mfa_already_enrolled");
    } catch (err) {
      failure = err;
    }
    // The `finally` of the block above, written out: a throw inside `finally`
    // would replace the first failure (biome noUnsafeFinally).
    if (enrolled) {
      try {
        // Clean-up that is also the disable cell's positive: a fresh code is
        // the only proof (the password is never consulted). 204, sessions
        // revoked.
        let off = await api(
          IDP_BASE,
          "POST",
          "/api/v1/me/mfa/disable",
          { code: await unconsumedTOTP(secret, ouEmail) },
          ou
        );
        if (off.status !== 204) {
          off = await api(
            IDP_BASE,
            "POST",
            "/api/v1/me/mfa/disable",
            { code: await unconsumedTOTPAfterFreshStep(secret, ouEmail) },
            ou
          );
        }
        expectStatus(off, 204, "self-disable with a fresh code");
      } catch (cleanup) {
        if (failure === undefined) throw cleanup;
        const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
        throw new Error(
          `${text(failure)}\n\nMFA clean-up (self-disable) also failed:\n${text(cleanup)}`,
          { cause: failure }
        );
      }
    }
    if (failure !== undefined) throw failure;

    // Proof the disable held: the password alone signs in again (no MFA step).
    const relogin = await api(IDP_BASE, "POST", "/api/v1/auth/login", {
      email: ouEmail,
      password: ouPw,
    });
    expectStatus(relogin, 200, "password-only sign-in after disable");
  });
});
