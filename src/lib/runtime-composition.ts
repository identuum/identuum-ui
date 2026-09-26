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
  IdpSetupStateView,
  IdpUpgradeStateView,
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
  "account_self_service",
  "user_sessions",
  "mfa",
  "webauthn",
  "authorization_server",
  "oauth_clients",
  "api_resources",
  "service_accounts",
  "scope_templates",
  "org_roles",
  "protocol_settings",
  "client_credentials",
  "dynamic_client_registration",
  "scim",
  "audit_log",
  "audit_chain",
  "reporting",
  "anomaly_detection",
  "observability",
  "mail_ceremonies",
  "admin_reset_link",
  "user_approval",
];

export type CapabilityAvailability = "available" | "unavailable" | "unknown";

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

export function getCapabilityAvailability(
  capabilities: ComponentCapabilities,
  key: keyof ComponentCapabilities
): CapabilityAvailability {
  const value = capabilities[key];
  if (value === true) return "available";
  if (value === false) return "unavailable";
  return "unknown";
}

function notConfiguredState(): BackendComponentState {
  return {
    configured: false,
    reachable: false,
    usable: false,
    component: null,
    product: null,
    capability_map_schema_version: null,
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
    product: null,
    capability_map_schema_version: null,
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
      product: null,
      capability_map_schema_version: null,
      version: null,
      status: null,
      capabilities: {},
      auth: {},
      license: { status: "unknown" },
      error: "invalid_json",
    };
  }

  const disc = raw as Partial<ComponentDiscoveryResponse>;

  // Pass-through helpers for the two optional backend-identity fields.
  // These are safe to surface on every non-unreachable response — they
  // carry no secret material and do not affect the usable/wrong-component
  // verdict.
  const product = typeof disc.product === "string" ? disc.product : null;
  const schemaVersion =
    typeof disc.capability_map_schema_version === "string"
      ? disc.capability_map_schema_version
      : null;

  if (disc.component !== expectedComponent) {
    return {
      configured: true,
      reachable: true,
      usable: false,
      component: typeof disc.component === "string" ? disc.component : null,
      product,
      capability_map_schema_version: schemaVersion,
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
    product,
    capability_map_schema_version: schemaVersion,
    version: typeof disc.version === "string" ? disc.version : null,
    status: typeof disc.status === "string" ? disc.status : null,
    capabilities: caps,
    auth,
    license,
    error: null,
  };
}

/**
 * fetchIdpSetupState probes the IDP appliance setup-status surface
 * (`GET /api/setup/status`) and projects the safe-to-render subset onto
 * IdpSetupStateView. Failure modes (timeout / 404 from an older backend
 * / non-OK / non-JSON / unexpected shape) all resolve to `null` so the
 * runtime composition never collapses to "setup_required" from a probe
 * that cannot speak the contract.
 *
 * No setup token, hash, or admin-credential material is read or
 * surfaced — the endpoint deliberately returns a no-secrets view per
 * D-IDP-INSTALL-20.
 */
export async function fetchIdpSetupState(baseUrl: string): Promise<IdpSetupStateView | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/setup/status`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  if (state !== "setup_required" && state !== "setup_complete") return null;

  return {
    state,
    setupTokenRequired: r.setup_token_required === true,
    firstSigningKeyExists: r.first_signing_key_exists === true,
    siteAdminExists: r.site_admin_exists === true,
    firstOrganizationExists: r.first_organization_exists === true,
    nextAction: typeof r.next_action === "string" ? r.next_action : "",
  };
}

/**
 * Wire-stable upgrade state vocabulary surfaced by the CE binary.
 * Local copy of the union from idp-upgrade-client.ts so the runtime
 * probe stays decoupled from the client helper that the wizard
 * itself imports — keeps this server-only module narrow.
 */
const UPGRADE_STATES: ReadonlySet<IdpUpgradeStateView["state"]> = new Set<
  IdpUpgradeStateView["state"]
>([
  "fresh_ce",
  "oss_database_detected",
  "upgrade_required",
  "ce_migrations_current",
  "upgrade_complete",
  "incompatible_database",
  "database_unreachable",
  "backup_required",
]);

function isUpgradeState(value: unknown): value is IdpUpgradeStateView["state"] {
  return typeof value === "string" && UPGRADE_STATES.has(value as IdpUpgradeStateView["state"]);
}

/**
 * fetchIdpUpgradeState probes the CE upgrade-status surface
 * (`GET /api/upgrade/status`) and projects the safe-to-render subset
 * onto IdpUpgradeStateView. Failure modes (timeout / 404 from an
 * older OSS backend / non-OK / non-JSON / unexpected shape) all
 * resolve to `null` so the runtime composition never routes to
 * `/upgrade` from a probe that cannot speak the contract.
 *
 * The probe is intentionally tolerant on the OSS side: OSS backends
 * do NOT expose `/api/upgrade/status` and a 404 there is the
 * expected state, not an error.
 *
 * No DB URL, no SQL error, no schema fragment, and no upgrade-token
 * plaintext is read or surfaced — the endpoint deliberately returns
 * a no-secrets view (see internal/upgrade/domain.go StatusView).
 */
export async function fetchIdpUpgradeState(baseUrl: string): Promise<IdpUpgradeStateView | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/upgrade/status`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isUpgradeState(r.state)) return null;

  return {
    state: r.state,
    distribution: typeof r.distribution === "string" ? r.distribution : "",
    upgradeAvailable: r.upgrade_available === true,
    ceMigrationsCurrent: r.ce_migrations_current === true,
    ossDatabaseDetected: r.oss_database_detected === true,
    backupRequired: r.backup_required === true,
    nextAction: typeof r.next_action === "string" ? r.next_action : "",
  };
}

/**
 * upgradeStateNeedsWizard returns true when the IDP-reported upgrade
 * state requires operator action in the /upgrade wizard. The runtime
 * composition layer uses this to decide whether to send the operator
 * to /upgrade ahead of /setup or /login.
 */
export function upgradeStateNeedsWizard(state: IdpUpgradeStateView["state"]): boolean {
  return (
    state === "fresh_ce" ||
    state === "oss_database_detected" ||
    state === "upgrade_required" ||
    state === "incompatible_database" ||
    state === "database_unreachable" ||
    state === "backup_required"
  );
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

  // Probe the appliance setup-status surface only when the IDP is
  // both configured and usable. A non-usable IDP cannot serve the
  // setup-status endpoint reliably; older OSS backends without
  // /api/setup/status return null and the UI keeps default behaviour
  // (no redirect to /setup).
  if (idpBaseUrl && idp.usable) {
    idp.setupState = await fetchIdpSetupState(idpBaseUrl);
  }

  // Probe the OSS-to-CE upgrade-status surface whenever the IDP base
  // URL is configured. In CE upgrade mode the binary mounts ONLY
  // `/healthz` + `/api/upgrade/*` — the `/api/v1/component` endpoint
  // is absent, so `idp.usable` is false. We still need to detect
  // upgrade mode so the UI can route to `/upgrade`. OSS backends do
  // not expose `/api/upgrade/status`; the probe returns null and the
  // UI keeps default behaviour (no redirect to /upgrade).
  if (idpBaseUrl) {
    idp.upgradeState = await fetchIdpUpgradeState(idpBaseUrl);
  }

  return {
    mode: computePlatformMode(idp, ag),
    components: { idp, ag },
  };
}
