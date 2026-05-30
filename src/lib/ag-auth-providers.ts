/**
 * ag-auth-providers.ts
 *
 * Server-side discovery for AG human/operator login providers.
 * Calls AG's GET /api/v1/auth/providers endpoint and returns a safe
 * AgAuthProviderDiscoveryState — no internal URLs, secrets, raw errors,
 * or stack traces are included.
 *
 * No server-only restriction so this module can be unit-tested directly
 * with mocked fetch. Callers that need server-only guarantees should add
 * import "server-only" in their own file.
 *
 * Login URL safety:
 *   AG returns login_url as a relative path (e.g. "/login?idp=entra-prod").
 *   This module validates that login_url is relative (no "://") before
 *   including the provider. Absolute login_urls are rejected to prevent
 *   open-redirect attacks from a compromised or misconfigured AG backend.
 *   Callers rendering login links must use /api/ag-auth/login?idp=<id>
 *   rather than the raw login_url, to avoid exposing the AG identity
 *   surface URL in the browser.
 *
 * License availability:
 *   AG reports login_available and unavailable_reason at the response level
 *   and per-provider when OIDCFederation is not licensed. Disabled providers
 *   are included in the state (not filtered out) so the UI can show them as
 *   configured-but-locked rather than hiding them from operators.
 */

import type {
  AgAuthProvider,
  AgAuthProviderDiscoveryState,
  AgAuthProvidersApiResponse,
} from "./types";

const DISCOVERY_TIMEOUT_MS = 5000;
const EXPECTED_COMPONENT = "identuum-ag";

/** Slug pattern matching AG's validation: lowercase alphanumeric + hyphens, 1-64 chars. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** Shared null-state for when AG is not reachable or not configured. */
function notAvailableState(
  auth_mode: string | null,
  error_code: string | null
): AgAuthProviderDiscoveryState {
  return {
    available: false,
    auth_mode,
    providers: [],
    provider_count: 0,
    error_code,
    login_available: null,
    unavailable_reason: null,
    local_login_available: null,
    local_login_url: null,
  };
}

/**
 * Returns true when login_url is a safe relative path.
 * Rejects absolute URLs (containing "://") and empty strings.
 * AG is expected to return relative paths like "/login?idp=<slug>".
 */
export function isRelativeLoginUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return !url.includes("://") && url.startsWith("/");
}

/**
 * Returns true when id matches the expected AG provider slug format.
 * Guards against injection when the slug is used in query parameters.
 */
export function isValidProviderSlug(id: string): boolean {
  return typeof id === "string" && SLUG_PATTERN.test(id);
}

/**
 * Sanitises a raw provider entry from the AG response.
 * Returns null when the entry is missing required safe fields or contains
 * an absolute login_url.
 * Disabled providers (enabled=false) are preserved with their unavailable_reason
 * so the UI can show them as configured-but-locked.
 */
export function sanitiseProvider(raw: unknown): AgAuthProvider | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const p = raw as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : null;
  const displayName = typeof p.display_name === "string" ? p.display_name : null;
  const loginUrl = typeof p.login_url === "string" ? p.login_url : null;
  const enabled = typeof p.enabled === "boolean" ? p.enabled : false;

  if (!id || !displayName || !loginUrl) return null;
  if (!isValidProviderSlug(id)) return null;
  if (!isRelativeLoginUrl(loginUrl)) return null;

  const result: AgAuthProvider = {
    id,
    type: typeof p.type === "string" ? p.type : "generic_oidc",
    display_name: displayName,
    login_url: loginUrl,
    enabled,
    advanced: typeof p.advanced === "boolean" ? p.advanced : false,
  };

  // Preserve unavailable_reason when enabled=false. Only the opaque safe string
  // is passed through — no raw AG error text or internal config is included.
  if (!enabled && typeof p.unavailable_reason === "string" && p.unavailable_reason) {
    result.unavailable_reason = p.unavailable_reason;
  }

  return result;
}

/**
 * Fetches AG login provider metadata from the AG management surface.
 *
 * Returns a safe AgAuthProviderDiscoveryState; never exposes internal AG URLs,
 * raw backend errors, tokens, or secrets in the returned value.
 *
 * Pass null for agManagementBaseUrl when AG is not configured; returns a
 * not-available state without making a network request.
 *
 * Login availability:
 *   When AG reports login_available=false (OIDCFederation not licensed), the
 *   state includes the disabled providers and unavailable_reason so the UI can
 *   show them as configured-but-locked rather than hiding them entirely.
 */
export async function fetchAgAuthProviders(
  agManagementBaseUrl: string | null
): Promise<AgAuthProviderDiscoveryState> {
  if (!agManagementBaseUrl) {
    return notAvailableState(null, null);
  }

  const url = `${agManagementBaseUrl.replace(/\/$/, "")}/api/v1/auth/providers`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (res.status === 503) {
      let errorCode = "provider_discovery_failed";
      try {
        const body = (await res.json()) as Partial<AgAuthProvidersApiResponse>;
        if (body?.error?.code) errorCode = body.error.code;
      } catch {
        // ignore parse error on 503 body
      }
      return {
        ...notAvailableState("unknown", errorCode),
        login_available: false,
      };
    }

    if (!res.ok) {
      return notAvailableState(null, "unreachable");
    }

    raw = await res.json();
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return notAvailableState(null, isTimeout ? "timeout" : "unreachable");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return notAvailableState(null, "invalid_json");
  }

  const body = raw as Partial<AgAuthProvidersApiResponse>;

  // Validate the responding component identity.
  if (body.component !== EXPECTED_COMPONENT) {
    return notAvailableState(null, "wrong_component");
  }

  const authMode = typeof body.auth_mode === "string" ? body.auth_mode : "unknown";
  const rawProviders = Array.isArray(body.providers) ? body.providers : [];

  // Sanitise providers. Disabled providers (enabled=false) are included so the
  // UI can show them as configured-but-locked when the feature gate is inactive.
  const providers: AgAuthProvider[] = rawProviders
    .map(sanitiseProvider)
    .filter((p): p is AgAuthProvider => p !== null);

  // Preserve login_available and unavailable_reason from the AG response.
  const loginAvailable = typeof body.login_available === "boolean" ? body.login_available : null;
  const unavailableReason =
    typeof body.unavailable_reason === "string" && body.unavailable_reason
      ? body.unavailable_reason
      : null;

  // Parse the local-login signal added in identuum-ag 2026-05-25. Older AG
  // builds omit both fields; treat absent as null (UI falls back to "show the
  // form anyway" rather than hiding it, since hiding it would be a regression
  // for deployments that haven't picked up the new AG release).
  const localLoginAvailable =
    typeof body.local_login_available === "boolean" ? body.local_login_available : null;

  // local_login_url is only propagated when AG advertises local login AND the
  // path passes the same relative-URL guard used for federated providers. An
  // absolute URL here would risk an open-redirect-shaped bug; the UI's
  // server-side proxy always posts to the configured agIdentityBaseUrl, so a
  // bad path is discarded rather than honored.
  let localLoginUrl: string | null = null;
  if (
    localLoginAvailable === true &&
    typeof body.local_login_url === "string" &&
    isRelativeLoginUrl(body.local_login_url)
  ) {
    localLoginUrl = body.local_login_url;
  }

  return {
    available: true,
    auth_mode: authMode,
    login_available: loginAvailable,
    unavailable_reason: unavailableReason,
    local_login_available: localLoginAvailable,
    local_login_url: localLoginUrl,
    providers,
    provider_count: providers.length,
    error_code: null,
  };
}
