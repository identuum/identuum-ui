import type { AGCEOrgLinkAvailability } from "./ag-ce-org-linking-availability";

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
  /**
   * MFA enrollment state on the IdP `users` row. The IdP's
   * `types.UserInfo.MfaEnabled` field serialises as `mfa_enabled`. Admin
   * roles (org_admin, site_admin) MUST have this true before they can
   * access privileged surfaces — see the org-admin layout guard which
   * redirects to MFA setup when the value is false. May be absent when
   * the IdP did not include the field (older builds).
   */
  mfa_enabled?: boolean;
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
 * Note: has_admin maps to the IdP's is_claimed field, which the handlers
 * compute as "at least one live org_admin row".
 *
 * ABSENT ≠ NEGATIVE (PHANTOM-NO-ADMIN): the backend emits is_claimed /
 * can_assign_admin as pointer+omitempty — a backend that does not emit
 * them (or could not compute them) yields `undefined` here, and the UI
 * must render "status unavailable", never a false "No administrator".
 * Coercing with Boolean() is exactly the bug this type change fences.
 */
export interface OrgListItem {
  id: string;
  name: string;
  domain: string;
  slug: string;
  active: boolean;
  deleted: boolean;
  /** True/false from the live count; undefined when the backend did not emit it. */
  has_admin: boolean | undefined;
  /**
   * True when an org_admin exists but none are verified (the expired-pending
   * recovery state). NOT a complete "can assign" signal on its own — when no
   * admin row exists, this is false even though assignment is allowed.
   * UI gates should use `has_admin === false || can_assign_admin === true`
   * so an undefined state never yields an assignment affordance.
   */
  can_assign_admin: boolean | undefined;
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
  /**
   * True/false from the live count; undefined when the backend did not
   * emit it (ABSENT ≠ NEGATIVE — render "status unavailable", never
   * "No administrator").
   */
  has_admin: boolean | undefined;
  /**
   * True when an org_admin exists but none are verified (the expired-pending
   * recovery state). NOT a complete "can assign" signal on its own — when no
   * admin row exists, this is false even though assignment is allowed.
   * UI gates should use `has_admin === false || can_assign_admin === true`
   * so an undefined state never yields an assignment affordance.
   */
  can_assign_admin: boolean | undefined;
  /**
   * Organization-level invite policy projection (read-only for org_admin in
   * the current settings surface — write support is intentionally deferred
   * until product semantics across all four mode combinations are signed off).
   * Wire fields: organizations.allow_public_registration +
   * organizations.require_registration_approval. Both are persisted by the
   * IDP and enforced at the login/JIT/registration paths.
   */
  allow_public_registration: boolean;
  require_registration_approval: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Per-organization protocol settings returned by
 * GET /api/v1/organizations/:id/protocol-settings (site_admin only).
 *
 * `source` distinguishes an explicit operator decision from the
 * system-default fallback:
 *   "explicit" — the org has a row in organization_protocol_settings;
 *                created_at and updated_at are populated.
 *   "default"  — no row exists; both booleans reflect system defaults
 *                (currently false/false); timestamps are null.
 *
 * Neither DCR nor SCIM credentials, tokens, IATs, or raw client secrets
 * appear in this type — only the two enable/disable booleans and
 * metadata needed to render the settings panel.
 */
export interface OrgProtocolSettings {
  organization_id: string;
  dynamic_client_registration_enabled: boolean;
  scim_enabled: boolean;
  source: "explicit" | "default";
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Discriminated result from getOrgProtocolSettings().
 *
 * ok=true  — settings fetched successfully.
 * ok=false — reason distinguishes the failure mode so the UI can render
 *            appropriate per-reason copy instead of a single generic notice:
 *   "not_authenticated" — session expired / 401.
 *   "forbidden"         — caller lacks permission / 403 (auth/role gate).
 *   "not_licensed"      — commercial license gate / 403 with structured license signal.
 *   "not_found"         — org absent or endpoint not present in this runtime / 404 or 501.
 *   "unavailable"       — backend unreachable, IDP not configured, 503, or network error.
 *   "unknown"           — any other non-200 from the backend.
 *
 * DCR Foundation remains OSS/Starter. SCIM 2.0 provisioning is
 * Enterprise/CE-only. "not_licensed" is reserved for structured commercial
 * license signals. When no structured signal is present, 403 maps to
 * "forbidden".
 */
export type GetOrgProtocolSettingsResult =
  | { ok: true; settings: OrgProtocolSettings }
  | {
      ok: false;
      reason:
        | "not_authenticated"
        | "forbidden"
        | "not_licensed"
        | "not_found"
        | "unavailable"
        | "unknown";
      status: number;
    };

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
  /**
   * IDP-authoritative pending-approval flag. The IDP creates self-registered
   * users with banned=true; (*UserService).ApproveRegistration flips banned to
   * false (and email_verified to true) only for role=org_user. The "Approve
   * registration" UI affordance MUST be gated on `banned && role === "org_user"`
   * — never inferred from other fields.
   */
  banned: boolean;
}

/**
 * UI-safe subset of the IdP APIResourceResponse type for the org-admin
 * API Resources page. Sanitised in idp-admin-client.ts. The backend's
 * APIResourceResponse already omits `resource_secret_hash` (it lives only
 * on the domain object, not the wire); the UI projection drops nothing
 * sensitive but keeps the explicit safe-field allowlist as defence in
 * depth against any future backend struct drift.
 */
export interface OrgAPIResourceItem {
  id: string;
  organization_id: string;
  name: string;
  /** Logical OAuth audience identifier, immutable after create. */
  audience: string;
  active: boolean;
  /** Access-token lifetime for tokens minted for this audience. */
  token_ttl_secs: number;
  /** Per-resource OAuth scope catalog. Each scope is independently assignable. */
  scopes: OrgAPIResourceScope[];
  created_at: string;
  updated_at: string;
}

export interface OrgAPIResourceScope {
  id: string;
  name: string;
  description: string;
}

/**
 * UI-safe subset of the IdP types.ServiceAccount wire shape. The IDP
 * intentionally projects ONLY the seven fields below to the wire (the
 * mapper at internal/handlers/mappers.go:25 drops Active / ExpiresAt /
 * OwnerUserID / OriginPeerID / OriginSPIFFEID from the DB row before
 * responding), so the UI's safe-projection allowlist mirrors the
 * backend exactly. The IDP NEVER returns a credential / secret / hash
 * / private-key field on any service-account route — the create
 * endpoint returns the same DTO as list/get, with no credential
 * material. Linking a service account to an OAuth client to obtain a
 * usable client_credentials grant is a separate (unimplemented)
 * backend operation; the UI does NOT promise a credential here.
 */
export interface OrgServiceAccountItem {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  /** "org_user" | "org_admin" (per domain.AllowedServiceAccountRoles). */
  role: string;
  /**
   * Service account lifecycle state — true when the SA can mint
   * client_credentials tokens via its linked OAuth client; false when
   * the org_admin has disabled it (slice
   * identuum-20260530-service-account-disable-enable-backend). The
   * IDP's GenerateTokensForClient guard refuses new tokens when this
   * is false. Existing already-issued access tokens run to their
   * natural expiry.
   */
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * UI-safe subset of the IDP ClientResponse for the org-admin
 * Applications page. Sanitised in idp-admin-client.ts before being
 * passed to client components.
 *
 * SECURITY:
 *   - The IDP's `ClientResponse.ClientSecret` field is `omitempty`
 *     and is populated ONLY on client creation responses (the
 *     `list-clients` handler does not populate it). We additionally
 *     ENSURE the field is not surfaced into this shape — by simply
 *     not declaring it — so a future regression that started
 *     populating the field on the list path cannot reach the
 *     operator UI through this type.
 *   - JWKS inline-key material is intentionally absent from the
 *     wire ClientResponse (the IDP comment: "public keys are
 *     write-only input; use jwks_uri to publish them instead").
 *     We surface only the `jwks_uri` reference, never inline keys.
 *   - `redirect_uris` and `post_logout_redirect_uris` are operator-
 *     configured public URLs and safe to display.
 */
export interface OrgClientItem {
  /** Internal opaque UUID — used only as a routing key, never displayed. */
  id: string;
  /** Operator-visible OAuth client_id (e.g. "my-app-prod"). */
  client_id: string;
  /** Operator-visible display name. */
  name: string;
  /** Public-client flag (no client_secret on token requests). */
  is_public: boolean;
  /** Skip-consent flag — only meaningful for first-party clients. */
  skip_consent: boolean;
  /** Configured redirect URIs. Empty array when none configured. */
  redirect_uris: string[];
  /** Configured post-logout redirect URIs. Empty array when none. */
  post_logout_redirect_uris: string[];
  /** Allowed token audiences. Empty array when not restricted. */
  allowed_audiences: string[];
  /** Default scope string. Empty string when none. */
  scope: string;
  /** Token endpoint auth method ("client_secret_post" / "private_key_jwt" / ...). */
  token_endpoint_auth_method: string;
  /** JWKS URI for private_key_jwt clients. Empty string when not configured. */
  jwks_uri: string;
  /** Signing alg for private_key_jwt clients ("ES256" / "RS256" / ...). */
  token_endpoint_auth_signing_alg: string;
  /** Organization this client belongs to. Null only for the system org. */
  organization_id: string | null;
  /** ISO 8601 creation timestamp. */
  created_at: string;
}

/** Result envelope for the org-scoped client list call. */
export interface OrgClientListResult {
  clients: OrgClientItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Options for the org-scoped create-client call. Mirrors the IDP's
 * CreateClientRequest shape but intentionally omits fields the
 * org_admin self-service surface does not expose:
 *   - organization_id (server-injected from the actor's session)
 *   - service_account_id (M2M provisioning surface, separate slice)
 *   - jwks (inline key material — operators publish via jwks_uri)
 *   - token_ttl_secs (operator-tuning surface, separate slice)
 *
 * The IDP enforces required name + at least one redirect URI.
 */
export interface CreateOrgClientOptions {
  /** Required operator-visible display name. */
  name: string;
  /** Required — at least one entry. Each MUST be a valid http(s) URI. */
  redirect_uris: string[];
  /** Optional. */
  post_logout_redirect_uris?: string[];
  /** Optional default scope string (e.g. "openid profile email"). */
  scope?: string;
  /** Optional. When true the IDP does not mint a client_secret. */
  is_public?: boolean;
  /** Optional allowed token audiences. */
  allowed_audiences?: string[];
}

/**
 * Result of a successful client creation. Carries the wire fields the
 * IDP returned on the create response, including the SINGLE-SHOT
 * `client_secret` that the IDP returns ONLY on this exact response and
 * never on any subsequent read.
 *
 * SECURITY:
 *   - `client_secret` lives only inside this returned envelope and must
 *     be surfaced once to the operator via the in-memory server-action
 *     state. It MUST NOT be written to localStorage / sessionStorage /
 *     cookies / URL / logs. It MUST NOT be refetched.
 *   - For public clients (`is_public=true`) the IDP does not mint a
 *     secret; `client_secret` will be empty/undefined.
 */
export interface CreatedOrgClient {
  id: string;
  client_id: string;
  name: string;
  is_public: boolean;
  /**
   * SINGLE-SHOT secret. Empty string for public clients. The string
   * is the only place this value ever surfaces — copy it now or
   * re-create the application later.
   */
  client_secret: string;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_audiences: string[];
  scope: string;
  token_endpoint_auth_method: string;
  organization_id: string | null;
}

/**
 * Options for the org-scoped update-client call. Mirrors the IDP's
 * UpdateClientRequest shape (every field optional / pointer-typed on the
 * Go side: omitted means "leave unchanged"), restricted to the safe
 * org_admin self-service subset.
 *
 * The org_admin self-service edit surface deliberately omits:
 *   - organization_id (server-enforced — cross-org would 403 anyway)
 *   - client_secret (no rotation in this slice; create a replacement
 *     application if a leak is suspected)
 *   - is_public (flipping public->confidential clears the IDP's stored
 *     `client_secret_hash` without minting a new secret, leaving the
 *     client unusable; secret rotation is out of scope)
 *   - token_endpoint_auth_method / jwks_uri / jwks /
 *     token_endpoint_auth_signing_alg (advanced private_key_jwt
 *     surface, separate authorisation review)
 *   - service_account_id (M2M provisioning surface)
 *   - skip_consent (consent control, separate slice)
 *   - token_ttl_secs (operator-tuning surface)
 */
export interface UpdateOrgClientOptions {
  /** New display name; omit to leave unchanged. */
  name?: string;
  /** New redirect URI list (REPLACES the existing list when supplied). */
  redirect_uris?: string[];
  /** New post-logout redirect URI list (REPLACES the existing list when supplied). */
  post_logout_redirect_uris?: string[];
  /** New default scope string; omit to leave unchanged. */
  scope?: string;
  /** New allowed-audiences list (REPLACES the existing list when supplied). */
  allowed_audiences?: string[];
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
  /**
   * OIDC Core §5.1 profile fields (THE-PROFILE-CLAIMS). Optional on the IdP;
   * null when unset. Edited on /account/settings?tab=profile via PUT /api/v1/profile.
   */
  given_name: string | null;
  family_name: string | null;
  middle_name: string | null;
  nickname: string | null;
  preferred_username: string | null;
  profile: string | null;
  picture: string | null;
  website: string | null;
  gender: string | null;
  birthdate: string | null;
  zoneinfo: string | null;
  locale: string | null;
}

/** The self-service writable subset of UserProfile (PUT /api/v1/profile). */
export const PROFILE_FIELD_KEYS = [
  "given_name",
  "family_name",
  "middle_name",
  "nickname",
  "preferred_username",
  "profile",
  "picture",
  "website",
  "gender",
  "birthdate",
  "zoneinfo",
  "locale",
] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

// Shared between /api/status server route and browser-side status client.
export interface BackendHealthStatus {
  enabled: boolean;
  healthy: boolean | null;
  /**
   * Backend product name derived from the /health response body.
   * Examples: "identuum-idp-oss", "identuum-idp-ce", "identuum-ag-oss",
   * "identuum-idp" (monolith/unknown), "identuum-ag" (legacy fallback).
   */
  product: string;
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
 *
 * "local" is returned when only the local site-admin password login is
 * available (post-`--setup`, pre-federation steady state for local/demo
 * stacks). "mixed" covers local + any federated provider as well as the
 * legacy "identuum_idp + external_oidc" case.
 */
export type AgAuthMode =
  | "unknown"
  | "bootstrap"
  | "local"
  | "external_oidc"
  | "identuum_idp"
  | "mixed";

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
  /** Absent when no federated providers configured. True = usable. False = feature gate blocks /login. */
  login_available?: boolean;
  /** Present only when login_available=false. "forbidden_feature" = OIDCFederation not licensed. */
  unavailable_reason?: string;
  /**
   * True after `identuum-ag --setup` has stored a password_hash on the
   * site-admin row; false (or absent) before setup. Independent of
   * login_available — local login is not gated by OIDCFederation.
   */
  local_login_available?: boolean;
  /**
   * Relative path on the AG identity surface that accepts the password
   * POST when local_login_available is true. AG advertises "/login".
   * Absent when local login is unavailable.
   */
  local_login_url?: string;
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
  /**
   * True when AG advertises the local site-admin password login as usable
   * (post-`--setup`). False when AG reports the site-admin row is not yet
   * configured. null when AG is not reachable or did not include the field
   * (older AG versions without the local-login signal).
   *
   * Use this to decide whether to render the local password form prominently
   * vs. show a "site-admin not yet configured" hint. The form should still
   * accept input when the signal is null (defensive fallback for older AG
   * builds); only suppress the form when local_login_available is explicitly
   * false.
   */
  local_login_available: boolean | null;
  /**
   * Relative path on the AG identity surface for local password POST.
   * Present only when local_login_available is true and the value passed
   * isRelativeLoginUrl() (rejects absolute URLs to block open-redirect
   * injection from a compromised AG backend). Null otherwise.
   *
   * The browser never POSTs to this path directly; it submits to the
   * same-origin /api/ag/login route which proxies the request to the AG
   * identity surface server-to-server.
   */
  local_login_url: string | null;
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

/**
 * Capability flags returned by a backend's GET /api/v1/component endpoint.
 * All fields are optional so older backends that omit the capabilities object
 * remain fully compatible. These are product/API capability flags, not
 * commercial license entitlements.
 */
export interface ComponentCapabilities {
  identity_provider?: boolean;
  agent_governance?: boolean;
  component_discovery?: boolean;
  license_status?: boolean;
  auth_provider_discovery?: boolean;
  organization_export?: boolean;
  organization_import?: boolean;
  organization_linking?: boolean;
  hitl?: boolean;
  agent_sessions?: boolean;
  account_self_service?: boolean;
  user_sessions?: boolean;
  mfa?: boolean;
  webauthn?: boolean;
  authorization_server?: boolean;
  oauth_clients?: boolean;
  api_resources?: boolean;
  service_accounts?: boolean;
  scope_templates?: boolean;
  org_roles?: boolean;
  protocol_settings?: boolean;
  client_credentials?: boolean;
  dynamic_client_registration?: boolean;
  scim?: boolean;
  audit_log?: boolean;
  audit_chain?: boolean;
  reporting?: boolean;
  anomaly_detection?: boolean;
  observability?: boolean;
}

/**
 * Safe license fields returned by a backend's GET /api/v1/component endpoint.
 * Only non-sensitive metadata is included. Raw payload, ciphertext, entitlement
 * list, features, customer identifiers, and key material are never present here.
 */
export interface ComponentLicenseInfo {
  status: string;
  product?: string;
  tier?: string;
  expires_at?: string | null;
  days_remaining?: number | null;
  deployment_mode?: string | null;
  license_type?: string | null;
}

/** Raw shape returned by a backend's GET /api/v1/component endpoint. */
export interface ComponentDiscoveryResponse {
  component: string;
  product?: string;
  version: string;
  status: string;
  capability_map_schema_version?: string;
  /** Raw backend capabilities object — pass through extractCapabilities() before use. */
  capabilities?: Record<string, unknown>;
  auth: Record<string, string>;
  license: ComponentLicenseInfo;
}

/** UI-side state for one discovered backend component. */
export interface BackendComponentState {
  configured: boolean;
  reachable: boolean;
  usable: boolean;
  component: string | null;
  /**
   * Backend product / distribution identifier, when the backend reports
   * the optional `product` field (e.g. AG OSS returns `"identuum-ag-oss"`,
   * IDP OSS returns `"identuum-idp-oss"`). null when the backend does not
   * report it or is unreachable. Distinct from `license.product`, which is
   * the product field on the license snapshot.
   *
   * Optional on the type so older test fixtures that pre-date this field
   * continue to compile; readers must guard for `undefined` in addition to
   * `null`. New production code paths set it explicitly to `null` when
   * absent, never `undefined`.
   */
  product?: string | null;
  /**
   * Capability map schema version (e.g. `"ag-capabilities.v1"`,
   * `"idp-capabilities.v1"`). null when the backend does not report it
   * or is unreachable. Surfacing this lets the UI display the schema
   * generation it negotiated without inventing one.
   *
   * Optional on the type for the same reason as `product` above.
   */
  capability_map_schema_version?: string | null;
  version: string | null;
  status: string | null;
  capabilities: ComponentCapabilities;
  auth: Record<string, string>;
  license: ComponentLicenseInfo;
  error: DiscoveryErrorCode | null;
  /**
   * Appliance first-run setup state probed from `GET /api/setup/status`
   * when the IDP component is usable. Defined only on the IDP slot.
   *
   *   { state: "setup_required" }   — the IDP wants the operator to run
   *                                    the first-run wizard at /setup.
   *   { state: "setup_complete" }   — setup is finished; the wizard is
   *                                    not shown.
   *   null                          — older OSS backend without the
   *                                    setup endpoint, OR the probe
   *                                    failed (treated as unknown; the
   *                                    UI does NOT redirect to /setup).
   *   undefined                     — IDP unreachable / never probed.
   *
   * The field is intentionally separate from `status` (which carries
   * the backend's free-form status string for /system/info) and from
   * the capability map (which surfaces feature booleans).
   */
  setupState?: IdpSetupStateView | null;
  /**
   * Appliance OSS-to-CE upgrade state probed from
   * `GET /api/upgrade/status` when the IDP component is reachable.
   * Defined only on the IDP slot.
   *
   *   { state: "oss_database_detected" | "upgrade_required" | … } —
   *     CE binary observes a database that needs the upgrade wizard
   *     (or is already current — the field still carries the state
   *     so post-upgrade screens can render correctly).
   *   null — older OSS backend without the upgrade endpoint, OR the
   *          probe failed (treated as unknown; the UI does NOT
   *          redirect to /upgrade).
   *   undefined — IDP unreachable / never probed.
   *
   * The probe is intentionally tolerant: any non-200 response, any
   * malformed body, or an unknown state value collapses to null so
   * the runtime composition layer never makes a false "upgrade
   * needed" verdict from a probe that cannot speak the contract.
   */
  upgradeState?: IdpUpgradeStateView | null;
}

/**
 * IdpSetupStateView mirrors the safe subset of the IDP's
 * GET /api/setup/status response surfaced to the UI. It carries no
 * setup token, no token hash, no organization id, no admin email, and
 * no signing-key material — only the booleans the wizard needs to
 * decide what to render. New fields landing on the backend status
 * shape can be added here as the wizard grows.
 */
export interface IdpSetupStateView {
  state: "setup_required" | "setup_complete";
  setupTokenRequired: boolean;
  firstSigningKeyExists: boolean;
  siteAdminExists: boolean;
  firstOrganizationExists: boolean;
  nextAction: string;
}

/**
 * IdpUpgradeStateView mirrors the safe subset of the CE binary's
 * `GET /api/upgrade/status` response surfaced to the UI. It carries
 * no DB URL, no SQL error, no schema fragment, and no upgrade-token
 * plaintext — only the explicit named state and the wire booleans
 * the runtime composition layer needs to decide whether to route
 * the operator to /upgrade before /setup.
 *
 * `null` on a BackendComponentState means either the backend does
 * not expose `/api/upgrade/status` (older OSS) OR the probe failed;
 * the UI does NOT redirect to `/upgrade` in either case.
 */
export interface IdpUpgradeStateView {
  state:
    | "fresh_ce"
    | "oss_database_detected"
    | "upgrade_required"
    | "ce_migrations_current"
    | "upgrade_complete"
    | "incompatible_database"
    | "database_unreachable"
    | "backup_required";
  distribution: string;
  upgradeAvailable: boolean;
  ceMigrationsCurrent: boolean;
  ossDatabaseDetected: boolean;
  backupRequired: boolean;
  nextAction: string;
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
  /**
   * AG CE-specific org-link availability verdict (2026-07-08).
   * Composed server-side by `getServerRuntimeState` from BOTH the
   * AG component capability map (already on `components.ag`) AND a
   * live call to AG CE's `GET /api/v1/org-link/readiness` probe.
   *
   * Surfaced here so any UI consumer can read the verdict from a
   * single composed state object instead of re-fetching the
   * readiness probe per page. Pages MUST consume this field rather
   * than calling `fetchAGOrgLinkReadiness` + `deriveAGCEOrgLinkAvailability`
   * directly — that duplication was removed in the 2026-07-08
   * runtime composition slice.
   *
   * `null` when AG is NOT enabled in the UI runtime config — there
   * is no AG backend to probe, so there is no AG CE-side verdict
   * to compute. Consumers MUST handle the null case (typically by
   * skipping the availability render entirely).
   *
   * Optional on the type so older test fixtures that pre-date this
   * field continue to compile; new production code paths always
   * set it explicitly to a verdict object or `null`, never
   * `undefined`. Readers must guard for `undefined` in addition
   * to `null` when consuming pre-existing fixtures.
   */
  agCEOrgLinkAvailability?: AGCEOrgLinkAvailability | null;
}

// ── AG PolicyPacks org-level settings ───────────────────────────────────────

/**
 * AG PolicyPacks org-level settings returned by
 * GET /api/v1/policy-packs/settings (AG management surface).
 *
 * policy_packs_enabled=true  → enforcement is active for this organization.
 * policy_packs_enabled=false → enforcement is off (operator-disabled).
 *
 * A 503 from the AG backend when reading settings means the lookup failed
 * and enforcement falls back to fail-closed (active). That is distinct from
 * the operator having set policy_packs_enabled=false.
 *
 * No credential material, tokens, or internal config appears in this type.
 */
export interface AgPolicyPackSettings {
  policy_packs_enabled: boolean;
}

// ── Cross-system organization export candidates ─────────────────────────────

/**
 * UI-safe shape for a single organization export candidate returned by either
 * IDP's or AG's GET /api/v1/organizations/export-candidates endpoint.
 *
 * Organization-only: this type never carries users, org admins, emails,
 * passwords, MFA state, role bindings, sessions, tokens, license payloads,
 * signatures, ciphertext, internal config, or audit metadata. Unknown keys
 * present on the raw backend response are discarded by the parser.
 */
export interface OrganizationExportCandidate {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  source_component: string;
  /**
   * Set on AG-side candidates when the AG organization's idp_org_id is
   * non-null. UUID string when linked, "" or absent when unlinked.
   * IDP-side candidates always have "" because IDP does not own AG link state.
   */
  linked_idp_organization_id?: string;
  /**
   * "linked" when linked_idp_organization_id is non-empty, "unlinked"
   * otherwise. Absent (omit) for sources that do not report link state
   * (e.g. IDP).
   */
  link_status?: string;
}

/**
 * UI-safe shape of the GET /api/v1/organizations/export-candidates response.
 * The parser projects the raw backend body onto this shape and discards any
 * additional top-level keys.
 */
export interface OrganizationExportCandidatesResponse {
  organizations: OrganizationExportCandidate[];
}

// ── AG import-from-IDP dry-run preview ──────────────────────────────────────

/**
 * Action category for an AG import-from-IDP dry-run preview. Mirrors the
 * AG backend's OrgImportFromIDPAction enum.
 */
export type OrgImportDryRunAction =
  | "create_ag_organization"
  | "link_existing_ag_organization"
  | "noop"
  | "rejected";

/**
 * Status for an AG import-from-IDP dry-run preview. Mirrors the AG backend's
 * OrgImportFromIDPStatus enum.
 *
 * In dry-run mode the backend uses "planned" for prospective writes and
 * "already_linked" / "rejected" for idempotent or duplicate states; the UI
 * never expects "created" or "linked" because those only appear under
 * dry_run=false.
 */
export type OrgImportDryRunStatus = "planned" | "already_linked" | "rejected";

/**
 * UI-safe shape of the AG POST /api/v1/organizations/import-from-idp
 * response, restricted to dry-run mode. Parser discards unknown keys and
 * sensitive fields; dry_run is always true on a valid parse.
 */
export interface OrgImportDryRunResponse {
  dry_run: true;
  action: OrgImportDryRunAction;
  idp_organization_id: string;
  ag_organization_id: string;
  ag_organization_created: boolean;
  link_created: boolean;
  status: OrgImportDryRunStatus;
  message: string;
}

/**
 * Discriminated result returned by dryRunImportIDPOrganizationToAG().
 * Failure reasons are operator-safe opaque strings — never the raw backend
 * error body.
 *
 *   - not_configured: AG is not enabled in the UI runtime config.
 *   - not_ready:      AG discovery reports the backend is not usable.
 *   - unauthorized:   no operator session, or AG returned 401/403.
 *   - unsafe_response: AG responded 2xx but the body parsed to dry_run!=true
 *                     or was malformed — treated as failed to avoid trusting
 *                     a response that might describe a mutation.
 *   - failed:         non-2xx, network failure, timeout, or parse error.
 */
export type OrgImportDryRunResult =
  | { ok: true; response: OrgImportDryRunResponse }
  | {
      ok: false;
      reason: "not_configured" | "not_ready" | "unauthorized" | "unsafe_response" | "failed";
    };

// ── AG import-from-IDP EXECUTE (dry_run=false) ──────────────────────────────

/**
 * Status values that may appear on an executed (dry_run=false) import response.
 *
 * Distinct from OrgImportDryRunStatus:
 *   - "created" appears only when a new AG organization was actually created.
 *   - "linked" appears only when an existing AG organization was actually
 *     linked to an IDP organization.
 *   - "already_linked" is idempotent — the link was already in place before
 *     the request.
 *   - "rejected" is a safe failure (e.g. duplicate name) reported by the
 *     backend as a structured response rather than a non-2xx error.
 *
 * "planned" is intentionally excluded — it should never appear in an execute
 * response. The parser rejects it.
 */
export type OrgImportExecuteStatus = "created" | "linked" | "already_linked" | "rejected";

/**
 * UI-safe shape of an AG POST /api/v1/organizations/import-from-idp execute
 * response (dry_run=false). Parser discards unknown keys and sensitive fields;
 * dry_run is always false on a valid execute parse.
 */
export interface OrgImportExecuteResponse {
  dry_run: false;
  action: OrgImportDryRunAction;
  idp_organization_id: string;
  ag_organization_id: string;
  ag_organization_created: boolean;
  link_created: boolean;
  status: OrgImportExecuteStatus;
  message: string;
}

/**
 * Discriminated result returned by executeImportIDPOrganizationToAG().
 *
 *   - not_configured / not_ready / unauthorized / failed: same semantics as
 *     the dry-run path.
 *   - unsafe_response: 2xx body did not parse to dry_run=false safe shape —
 *     treated as failed defensively.
 *   - confirmation_missing: the server action did not receive the required
 *     confirm_scope="organization_only" form field. Surfaced only by the
 *     server-action wrapper; the underlying client never produces it.
 */
export type OrgImportExecuteResult =
  | { ok: true; response: OrgImportExecuteResponse }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "not_ready"
        | "unauthorized"
        | "unsafe_response"
        | "failed"
        | "confirmation_missing"
        | "invalid_request";
    };

// ── Org-admin Domains ────────────────────────────────────────────────────────

/**
 * UI-safe projection of a single row in organization_domains.
 *
 * Mirrors the IDP `types.OrganizationDomainInfo` wire shape exactly. The
 * struct intentionally does NOT carry `verification_token_hash` — the
 * stored hash is service-internal and never leaves the API surface. The
 * raw verification token also does not appear here; it surfaces exactly
 * once on `OrganizationDomainChallenge.record_value` / `.token` in the
 * add-domain response.
 */
export interface OrganizationDomainInfo {
  id: string;
  organization_id: string;
  domain: string;
  is_primary: boolean;
  verified: boolean;
  /** ISO timestamp when the row was verified; absent on pending rows. */
  verified_at: string | null;
  /** ISO timestamp when the pending verification token expires; absent on verified rows. */
  verification_token_expires_at: string | null;
  verification_attempts: number;
  created_at: string;
  updated_at: string;
}

/**
 * One-shot DNS-TXT challenge envelope returned by POST add-domain.
 *
 * The `record_value` (and the bare `token`) are the ONLY places the raw
 * verification token appears in the API surface. The UI must:
 *   - render them only on the immediate add-domain response,
 *   - not persist them to local/sessionStorage,
 *   - not log them,
 *   - not show them on later page reloads,
 *   - not attempt to fetch them again.
 */
export interface OrganizationDomainChallenge {
  record_name: string;
  record_type: string;
  record_value: string;
  token: string;
  /** ISO timestamp when the challenge expires. */
  expires_at: string;
}

/** GET list response. */
export interface OrganizationDomainListResponse {
  domains: OrganizationDomainInfo[];
  count: number;
}

/**
 * Read-shape returned by every per-row endpoint that does NOT mint a
 * challenge (verify, list-one).
 */
export interface OrganizationDomainResponse {
  domain: OrganizationDomainInfo;
}

/**
 * Single-shot envelope returned by POST add-domain. The challenge field
 * is the only place the raw token appears in the API surface; every
 * other response shape hides it.
 */
export interface OrganizationDomainChallengeResponse {
  domain: OrganizationDomainInfo;
  challenge: OrganizationDomainChallenge;
}

/** DELETE response shape. */
export interface OrganizationDomainDeleteResponse {
  deleted: boolean;
}

/** Set-primary response shape. */
export interface OrganizationDomainSetPrimaryResponse {
  primary: boolean;
}
