/**
 * UI-0912-A (UI019, RQ-4 a): a visitor who presented no credential at all is
 * sent to the plain sign-in page. "Your session has expired" is kept for a
 * credential that was presented and refused: told to a stranger it is false.
 *
 * UI-0912-AB-FIX (F1): the Next deployment's probe does not opt in, and
 * identuum-idp-oss HandleValidateSession answers a request with no credential
 * 401 {"error":"unauthorized","reason":"missing_credential"}
 * (internal/handlers/auth_sessions.go:933, mw.RespondUnauthenticatedReason).
 * Only route guards say no_credential. The Next case is that body, read by the
 * same parser the probe uses.
 */
import { describe, expect, it } from "vitest";

describe("the sign-in banner after a guard redirect", () => {
  it("no credential at all goes to the plain sign-in page; a refused one keeps the expiry reason [GUARD-PLAIN-LOGIN-1]", async () => {
    const { decideSessionGuard, LOGIN_SESSION_EXPIRED } = await import("../lib/session-guard");
    const { validateSessionResponse } = await import("../lib/session-validation");

    // The Next deployment: /api/v1/validate with no cookie, no opt-in.
    const next = await validateSessionResponse(async () =>
      Response.json({ error: "unauthorized", reason: "missing_credential" }, { status: 401 })
    );
    expect(next).toEqual({ kind: "unauthenticated", status: 401, reason: "missing_credential" });
    expect(decideSessionGuard(next)).toEqual({ action: "redirect", to: "/login" });

    // The export: the opted-in probe is answered 200 {"authenticated":false}.
    const exported = await validateSessionResponse(async () =>
      Response.json({ authenticated: false }, { status: 200 })
    );
    expect(decideSessionGuard(exported)).toEqual({ action: "redirect", to: "/login" });

    for (const reason of ["signed_out", "no_credential", "missing_credential"]) {
      expect(decideSessionGuard({ kind: "unauthenticated", status: 401, reason })).toEqual({
        action: "redirect",
        to: "/login",
      });
    }
    for (const reason of ["token_invalid", "token_revoked", "session_not_live", null]) {
      expect(decideSessionGuard({ kind: "unauthenticated", status: 401, reason })).toEqual({
        action: "redirect",
        to: LOGIN_SESSION_EXPIRED,
      });
    }
  });
});
