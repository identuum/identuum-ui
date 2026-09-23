/**
 * Server transport for the IdP admin client (the Next deployment).
 *
 * idp-admin-client.ts decides WHAT to ask the IdP and how to read the
 * answer; this module decides HOW the request travels. Here, server-side:
 * the request goes to the IdP base URL with the caller's cookies and the
 * Bearer lifted from the HttpOnly access_token cookie. The static export
 * substitutes its own transport at build time (export/src/platform/
 * idp-transport.ts), which sends the same request through the Go boundary
 * under /bff where the binary lifts the cookie itself.
 *
 * Server-only: the Bearer and cookie jar never leave the server.
 */
import "server-only";

import { cookies } from "next/headers";

/**
 * Server-side IdP auth headers for the BFF. Returns BOTH credentials:
 *   - Cookie: the full httpOnly cookie jar — the IdP's cookie-aware endpoints
 *     (e.g. /api/v1/validate) read the session from here.
 *   - Authorization: Bearer <access_token> — released OSS resource endpoints
 *     (clients, users, organizations, service-accounts, …) establish the
 *     request principal ONLY from the Authorization header: mw.BearerPrincipal
 *     never reads the access_token cookie, so a cookie-only call 401s. The
 *     bearer is lifted from the SAME httpOnly access_token cookie.
 *
 * The token stays server-side: this module is `server-only`, and the header is
 * attached only to the server→IdP fetch — it is never returned to the browser,
 * never serialised into a response body, and never logged. Sending both
 * credentials is safe: each endpoint reads only the one it understands.
 * `extra` merges caller-supplied headers (e.g. Content-Type).
 */
export async function idpAuthHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const all = (await cookies()).getAll();
  const headers: Record<string, string> = {
    ...extra,
    Cookie: all.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  const accessToken = all.find((c) => c.name === "access_token")?.value;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

/** The request itself: the global fetch, looked up at call time. */
export function idpFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
