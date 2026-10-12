/**
 * session-guard.ts — THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02).
 *
 * The ONE decision every route-segment layout makes from the tri-state
 * session, kept pure so the rule test can pin it without rendering:
 *
 *   authenticated   → proceed (the layout applies its role rules next)
 *   unauthenticated → redirect to /login (a VERDICT): plain when NO
 *                     credential was presented (UI-0912-A, UI019: a visitor
 *                     who never signed in, or whose cookies are all gone, is
 *                     not told a session expired); /login?reason=session_expired
 *                     when a credential was presented and refused
 *   unavailable     → render the ServiceUnavailable state IN PLACE: no
 *                     redirect, no cookie touched, the URL stays so a reload
 *                     retries once the IdP is back.
 */
import type { SessionState } from "./session-validation";
import type { ValidateResponse } from "./types";

export const LOGIN_SESSION_EXPIRED = "/login?reason=session_expired";

/**
 * The verdicts that mean no credential at all: the export's opted-in probe
 * answers `signed_out` (session-validation.ts); the Next deployment's probe
 * does not opt in, and /api/v1/validate answers it 401 `missing_credential`
 * (identuum-idp-oss HandleValidateSession). Route guards say `no_credential`.
 */
const NO_CREDENTIAL_REASONS = new Set(["signed_out", "no_credential", "missing_credential"]);

export type SessionGuardDecision =
  | { action: "proceed"; session: ValidateResponse }
  | { action: "redirect"; to: string }
  | { action: "render-unavailable"; state: Extract<SessionState, { kind: "unavailable" }> };

export function decideSessionGuard(state: SessionState): SessionGuardDecision {
  switch (state.kind) {
    case "authenticated":
      return { action: "proceed", session: state.session };
    case "unavailable":
      return { action: "render-unavailable", state };
    default:
      return {
        action: "redirect",
        to: NO_CREDENTIAL_REASONS.has(state.reason ?? "") ? "/login" : LOGIN_SESSION_EXPIRED,
      };
  }
}
