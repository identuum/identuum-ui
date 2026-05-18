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
    internal_base_url?: string;
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
