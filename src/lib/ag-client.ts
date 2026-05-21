/**
 * Server-side client for AG operator API calls.
 *
 * Reads the ag_operator_session cookie and attaches it as a Bearer token on
 * requests to the AG management surface. Must never expose internal_base_url,
 * the bearer token value, or any secrets to browser-side code or client props.
 *
 * Server-only: client components may not import this module.
 *
 * Auth contract:
 *   - AG uses "Authorization: Bearer <JWT>" header authentication.
 *   - The UI stores the token as an HttpOnly cookie (ag_operator_session) and
 *     forwards it server-side; JavaScript never reads the cookie value.
 *   - getAgOperatorToken() returns the raw cookie value for server-side use
 *     only. It must not be passed to client components or serialized to JSON.
 *
 * Session validation:
 *   - The presence of ag_access_token is treated as a soft session indicator.
 *   - Actual validity is enforced server-side by the AG backend (401 on expired
 *     or revoked tokens). AG management calls will return 401 on invalid tokens,
 *     which callers map to null/redirect.
 */
import "server-only";

import { cookies } from "next/headers";
import { agBaseUrl, loadRuntimeConfig } from "./runtime-config";

// ag_operator_session matches the cookie name set by the AG identity surface
// on both the federated OIDC /callback path and the local /login path.
export const AG_COOKIE_NAME = "ag_operator_session";

/**
 * Returns the operator bearer token from the ag_access_token cookie, or null
 * when absent. The returned value is a raw JWT — must not be logged, returned
 * to browsers, or included in client component props.
 */
export async function getAgOperatorToken(): Promise<string | null> {
  const store = await cookies();
  const val = store.get(AG_COOKIE_NAME)?.value;
  return val?.trim() || null;
}

/**
 * Returns true when an ag_access_token cookie is present.
 * Does NOT validate the token signature or check expiry server-side —
 * use AG API calls to detect 401 for actual validity checks.
 */
export async function hasAgSession(): Promise<boolean> {
  return (await getAgOperatorToken()) !== null;
}

/**
 * Makes an authenticated request to the AG management surface.
 *
 * Attaches the bearer token from ag_access_token as the Authorization header.
 * Returns the raw Response — callers are responsible for status checking.
 * Returns null when AG is not enabled or no session token is present.
 *
 * Internal URLs are never forwarded to browser code; only the response data
 * (after caller-side sanitisation) may be surfaced to client components.
 */
export async function agRequest(path: string, init?: RequestInit): Promise<Response | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return null;

  const token = await getAgOperatorToken();
  if (!token) return null;

  const base = agBaseUrl(cfg).replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      // Token attached server-side; never read by browser JavaScript.
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}
