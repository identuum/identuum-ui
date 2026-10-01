/**
 * The browser side of the narrow Go boundary (identuum-idp-oss internal/api/ui.go).
 *
 * Every call goes to the same origin the shell was served from. The HttpOnly
 * `access_token` cookie is sent by the browser and lifted to a Bearer by the
 * boundary; page script never reads, stores or forwards a token. Every
 * request, reads included, carries the request header the boundary requires —
 * a cross-site form cannot set it, and a non-allowlisted origin cannot send it
 * through CORS — which is the CSRF mechanism this proof selected.
 */

import { LOGIN_STEP_STATUS_HEADER } from "@/lib/idp-client";

export const BFF_PREFIX = "/bff";
export const BFF_REQUEST_HEADER = "X-Requested-With";
export const BFF_REQUEST_HEADER_VALUE = "identuum-ui";
export const BFF_LOGOUT_PATH = "/session/logout";

/**
 * OSS-HARDEN (2026-10-01): the login-step opt-in. A request carrying it that
 * presents no credential is answered 200 {"authenticated":false} by the
 * session probe and the refresh, instead of a 401 the browser logs. The
 * refresh always sends it; a caller that did not send it gets the 401 back.
 */
export const SIGNED_OUT_OPT_IN = { [LOGIN_STEP_STATUS_HEADER]: "200" } as const;
const MISSING_REFRESH_CREDENTIAL = JSON.stringify({ reason: "missing_refresh_credential" });

async function isSignedOut(response: Response): Promise<boolean> {
  return response.status === 200 && (await readJson(response.clone()))?.authenticated === false;
}

let refreshInFlight: Promise<Response> | null = null;
let refreshEpoch = 0;

function refreshSession(signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  if (!refreshInFlight) {
    refreshInFlight = fetch(
      `${BFF_PREFIX}/session/refresh`,
      // One caller cancelling must not cancel the other callers' renewal.
      withBoundaryHeaders({
        method: "POST",
        headers: SIGNED_OUT_OPT_IN,
        signal: AbortSignal.timeout(6000),
      })
    )
      .then((response) => {
        if (response.status === 204) refreshEpoch += 1;
        return response;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  const shared = refreshInFlight;
  return new Promise<Response>((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    signal.addEventListener("abort", cancelled, { once: true });
    shared.then(
      (response) => {
        signal.removeEventListener("abort", cancelled);
        if (signal.aborted) reject(signal.reason);
        else resolve(response);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancelled);
        reject(error);
      }
    );
  });
}

function withBoundaryHeaders(init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  // The boundary requires the proof on EVERY /bff request, reads included.
  headers.set(BFF_REQUEST_HEADER, BFF_REQUEST_HEADER_VALUE);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return {
    ...init,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  };
}

/** A call through the boundary: `path` is the API path, e.g. `/api/v1/users/<id>`. */
export async function bff(path: string, init: RequestInit = {}): Promise<Response> {
  const request = withBoundaryHeaders({
    ...init,
    signal: init.signal ?? AbortSignal.timeout(6000),
  });
  const explicitBearer = new Headers(request.headers).has("Authorization");
  const readOnly = request.method === "GET" || request.method === "HEAD";
  const publicCeremony =
    path === "/api/v1/auth/login" ||
    path.startsWith("/api/v1/auth/login/") ||
    path === "/api/v1/auth/organization-lookup";
  const api = path.startsWith("/api/v1/");
  if (!readOnly && api && !publicCeremony && !explicitBearer) {
    // Renew BEFORE submitting a mutation. Its body is sent once, never
    // replayed after an ambiguous network failure or a handler refusal.
    const confirmed = await bff("/api/v1/validate", { signal: request.signal });
    if (!confirmed.ok) return confirmed;
  }
  const optedIn = new Headers(request.headers).get(LOGIN_STEP_STATUS_HEADER) === "200";
  const epochAtRequest = refreshEpoch;
  const response = await fetch(`${BFF_PREFIX}${path}`, request);
  if (!readOnly || !api || explicitBearer) return response;
  // An opted-in "signed out" is the 401 missing_credential of a caller that
  // did not opt in: the refresh cookie is still tried before it is believed.
  if (!(optedIn && (await isSignedOut(response)))) {
    if (response.status !== 401) return response;
    const failure = await readJson(response.clone());
    if (
      !["missing_credential", "token_invalid", "token_expired"].includes(String(failure?.reason))
    ) {
      return response;
    }
  }
  const signal = request.signal as AbortSignal;
  signal.throwIfAborted();
  // A delayed response may describe the credentials from before another
  // request renewed them. Retry with the browser's current cookies first.
  if (epochAtRequest === refreshEpoch) {
    const refreshed = await refreshSession(signal);
    if (refreshed.status !== 204) {
      if (!optedIn && (await isSignedOut(refreshed))) {
        return new Response(MISSING_REFRESH_CREDENTIAL, {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return refreshed.clone();
    }
  }
  signal.throwIfAborted();
  // Safe reads alone are retried, once. A failed refresh never clears the
  // cookies and never turns an outage into an authentication verdict.
  return fetch(`${BFF_PREFIX}${path}`, request);
}

/**
 * A direct, same-origin call to a PUBLIC route the boundary does not reach
 * (`/api/setup/*`, `/api/v1/component`): no cookie lift, no credential.
 */
export function direct(path: string, timeoutMs: number): Promise<Response> {
  return fetch(path, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Reads a JSON body without throwing on a non-JSON or empty response. */
export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
