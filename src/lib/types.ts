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
  /**
   * True when an org_admin exists but none are verified (the expired-pending
   * recovery state). NOT a complete "can assign" signal on its own — when no
   * admin row exists, this is false even though assignment is allowed.
   * UI gates should use `!has_admin || can_assign_admin`.
   */
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
  /**
   * True when an org_admin exists but none are verified (the expired-pending
   * recovery state). NOT a complete "can assign" signal on its own — when no
   * admin row exists, this is false even though assignment is allowed.
   * UI gates should use `!has_admin || can_assign_admin`.
   */
  can_assign_admin: boolean;
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
  version: string;
  status: string;
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
  version: string | null;
  status: string | null;
  capabilities: ComponentCapabilities;
  auth: Record<string, string>;
  license: ComponentLicenseInfo;
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
export type OrgImportDryRunStatus =
  | "planned"
  | "already_linked"
  | "rejected";

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
export type OrgImportExecuteStatus =
  | "created"
  | "linked"
  | "already_linked"
  | "rejected";

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
