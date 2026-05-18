/**
 * Browser-side typed fetch helper for same-origin UI API routes.
 *
 * All fetches target /api/* routes on the UI origin. Never call backend
 * public URLs directly from browser-side code — use /api/idp/... or
 * /api/ag/... proxy routes, or typed wrappers like fetchStatus().
 *
 * Tokens remain cookie-only. Nothing here touches localStorage/sessionStorage.
 */

import type { PublicRuntimeConfig, StatusResponse } from "./types";

// ApiError is thrown by idp-client and ui-api fetchers for non-OK HTTP responses.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fetches a JSON response or throws ApiError on non-OK status. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new ApiError(res.status, `HTTP ${res.status}: ${url}`, body);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetches /api/runtime-config.
 * Always returns 200 (returns { configured: false } when unconfigured),
 * so ApiError is only thrown for unexpected network/server failures.
 */
export async function fetchRuntimeConfig(): Promise<PublicRuntimeConfig> {
  return fetchJson<PublicRuntimeConfig>("/api/runtime-config");
}

/**
 * Fetches /api/status — server-side backend health summary.
 * Browser never calls IdP/AG health endpoints directly.
 */
export async function fetchStatus(): Promise<StatusResponse> {
  return fetchJson<StatusResponse>("/api/status");
}
