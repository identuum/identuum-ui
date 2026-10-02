/**
 * F5 (owner ruling 2026-10-01): the password step opts in to a 200 status for
 * its MFA next step with `X-Identuum-Login-Step-Status: 200`, so the browser
 * does not log the expected next step as a failed resource. An IdP without
 * the opt-in (identuum-idp-ce, an older OSS) still answers 401 with the same
 * body, and both forms must reach the MFA step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_STEP_STATUS_HEADER, login, loginPasswordChange, orgLookup } from "../lib/idp-client";

const SID = "pending-handle-0000";

function respond(status: number, body: unknown) {
  return vi
    .fn()
    .mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const creds = { email: "admin@example.invalid", password: "placeholder", remember_me: false };

describe("login() — the password step's opt-in step status", () => {
  it("sends the opt-in header with the value 200", async () => {
    const f = respond(200, { mfa_required: true, mfa_enrollment_required: false, session_id: SID });
    vi.stubGlobal("fetch", f);
    await login(creds);
    const init = f.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(LOGIN_STEP_STATUS_HEADER).toBe("X-Identuum-Login-Step-Status");
    expect(headers.get(LOGIN_STEP_STATUS_HEADER)).toBe("200");
  });

  for (const status of [200, 401]) {
    it(`reaches the TOTP step from a ${status} mfa_required answer`, async () => {
      vi.stubGlobal(
        "fetch",
        respond(status, {
          error: "mfa_required",
          mfa_required: true,
          mfa_enrollment_required: false,
          session_id: SID,
        })
      );
      expect(await login(creds)).toEqual({ kind: "mfa_required", sessionId: SID });
    });

    it(`reaches the enrolment step from a ${status} mfa_enrollment_required answer`, async () => {
      vi.stubGlobal(
        "fetch",
        respond(status, {
          error: "mfa_enrollment_required",
          mfa_required: true,
          mfa_enrollment_required: true,
          session_id: SID,
        })
      );
      expect(await login(creds)).toEqual({ kind: "mfa_enrollment_required", sessionId: SID });
    });
  }
});

// OSS-HARDEN item 3 (2026-10-01): the password-change step opts in too, so
// its MFA continuation is not a logged 401; both statuses still reach MFA.
describe("loginPasswordChange() — the same opt-in", () => {
  it("sends the opt-in header with the value 200", async () => {
    const f = respond(200, { success: true, role: "org_user" });
    vi.stubGlobal("fetch", f);
    await loginPasswordChange(SID, "placeholder-new");
    const headers = new Headers((f.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get(LOGIN_STEP_STATUS_HEADER)).toBe("200");
  });

  for (const status of [200, 401]) {
    it(`reaches the enrolment step from a ${status} mfa_enrollment_required answer`, async () => {
      vi.stubGlobal(
        "fetch",
        respond(status, {
          error: "mfa_enrollment_required",
          mfa_required: true,
          mfa_enrollment_required: true,
          session_id: SID,
        })
      );
      expect(await loginPasswordChange(SID, "placeholder-new")).toEqual({
        kind: "mfa_enrollment_required",
        sessionId: SID,
      });
    });
  }
});

// OSS-TIDY-2: a pending self-registrant's correct password is refused as
// registration_pending — 403 by default, 200 with the same body under the
// opt-in. Either way it is a refusal, never a sign-in.
describe("login() — registration_pending under either status", () => {
  for (const status of [200, 403]) {
    it(`a ${status} registration_pending is the REGISTRATION_PENDING refusal`, async () => {
      vi.stubGlobal("fetch", respond(status, { error: "registration_pending" }));
      await expect(login(creds)).rejects.toMatchObject({ message: "REGISTRATION_PENDING" });
    });
  }
});

// OSS-TIDY-2: the sign-in page's organization lookup opts in too, so a domain
// that is no organization's (a 404, or 200 with the same body under the
// opt-in) is "no organization", not a logged failure.
describe("orgLookup() — the same opt-in", () => {
  it("sends the opt-in header with the value 200", async () => {
    const f = respond(200, { error: "organization_not_found" });
    vi.stubGlobal("fetch", f);
    await orgLookup("nobody.example.invalid");
    const headers = new Headers((f.mock.calls[0][1] as RequestInit | undefined)?.headers);
    expect(headers.get(LOGIN_STEP_STATUS_HEADER)).toBe("200");
  });

  for (const status of [200, 404]) {
    it(`a ${status} organization_not_found is no organization`, async () => {
      vi.stubGlobal("fetch", respond(status, { error: "organization_not_found" }));
      expect(await orgLookup("nobody.example.invalid")).toBeNull();
    });
  }

  it("a found organization is returned", async () => {
    const org = {
      slug: "acme",
      name: "Acme",
      domain: "acme.example.invalid",
      auth_policy: "local_only",
      identity_providers: [],
    };
    vi.stubGlobal("fetch", respond(200, org));
    expect(await orgLookup("acme.example.invalid")).toEqual(org);
  });
});
