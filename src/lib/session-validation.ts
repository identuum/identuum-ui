/** Shared session verdict and retry engine for the Next server and static browser UI.
 * Transport alone is injected; both deployments use the same timeout and retry decisions.
 */
import type { ValidateResponse } from "./types";

export type SessionState =
  | { kind: "authenticated"; session: ValidateResponse }
  | { kind: "unauthenticated"; status: number | null; reason: string | null }
  | {
      kind: "unavailable";
      /** last unavailable HTTP status seen or null for a network failure */
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

export async function validateSessionResponse(
  request: (signal: AbortSignal) => Promise<Response>
): Promise<SessionState> {
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
      const res = await request(AbortSignal.timeout(timeoutMs));
      if (res.ok) {
        return { kind: "authenticated", session: (await res.json()) as ValidateResponse };
      }
      if (res.status < 500 && res.status !== 429) {
        // A VERDICT. 401 bodies name it (AUTH-503: `reason`); keep it for the guards' logs.
        const body = await readBody(res);
        return {
          kind: "unauthenticated",
          status: res.status,
          reason: stringField(body, "reason") ?? stringField(body, "error"),
        };
      }
      // 5xx / 429 — the IdP could not judge. Retry within the same bounded budget.
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
}
