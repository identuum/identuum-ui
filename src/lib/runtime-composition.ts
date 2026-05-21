/**
 * runtime-composition.ts
 *
 * Server-side module: discovers configured IDP and AG backends by calling
 * their GET /api/v1/component endpoints, validates component identity, and
 * computes the current platform mode.
 *
 * This module is the server-side composition layer for the Identuum UI.
 * Backends remain source of truth for all domain data. The UI only reads
 * their published capability contracts and computes a composed view.
 *
 * No server-only restriction: the module uses only `fetch` so it can be
 * unit-tested directly with mocked fetch without Next.js infrastructure.
 */

import type {
  BackendComponentState,
  ComponentDiscoveryResponse,
  DiscoveryErrorCode,
  PlatformMode,
  RuntimeState,
} from "./types";

const DISCOVERY_TIMEOUT_MS = 5000;
export const EXPECTED_IDP_COMPONENT = "identuum-idp";
export const EXPECTED_AG_COMPONENT = "identuum-ag";

function notConfiguredState(): BackendComponentState {
  return {
    configured: false,
    reachable: false,
    usable: false,
    component: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" },
    error: null,
  };
}

function unreachableState(error: DiscoveryErrorCode): BackendComponentState {
  return {
    configured: true,
    reachable: false,
    usable: false,
    component: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" },
    error,
  };
}

async function fetchComponent(
  baseUrl: string,
  expectedComponent: string
): Promise<BackendComponentState> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/component`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return unreachableState("unreachable");
    }
    raw = await res.json();
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return unreachableState(isTimeout ? "timeout" : "unreachable");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      configured: true,
      reachable: true,
      usable: false,
      component: null,
      version: null,
      status: null,
      capabilities: {},
      auth: {},
      license: { status: "unknown" },
      error: "invalid_json",
    };
  }

  const disc = raw as Partial<ComponentDiscoveryResponse>;

  if (disc.component !== expectedComponent) {
    return {
      configured: true,
      reachable: true,
      usable: false,
      component: typeof disc.component === "string" ? disc.component : null,
      version: typeof disc.version === "string" ? disc.version : null,
      status: typeof disc.status === "string" ? disc.status : null,
      capabilities: {},
      auth: {},
      license: { status: "unknown" },
      error: "wrong_component",
    };
  }

  const caps =
    typeof disc.capabilities === "object" &&
    disc.capabilities !== null &&
    !Array.isArray(disc.capabilities)
      ? (disc.capabilities as Record<string, boolean>)
      : {};

  const auth =
    typeof disc.auth === "object" && disc.auth !== null && !Array.isArray(disc.auth)
      ? (disc.auth as Record<string, string>)
      : {};

  const licStatus =
    typeof disc.license === "object" &&
    disc.license !== null &&
    typeof disc.license.status === "string"
      ? disc.license.status
      : "unknown";

  return {
    configured: true,
    reachable: true,
    usable: true,
    component: disc.component,
    version: typeof disc.version === "string" ? disc.version : null,
    status: typeof disc.status === "string" ? disc.status : null,
    capabilities: caps,
    auth,
    license: { status: licStatus },
    error: null,
  };
}

/**
 * computePlatformMode derives the platform mode from the two backend states.
 *
 * Rules (in priority order):
 *   both usable                          -> full-platform
 *   IDP only usable, AG not configured   -> identity-only
 *   AG only usable, IDP not configured   -> agent-governance-only
 *   IDP usable, AG configured + unusable -> degraded-ag-unavailable
 *   AG usable, IDP configured + unusable -> degraded-idp-unavailable
 *   both configured, neither usable      -> misconfigured
 *   neither configured                   -> unconfigured
 */
export function computePlatformMode(
  idp: BackendComponentState,
  ag: BackendComponentState
): PlatformMode {
  if (!idp.configured && !ag.configured) return "unconfigured";
  if (idp.usable && ag.usable) return "full-platform";
  if (idp.usable && !ag.configured) return "identity-only";
  if (ag.usable && !idp.configured) return "agent-governance-only";
  if (idp.usable && ag.configured && !ag.usable) return "degraded-ag-unavailable";
  if (ag.usable && idp.configured && !idp.usable) return "degraded-idp-unavailable";
  return "misconfigured";
}

/**
 * discoverRuntime contacts each configured backend and returns the composed
 * RuntimeState. Pass null for a backend that is not configured.
 * Uses internal/management URLs for server-side calls (caller's responsibility).
 */
export async function discoverRuntime(
  idpBaseUrl: string | null,
  agBaseUrl: string | null
): Promise<RuntimeState> {
  const [idp, ag] = await Promise.all([
    idpBaseUrl
      ? fetchComponent(idpBaseUrl, EXPECTED_IDP_COMPONENT)
      : Promise.resolve(notConfiguredState()),
    agBaseUrl
      ? fetchComponent(agBaseUrl, EXPECTED_AG_COMPONENT)
      : Promise.resolve(notConfiguredState()),
  ]);

  return {
    mode: computePlatformMode(idp, ag),
    components: { idp, ag },
  };
}
