// RuntimeConfig is the full server-side config read from ui-runtime.json.
// internal_base_url fields are server-only and must never be returned to browsers.
export interface RuntimeConfig {
  configured: boolean;
  ui_origin: string;
  idp: {
    enabled: boolean;
    public_base_url: string;
    internal_base_url?: string;
  };
  ag: {
    enabled: boolean;
    /** Management surface (health checks, admin API). Default port 7215 in dev. */
    public_base_url: string;
    /** Canonical server-side management URL. Preferred over public_base_url for server calls. */
    internal_base_url?: string;
    /** Legacy alias for internal_base_url accepted for backward compatibility. Server-side only. */
    management_base_url?: string;
    /**
     * Identity surface for operator login (POST /login) and OIDC discovery.
     * Default port 7214 in dev. Required for AG operator login integration.
     * Falls back to public_base_url when absent (for reverse-proxy deployments
     * where all surfaces share a single external URL).
     */
    identity_base_url?: string;
    identity_internal_base_url?: string;
  };
}

// PublicRuntimeConfig is the browser-safe subset. No internal URLs.
export interface PublicRuntimeConfig {
  configured: boolean;
  ui_origin: string;
  idp: {
    enabled: boolean;
    public_base_url: string;
  };
  ag: {
    enabled: boolean;
    public_base_url: string;
  };
}

export type UserRole = "site_admin" | "org_admin" | "org_user";

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
  /** Backend JSON field is "organization_id" (from types.UserInfo). */
  organization_id?: string;
}

export interface OrgConfig {
  slug: string;
  name: string;
  auth_policy: "local_only" | "idp_only" | "mixed";
  sso_url?: string;
  identity_providers?: PublicIDPInfo[];
}

export interface PublicIDPInfo {
  id: string;
  type: string;
  name: string;
  login_url: string;
  email_domains?: string[];
}

export interface ValidateResponse {
  user?: CurrentUser;
  role?: UserRole;
}

// ── Site-admin organization list ────────────────────────────────────────────

/**
 * UI-safe subset of the IdP OrganizationInfo type.
 * Sanitized in idp-admin-client.ts before being passed to client components.
 * Does not include internal URLs, secrets, or mfa/auth policy details.
 * Note: has_admin maps to the IdP's is_claimed field, which the list handler
 * sets to true when the organization has at least one active org_admin.
 */
export interface OrgListItem {
  id: string;
  name: string;
  domain: string;
  slug: string;
  active: boolean;
  deleted: boolean;
  has_admin: boolean;
  /** True when site_admin may use the recovery delegation flow (same semantics as GenerateClaimToken). */
  can_assign_admin: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * UI-safe shape for the edit form. Includes fields that the site-admin edit
 * form exposes. Sanitized in idp-admin-client.ts; never includes secrets or
 * internal URLs.
 *
 * auth_policy valid values (from IdP domain): "local_only" | "idp_only" | "mixed"
 * mfa_policy valid values (from IdP domain): "optional" | "required"
 */
export interface OrgDetail {
  id: string;
  name: string;
  domain: string;
  slug: string;
  active: boolean;
  deleted: boolean;
  auth_policy: string;
  mfa_policy: string;
  has_admin: boolean;
  /** True when site_admin may use the recovery delegation flow (same semantics as GenerateClaimToken). */
  can_assign_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgListResult {
  organizations: OrgListItem[];
  total_count: number;
  count: number;
  offset: number;
  limit: number;
}

// ── Org-admin user list ─────────────────────────────────────────────────────

/**
 * UI-safe subset of the IdP UserInfo type for the org-admin Users page.
 * Sanitized in idp-admin-client.ts; never includes password hashes, MFA
 * secrets, recovery codes, session data, or internal encrypted fields.
 */
export interface OrgUserItem {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  active: boolean;
  deleted: boolean;
  mfa_enabled: boolean;
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
  /** Backend-authoritative: true when the user has an outstanding unclaimed invitation. */
  invitation_pending: boolean;
  /** true = email-bound invite; false = no-email (manual) invite. Only meaningful when invitation_pending. */
  invitation_email_bound: boolean;
}

/**
 * Safe profile data fetched server-side from GET /api/v1/profile.
 * Sanitized in idp-admin-client.ts; never includes passwords, MFA secrets,
 * recovery codes, activation tokens, session IDs, or internal encrypted fields.
 */
export interface UserProfile {
  email: string;
  name: string | null;
  role: UserRole;
  organization_name: string | null;
  domain: string | null;
  mfa_enabled: boolean;
  email_verified: boolean;
}

// Shared between /api/status server route and browser-side status client.
export interface BackendHealthStatus {
  enabled: boolean;
  healthy: boolean | null;
}

export interface StatusResponse {
  idp: BackendHealthStatus;
  ag: BackendHealthStatus;
}

// ── AG auth-provider discovery types (/api/ag-auth/providers) ──────────────

/**
 * Canonical preset type strings for AG human/operator login providers.
 * Values are stable across API versions so the UI may map them to icons/labels.
 */
export type AgAuthProviderType =
  | "microsoft_entra"
  | "okta"
  | "google_workspace"
  | "auth0"
  | "keycloak"
  | "generic_oidc"
  | "identuum_idp";

/**
 * AG overall operator authentication mode reported by /api/v1/auth/providers.
 */
export type AgAuthMode = "unknown" | "bootstrap" | "external_oidc" | "identuum_idp" | "mixed";

/**
 * Public-safe metadata for a single AG login provider.
 * Never contains client_secret, client_id, issuer_url, or internal config.
 */
export interface AgAuthProvider {
  id: string;
  type: AgAuthProviderType | string;
  display_name: string;
  /**
   * Relative login path on the AG identity surface, e.g. "/login?idp=entra-prod".
   * Absolute URLs are rejected by the UI. Use /api/ag-auth/login?idp=<id> to
   * redirect safely without exposing the AG identity surface URL to the browser.
   */
  login_url: string;
  /**
   * True when this provider's login flow is usable. False when the provider
   * is configured but OIDCFederation is not licensed — clicking would get 403.
   */
  enabled: boolean;
  advanced: boolean;
  /**
   * Present only when enabled=false. "forbidden_feature" means OIDCFederation
   * is not active. Safe opaque string; no internal detail.
   */
  unavailable_reason?: string;
}

/** Raw shape returned by AG's GET /api/v1/auth/providers. */
export interface AgAuthProvidersApiResponse {
  component: string;
  auth_mode: AgAuthMode | string;
  /** Absent when no providers configured. True = usable. False = feature gate blocks /login. */
  login_available?: boolean;
  /** Present only when login_available=false. "forbidden_feature" = OIDCFederation not licensed. */
  unavailable_reason?: string;
  providers: AgAuthProvider[];
  error?: { code: string };
}

/**
 * Discovery state for UI consumption. Produced by fetchAgAuthProviders() and
 * returned by GET /api/ag-auth/providers. No internal URLs, secrets, or raw
 * backend errors are included.
 */
export interface AgAuthProviderDiscoveryState {
  /** True when AG responded successfully (even with an empty provider list). */
  available: boolean;
  /** AG-reported auth_mode, or null when AG is not reachable. */
  auth_mode: AgAuthMode | string | null;
  /**
   * All sanitised providers (enabled and disabled). Disabled providers have
   * enabled=false and may have unavailable_reason set.
   */
  providers: AgAuthProvider[];
  /** Number of configured providers (enabled + disabled combined). */
  provider_count: number;
  /** Safe error code when provider listing failed; null on success or not-configured. */
  error_code: string | null;
  /**
   * null = absent from AG response (no providers) or AG not reachable.
   * true = OIDCFederation licensed; /login?idp=<slug> will work.
   * false = feature gate inactive; /login returns 403 forbidden_feature.
   */
  login_available: boolean | null;
  /**
   * "forbidden_feature" when login_available=false due to license gate.
   * null when login is available or providers are not configured.
   */
  unavailable_reason: string | null;
}

// ── Runtime composition types (/api/runtime) ────────────────────────────────

/**
 * Platform mode computed by /api/runtime from live backend discovery.
 * The UI uses this to show/hide surfaces at render time.
 */
export type PlatformMode =
  | "identity-only"
  | "agent-governance-only"
  | "full-platform"
  | "degraded-idp-unavailable"
  | "degraded-ag-unavailable"
  | "misconfigured"
  | "unconfigured";

/**
 * Safe error category for a failed component discovery. Avoids leaking
 * URLs, credentials, or stack traces.
 */
export type DiscoveryErrorCode =
  | "unreachable"
  | "timeout"
  | "invalid_json"
  | "wrong_component"
  | "discovery_failed";

/** Raw shape returned by a backend's GET /api/v1/component endpoint. */
export interface ComponentDiscoveryResponse {
  component: string;
  version: string;
  status: string;
  capabilities: Record<string, boolean>;
  auth: Record<string, string>;
  license: { status: string; product?: string };
}

/** UI-side state for one discovered backend component. */
export interface BackendComponentState {
  configured: boolean;
  reachable: boolean;
  usable: boolean;
  component: string | null;
  version: string | null;
  status: string | null;
  capabilities: Record<string, boolean>;
  auth: Record<string, string>;
  license: { status: string };
  error: DiscoveryErrorCode | null;
}

/**
 * Full runtime state returned by GET /api/runtime.
 * The UI derives navigation, login choices, and platform mode from this.
 */
export interface RuntimeState {
  mode: PlatformMode;
  components: {
    idp: BackendComponentState;
    ag: BackendComponentState;
  };
}
