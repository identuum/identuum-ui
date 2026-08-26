/**
 * Server-side session validation.
 *
 * Reads session cookies from the incoming request (via Next.js cookies()),
 * calls the IdP validate endpoint directly using the internal URL from
 * runtime config, and returns the session or null.
 *
 * This module is server-only. Client components may not import it.
 * Use validateSession() from idp-client.ts for browser-side validation.
 *
 * getServerSession() is wrapped with React's cache() so that multiple
 * callers within the same render tree (e.g. layout + page) share a single
 * IdP validate fetch per request.
 */
import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type { ValidateResponse } from "./types";

/**
 * Validates the session on the server side by forwarding request cookies
 * to the IdP backend. Returns the validate response or null when the session
 * is absent or invalid.
 *
 * Returns null (not throws) when:
 * - Runtime config is not yet written (setup-required state)
 * - IdP is not enabled in the runtime config (AG-only deployment)
 * - The IdP returns any non-200 response (401 = unauthenticated, etc.)
 * - The fetch itself fails (network error) even after one retry
 *
 * cache() ensures this function executes at most once per server render cycle,
 * even when called from both the layout (auth guard) and the page (data fetch).
 *
 * A single retry with a 150ms delay handles transient Docker DNS failures that
 * occasionally occur under combined test-suite load. Genuine auth failures
 * (non-200 status) return null immediately without retrying.
 */
export const getServerSession = cache(async (): Promise<ValidateResponse | null> => {
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) return null;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const url = `${idpBaseUrl(cfg)}/api/v1/validate`;

  // Exponential backoff: up to 6 attempts with 200ms, 400ms, 800ms, 1600ms, 3200ms delays
  // (~6s total retry window). Retries on:
  //   - network errors (ECONNREFUSED, DNS failure under Docker combined-suite load)
  //   - 5xx responses (IdP DB connection pool exhaustion in back-to-back test runs)
  // Returns null immediately on 4xx (genuine auth failure — do not retry).
  // Each attempt is bounded by a 4s AbortSignal timeout to prevent hung fetches.
  // connection: "close" prevents stale keep-alive connections from causing silent failures
  // when the Docker container recovers between test runs.
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      const signal = AbortSignal.timeout(4000);
      const reqInit: RequestInit = {
        headers: { Cookie: cookieHeader, Connection: "close" },
        cache: "no-store",
        signal,
      };
      const res = await fetch(url, reqInit);
      if (res.status >= 500) throw new Error(`IdP validate: ${res.status}`); // treat 5xx as transient
      if (!res.ok) return null; // 4xx = genuine auth failure — do not retry
      return (await res.json()) as ValidateResponse;
    } catch {
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        continue;
      }
      return null;
    }
  }
  return null;
});
