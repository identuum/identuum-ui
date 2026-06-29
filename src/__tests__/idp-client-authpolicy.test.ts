/**
 * D-1 AuthPolicy expectation pin (UI side).
 *
 * Backend contract (IDP CE, after D-1 fix
 * agent-a-20260705-idp-ce-org-admin-authpolicy-local-login-bypass):
 *   - organization auth_policy=idp_only REFUSES local-password login for a
 *     NON-admin org_user → HTTP 401 + {"error":"auth_policy_blocks_local_login"}.
 *   - site_admin AND org_admin local/admin credential flows are ALWAYS allowed
 *     regardless of auth_policy (org.Role.CanAdminister()); the backend lets
 *     them through, so they return a normal success body.
 *
 * UI contract pinned here:
 *   - login() recognizes the auth_policy_blocks_local_login error code and
 *     surfaces a DISTINCT sentinel ("AUTH_POLICY_BLOCKS_LOCAL_LOGIN") so the
 *     caller can render an honest "local sign-in unavailable" message instead
 *     of the misleading "Invalid credentials.".
 *   - login() performs NO client-side role/policy logic — it forwards whatever
 *     role the backend returns on success, for every role, unchanged. The
 *     policy decision is the backend's alone.
 *   - PasswordForm maps the sentinel to the honest copy and keeps the generic
 *     wrong-password 401 → "Invalid credentials." behavior intact.
 *
 * These are deterministic unit/source-invariant tests: no live backend, no
 * credentials, no cookies, no Playwright. They mirror the fetch-mock pattern in
 * idp-client-mfa-enrollment.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "../lib/idp-client";
import { ApiError } from "../lib/ui-api";

function makeFetchMock(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("login() — D-1 auth_policy_blocks_local_login recognition", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws ApiError with the AUTH_POLICY_BLOCKS_LOCAL_LOGIN sentinel for a non-admin idp_only block", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "auth_policy_blocks_local_login" }));

    const err = await login({
      email: "user@acme.example",
      password: "correct-but-policy-blocked",
      remember_me: false,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toBe("AUTH_POLICY_BLOCKS_LOCAL_LOGIN");
  });

  it("treats auth_policy_blocks_local_login distinctly from a wrong-password 401", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "invalid_credentials" }));

    const err = await login({
      email: "user@acme.example",
      password: "wrong",
      remember_me: false,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    // Generic wrong-password path is unchanged — NOT the policy sentinel.
    expect((err as ApiError).message).toContain("Invalid credentials");
    expect((err as ApiError).message).not.toBe("AUTH_POLICY_BLOCKS_LOCAL_LOGIN");
  });

  it("is backend-authoritative: returns whatever role the backend grants on success, with NO client-side role/policy logic", async () => {
    // The backend lets admins through under idp_only; the UI must forward the
    // role verbatim and never re-derive or block based on role client-side.
    for (const role of ["site_admin", "org_admin", "org_user"]) {
      vi.stubGlobal("fetch", makeFetchMock(200, { role }));
      const outcome = await login({
        email: `${role}@acme.example`,
        password: "accepted-by-backend",
        remember_me: false,
      });
      expect(outcome.kind).toBe("success");
      if (outcome.kind === "success") {
        expect(outcome.role).toBe(role);
      }
    }
  });
});

describe("D-1 source invariants — no client-side role/policy blocking in the local-login path", () => {
  const root = resolve(__dirname, "..");
  const passwordForm = readFileSync(resolve(root, "components/auth/password-form.tsx"), "utf8");
  const idpClient = readFileSync(resolve(root, "lib/idp-client.ts"), "utf8");

  it("PasswordForm maps the AUTH_POLICY_BLOCKS_LOCAL_LOGIN sentinel to an honest, non-'Invalid credentials' message", () => {
    expect(passwordForm).toContain("AUTH_POLICY_BLOCKS_LOCAL_LOGIN");
    expect(passwordForm).toContain("Local sign-in is not available for this organization");
  });

  it("idp-client login() recognizes the auth_policy_blocks_local_login wire code", () => {
    expect(idpClient).toContain("auth_policy_blocks_local_login");
    expect(idpClient).toContain("AUTH_POLICY_BLOCKS_LOCAL_LOGIN");
  });

  it("the local-login submit path does NOT branch on the user's role to allow/deny login (backend decides)", () => {
    // Guard against a regression that introduces client-side role gating in the
    // password submit/login wrapper. The PasswordForm onSubmit and the
    // idp-client login() must not compare against site_admin/org_admin/org_user
    // to decide whether to permit the credential flow.
    for (const roleLiteral of ['"site_admin"', '"org_admin"', '"org_user"']) {
      // login() forwards body.role (a string) but must not compare it to a role
      // literal to gate the auth_policy decision.
      expect(idpClient.includes(`=== ${roleLiteral}`)).toBe(false);
      expect(passwordForm.includes(`=== ${roleLiteral}`)).toBe(false);
    }
  });
});
