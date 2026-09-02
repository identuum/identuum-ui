/**
 * session-guard.ts — THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02).
 *
 * The ONE decision every route-segment layout makes from the tri-state
 * session, kept pure so the rule test can pin it without rendering:
 *
 *   authenticated   → proceed (the layout applies its role rules next)
 *   unauthenticated → redirect to /login?reason=session_expired (a VERDICT)
 *   unavailable     → render the ServiceUnavailable state IN PLACE: no
 *                     redirect, no cookie touched, the URL stays so a reload
 *                     retries once the IdP is back.
 */
import type { SessionState } from "./server-session";
import type { ValidateResponse } from "./types";

export const LOGIN_SESSION_EXPIRED = "/login?reason=session_expired";

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
      return { action: "redirect", to: LOGIN_SESSION_EXPIRED };
  }
}
