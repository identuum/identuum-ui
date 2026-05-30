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
  ComponentCapabilities,
  ComponentDiscoveryResponse,
  ComponentLicenseInfo,
  DiscoveryErrorCode,
  PlatformMode,
  RuntimeState,
} from "./types";

const DISCOVERY_TIMEOUT_MS = 5000;
export const EXPECTED_IDP_COMPONENT = "identuum-idp";
export const EXPECTED_AG_COMPONENT = "identuum-ag";

const KNOWN_CAPABILITY_KEYS: ReadonlyArray<keyof ComponentCapabilities> = [
  "identity_provider",
  "agent_governance",
  "component_discovery",
  "license_status",
  "auth_provider_discovery",
  "organization_export",
  "organization_import",
  "organization_linking",
  "hitl",
  "agent_sessions",
];

/**
 * extractCapabilities safely projects the raw backend capabilities object onto
 * ComponentCapabilities. Only the explicit known boolean keys are passed through;
 * unknown keys, non-boolean values, and null/non-object input are discarded.
 */
export function extractCapabilities(input: unknown): ComponentCapabilities {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const caps: ComponentCapabilities = {};
  for (const key of KNOWN_CAPABILITY_KEYS) {
    if (typeof raw[key] === "boolean") {
      caps[key] = raw[key] as boolean;
    }
  }
  return caps;
}

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

/**
 * extractLicenseInfo safely projects the raw backend license object onto
 * ComponentLicenseInfo. Only the explicit safe fields are passed through;
 * unknown keys, entitlement lists, feature overrides, customer IDs, and key
 * material are discarded even if accidentally present in the backend response.
 */
function extractLicenseInfo(raw: unknown): ComponentLicenseInfo {
  const info: ComponentLicenseInfo = { status: "unknown" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return info;
  const r = raw as Record<string, unknown>;

  if (typeof r.status === "string") info.status = r.status;
  if (typeof r.product === "string") info.product = r.product;
  if (typeof r.tier === "string") info.tier = r.tier;
  if (r.expires_at === null) {
    info.expires_at = null;
  } else if (typeof r.expires_at === "string") {
    info.expires_at = r.expires_at;
  }
  if (r.days_remaining === null) {
    info.days_remaining = null;
  } else if (typeof r.days_remaining === "number") {
    info.days_remaining = r.days_remaining;
  }
  if (r.deployment_mode === null) {
    info.deployment_mode = null;
  } else if (typeof r.deployment_mode === "string") {
    info.deployment_mode = r.deployment_mode;
  }
  if (r.license_type === null) {
    info.license_type = null;
  } else if (typeof r.license_type === "string") {
    info.license_type = r.license_type;
  }

  return info;
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

  const caps = extractCapabilities(disc.capabilities);

  const auth =
    typeof disc.auth === "object" && disc.auth !== null && !Array.isArray(disc.auth)
      ? (disc.auth as Record<string, string>)
      : {};

  const license = extractLicenseInfo(disc.license);

  return {
    configured: true,
    reachable: true,
    usable: true,
    component: disc.component,
    version: typeof disc.version === "string" ? disc.version : null,
    status: typeof disc.status === "string" ? disc.status : null,
    capabilities: caps,
    auth,
    license,
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
