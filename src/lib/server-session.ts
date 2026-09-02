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
import type { ValidateResponse } from "./types";

export type SessionState =
  | { kind: "authenticated"; session: ValidateResponse }
  | { kind: "unauthenticated"; status: number | null; reason: string | null }
  | {
      kind: "unavailable";
      /** last HTTP status seen (5xx) or null for a network failure */
      status: number | null;
      /** the IdP's correlation id (X-Request-ID header / body correlation_id) — the join key to its ERROR log */
      correlationId: string | null;
      /** the IdP's Retry-After, in seconds, when it sent one */
      retryAfterSeconds: number | null;
      /** attempts made before giving up */
      attempts: number;
      /** secret-free diagnostic (status line or error class) */
      detail: string;
    };

/** Total wall-clock budget for one server-side validate, fetch timeouts included. */
export const SESSION_VALIDATE_TOTAL_CAP_MS = 8000;
/** Upper bound of a single attempt. */
export const SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS = 4000;
/** Upper bound of a single wait between attempts (Retry-After or backoff). */
export const SESSION_VALIDATE_MAX_WAIT_MS = 2000;
const BACKOFF_BASE_MS = 200;
/** Below this remaining budget another attempt cannot complete meaningfully. */
const MIN_USEFUL_ATTEMPT_MS = 100;

/**
 * parseRetryAfterSeconds reads RFC 9110 Retry-After: delay-seconds or an
 * HTTP-date. Returns whole seconds ≥ 0, or null when absent / unparseable.
 */
export function parseRetryAfterSeconds(
  header: string | null,
  now: number = Date.now()
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * planNextWaitMs decides the wait before attempt `attempt + 1` (attempt is
 * 1-based: the number of attempts already made). Returns null when the
 * remaining budget cannot fit the wait plus a useful attempt.
 */
export function planNextWaitMs(
  attempt: number,
  retryAfterSeconds: number | null,
  remainingMs: number
): number | null {
  const backoff = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  const honored =
    retryAfterSeconds !== null ? Math.max(backoff, retryAfterSeconds * 1000) : backoff;
  const wait = Math.min(honored, SESSION_VALIDATE_MAX_WAIT_MS);
  if (remainingMs - wait < MIN_USEFUL_ATTEMPT_MS) return null;
  return wait;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await res.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringField(body: Record<string, unknown> | null, key: string): string | null {
  const v = body?.[key];
  return typeof v === "string" && v !== "" ? v : null;
}

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
  const started = Date.now();
  let attempts = 0;
  let last: {
    status: number | null;
    correlationId: string | null;
    retryAfterSeconds: number | null;
    detail: string;
  } = {
    status: null,
    correlationId: null,
    retryAfterSeconds: null,
    detail: "not attempted",
  };

  for (;;) {
    const remaining = SESSION_VALIDATE_TOTAL_CAP_MS - (Date.now() - started);
    if (attempts > 0 && remaining < MIN_USEFUL_ATTEMPT_MS) break;
    attempts += 1;
    try {
      const timeoutMs = Math.max(
        MIN_USEFUL_ATTEMPT_MS,
        Math.min(
          SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS,
          remaining > 0 ? remaining : SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS
        )
      );
      const res = await fetch(url, {
        headers: { Cookie: cookieHeader, Connection: "close" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        return { kind: "authenticated", session: (await res.json()) as ValidateResponse };
      }
      if (res.status < 500) {
        // A VERDICT. 401 bodies name it (AUTH-503: `reason`); keep it for the guards' logs.
        const body = await readBody(res);
        return {
          kind: "unauthenticated",
          status: res.status,
          reason: stringField(body, "reason") ?? stringField(body, "error"),
        };
      }
      // 5xx — the IdP could not judge. Remember what it said and retry within budget.
      const body = await readBody(res);
      last = {
        status: res.status,
        correlationId: res.headers.get("x-request-id") ?? stringField(body, "correlation_id"),
        retryAfterSeconds: parseRetryAfterSeconds(res.headers.get("retry-after")),
        detail: `IdP validate answered ${res.status}`,
      };
    } catch (err) {
      last = {
        status: null,
        correlationId: null,
        retryAfterSeconds: null,
        detail: `IdP validate unreachable: ${err instanceof Error ? err.name : "error"}`,
      };
    }
    const wait = planNextWaitMs(
      attempts,
      last.retryAfterSeconds,
      SESSION_VALIDATE_TOTAL_CAP_MS - (Date.now() - started)
    );
    if (wait === null) break;
    await sleep(wait);
  }
  return { kind: "unavailable", ...last, attempts };
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
