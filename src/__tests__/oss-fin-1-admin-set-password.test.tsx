/**
 * OSS-FIN-1 (owner ruling D-017): a user created with an admin-set password
 * must change it at first sign-in, before MFA and before any session.
 *
 *   sign-in   POST /api/v1/auth/login
 *             → 401 {error:"password_change_required", password_change_required:true, session_id}
 *   change    POST /api/v1/auth/login/password-change {session_id, new_password}
 *             → 200 session | 401 mfa_enrollment_required / mfa_required + session_id
 *             | 400 weak_password {message} | 401 invalid_session
 *
 * And item 2's list row: a pending organization reads "Waiting for
 * activation" and offers the re-issue, not "Admin active" + Reactivate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer> = {};
const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
  const a = answers[`${(init.method ?? "GET").toUpperCase()} ${url}`] ?? { status: 404, body: {} };
  return new Response(JSON.stringify(a.body), { status: a.status });
});
beforeEach(() => {
  answers = {};
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const LOGIN = "POST /api/idp/api/v1/auth/login";
const CHANGE = "POST /api/idp/api/v1/auth/login/password-change";
const HANDLE = "0198b2d0-0000-7000-8000-0000000000ee";

describe("the console sign-in takes the change step first", () => {
  it("login answers password_change_required with the handle", async () => {
    answers[LOGIN] = {
      status: 401,
      body: {
        error: "password_change_required",
        password_change_required: true,
        session_id: HANDLE,
      },
    };
    const { login } = await import("../lib/idp-client");
    await expect(login({ email: "a@b.test", password: "x", remember_me: false })).resolves.toEqual({
      kind: "password_change_required",
      sessionId: HANDLE,
    });
  });
  it("the change sends {session_id, new_password} and continues to MFA enrolment", async () => {
    answers[CHANGE] = {
      status: 401,
      body: {
        error: "mfa_enrollment_required",
        mfa_required: true,
        mfa_enrollment_required: true,
        session_id: "next",
      },
    };
    const { loginPasswordChange } = await import("../lib/idp-client");
    await expect(loginPasswordChange(HANDLE, "Own-New-Pass-2026!w")).resolves.toEqual({
      kind: "mfa_enrollment_required",
      sessionId: "next",
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      session_id: HANDLE,
      new_password: "Own-New-Pass-2026!w",
    });
  });
  it("continues to MFA verification, or completes", async () => {
    const { loginPasswordChange } = await import("../lib/idp-client");
    answers[CHANGE] = {
      status: 401,
      body: { error: "mfa_required", mfa_required: true, session_id: "v" },
    };
    await expect(loginPasswordChange(HANDLE, "p")).resolves.toEqual({
      kind: "mfa_required",
      sessionId: "v",
    });
    answers[CHANGE] = { status: 200, body: { role: "org_user", session_id: "s" } };
    await expect(loginPasswordChange(HANDLE, "p")).resolves.toEqual({
      kind: "success",
      role: "org_user",
    });
  });
  it("a refused password shows the IdP's reason; a gone step says so", async () => {
    const { loginPasswordChange } = await import("../lib/idp-client");
    answers[CHANGE] = {
      status: 400,
      body: {
        error: "weak_password",
        message: "choose a password different from the one you were given",
      },
    };
    await expect(loginPasswordChange(HANDLE, "p")).rejects.toMatchObject({
      status: 400,
      message: "choose a password different from the one you were given",
    });
    answers[CHANGE] = { status: 401, body: { error: "invalid_session" } };
    await expect(loginPasswordChange(HANDLE, "p")).rejects.toMatchObject({
      message: "SESSION_EXPIRED",
    });
  });
  it("the change form asks for the new password twice", async () => {
    const { PasswordChangeForm } = await import("../components/auth/password-change-form");
    const html = renderToStaticMarkup(
      <PasswordChangeForm
        sessionId={HANDLE}
        onMfaRequired={() => {}}
        onMfaEnrollmentRequired={() => {}}
        onSuccess={() => {}}
        onExpired={() => {}}
      />
    );
    expect(html).toContain("Choose a new password");
    expect(html).toContain('id="new_password"');
    expect(html).toContain('id="confirm_password"');
    expect(html).not.toContain(HANDLE);
  });
  it("the login flow routes the outcome to the change step", () => {
    const src = readFileSync(resolve(__dirname, "..", "components/auth/login-flow.tsx"), "utf8");
    expect(src).toContain('step === "PASSWORD_CHANGE"');
    expect(src).toContain("onPasswordChangeRequired={handlePasswordChangeRequired}");
  });
});

describe("a pending organization's list row", () => {
  const org = (extra: Record<string, unknown>) => ({
    id: "0198b2d0-0000-7000-8000-0000000000aa",
    name: "Acme",
    domain: "acme.test",
    slug: "acme",
    active: false,
    deleted: false,
    has_admin: true,
    can_assign_admin: false,
    created_at: "2026-09-29T10:00:00Z",
    updated_at: "2026-09-29T10:00:00Z",
    ...extra,
  });
  const row = async (o: Record<string, unknown>) => {
    const { OrganizationsClient } = await import("../app/site-admin/organizations/client");
    return renderToStaticMarkup(
      <OrganizationsClient
        initialData={{
          organizations: [org(o)] as never,
          total_count: 1,
          count: 1,
          offset: 0,
          limit: 20,
        }}
        page={1}
        stateFilter="deactivated"
      />
    );
  };
  it("reads Waiting for activation and offers the re-issue, not Reactivate", async () => {
    const html = await row({ activation_pending: true });
    expect(html).toContain("Waiting for activation");
    expect(html).not.toContain("Admin active");
    expect(html).toContain("Re-issue activation link");
    expect(html).not.toContain("/reactivate");
  });
  it("a deactivated organization whose administrator activated keeps Reactivate", async () => {
    const html = await row({ activation_pending: false });
    expect(html).toContain("Admin active");
    expect(html).toContain("/reactivate");
  });
});
