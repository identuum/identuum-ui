/**
 * UI-0912-A (UI019, RQ-4 a): a visitor who presented no credential at all is
 * sent to the plain sign-in page. "Your session has expired" is kept for a
 * credential that was presented and refused: told to a stranger it is false.
 */
import { describe, expect, it } from "vitest";

describe("the sign-in banner after a guard redirect", () => {
  it("no credential at all goes to the plain sign-in page; a refused one keeps the expiry reason [GUARD-PLAIN-LOGIN-1]", async () => {
    const { decideSessionGuard, LOGIN_SESSION_EXPIRED } = await import("../lib/session-guard");
    for (const reason of ["signed_out", "no_credential"]) {
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
