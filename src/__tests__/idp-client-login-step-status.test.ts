/**
 * F5 (owner ruling 2026-10-01): the password step opts in to a 200 status for
 * its MFA next step with `X-Identuum-Login-Step-Status: 200`, so the browser
 * does not log the expected next step as a failed resource. An IdP without
 * the opt-in (identuum-idp-ce, an older OSS) still answers 401 with the same
 * body, and both forms must reach the MFA step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_STEP_STATUS_HEADER, login } from "../lib/idp-client";

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
