/**
 * Server-side session validation.
 *
 * Reads session cookies from the incoming request (via Next.js cookies()),
 * calls the IdP validate endpoint directly using the internal URL from
 * runtime config, and answers ONE OF THREE STATES:
 *
 *   - authenticated   — the IdP answered 200 with the session.
 *   - unauthenticated — the IdP reached a VERDICT (4xx: absent, invalid,
 *                       expired, revoked, not live). The caller redirects to
 *                       /login as before.
 *   - unavailable     — the IdP could NOT judge: a 5xx (the OP's honest
 *                       AUTH-503 answer carries `correlation_id` and
 *                       `Retry-After`) or a network failure that outlasted
 *                       the retry budget. This is NOT a verdict: nobody
 *                       redirects to /login, no cookie is cleared, and the
 *                       user sees an honest "service unavailable" state that
 *                       shows the correlation id.
 *
 * THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02): before this slice the helper
 * collapsed an exhausted 5xx retry window into `null`, and every guard read
 * null as "session expired" — an outage shown to a human as a false verdict.
 *
 * Retry policy (measured against the OP's `Retry-After: 1`):
 *   - total wall-clock CAP of SESSION_VALIDATE_TOTAL_CAP_MS (8 s) per request,
 *     fetch timeouts included — a server render must answer, not hang;
 *   - each attempt is bounded by SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS (4 s) or
 *     the remaining budget, whichever is smaller;
 *   - the wait between attempts HONORS `Retry-After` (seconds or HTTP-date)
 *     when the IdP sent one, else exponential backoff 200·2^n ms; either is
 *     capped at SESSION_VALIDATE_MAX_WAIT_MS (2 s) and never exceeds the
 *     remaining budget;
 *   - a 4xx never retries (it is the verdict).
 *
 * This module is server-only. Client components may not import it.
 * Use validateSession() from idp-client.ts for browser-side validation.
 *
 * getServerSessionState() / getServerSession() are wrapped with React's
 * cache() so that multiple callers within the same render tree (layout +
 * page + actions) share a single IdP validate fetch per request.
 */
import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import { type SessionState, validateSessionResponse } from "./session-validation";
import type { ValidateResponse } from "./types";

export type { SessionState } from "./session-validation";
export {
  parseRetryAfterSeconds,
  planNextWaitMs,
  SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS,
  SESSION_VALIDATE_MAX_WAIT_MS,
  SESSION_VALIDATE_TOTAL_CAP_MS,
} from "./session-validation";

/**
 * getServerSessionState is the tri-state truth. Cached per request.
 */
export const getServerSessionState = cache(async (): Promise<SessionState> => {
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) {
    // Not configured / IdP disabled: no session can exist. The layouts show
    // their own "IdP required" state before asking; this is the safe default.
    return { kind: "unauthenticated", status: null, reason: "idp_not_enabled" };
  }

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const url = `${idpBaseUrl(cfg)}/api/v1/validate`;
  return validateSessionResponse((signal) =>
    fetch(url, {
      headers: { Cookie: cookieHeader, Connection: "close" },
      cache: "no-store",
      signal,
    })
  );
});

/**
 * unavailablePath builds the honest destination for callers that cannot
 * render (server actions, data helpers): the /unavailable page shows the
 * correlation id and offers a retry. Cookies are untouched by design.
 */
export function unavailablePath(state: Extract<SessionState, { kind: "unavailable" }>): string {
  const params = new URLSearchParams();
  if (state.correlationId) params.set("cid", state.correlationId);
  if (state.status !== null) params.set("status", String(state.status));
  if (state.retryAfterSeconds !== null) params.set("retry", String(state.retryAfterSeconds));
  const qs = params.toString();
  return qs ? `/unavailable?${qs}` : "/unavailable";
}

/**
 * getServerSession keeps the original shape for its consumers (server
 * actions, data helpers, pages): the session, or null for an UNAUTHENTICATED
 * verdict. An UNAVAILABLE state never becomes null — the caller is sent to
 * the honest /unavailable page instead (redirect() throws NEXT_REDIRECT, so
 * no consumer can mistake an outage for "session expired").
 *
 * Layouts should call getServerSessionState() and render the unavailable
 * state inline (see lib/session-guard.ts) so the URL stays put and a reload
 * retries.
 */
export const getServerSession = cache(async (): Promise<ValidateResponse | null> => {
  const state = await getServerSessionState();
  if (state.kind === "authenticated") return state.session;
  if (state.kind === "unavailable") redirect(unavailablePath(state));
  return null;
});
