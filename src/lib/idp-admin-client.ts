/**
 * Server-side client for IdP admin APIs.
 *
 * Forwards request cookies to the IdP backend (via internal_base_url when
 * configured). Must never expose internal_base_url, cookies, or tokens to
 * browser-side code or client component props.
 *
 * Server-only: client components may not import this module.
 */
import "server-only";

import { cookies } from "next/headers";
import { classifyDomainVerifyErrorKind } from "./domain-verification-errors";
import { type IDPStatusClassification, type IDPStatusKind, classifyIDPStatus } from "./idp-status";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type {
  CreateOrgClientOptions,
  CreatedOrgClient,
  GetOrgProtocolSettingsResult,
  OrgAPIResourceItem,
  OrgAPIResourceScope,
  OrgClientItem,
  OrgClientListResult,
  OrgDetail,
  OrgListItem,
  OrgListResult,
  OrgProtocolSettings,
  OrgServiceAccountItem,
  OrgUserItem,
  OrganizationDomainChallenge,
  OrganizationDomainChallengeResponse,
  OrganizationDomainDeleteResponse,
  OrganizationDomainInfo,
  OrganizationDomainListResponse,
  OrganizationDomainResponse,
  OrganizationDomainSetPrimaryResponse,
  UpdateOrgClientOptions,
  UserProfile,
  UserRole,
} from "./types";

// ── Types for create organization ────────────────────────────────────────────

export interface CreateOrgOptions {
  name: string;
  domain: string;
  admin_email?: string;
}

/**
 * Discriminated union returned by createOrganization().
 *
 * activation_token semantics (from backend dispatchActivation()):
 *   - Only returned when the IdP is in air-gapped mode (IsAirGapped = true).
 *   - In normal mode the backend clears the token and relies on email delivery.
 *   - The token is a raw JWT (not a full URL).
 *   - Expiry: 24 hours from creation.
 *   - Must be delivered out-of-band to the org_admin — UI shows it only once.
 */
export type CreateOrgResult =
  | {
      ok: true;
      id: string;
      name: string;
      domain: string;
      /** Present only in air-gapped mode. Raw JWT; not a URL. */
      activationToken: string | null;
    }
  | { ok: false; status: number; conflict: boolean };

/**
 * Server-side IdP auth headers for the BFF. Returns BOTH credentials:
 *   - Cookie: the full httpOnly cookie jar — the IdP's cookie-aware endpoints
 *     (e.g. /api/v1/validate) read the session from here.
 *   - Authorization: Bearer <access_token> — released OSS resource endpoints
 *     (clients, users, organizations, service-accounts, …) establish the
 *     request principal ONLY from the Authorization header: mw.BearerPrincipal
 *     never reads the access_token cookie, so a cookie-only call 401s. The
 *     bearer is lifted from the SAME httpOnly access_token cookie.
 *
 * The token stays server-side: this module is `server-only`, and the header is
 * attached only to the server→IdP fetch — it is never returned to the browser,
 * never serialised into a response body, and never logged. Sending both
 * credentials is safe: each endpoint reads only the one it understands.
 * `extra` merges caller-supplied headers (e.g. Content-Type).
 */
async function idpAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const all = (await cookies()).getAll();
  const headers: Record<string, string> = {
    ...extra,
    Cookie: all.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  const accessToken = all.find((c) => c.name === "access_token")?.value;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function safeErrorBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

async function classifyAdminReadFailure(res: Response): Promise<{
  status: number;
  forbidden: boolean;
  featureUnavailable: boolean;
}> {
  const body = res.status === 402 || res.status === 403 ? await safeErrorBody(res) : undefined;
  const classified = classifyIDPStatus(res.status, body);
  return {
    status: res.status,
    forbidden: classified.kind === "forbidden",
    featureUnavailable: classified.kind === "feature_absent" || classified.kind === "not_licensed",
  };
}

/**
 * Fetches the paginated organization list for site_admin.
 *
 * Returns null when:
 * - Runtime config is missing or IdP is disabled (AG-only deployment)
 * - The IdP returns a non-200 response (auth error, network failure, etc.)
 *
 * Sanitizes the response to a narrow UI-safe shape before returning.
 *
 * Field mapping note — is_claimed → has_admin:
 *   The IdP read handlers project is_claimed = (live org_admin count > 0)
 *   and can_assign_admin = (is_claimed && verified count == 0) onto the
 *   org payloads. Despite the name "is_claimed", the field means "has at
 *   least one live org_admin".
 *
 *   ABSENT ≠ NEGATIVE (PHANTOM-NO-ADMIN): the backend emits both fields
 *   pointer+omitempty — when the payload does not carry them (older
 *   backend, unwired counter, count error) the mapping below preserves
 *   `undefined` instead of coercing to false. Boolean()-coercing the
 *   absent is_claimed here was the root cause of every org rendering
 *   "No active administrator".
 */
export async function listOrganizations(opts?: {
  offset?: number;
  limit?: number;
  deleted?: "false" | "true" | "all";
}): Promise<OrgListResult | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  // offset and limit are validated by the caller (page.tsx) before reaching here.
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(opts?.limit ?? 25)));

  const params = new URLSearchParams();
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  params.set("deleted", opts?.deleted ?? "false");

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations?${params.toString()}`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();

    // Sanitize to the UI-safe OrgListItem shape.
    // Strip every field not explicitly included here.
    // biome-ignore lint/suspicious/noExplicitAny: raw API item before sanitization
    const organizations: OrgListItem[] = (data.organizations ?? []).map((o: any) => ({
      id: String(o.id ?? ""),
      name: String(o.name ?? ""),
      domain: String(o.domain ?? ""),
      slug: String(o.org_slug ?? ""),
      active: Boolean(o.active),
      deleted: Boolean(o.deleted),
      // is_claimed means "has at least one live org_admin" (see mapping note
      // above). ABSENT stays undefined — never coerced to false.
      has_admin: typeof o.is_claimed === "boolean" ? o.is_claimed : undefined,
      // can_assign_admin: true when site_admin recovery delegation is allowed (same
      // semantics as GenerateClaimToken — expired pending invitations don't block).
      can_assign_admin: typeof o.can_assign_admin === "boolean" ? o.can_assign_admin : undefined,
      created_at: String(o.created_at ?? ""),
      updated_at: String(o.updated_at ?? ""),
    }));

    return {
      organizations,
      // Released OSS paginates as { total, page, page_size }; legacy shapes
      // carried total_count/count/offset/limit. Tolerate both.
      total_count: Number(data.total_count ?? data.total ?? organizations.length),
      count: Number(data.count ?? organizations.length),
      offset: Number(
        data.offset ?? (data.page && data.page_size ? (data.page - 1) * data.page_size : 0)
      ),
      limit: Number(data.limit ?? data.page_size ?? limit),
    };
  } catch {
    return null;
  }
}

/**
 * Creates a new organization (site_admin only).
 *
 * The IdP service layer enforces role === site_admin and returns 403 otherwise.
 * The backend also returns 409 when domain is already in use.
 *
 * If admin_email is supplied, the IdP atomically creates the org plus an
 * initial org_admin user and sends an activation email. If omitted, a "shell"
 * organization (inactive, no admin) is created.
 *
 * Returns a narrow UI-safe shape on success — never raw backend fields.
 * On failure, returns { ok: false, status, conflict }.
 */
export async function createOrganization(opts: CreateOrgOptions): Promise<CreateOrgResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, conflict: false };

  // Canonicalize domain to lowercase before sending (mirrors backend behavior).
  const body: Record<string, unknown> = {
    name: opts.name,
    domain: opts.domain.toLowerCase().trim(),
  };
  if (opts.admin_email) body.admin_email = opts.admin_email;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 409) return { ok: false, status: 409, conflict: true };
    if (!res.ok) return { ok: false, status: res.status, conflict: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS returns the created org top-level; tolerate a wrapped shape.
    const org = data.organization ?? data ?? {};

    // Sanitize to UI-safe shape. activation_token is conditionally included:
    // - non-empty string → air-gapped mode; must be delivered out-of-band to admin.
    // - empty/absent → normal mode; email was dispatched (or attempted).
    const rawToken = typeof data.activation_token === "string" ? data.activation_token.trim() : "";
    return {
      ok: true,
      id: String(org.id ?? ""),
      name: String(org.name ?? ""),
      domain: String(org.domain ?? ""),
      activationToken: rawToken || null,
    };
  } catch {
    return { ok: false, status: 0, conflict: false };
  }
}

// ── Get organization by ID (for edit form prefill) ────────────────────────────

/**
 * Fetches a single organization by UUID for the edit form.
 * Returns null when:
 * - Runtime config is missing or IdP is disabled
 * - The IdP returns non-200 (404, 403, network error)
 * Sanitizes to OrgDetail — a narrow UI-safe shape for the edit form.
 */
export async function getOrganization(id: string): Promise<OrgDetail | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(id)}`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS GET /organizations/:id returns the org fields at the TOP
    // LEVEL (safeOrganization), not wrapped; tolerate both shapes.
    const o = data.organization ?? data ?? {};

    // Sanitize to the UI-safe OrgDetail shape.
    return {
      id: String(o.id ?? ""),
      name: String(o.name ?? ""),
      domain: String(o.domain ?? ""),
      slug: String(o.org_slug ?? ""),
      active: Boolean(o.active),
      deleted: Boolean(o.deleted),
      auth_policy: String(o.auth_policy ?? "local_only"),
      mfa_policy: String(o.mfa_policy ?? "optional"),
      // ABSENT ≠ NEGATIVE: undefined admin state stays undefined so the
      // detail page renders "status unavailable", never "No administrator".
      has_admin: typeof o.is_claimed === "boolean" ? o.is_claimed : undefined,
      can_assign_admin: typeof o.can_assign_admin === "boolean" ? o.can_assign_admin : undefined,
      allow_public_registration: Boolean(o.allow_public_registration),
      require_registration_approval: Boolean(o.require_registration_approval),
      created_at: String(o.created_at ?? ""),
      updated_at: String(o.updated_at ?? ""),
    };
  } catch {
    return null;
  }
}

// ── Own organization (org_admin self-service) ─────────────────────────────────

/**
 * Fetches the calling org_admin's own organization from
 * GET /api/v1/organizations/current.
 *
 * The backend derives the organization from the session cookie — no org ID is
 * passed from the client, so this cannot be used to read another org's data.
 * Returns null when the IdP is unavailable or the session is absent/expired.
 */
export async function getOwnOrganization(): Promise<OrgDetail | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations/current`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS GET /organizations/current returns the org fields at the TOP
    // LEVEL (id, name, domain, org_slug, active, mfa_policy, …), not wrapped in
    // an `organization` envelope. Tolerate both shapes so a future wrapped
    // response still round-trips.
    const o = data.organization ?? data ?? {};

    return {
      id: String(o.id ?? ""),
      name: String(o.name ?? ""),
      domain: String(o.domain ?? ""),
      slug: String(o.org_slug ?? ""),
      active: Boolean(o.active),
      deleted: Boolean(o.deleted),
      auth_policy: String(o.auth_policy ?? "local_only"),
      mfa_policy: String(o.mfa_policy ?? "optional"),
      // /current does not emit admin state today; preserve absence.
      has_admin: typeof o.is_claimed === "boolean" ? o.is_claimed : undefined,
      // org_admin views their own org; recovery affordance is not applicable here.
      can_assign_admin: false,
      allow_public_registration: Boolean(o.allow_public_registration),
      require_registration_approval: Boolean(o.require_registration_approval),
      created_at: String(o.created_at ?? ""),
      updated_at: String(o.updated_at ?? ""),
    };
  } catch {
    return null;
  }
}

// ── Update organization ───────────────────────────────────────────────────────

export interface UpdateOrgOptions {
  name?: string;
  active?: boolean;
  auth_policy?: string;
  mfa_policy?: string;
  /**
   * Organization-level invite policy fields. Together with
   * `require_registration_approval` these control the three operator-
   * visible modes (`invite-only`, `public-with-approval`, `public-immediate`)
   * that the org-admin Invite policy form on /org-admin/settings exposes.
   * Both fields are already accepted by the IDP wire shape
   * (`types.UpdateOrganizationRequest`); omitting either leaves the
   * corresponding column unchanged on the backend.
   */
  allow_public_registration?: boolean;
  require_registration_approval?: boolean;
}

export type UpdateOrgResult =
  | { ok: true; id: string; name: string }
  | { ok: false; status: number; notFound: boolean; conflict: boolean };

/**
 * Updates an organization (site_admin only).
 * Uses PUT /api/v1/organizations/:id. All fields are optional; omitting a
 * field leaves it unchanged on the backend.
 * Returns { ok: false, notFound: true } on 404, { ok: false, conflict: true }
 * on 409 (duplicate domain), and { ok: false } for other errors.
 */
export async function updateOrganization(
  id: string,
  opts: UpdateOrgOptions
): Promise<UpdateOrgResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, notFound: false, conflict: false };

  // Build the request body with only the fields that are provided.
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.active !== undefined) body.active = opts.active;
  if (opts.auth_policy !== undefined) body.auth_policy = opts.auth_policy;
  if (opts.mfa_policy !== undefined) body.mfa_policy = opts.mfa_policy;
  if (opts.allow_public_registration !== undefined)
    body.allow_public_registration = opts.allow_public_registration;
  if (opts.require_registration_approval !== undefined)
    body.require_registration_approval = opts.require_registration_approval;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, status: 404, notFound: true, conflict: false };
    if (res.status === 409) return { ok: false, status: 409, notFound: false, conflict: true };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, conflict: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS returns the updated org top-level; tolerate a wrapped shape.
    const org = data.organization ?? data ?? {};

    return {
      ok: true,
      id: String(org.id ?? id),
      name: String(org.name ?? ""),
    };
  } catch {
    return { ok: false, status: 0, notFound: false, conflict: false };
  }
}

// ── Delete organization (soft-delete) ─────────────────────────────────────────

export type DeleteOrgResult =
  | { ok: true }
  | { ok: false; status: number; notFound: boolean; hasSiteAdmins: boolean };

/**
 * Soft-deletes an organization (site_admin only).
 *
 * - DELETE /api/v1/organizations/:id
 * - Idempotent: already-deleted org returns ok:true (backend treats as success).
 * - Returns { ok: false, hasSiteAdmins: true } on HTTP 403 — the backend
 *   returns 403 both for permission errors and for orgs with site_admins.
 *   The UI shows a tailored message.
 * - System org is protected at the backend and returns 403.
 */
export async function deleteOrganization(id: string): Promise<DeleteOrgResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, notFound: false, hasSiteAdmins: false };

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, status: 404, notFound: true, hasSiteAdmins: false };
    // 403 covers both permission errors and ErrOrgHasSiteAdmins — treat as hasSiteAdmins
    // for the most actionable error message; the backend logs the distinction.
    if (res.status === 403) return { ok: false, status: 403, notFound: false, hasSiteAdmins: true };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, hasSiteAdmins: false };

    return { ok: true };
  } catch {
    return { ok: false, status: 0, notFound: false, hasSiteAdmins: false };
  }
}

// ── Restore organization ──────────────────────────────────────────────────────

export type RestoreOrgResult = { ok: true } | { ok: false; status: number; notFound: boolean };

/**
 * Restores a soft-deleted organization (site_admin only).
 *
 * - POST /api/v1/organizations/:id/restore
 * - System org and already-active orgs: backend returns 404 or error.
 * - Returns { ok: false, notFound: true } on HTTP 404.
 */
export async function restoreOrganization(id: string): Promise<RestoreOrgResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, notFound: false };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(id)}/restore`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    if (res.status === 404) return { ok: false, status: 404, notFound: true };
    if (res.status === 403) return { ok: false, status: 403, notFound: false };
    if (!res.ok) return { ok: false, status: res.status, notFound: false };

    return { ok: true };
  } catch {
    return { ok: false, status: 0, notFound: false };
  }
}

// ── Assign first org_admin via claim/invitation ───────────────────────────────

export interface AssignOrgAdminOptions {
  /** Organization UUID */
  orgId: string;
  /**
   * Email of the prospective org_admin. Optional.
   * When non-empty the token is bound to this address and the link is emailed
   * if SMTP is configured. When empty the token is not email-bound; the
   * site_admin delivers the link out-of-band and the claimant enters any
   * valid email on the claim page.
   */
  recipientEmail: string;
}

export type AssignOrgAdminResult =
  | {
      ok: true;
      /**
       * One-time claim URL the prospective org_admin must open.
       * Always returned by the backend (not limited to air-gapped mode).
       * Do NOT put this in query params, localStorage, or sessionStorage.
       * Show only in the immediate success panel and discard on navigation.
       */
      claimUrl: string;
      /** ISO timestamp when the claim URL expires (48 h from creation). */
      expiresAt: string;
      /** true if the backend successfully emailed the claim URL to the recipient. */
      emailSent: boolean;
    }
  | {
      ok: false;
      status: number;
      /** 404 – org not found or soft-deleted */
      notFound: boolean;
      /** 409 – org already has at least one active org_admin */
      alreadyHasAdmin: boolean;
    };

/**
 * Generates a one-time claim/invitation URL for the first org_admin of an
 * organization that currently has no active org_admin.
 *
 * Backend endpoint: POST /api/v1/organizations/:id/invitations
 * Requires: site_admin session, org must exist, org must have no active admin.
 *
 * The backend always returns the claim URL in the response body. It also
 * attempts to email the URL to recipient_email if SMTP is configured.
 * Email failure is non-fatal — the claim URL is always available in the response.
 *
 * The claim URL is in the format {idpBaseURL}/claim?token={token}.
 * Note: this URL pattern may be a browser-facing endpoint on the IdP; the UI
 * shows it as a copyable value for the site_admin to deliver out-of-band when
 * email is not configured.
 */
export async function assignOrgAdmin(opts: AssignOrgAdminOptions): Promise<AssignOrgAdminResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, notFound: false, alreadyHasAdmin: false };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(opts.orgId)}/invitations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await idpAuthHeaders()),
        },
        body: JSON.stringify({ recipient_email: opts.recipientEmail.toLowerCase().trim() }),
        cache: "no-store",
      }
    );

    if (res.status === 404)
      return { ok: false, status: 404, notFound: true, alreadyHasAdmin: false };
    if (res.status === 409)
      return { ok: false, status: 409, notFound: false, alreadyHasAdmin: true };
    if (res.status === 403)
      return { ok: false, status: 403, notFound: false, alreadyHasAdmin: false };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, alreadyHasAdmin: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();

    // Return only the UI-safe fields — never raw token strings in error paths.
    return {
      ok: true,
      claimUrl: String(data.claim_url ?? ""),
      expiresAt: String(data.expires_at ?? ""),
      emailSent: Boolean(data.email_sent),
    };
  } catch {
    return { ok: false, status: 0, notFound: false, alreadyHasAdmin: false };
  }
}

// ── Site-admin self-service password change ───────────────────────────────────

export type ChangePasswordResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Changes the authenticated user's own password.
 *
 * Works for any authenticated human session (site_admin, org_admin, org_user).
 * Forwards session cookies server-side so the IdP can authenticate the request.
 * The IdP derives the target user from the session — the caller never submits a
 * user ID. After a successful change, the IdP revokes ALL sessions for that user,
 * including the current one.
 *
 * Security:
 *   - Passwords are never logged.
 *   - Uses idpBaseUrl() (internal URL when available) — not the browser proxy path.
 *   - Must only be called from a "use server" context (this module is server-only).
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      cache: "no-store",
    });

    if (res.ok) return { ok: true };

    // Extract a safe displayable message from the backend response.
    // 400 responses carry policy-violation messages that are safe to show
    // (e.g. "Password is too short"). All other statuses fall back to a
    // generic message so internal server state is never exposed.
    let message = "Could not change password. Check your current password and try again.";
    if (res.status === 400) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
        const body: any = await res.json();
        if (typeof body?.message === "string" && body.message) {
          message = body.message;
        }
      } catch {
        // ignore parse error — fall back to default message
      }
    }

    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Please try again." };
  }
}

// ── Org-admin invite user ────────────────────────────────────────────────────

export interface InviteOrgUserOptions {
  /** Optional. When provided, the invitation is bound to this email address. */
  email?: string;
  /** Optional display name. */
  name?: string;
  /** Role for the invited user. Only org_user is supported in the first pass. */
  role: "org_user";
}

export type InviteOrgUserResult =
  | {
      ok: true;
      /** Full invitation setup URL (e.g. https://ui.example.com/invitation?token=...) */
      setupUrl: string;
      /** Whether an invitation email was dispatched. */
      emailSent: boolean;
    }
  | { ok: false; status: number; message: string };

/**
 * Creates a new org_user invitation in the org_admin's own organization.
 *
 * Backend endpoint: POST /api/v1/users
 * Requires: org_admin session cookie.
 *
 * When email is omitted, the backend generates a no-email invitation and the
 * setup URL must be delivered out-of-band by the org_admin.
 * When email is provided and SMTP is configured, the backend will attempt
 * email delivery; the setup URL is always returned in the response.
 *
 * The returned setupUrl points to the identuum-ui /invitation page.
 */
export async function inviteOrgUser(opts: InviteOrgUserOptions): Promise<InviteOrgUserResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }

  try {
    const body: Record<string, unknown> = { role: opts.role };
    if (opts.email) body.email = opts.email.toLowerCase().trim();
    if (opts.name) body.name = opts.name.trim();

    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      return {
        ok: true,
        setupUrl: typeof data.activation_url === "string" ? data.activation_url : "",
        emailSent: Boolean(data.email_sent),
      };
    }

    const message =
      typeof data.message === "string" && data.message.length > 0
        ? data.message
        : "Could not create invitation.";

    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Please try again." };
  }
}

// ── Own profile (any authenticated user) ────────────────────────────────────

/**
 * Fetches the calling user's own profile from GET /api/v1/profile.
 *
 * Safe for use by any authenticated role (org_user, org_admin, site_admin).
 * Returns null when the IdP is unavailable, the session is absent/expired, or
 * the fetch fails. Never throws.
 *
 * The response is sanitized to UserProfile — no password hashes, MFA secrets,
 * recovery codes, activation tokens, session IDs, or internal UUIDs are included.
 */
export async function getOwnProfile(): Promise<UserProfile | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/profile`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const u = data?.user;
    if (!u) return null;

    return {
      email: String(u.email ?? ""),
      name: typeof u.name === "string" && u.name.length > 0 ? u.name : null,
      role: (u.role as UserRole) ?? "org_user",
      organization_name:
        typeof u.organization_name === "string" && u.organization_name.length > 0
          ? u.organization_name
          : null,
      domain: typeof u.domain === "string" && u.domain.length > 0 ? u.domain : null,
      mfa_enabled: Boolean(u.mfa_enabled),
      email_verified: Boolean(u.email_verified),
    };
  } catch {
    return null;
  }
}

// ── Org-admin user list ──────────────────────────────────────────────────────

/**
 * Fetches the user list for the authenticated org_admin's organization.
 *
 * The backend derives the organization scope from the session cookie — no
 * org ID is passed in the request. org_admin sessions are automatically
 * scoped to their own organization by the backend handler.
 *
 * Returns null when the IdP is unavailable or the request fails.
 *
 * The response is sanitized to OrgUserItem[] — no password hashes, MFA
 * secrets, recovery codes, or internal fields are included.
 */
export async function listOrgUsers(): Promise<OrgUserItem[] | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users?limit=200&sort=created_at&order=asc`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const users = Array.isArray(data.users) ? data.users : [];

    return users.map(
      // biome-ignore lint/suspicious/noExplicitAny: raw API response item
      (u: any): OrgUserItem => ({
        id: String(u.id ?? ""),
        email: String(u.email ?? ""),
        name: typeof u.name === "string" && u.name.length > 0 ? u.name : null,
        role: (u.role as UserRole) ?? "org_user",
        active: Boolean(u.active),
        deleted: Boolean(u.deleted),
        mfa_enabled: Boolean(u.mfa_enabled),
        email_verified: Boolean(u.email_verified),
        created_at: String(u.created_at ?? ""),
        last_login_at: typeof u.last_login_at === "string" ? u.last_login_at : null,
        invitation_pending: Boolean(u.invitation_pending),
        invitation_email_bound: Boolean(u.invitation_email_bound),
        banned: Boolean(u.banned),
      })
    );
  } catch {
    return null;
  }
}

// ── Reset user MFA (org_admin — same-org org_user targets only) ──────────────

/**
 * Clears a same-org org_user's TOTP/MFA enrollment and revokes all their sessions.
 *
 * Backend: POST /api/v1/users/:id/mfa/reset
 * Auth: org_admin session; M2M denied.
 * Policy: target must be org_user in same org; org_admin and site_admin targets blocked.
 * Effect: MFA enrollment cleared, sessions revoked. No credential material in response.
 */
export async function resetUserMFA(
  userId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/mfa/reset`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.ok) return { ok: true };
    let message = "Could not reset MFA enrollment. Try again.";
    try {
      // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
      const body: any = await res.json();
      if (typeof body?.message === "string" && body.message) message = body.message;
    } catch {
      // ignore parse error — fall back to generic message
    }
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Get single org user by ID ────────────────────────────────────────────────

/**
 * Fetches a single user by UUID for the org_admin user detail page.
 *
 * Backend: GET /api/v1/users/:id
 * Org scoping is enforced at the service layer (ErrForbidden for cross-org IDs).
 * Returns null on 403/404/error.
 *
 * The response is sanitized to OrgUserItem — no passwords, MFA secrets,
 * recovery codes, session tokens, or internal fields are included.
 */
export async function getOrgUserById(id: string): Promise<OrgUserItem | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(id)}`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS returns the user top-level; tolerate a wrapped shape.
    const u = data.user ?? data ?? {};

    return {
      id: String(u.id ?? ""),
      email: String(u.email ?? ""),
      name: typeof u.name === "string" && u.name.length > 0 ? u.name : null,
      role: (u.role as UserRole) ?? "org_user",
      active: Boolean(u.active),
      deleted: Boolean(u.deleted),
      mfa_enabled: Boolean(u.mfa_enabled),
      email_verified: Boolean(u.email_verified),
      created_at: String(u.created_at ?? ""),
      last_login_at: typeof u.last_login_at === "string" ? u.last_login_at : null,
      invitation_pending: Boolean(u.invitation_pending),
      invitation_email_bound: Boolean(u.invitation_email_bound),
      banned: Boolean(u.banned),
    };
  } catch {
    return null;
  }
}

// ── Regenerate invitation / setup link ───────────────────────────────────────

/**
 * Regenerates a setup link for a pending (unclaimed) invited user.
 *
 * Backend: POST /api/v1/users/:id/setup/resend
 * Auth: org_admin (own org) or site_admin session.
 * Returns the new activation_url (one-time setup link). Never logs the URL.
 */
export async function regenerateInvitation(
  userId: string
): Promise<{ ok: true; setupUrl: string } | { ok: false; status: number; message: string }> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/setup/resend`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    // biome-ignore lint/suspicious/noExplicitAny: raw API response
    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      return {
        ok: true,
        setupUrl: typeof data.activation_url === "string" ? data.activation_url : "",
      };
    }

    const message =
      typeof data.message === "string" && data.message.length > 0
        ? data.message
        : "Failed to regenerate setup link.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Please try again." };
  }
}

// ── Org-admin user lifecycle ──────────────────────────────────────────────────

/**
 * Enables or disables a user by setting active=true/false on the backend.
 *
 * Backend: PUT /api/v1/users/:id  { "active": bool }
 * The backend enforces that org_admin can only update users in their own org
 * and cannot disable the last active org_admin.
 *
 * Never pass the org ID or actor claims from the browser — the backend derives
 * authorization from the session cookie.
 */
export async function setUserActive(
  userId: string,
  active: boolean
): Promise<{ ok: boolean; status: number; message: string }> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify({ active }),
      cache: "no-store",
    });

    if (!res.ok) {
      // biome-ignore lint/suspicious/noExplicitAny: raw error response
      const errData: any = await res.json().catch(() => ({}));
      const message =
        typeof errData.message === "string" && errData.message.length > 0
          ? errData.message
          : active
            ? "Failed to enable user."
            : "Failed to disable user.";
      return { ok: false, status: res.status, message };
    }

    return { ok: true, status: 200, message: active ? "User enabled." : "User disabled." };
  } catch {
    return { ok: false, status: 0, message: "Network error. Please try again." };
  }
}

// ── Session management (self-service) ────────────────────────────────────────

/**
 * Opaque session representation for display in the account settings sessions list.
 * The `id` field is used only as a revocation handle in server actions — it must
 * not be rendered as visible text in the UI.
 * Backend: GET /api/v1/sessions (RequireScopesAny with user bypass).
 * Returns 403 for site_admin — by design (cross-tenant isolation).
 */
export interface SessionItem {
  /** Used as revocation handle; not shown in rendered text. */
  id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  /** Client IP at session creation. Null for pre-migration sessions. */
  ip_address: string | null;
  /** Truncated User-Agent (≤200 chars). Null for pre-migration sessions. */
  user_agent: string | null;
  is_active: boolean;
  /** True when this session is the one making the current request. */
  is_current: boolean;
}

export type ListSessionsResult =
  | { ok: true; sessions: SessionItem[] }
  | { ok: false; status: number; forbidden: boolean };

export async function listOwnSessions(): Promise<ListSessionsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, forbidden: false };

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/sessions`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (res.status === 403) return { ok: false, status: 403, forbidden: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false };

    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};
    const raw: Record<string, unknown>[] = Array.isArray(body.sessions)
      ? body.sessions.filter(isRecord)
      : [];

    const sessions: SessionItem[] = raw.map((s) => ({
      id: String(s.id ?? ""),
      created_at: String(s.created_at ?? ""),
      expires_at: String(s.expires_at ?? ""),
      last_used_at: s.last_used_at ? String(s.last_used_at) : null,
      ip_address: s.ip_address ? String(s.ip_address) : null,
      user_agent: s.user_agent ? String(s.user_agent) : null,
      is_active: Boolean(s.is_active),
      is_current: Boolean(s.is_current),
    }));

    return { ok: true, sessions };
  } catch {
    return { ok: false, status: 0, forbidden: false };
  }
}

export type RevokeSessionResult =
  | { ok: true }
  | { ok: false; status: number; forbidden: boolean; notFound: boolean };

/**
 * Revokes a session by its UUID.
 * Backend: POST /api/v1/revoke with { session_id }.
 * Ownership is enforced at the service layer (actor.UserID must own the session).
 * Returns 403 for site_admin — by design.
 */
export async function revokeOwnSession(sessionId: string): Promise<RevokeSessionResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, notFound: false };

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify({ session_id: sessionId }),
      cache: "no-store",
    });

    if (res.status === 403) return { ok: false, status: 403, forbidden: true, notFound: false };
    if (res.status === 404) return { ok: false, status: 404, forbidden: false, notFound: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false, notFound: false };

    return { ok: true };
  } catch {
    return { ok: false, status: 0, forbidden: false, notFound: false };
  }
}

// ── Audit log (read-only) ─────────────────────────────────────────────────────

/**
 * An audit event projected from the OSS wire (GET /api/v1/audit/events).
 * AUDIT-DETAILS-1: the mapper reads ONLY the backend's contract keys — no
 * invented `summary` (the wire never carried one; it was always null) — and
 * surfaces the details the backend already ships (outcome, actor/request/
 * correlation ids, user_agent, metadata) for the read-only expandable view.
 * The backend's own redaction owns what enters an audit row; the UI carries no
 * token / cookie / session material because the wire does not.
 *
 * Absent (omitempty) columns are `null`, never zero-faked.
 */
export interface AuditEventItem {
  id: string | null;
  created_at: string;
  event_type: string;
  outcome: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_type: string;
  actor_role: string | null;
  actor_organization_id: string | null;
  subject_id: string | null;
  subject_email: string | null;
  subject_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  correlation_id: string | null;
  priority: string;
  metadata: Record<string, unknown> | null;
}

export type ListAuditEventsResult =
  | { ok: true; events: AuditEventItem[]; total_count: number; page: number; page_size: number }
  | { ok: false; status: number; featureUnavailable: boolean; forbidden: boolean };

/**
 * Lists audit events for the authenticated admin.
 * site_admin sees all events; org_admin sees only their org's events (enforced at service layer).
 * Returns featureUnavailable=true when the Enterprise/CE license gate or absent OSS endpoint
 * blocks the surface.
 *
 * Filter params are forwarded verbatim to the backend after server-side sanitization in the
 * calling page. No client-side filtering is performed.
 */
export async function listAuditEvents(opts?: {
  page?: number;
  pageSize?: number;
  /** Backend ?event_type= — trimmed, max 64 chars */
  eventType?: string | null;
  /** Backend ?subject_type= — trimmed, max 32 chars */
  subjectType?: string | null;
  /** Backend ?subject_id= — UUID of the target user/resource */
  subjectId?: string | null;
  /** Backend ?start_date= — RFC3339 ISO string */
  startDate?: string | null;
  /** Backend ?end_date= — RFC3339 ISO string */
  endDate?: string | null;
  /** Backend ?order= asc|desc. Default desc. */
  sortOrder?: "asc" | "desc";
}): Promise<ListAuditEventsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, featureUnavailable: false, forbidden: false };

  // Released OSS mounts GET /api/v1/audit/events with limit/offset paging and
  // start/end RFC3339 bounds (parseAuditFilters); page/page_size are translated
  // here. subject_type is not a released filter — subject scoping travels via
  // subject_id only.
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (opts?.eventType) params.set("event_type", opts.eventType);
  if (opts?.subjectId) params.set("subject_id", opts.subjectId);
  if (opts?.startDate) params.set("start", opts.startDate);
  if (opts?.endDate) params.set("end", opts.endDate);

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/audit/events?${params}`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }

    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};
    const raw: Record<string, unknown>[] = Array.isArray(body.events)
      ? body.events.filter(isRecord)
      : [];

    // AUDIT-DETAILS-1: project ONLY the backend's contract keys (auditEventView
    // in internal/handlers/audit_events.go). No invented `summary`. Absent
    // omitempty columns map to null, never zero-faked.
    const events: AuditEventItem[] = raw.map((e) => ({
      id: e.id ? String(e.id) : null,
      created_at: String(e.created_at ?? ""),
      event_type: String(e.event_type ?? ""),
      outcome: e.outcome ? String(e.outcome) : null,
      actor_id: e.actor_id ? String(e.actor_id) : null,
      actor_email: e.actor_email ? String(e.actor_email) : null,
      actor_type: String(e.actor_type ?? ""),
      actor_role: e.actor_role ? String(e.actor_role) : null,
      actor_organization_id: e.actor_organization_id ? String(e.actor_organization_id) : null,
      subject_id: e.subject_id ? String(e.subject_id) : null,
      subject_email: e.subject_email ? String(e.subject_email) : null,
      subject_type: e.subject_type ? String(e.subject_type) : null,
      ip_address: e.ip_address ? String(e.ip_address) : null,
      user_agent: e.user_agent ? String(e.user_agent) : null,
      request_id: e.request_id ? String(e.request_id) : null,
      correlation_id: e.correlation_id ? String(e.correlation_id) : null,
      priority: String(e.priority ?? "normal"),
      metadata: isRecord(e.metadata) ? e.metadata : null,
    }));

    return {
      ok: true,
      events,
      // Released OSS reports { events, has_more } with no absolute total; the
      // returned batch length is the honest floor when total_count is absent.
      total_count: typeof body.total_count === "number" ? body.total_count : events.length,
      page: typeof body.page === "number" ? body.page : page,
      page_size: typeof body.page_size === "number" ? body.page_size : pageSize,
    };
  } catch {
    return { ok: false, status: 0, featureUnavailable: false, forbidden: false };
  }
}

// ── Audit event types metadata ────────────────────────────────────────────────

export interface AuditEventTypeOption {
  value: string;
  label: string;
}

export interface AuditEventTypeGroupFromAPI {
  label: string;
  types: AuditEventTypeOption[];
}

/**
 * Fetches the grouped list of known audit event types from the backend.
 * Backend: GET /api/v1/audit/event-types
 * Requires Enterprise/CE commercial capability (inherits AppendOnlyAudit gate from audit group).
 * Returns null on any failure; callers should fall back to the static list.
 */
export async function listAuditEventTypes(): Promise<AuditEventTypeGroupFromAPI[] | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/audit/event-types`, {
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const body = isRecord(data) ? data : {};
    if (!Array.isArray(body.groups)) return null;
    const groups: Record<string, unknown>[] = body.groups.filter(isRecord);
    return groups.map((g) => {
      const types: Record<string, unknown>[] = Array.isArray(g.types)
        ? g.types.filter(isRecord)
        : [];
      return {
        label: String(g.label ?? ""),
        types: types.map((t) => ({
          value: String(t.value ?? ""),
          label: String(t.label ?? ""),
        })),
      };
    });
  } catch {
    return null;
  }
}

// ── site_admin → org_admin MFA recovery ───────────────────────────────────────
//
// Calls the IdP's POST /api/v1/users/:id/recovery/reset-mfa endpoint added
// for identuum-20260527-org-admin-credential-mfa-recovery. The endpoint
// is the operator-recovery primitive for an org_admin who:
//   - lost their TOTP device, or
//   - was created before MFA enrollment was enforced and therefore cannot
//     reach the new MFA-required login gate (the pre-enforcement class
//     of legacy accounts).
//
// After a successful reset the target's row has MFAEnabled=false and
// MFASecret=NULL. The next successful password login routes the user
// into TOTP enrollment via the existing mfa_enrollment_required wire
// signal — no recovery URL or email is generated by this primitive, so
// it is air-gapped-friendly. (Air-gapped operators can run this reset
// from the site-admin UI and tell the target to sign in normally
// out-of-band; the UI's login flow handles the rest.)

export type ResetOrgAdminMFAResult =
  | { ok: true }
  | { ok: false; status: number; message: string; notFound?: boolean };

/**
 * Site-admin operator-recovery: clears the named org_admin's TOTP and
 * revokes their existing sessions. The target signs in with their
 * existing password afterwards and is automatically guided through
 * fresh TOTP enrollment via the login flow.
 *
 * Returns:
 *   - { ok: true }                              on success
 *   - { ok: false, status: 403, ... }           if actor is not site_admin
 *                                                or target is not org_admin
 *   - { ok: false, status: 404, notFound: true } if target is deleted /
 *                                                  banned / not found
 *   - { ok: false, status: 0, ... }             on network error
 */
export async function resetOrgAdminMFA(userID: string): Promise<ResetOrgAdminMFAResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IDP is not enabled in this deployment." };
  }

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userID)}/recovery/reset-mfa`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    if (res.status === 404) {
      return { ok: false, status: 404, notFound: true, message: "User not found." };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        message:
          "Only site_admin may reset an org_admin's MFA. Target must be an active org_admin.",
      };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: "MFA reset failed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Org-admin recovery candidates listing ─────────────────────────────────────
//
// site_admin-only read surface paired with resetOrgAdminMFA(). Powers the
// "Administrator recovery" section on the site-admin organization detail
// page: lists the org_admin rows of an organisation so the operator can
// pick a target without hunting user_ids in psql. Backend enforces the
// "Blind Sovereign Bunker" exception narrowly — only org_admin rows
// return, and the projection never exposes password hashes, MFA secret
// ciphertext, or any non-recovery-relevant credential material.

/** A safe org_admin recovery candidate row, as returned by the IDP. */
export interface OrgAdminRecoveryCandidate {
  id: string;
  email: string;
  name?: string;
  role: "org_admin";
  mfa_enabled: boolean;
  email_verified: boolean;
  active: boolean;
  deleted: boolean;
  created_at?: string;
  last_login_at?: string;
}

export type ListOrgAdminsForRecoveryResult =
  | { ok: true; admins: OrgAdminRecoveryCandidate[] }
  | { ok: false; status: number; message: string; notFound?: boolean };

/**
 * Lists the org_admin rows of an organisation for the site_admin
 * recovery surface. Returns ok=true with `admins` on success; on any
 * non-OK status returns a discriminated error.
 *
 * The result never contains password hashes, MFA secrets, claim
 * tokens, or any other credential material — the IDP-side projection
 * already strips those. Render the rows directly in the UI.
 */
export async function listOrgAdminsForRecovery(
  orgID: string
): Promise<ListOrgAdminsForRecoveryResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IDP is not enabled in this deployment." };
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/admin-recovery-candidates`,
      {
        method: "GET",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 404) {
      return { ok: false, status: 404, notFound: true, message: "Organization not found." };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        message: "Only site_admin may list org_admin recovery candidates.",
      };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: "Failed to load administrators." };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
    const body: any = await res.json();
    if (!Array.isArray(body?.admins)) {
      return { ok: false, status: 502, message: "Unexpected response from server." };
    }
    return { ok: true, admins: body.admins as OrgAdminRecoveryCandidate[] };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Org-admin Domains ────────────────────────────────────────────────────────
//
// Five endpoints back the org-admin Domains card on /org-admin/settings:
//
//   GET    /api/v1/organizations/:id/domains                       (list)
//   POST   /api/v1/organizations/:id/domains                       (add → challenge)
//   POST   /api/v1/organizations/:id/domains/:domain_id/verify     (verify)
//   DELETE /api/v1/organizations/:id/domains/:domain_id            (remove)
//   POST   /api/v1/organizations/:id/domains/:domain_id/primary    (set-primary)
//
// Conventions:
//   - Org ID is in the URL path. Add-domain body must NEVER include
//     organization_id — the backend rejects unknown fields strictly.
//   - Domain strings are trimmed + lowercased before sending. The backend
//     does the same; we send canonical form so the wire mirrors storage.
//   - All responses are sanitized to a narrow ok-shape so a regression
//     that leaked a verification_token_hash or any other internal field
//     would be statically impossible (the TS type excludes it).

function sanitizeDomainInfo(o: unknown): OrganizationDomainInfo {
  // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
  const r = (o ?? {}) as any;
  return {
    id: String(r.id ?? ""),
    organization_id: String(r.organization_id ?? ""),
    domain: String(r.domain ?? ""),
    is_primary: Boolean(r.is_primary),
    verified: Boolean(r.verified),
    verified_at: typeof r.verified_at === "string" ? r.verified_at : null,
    verification_token_expires_at:
      typeof r.verification_token_expires_at === "string" ? r.verification_token_expires_at : null,
    verification_attempts: Number(r.verification_attempts ?? 0),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

export type ListOrganizationDomainsResult =
  | { ok: true; data: OrganizationDomainListResponse }
  | { ok: false; status: number };

/**
 * Lists the calling org_admin's organization domains.
 *
 * Backend: GET /api/v1/organizations/:id/domains. Authorization is
 * org-scoped; the IDP service rejects cross-org reads. The caller must
 * supply the orgID derived server-side from getOwnOrganization (NEVER
 * from the browser).
 *
 * The response is sanitized to the wire shape — no verification token
 * hash, no internal fields. Returns { ok: false } on any non-2xx.
 */
export async function listOrganizationDomains(
  orgID: string
): Promise<ListOrganizationDomainsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503 };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/domains`,
      {
        method: "GET",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (!res.ok) return { ok: false, status: res.status };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS returns { count, organization_domains: [...] }; tolerate the
    // legacy `domains` key too.
    const raw = Array.isArray(data?.organization_domains)
      ? data.organization_domains
      : Array.isArray(data?.domains)
        ? data.domains
        : [];
    return {
      ok: true,
      data: {
        domains: raw.map(sanitizeDomainInfo),
        count: Number(data?.count ?? raw.length),
      },
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

export type AddOrganizationDomainResult =
  | { ok: true; data: OrganizationDomainChallengeResponse }
  | { ok: false; status: number; conflict: boolean; invalid: boolean };

/**
 * Adds a new pending organization domain and mints the DNS-TXT
 * challenge. The challenge `record_value` (and the bare `token`) are
 * surfaced in the returned envelope — they appear ONLY on this immediate
 * response and never on subsequent list/verify reads. Callers must show
 * them once and discard.
 *
 * Backend: POST /api/v1/organizations/:id/domains.
 * The body carries only `{ domain }`. Org ID lives in the path and is
 * re-authorized by the service. Adding `organization_id` to the body
 * would be rejected by StrictBindJSON; the helper enforces this contract
 * by typing the body locally rather than accepting an open record.
 */
export async function addOrganizationDomain(
  orgID: string,
  domain: string
): Promise<AddOrganizationDomainResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, conflict: false, invalid: false };

  // Canonicalize: trim + lowercase. Matches backend NormalizeDomain.
  const body: { domain: string } = { domain: domain.toLowerCase().trim() };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/domains`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await idpAuthHeaders()),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );

    if (res.status === 400) return { ok: false, status: 400, conflict: false, invalid: true };
    if (res.status === 409) return { ok: false, status: 409, conflict: true, invalid: false };
    if (!res.ok) return { ok: false, status: res.status, conflict: false, invalid: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    // Released OSS returns { organization_domain, txt_record_name,
    // txt_record_value, verification_token } top-level; a legacy shape nested
    // the same data as { domain, challenge: {...} }. Tolerate both.
    const ch = (data?.challenge ?? {}) as Partial<OrganizationDomainChallenge>;
    return {
      ok: true,
      data: {
        domain: sanitizeDomainInfo(data?.organization_domain ?? data?.domain),
        challenge: {
          record_name: String(data?.txt_record_name ?? ch.record_name ?? ""),
          record_type: String(ch.record_type ?? "TXT"),
          record_value: String(data?.txt_record_value ?? ch.record_value ?? ""),
          token: String(data?.verification_token ?? ch.token ?? ""),
          expires_at: String(
            ch.expires_at ?? data?.organization_domain?.verification_token_expires_at ?? ""
          ),
        },
      },
    };
  } catch {
    return { ok: false, status: 0, conflict: false, invalid: false };
  }
}

export type VerifyOrganizationDomainResult =
  | { ok: true; data: OrganizationDomainResponse }
  | {
      ok: false;
      status: number;
      /** True when the lookup itself failed (resolver / network / NX). */
      lookupFailed: boolean;
      /** True when the TXT record was not found at the expected name. */
      recordNotFound: boolean;
      /** True when a TXT record exists but does not match the expected value. */
      mismatch: boolean;
    };

/**
 * Verifies a pending organization domain by performing a real DNS TXT
 * lookup at `_identuum-challenge.<domain>`. Reads the challenge token
 * hash from the row (the raw token is not stored), hashes the TXT
 * value, and compares.
 *
 * Backend: POST /api/v1/organizations/:id/domains/:domain_id/verify.
 *
 * The discriminated error surface lets the UI render specific copy for
 * the three operator-correctable outcomes: lookup failure (transient or
 * NX), record-not-found (operator must publish the TXT), and mismatch
 * (operator pasted the wrong token). The raw token / hash never appears
 * in the result.
 */
export async function verifyOrganizationDomain(
  orgID: string,
  domainID: string
): Promise<VerifyOrganizationDomainResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return {
      ok: false,
      status: 503,
      lookupFailed: false,
      recordNotFound: false,
      mismatch: false,
    };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/domains/${encodeURIComponent(domainID)}/verify`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    // Discriminate verifier failure kinds from the structured
    // `error_kind` field on the IDP envelope. The pure classifier
    // lives in ./domain-verification-errors so it is unit-testable
    // without spinning up a fetch / cookies / runtime-config stack.
    // Anything other than the four documented kinds collapses to
    // the all-false / generic-copy branch the action layer renders.
    //
    // The brittle substring parsing of the backend `message` is
    // intentionally gone — the helper does not even read the field.
    if (!res.ok) {
      let lookupFailed = false;
      let recordNotFound = false;
      let mismatch = false;
      try {
        // biome-ignore lint/suspicious/noExplicitAny: error envelope shape
        const body: any = await res.json();
        const classification = classifyDomainVerifyErrorKind(body?.error_kind);
        switch (classification.kind) {
          case "lookup_failed":
            lookupFailed = true;
            break;
          case "record_not_found":
            recordNotFound = true;
            break;
          case "mismatch":
            mismatch = true;
            break;
          case "generic":
            // All three discriminators stay false → the action layer
            // renders ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorGeneric.
            break;
        }
      } catch {
        // Parse failure → generic copy (helper would have returned
        // {kind: "generic"} too; the catch just short-circuits the
        // attempt to read the body).
      }
      return { ok: false, status: res.status, lookupFailed, recordNotFound, mismatch };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return { ok: true, data: { domain: sanitizeDomainInfo(data?.domain) } };
  } catch {
    return {
      ok: false,
      status: 0,
      lookupFailed: true,
      recordNotFound: false,
      mismatch: false,
    };
  }
}

export type DeleteOrganizationDomainResult =
  | { ok: true; data: OrganizationDomainDeleteResponse }
  | { ok: false; status: number; notFound: boolean; primary: boolean };

/**
 * Removes a non-primary organization domain.
 *
 * Backend: DELETE /api/v1/organizations/:id/domains/:domain_id.
 * The backend refuses to remove the primary row (409) — the UI also
 * hides the affordance for primary rows, but the wire is the final gate.
 */
export async function deleteOrganizationDomain(
  orgID: string,
  domainID: string
): Promise<DeleteOrganizationDomainResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, notFound: false, primary: false };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/domains/${encodeURIComponent(domainID)}`,
      {
        method: "DELETE",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    if (res.status === 404) return { ok: false, status: 404, notFound: true, primary: false };
    if (res.status === 409) return { ok: false, status: 409, notFound: false, primary: true };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, primary: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return { ok: true, data: { deleted: Boolean(data?.deleted) } };
  } catch {
    return { ok: false, status: 0, notFound: false, primary: false };
  }
}

export type SetPrimaryOrganizationDomainResult =
  | { ok: true; data: OrganizationDomainSetPrimaryResponse }
  | { ok: false; status: number; notFound: boolean; notVerified: boolean };

/**
 * Promotes a verified, non-primary organization domain to primary.
 *
 * Backend: POST /api/v1/organizations/:id/domains/:domain_id/primary.
 * The backend refuses to promote an unverified row (400 / 409 depending
 * on state); the UI also hides the affordance for unverified rows.
 */
export async function setPrimaryOrganizationDomain(
  orgID: string,
  domainID: string
): Promise<SetPrimaryOrganizationDomainResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, notFound: false, notVerified: false };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/domains/${encodeURIComponent(domainID)}/primary`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    if (res.status === 404) return { ok: false, status: 404, notFound: true, notVerified: false };
    if (res.status === 400 || res.status === 409)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        notVerified: true,
      };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, notVerified: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return { ok: true, data: { primary: Boolean(data?.primary) } };
  } catch {
    return { ok: false, status: 0, notFound: false, notVerified: false };
  }
}

// ── Org-admin Applications (OAuth clients) ──────────────────────────────────
//
// Backed by GET /api/v1/clients. The IDP's ClientService.ListClients
// filters by actor.OrganizationID when the actor is RoleOrgAdmin, so
// org_admin sessions only see their own organization's clients. site_admin
// sessions see clients across all organizations — but the org-admin UI
// surfaces the result through getServerSession's org_admin role gate at
// the layout level, so a site_admin would never reach this UI path.
//
// SECURITY:
//   - The sanitiser EXPLICITLY drops the `client_secret` field from the
//     wire shape even though the list-clients handler does not populate
//     it today. The IDP's ClientResponse declares the field with
//     `omitempty`; a future regression that started populating it on
//     the list path would slip past the wire-level guard but would NOT
//     reach this UI because the sanitiser does not even read the field.
//   - The sanitiser similarly never reads inline JWKS material — only
//     the `jwks_uri` reference is surfaced.
//   - No client secret, signing material, refresh-token, or auth-code
//     value is ever exposed in this code path.

export type ListOwnOrganizationClientsResult =
  | { ok: true; data: OrgClientListResult }
  | { ok: false; status: number };

/**
 * Lists OAuth clients for the calling org_admin's organization.
 *
 * Backend: GET /api/v1/clients. Tenant scope is enforced server-side
 * via ClientService.ListClients's `if actor.Role == RoleOrgAdmin
 * { orgID = &actor.OrganizationID }` branch. The UI MUST not attempt
 * to widen scope by passing a query param; the wire envelope from the
 * IDP carries the operator's scoped result automatically.
 *
 * Returns { ok: false } on any non-2xx so the page can render a safe
 * error state without forwarding backend prose.
 */
export async function listOwnOrganizationClients(opts?: {
  page?: number;
  pageSize?: number;
}): Promise<ListOwnOrganizationClientsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503 };

  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts?.pageSize ?? 50)));

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients?${params.toString()}`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const body: any = await res.json();
    // Released OSS HandleListClients returns { clients, total, page, page_size }.
    const rawList = Array.isArray(body?.clients) ? body.clients : [];

    // Sanitise to the narrow OrgClientItem shape. Explicitly DROP
    // any client_secret / signing-key material even if the wire
    // payload includes it — defence in depth on top of the IDP's
    // own `omitempty` + list-handler omission.
    const clients: OrgClientItem[] = rawList.map(
      // biome-ignore lint/suspicious/noExplicitAny: raw client entry
      (c: any): OrgClientItem => ({
        id: String(c.id ?? ""),
        client_id: String(c.client_id ?? ""),
        name: String(c.name ?? ""),
        is_public: Boolean(c.is_public),
        skip_consent: Boolean(c.skip_consent),
        redirect_uris: Array.isArray(c.redirect_uris)
          ? c.redirect_uris.map((s: unknown) => String(s))
          : [],
        post_logout_redirect_uris: Array.isArray(c.post_logout_redirect_uris)
          ? c.post_logout_redirect_uris.map((s: unknown) => String(s))
          : [],
        allowed_audiences: Array.isArray(c.allowed_audiences)
          ? c.allowed_audiences.map((s: unknown) => String(s))
          : [],
        scope: typeof c.scope === "string" ? c.scope : "",
        token_endpoint_auth_method:
          typeof c.token_endpoint_auth_method === "string" ? c.token_endpoint_auth_method : "",
        jwks_uri: typeof c.jwks_uri === "string" ? c.jwks_uri : "",
        token_endpoint_auth_signing_alg:
          typeof c.token_endpoint_auth_signing_alg === "string"
            ? c.token_endpoint_auth_signing_alg
            : "",
        organization_id: typeof c.organization_id === "string" ? c.organization_id : null,
        created_at: typeof c.created_at === "string" ? c.created_at : "",
      })
    );

    return {
      ok: true,
      data: {
        clients,
        total: typeof body?.total === "number" ? body.total : clients.length,
        page: typeof body?.page === "number" ? body.page : page,
        page_size: typeof body?.page_size === "number" ? body.page_size : pageSize,
      },
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── Org-admin Get Application by ID (GET /api/v1/clients/:id) ──────────────
//
// The IDP's HandleGetClient + ClientService.GetClient enforce tenant
// scope for org_admin actors: a client whose organization_id does not
// match the actor's session-derived organization id returns 403
// (ErrForbidden) — never a leak. Invalid UUIDs return 400
// (ErrInvalidRequest). Not-found returns 404 (ErrClientNotFound). The
// handler returns ClientResponse but does NOT populate the
// `client_secret` field, and the `omitempty` JSON tag strips it from
// the wire envelope. This wire helper additionally defends in depth
// by explicit field-by-field projection — it never reads
// client_secret / private_key / inline JWKS material even if the IDP
// returned them.

export type GetOrganizationClientByIdResult =
  | { ok: true; data: OrgClientItem }
  | { ok: false; status: number; notFound: boolean; forbidden: boolean; invalid: boolean };

/**
 * Fetches a single OAuth client by UUID for the org-admin detail page.
 *
 * Backend: GET /api/v1/clients/:id. Tenant scope enforced server-side
 * via ClientService.GetClient's `*c.OrganizationID != actor.OrganizationID`
 * branch for RoleOrgAdmin actors. The UI never widens scope.
 *
 * Returns a discriminated error on 400 (invalid UUID), 403 (forbidden
 * — including the cross-org case), 404 (not found), and any other
 * non-2xx so the detail page can render distinct copy without
 * forwarding backend prose.
 */
export async function getOrganizationClientById(
  id: string
): Promise<GetOrganizationClientByIdResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, notFound: false, forbidden: false, invalid: false };
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (res.status === 400)
      return { ok: false, status: 400, notFound: false, forbidden: false, invalid: true };
    if (res.status === 403)
      return { ok: false, status: 403, notFound: false, forbidden: true, invalid: false };
    if (res.status === 404)
      return { ok: false, status: 404, notFound: true, forbidden: false, invalid: false };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
      };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const c: any = await res.json();

    // Sanitise to the same OrgClientItem shape the list path uses.
    // Explicitly DROPS client_secret / private_key / inline JWKS even
    // if the IDP returned them. Defence in depth on top of the IDP-
    // side `omitempty` + handler omission.
    return {
      ok: true,
      data: {
        id: String(c.id ?? ""),
        client_id: String(c.client_id ?? ""),
        name: String(c.name ?? ""),
        is_public: Boolean(c.is_public),
        skip_consent: Boolean(c.skip_consent),
        redirect_uris: Array.isArray(c.redirect_uris)
          ? c.redirect_uris.map((s: unknown) => String(s))
          : [],
        post_logout_redirect_uris: Array.isArray(c.post_logout_redirect_uris)
          ? c.post_logout_redirect_uris.map((s: unknown) => String(s))
          : [],
        allowed_audiences: Array.isArray(c.allowed_audiences)
          ? c.allowed_audiences.map((s: unknown) => String(s))
          : [],
        scope: typeof c.scope === "string" ? c.scope : "",
        token_endpoint_auth_method:
          typeof c.token_endpoint_auth_method === "string" ? c.token_endpoint_auth_method : "",
        jwks_uri: typeof c.jwks_uri === "string" ? c.jwks_uri : "",
        token_endpoint_auth_signing_alg:
          typeof c.token_endpoint_auth_signing_alg === "string"
            ? c.token_endpoint_auth_signing_alg
            : "",
        organization_id: typeof c.organization_id === "string" ? c.organization_id : null,
        created_at: typeof c.created_at === "string" ? c.created_at : "",
      },
    };
  } catch {
    return { ok: false, status: 0, notFound: false, forbidden: false, invalid: false };
  }
}

// ── Org-admin Create Application (POST /api/v1/clients) ────────────────────
//
// The IDP's HandleCreateClient handler injects
// `OrganizationID: &actor.OrganizationID` automatically when the actor's
// role is RoleOrgAdmin. The wire body MUST NOT include `organization_id`
// — the IDP's StrictBindJSON rejects unknown fields, so a regression
// that started sending it would surface as a 400, not a silent
// scope-widen.
//
// The handler uses `RespondWithCreated(c, ClientResponse{..., ClientSecret:
// secret, ...})` — the `client_secret` is populated EXACTLY on this
// response and never on any subsequent read. This wire helper surfaces
// the value through the returned envelope so the server action can
// hand it to the operator in a single-shot UI panel. The value is
// never persisted, never re-fetched, never logged.

export type CreateOrgClientResult =
  | { ok: true; data: CreatedOrgClient }
  | { ok: false; status: number; conflict: boolean; invalid: boolean; message: string };

export async function createOrganizationClient(
  opts: CreateOrgClientOptions
): Promise<CreateOrgClientResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      conflict: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }

  // Construct a STRICT body — no organization_id, no service_account_id,
  // no inline jwks, no token_ttl_secs. Org_admin self-service surface
  // is intentionally narrow; the IDP enforces required name +
  // redirect_uris.
  const body: Record<string, unknown> = {
    name: opts.name,
    redirect_uris: opts.redirect_uris,
  };
  if (opts.post_logout_redirect_uris && opts.post_logout_redirect_uris.length > 0) {
    body.post_logout_redirect_uris = opts.post_logout_redirect_uris;
  }
  if (typeof opts.scope === "string" && opts.scope.length > 0) {
    body.scope = opts.scope;
  }
  if (typeof opts.is_public === "boolean") {
    body.is_public = opts.is_public;
  }
  if (opts.allowed_audiences && opts.allowed_audiences.length > 0) {
    body.allowed_audiences = opts.allowed_audiences;
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 409) {
      return {
        ok: false,
        status: 409,
        conflict: true,
        invalid: false,
        message: "A client with this configuration already exists.",
      };
    }
    if (res.status === 400) {
      // Don't forward the backend prose. The form layer maps to safe copy.
      return {
        ok: false,
        status: 400,
        conflict: false,
        invalid: true,
        message: "The application could not be created with the supplied values.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        conflict: false,
        invalid: false,
        message: "Could not create application. Please try again.",
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();

    return {
      ok: true,
      data: {
        id: String(d.id ?? ""),
        client_id: String(d.client_id ?? ""),
        name: String(d.name ?? ""),
        is_public: Boolean(d.is_public),
        // The IDP returns client_secret ONLY on this response. Surface
        // it through the envelope. Empty string for public clients.
        client_secret: typeof d.client_secret === "string" ? d.client_secret : "",
        redirect_uris: Array.isArray(d.redirect_uris)
          ? d.redirect_uris.map((s: unknown) => String(s))
          : [],
        post_logout_redirect_uris: Array.isArray(d.post_logout_redirect_uris)
          ? d.post_logout_redirect_uris.map((s: unknown) => String(s))
          : [],
        allowed_audiences: Array.isArray(d.allowed_audiences)
          ? d.allowed_audiences.map((s: unknown) => String(s))
          : [],
        scope: typeof d.scope === "string" ? d.scope : "",
        token_endpoint_auth_method:
          typeof d.token_endpoint_auth_method === "string" ? d.token_endpoint_auth_method : "",
        organization_id: typeof d.organization_id === "string" ? d.organization_id : null,
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      conflict: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Org-admin Update Application (PUT /api/v1/clients/:id) ─────────────────
//
// The IDP's HandleUpdateClient enforces tenant scope inside
// service.ClientService.UpdateClient: when actor.Role == RoleOrgAdmin the
// client's organization_id MUST equal actor.OrganizationID, otherwise the
// service returns domain.ErrForbidden which the handler maps to HTTP 403.
// The wire body MUST NOT include `organization_id` — the IDP's
// StrictBindJSON rejects unknown fields, so a regression that started
// sending it would surface as a 400, not a silent scope-widen.
//
// The handler's ClientResponse struct literal OMITS ClientSecret (no
// assignment), and the field carries `json:"client_secret,omitempty"` so
// JSON encoding drops the empty string. The update path NEVER returns
// client_secret — secret rotation is an explicit non-feature of this
// surface. This wire helper defence-in-depth sanitises the response and
// drops any `client_secret` that a regression might re-introduce.

export type UpdateOrgClientResult =
  | { ok: true; data: OrgClientItem }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      conflict: boolean;
      message: string;
    };

export async function updateOrganizationClient(
  id: string,
  opts: UpdateOrgClientOptions
): Promise<UpdateOrgClientResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      conflict: false,
      message: "IdP is not configured.",
    };
  }

  // Construct a STRICT body — only the safe org_admin self-service
  // subset. No organization_id, no client_secret, no service_account_id,
  // no token_endpoint_auth_method, no jwks / jwks_uri / signing_alg, no
  // skip_consent, no token_ttl_secs, no is_public flip. Each field is
  // included only when the caller actually wants to change it; an
  // omitted field is left unchanged on the IDP side (the Go opts.X is
  // pointer-typed and `nil` means leave-unchanged).
  const body: Record<string, unknown> = {};
  if (typeof opts.name === "string") {
    body.name = opts.name;
  }
  if (Array.isArray(opts.redirect_uris)) {
    body.redirect_uris = opts.redirect_uris;
  }
  if (Array.isArray(opts.post_logout_redirect_uris)) {
    body.post_logout_redirect_uris = opts.post_logout_redirect_uris;
  }
  if (typeof opts.scope === "string") {
    body.scope = opts.scope;
  }
  if (Array.isArray(opts.allowed_audiences)) {
    body.allowed_audiences = opts.allowed_audiences;
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 400) {
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        conflict: false,
        message: "The application could not be updated with the supplied values.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        conflict: false,
        message: "You do not have permission to update this application.",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        conflict: false,
        message: "The application was not found.",
      };
    }
    if (res.status === 409) {
      return {
        ok: false,
        status: 409,
        notFound: false,
        forbidden: false,
        invalid: false,
        conflict: true,
        message: "A client with this configuration already exists.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        conflict: false,
        message: "Could not update application. Please try again.",
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const c: any = await res.json();

    // Sanitise to the same OrgClientItem shape the list + detail paths
    // use. Explicitly DROPS client_secret / private_key / inline jwks /
    // signing material even if the IDP returned them. The IDP-side
    // omitempty + ClientResponse-literal omission is the first
    // defence; this sanitiser is the second.
    return {
      ok: true,
      data: {
        id: String(c.id ?? ""),
        client_id: String(c.client_id ?? ""),
        name: String(c.name ?? ""),
        is_public: Boolean(c.is_public),
        skip_consent: Boolean(c.skip_consent),
        redirect_uris: Array.isArray(c.redirect_uris)
          ? c.redirect_uris.map((s: unknown) => String(s))
          : [],
        post_logout_redirect_uris: Array.isArray(c.post_logout_redirect_uris)
          ? c.post_logout_redirect_uris.map((s: unknown) => String(s))
          : [],
        allowed_audiences: Array.isArray(c.allowed_audiences)
          ? c.allowed_audiences.map((s: unknown) => String(s))
          : [],
        scope: typeof c.scope === "string" ? c.scope : "",
        token_endpoint_auth_method:
          typeof c.token_endpoint_auth_method === "string" ? c.token_endpoint_auth_method : "",
        jwks_uri: typeof c.jwks_uri === "string" ? c.jwks_uri : "",
        token_endpoint_auth_signing_alg:
          typeof c.token_endpoint_auth_signing_alg === "string"
            ? c.token_endpoint_auth_signing_alg
            : "",
        organization_id: typeof c.organization_id === "string" ? c.organization_id : null,
        created_at: typeof c.created_at === "string" ? c.created_at : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      conflict: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Org-admin Delete Application (DELETE /api/v1/clients/:id) ──────────────
//
// HARD DELETE on the IDP side: `PgxClientRepository.Delete` runs
// `DELETE FROM oauth_clients WHERE id = $1 AND organization_id = $2` —
// the row is removed, not soft-deleted. The IDP's HandleDeleteClient
// returns 204 No Content on success (no body, no client_secret, no
// secret material of any kind crosses the wire on this path).
//
// Tenant scope is enforced server-side inside
// `ClientService.DeleteClient`: when `actor.Role == RoleOrgAdmin` and
// the client's `OrganizationID` does not equal `actor.OrganizationID`,
// the service returns `domain.ErrForbidden` which the handler maps to
// HTTP 403. `guardSiteAdminTenantClient` adds defence-in-depth.
//
// The service is IDEMPOTENT on already-deleted: when the client row is
// already gone the service returns `nil` and the handler returns 204
// — a double-submit / concurrent-tab race cannot 404. The UI maps 404
// to a not-found result anyway so a stale link from outside the
// active list is still handled cleanly.
//
// The audit event `AuditClientDeleted` is emitted with metadata
// `{client_id, client_name}` (and `source: "mcp"` when the client's
// scope contains an `mcp:` prefix).

export type DeleteOrgClientResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      message: string;
    };

export async function deleteOrganizationClient(id: string): Promise<DeleteOrgClientResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }

  try {
    // DELETE carries NO request body, NO `organization_id`,
    // NO `client_secret`, NO `Authorization`-bearer header that
    // didn't already exist on the session cookie. Tenant scope is
    // enforced by the IDP from the actor's session.
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    // 204 No Content is the success path.
    if (res.status === 204 || res.ok) return { ok: true };

    if (res.status === 400) {
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        message: "The application could not be deleted with the supplied id.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        message: "You do not have permission to delete this application.",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        message: "The application was not found. It may have been removed already.",
      };
    }
    return {
      ok: false,
      status: res.status,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "Could not delete application. Please try again.",
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Org-admin Rotate Application Secret (POST /api/v1/clients/:id/secret/regenerate) ──
//
// The IDP exposes POST `/api/v1/clients/:id/secret/regenerate` (slice
// identuum-20260530-client-secret-rotation-backend-route). Backend
// semantics:
//   - Tenant scope enforced by ClientService.RegenerateClientSecret:
//     when actor.Role == RoleOrgAdmin the target client's
//     OrganizationID MUST equal actor.OrganizationID, otherwise the
//     service returns domain.ErrForbidden (HTTP 403).
//   - Public clients are REJECTED with ErrInvalidRequest → HTTP 400.
//     The wire helper surfaces this as `publicClient: true` so the
//     server action can route a precise operator-facing message.
//   - On success the handler returns the minimal envelope
//     `{id, client_id, name, client_secret}` (RotateClientSecretResponse
//     on the IDP side). client_secret is populated EXACTLY ONCE.
//   - Secret rotation does NOT invalidate already-issued access
//     tokens; new credential-bearing grants using the old secret fail
//     because AuthenticateClient re-checks the stored hash. The UI
//     surfaces this caveat verbatim in the success panel.
//
// The wire helper sends NO request body, NO `Content-Type` header,
// NO `Authorization: Bearer ...` (session cookie is the only auth),
// NO organization_id, NO client_secret. By construction the request
// cannot widen tenant scope or carry secret material outward.

export type RotateOrgClientSecretResult =
  | {
      ok: true;
      data: { id: string; client_id: string; name: string; client_secret: string };
    }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      publicClient: boolean;
      message: string;
    };

export async function rotateOrganizationClientSecret(
  id: string
): Promise<RotateOrgClientSecretResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      publicClient: false,
      message: "IdP is not configured.",
    };
  }

  try {
    // No `body:`, no `Content-Type` header — POST with an empty body.
    // Tenant scope is server-enforced from the actor's session cookie.
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(id)}/secret/regenerate`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );

    if (res.status === 400) {
      // The IDP returns 400 for both invalid UUID AND public-client
      // rejection — distinguishing the two on the wire requires
      // parsing the error body, which we do NOT trust verbatim.
      // Surface a `publicClient` discriminant the action layer uses
      // to render a precise message; the catch-all `invalid` covers
      // any other 400 cause.
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        publicClient: true,
        message: "This client cannot have its secret rotated.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        publicClient: false,
        message: "You do not have permission to rotate this client's secret.",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        publicClient: false,
        message: "The application was not found.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        publicClient: false,
        message: "Could not rotate the client secret. Please try again.",
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();

    // Explicit projection — surface ONLY the four documented fields.
    // Any other key the IDP might return is dropped on the floor.
    // The IDP's RotateClientSecretResponse struct (slice
    // identuum-20260530-client-secret-rotation-backend-route) carries
    // ONLY these four fields by construction; the projection here is
    // defence-in-depth against a future regression.
    return {
      ok: true,
      data: {
        id: String(d.id ?? ""),
        client_id: String(d.client_id ?? ""),
        name: String(d.name ?? ""),
        client_secret: typeof d.client_secret === "string" ? d.client_secret : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      publicClient: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Site-admin observability — read-only helpers (slice identuum-20260530-site-admin-observability-pages) ──
//
// All six helpers below project EXPLICITLY to safe non-secret fields.
// Each backend endpoint was verified during the slice's discovery
// phase to return zero private key material / no inline JWKS private
// fields / no bcrypt hashes / no JWTs / no refresh tokens / no
// database URLs / no Redis URLs / no env var values / no credentials
// of any kind. The wire helpers nevertheless project explicitly so a
// future regression that started populating a sensitive field server-
// side cannot leak through the UI by accident.

// ── Signing keys (GET /api/v1/keys) ────────────────────────────────────────

/**
 * Operator-safe projection of one signing-key row.
 *
 * The IDP backend's `/api/v1/keys` response includes only the
 * documented public-material fields below. This type pins the
 * UI-visible field set; the helper drops any other key the response
 * might carry. PRIVATE key bytes, PEM, seed, and inline JWKS-private
 * components (`d`, `p`, `q`, `dp`, `dq`, `qi`, `k`) are NEVER read
 * or surfaced by the projection.
 */
export interface SigningKeyItem {
  kid: string;
  algorithm: string;
  state: string;
  created_at: string;
  activated_at: string | null;
  rotated_at: string | null;
  expires_at: string | null;
  public_key: string;
}

export type ListSigningKeysResult =
  | { ok: true; keys: SigningKeyItem[]; count: number }
  | { ok: false; status: number; forbidden: boolean };

export async function listSigningKeys(): Promise<ListSigningKeysResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, forbidden: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/keys`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (res.status === 403) return { ok: false, status: 403, forbidden: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawKeys = Array.isArray(d?.keys) ? d.keys : [];
    const keys: SigningKeyItem[] = rawKeys.map((k: Record<string, unknown>) => ({
      kid: typeof k.kid === "string" ? k.kid : "",
      algorithm: typeof k.algorithm === "string" ? k.algorithm : "",
      state: typeof k.state === "string" ? k.state : "",
      created_at: typeof k.created_at === "string" ? k.created_at : "",
      activated_at: typeof k.activated_at === "string" ? k.activated_at : null,
      rotated_at: typeof k.rotated_at === "string" ? k.rotated_at : null,
      expires_at: typeof k.expires_at === "string" ? k.expires_at : null,
      public_key: typeof k.public_key === "string" ? k.public_key : "",
    }));
    return { ok: true, keys, count: typeof d?.count === "number" ? d.count : keys.length };
  } catch {
    return { ok: false, status: 0, forbidden: false };
  }
}

// ── Anomaly (GET /api/v1/anomaly/events + /api/v1/anomaly/stats) ──────────

export interface AnomalyEventItem {
  id: string;
  organization_id: string;
  score: number;
  detection_method: string;
  created_at: string;
}

export type ListAnomalyEventsResult =
  | { ok: true; events: AnomalyEventItem[] }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function listAnomalyEvents(): Promise<ListAnomalyEventsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/anomaly/events`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawList = Array.isArray(d?.data) ? d.data : [];
    // Project ONLY the documented safe fields. The backend's
    // `metadata` map MAY contain detection-method-specific fields the
    // UI does not need; we drop it from the projection so a future
    // server-side regression that started embedding sensitive metadata
    // cannot leak through. The UI's compact rows render only id +
    // score + method + timestamp.
    const events: AnomalyEventItem[] = rawList.map((a: Record<string, unknown>) => ({
      id: typeof a.id === "string" ? a.id : "",
      organization_id: typeof a.organization_id === "string" ? a.organization_id : "",
      score: typeof a.score === "number" ? a.score : 0,
      detection_method: typeof a.detection_method === "string" ? a.detection_method : "",
      created_at: typeof a.created_at === "string" ? a.created_at : "",
    }));
    return { ok: true, events };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

export interface AnomalyStats {
  total_anomalies: number;
  recent_24h: number;
  high_risk_24h: number;
}

export type GetAnomalyStatsResult =
  | { ok: true; stats: AnomalyStats }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function getAnomalyStats(): Promise<GetAnomalyStatsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/anomaly/stats`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const data = d?.data ?? {};
    return {
      ok: true,
      stats: {
        total_anomalies: typeof data.total_anomalies === "number" ? data.total_anomalies : 0,
        recent_24h: typeof data.recent_24h === "number" ? data.recent_24h : 0,
        high_risk_24h: typeof data.high_risk_24h === "number" ? data.high_risk_24h : 0,
      },
    };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── System sessions (GET /api/v1/system/sessions) ──────────────────────────

export interface AdminSessionItem {
  id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  is_active: boolean;
  is_current: boolean;
}

export type ListAdminSessionsResult =
  | { ok: true; sessions: AdminSessionItem[]; total_count: number }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function listAdminSessions(): Promise<ListAdminSessionsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/system/sessions`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    // EDITION-SURFACE-1: /api/v1/system/sessions is a commercial-only route;
    // an OSS backend serves no such route and answers 404. Classify that as
    // featureUnavailable (edition boundary) — the SAME mechanism verifyAuditChain
    // / getAnomalyStats already use — so the page renders honest edition copy
    // instead of a fake outage.
    if (!res.ok) return { ok: false, ...(await classifyAdminReadFailure(res)) };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawList = Array.isArray(d?.sessions) ? d.sessions : [];
    // DELIBERATELY do NOT read d.token / d.cookie / any session-
    // material field. The backend already masks the token to "****"
    // for the admin context but this projection ensures even that
    // masked value never reaches the UI.
    const sessions: AdminSessionItem[] = rawList.map((s: Record<string, unknown>) => ({
      id: typeof s.id === "string" ? s.id : "",
      created_at: typeof s.created_at === "string" ? s.created_at : "",
      expires_at: typeof s.expires_at === "string" ? s.expires_at : "",
      last_used_at: typeof s.last_used_at === "string" ? s.last_used_at : null,
      is_active: Boolean(s.is_active),
      is_current: Boolean(s.is_current),
    }));
    return {
      ok: true,
      sessions,
      total_count: typeof d?.total_count === "number" ? d.total_count : sessions.length,
    };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── Audit chain verify (GET /api/v1/system/audit/chain/verify) ─────────────

export interface AuditChainShardSummary {
  organization_id: string;
  status: string;
  rows_verified: number;
  head_signature_status: string;
}

export interface AuditChainVerifyReport {
  generated_at: string;
  shard_count: number;
  ok_count: number;
  diverged_count: number;
  empty_count: number;
  signed_count: number;
  unsigned_count: number;
  signature_invalid_count: number;
  uncheckable_count: number;
  shards: AuditChainShardSummary[];
}

export type VerifyAuditChainResult =
  | { ok: true; report: AuditChainVerifyReport }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function verifyAuditChain(): Promise<VerifyAuditChainResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    // GET, no body — the IDP handler is read-only (no feedback loop,
    // does not write the verification result back to audit). Calling
    // it triggers a BFS walk over the audit chain for each tenant
    // org; the response carries hash/signature DIAGNOSTICS only
    // (status counts + per-shard head signature status).
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/system/audit/chain/verify`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawShards = Array.isArray(d?.shards) ? d.shards : [];
    // Project ONLY the count + status fields. The backend's per-shard
    // record carries head_hash / head_signature hex strings; those
    // are diagnostics for SOC2 chain-integrity work but the UI does
    // NOT render them — they could be confused for credentials by
    // an operator scanning the page. We surface only the summary
    // counts + per-shard pass/fail status.
    const shards: AuditChainShardSummary[] = rawShards.map((s: Record<string, unknown>) => ({
      organization_id: typeof s.organization_id === "string" ? s.organization_id : "",
      status: typeof s.status === "string" ? s.status : "",
      rows_verified: typeof s.rows_verified === "number" ? s.rows_verified : 0,
      head_signature_status:
        typeof s.head_signature_status === "string" ? s.head_signature_status : "",
    }));
    return {
      ok: true,
      report: {
        generated_at: typeof d?.generated_at === "string" ? d.generated_at : "",
        shard_count: typeof d?.shard_count === "number" ? d.shard_count : 0,
        ok_count: typeof d?.ok_count === "number" ? d.ok_count : 0,
        diverged_count: typeof d?.diverged_count === "number" ? d.diverged_count : 0,
        empty_count: typeof d?.empty_count === "number" ? d.empty_count : 0,
        signed_count: typeof d?.signed_count === "number" ? d.signed_count : 0,
        unsigned_count: typeof d?.unsigned_count === "number" ? d.unsigned_count : 0,
        signature_invalid_count:
          typeof d?.signature_invalid_count === "number" ? d.signature_invalid_count : 0,
        uncheckable_count: typeof d?.uncheckable_count === "number" ? d.uncheckable_count : 0,
        shards,
      },
    };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── System info (GET /api/v1/health/details) ───────────────────────────────

export interface SystemInfo {
  status: string;
  version: string;
  // Tri-state (THE-HEALTH-DETAILS): a field is `undefined` when the backend
  // OMITS it (the honest ABSENT signal — OSS omits `redis`, and an audit
  // subsystem with no queue omits `queue_depth`), rendered as "unknown" by the
  // page. It is NEVER zero-faked to "" / 0 / null.
  database_status?: string;
  audit_system_status?: string;
  audit_queue_depth?: number;
  redis_status?: string;
}

export type GetSystemInfoResult =
  | { ok: true; info: SystemInfo }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function getSystemInfo(): Promise<GetSystemInfoResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/health/details`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    // Runtime info IS an OSS feature (owner ruling). A 404 here means a STALE
    // or non-IDP backend that does not serve the route — classify it as
    // featureUnavailable (the SAME mechanism the other admin reads use) so the
    // page shows an honest "not served" boundary, never a fake outage.
    if (!res.ok) return { ok: false, ...(await classifyAdminReadFailure(res)) };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    // Project ONLY the documented safe fields. The backend response
    // includes pool-connection counters under `database.connections`
    // — we DELIBERATELY drop those from the UI projection. The IDP
    // response NEVER includes database URLs / Redis URLs / env var
    // values / license private fields by construction (verified
    // during the slice's discovery phase against handler_health.go),
    // but the projection is explicit defence-in-depth.
    // Tri-state projection (THE-HEALTH-DETAILS): an ABSENT component or field
    // stays `undefined` — the page renders it "unknown" — rather than being
    // zero-faked to "" / 0 / null. A present component with a non-string /
    // non-number value is also treated as absent (defensive).
    const db = d?.database as Record<string, unknown> | undefined;
    const audit = d?.audit_system as Record<string, unknown> | undefined;
    const redis = d?.redis as Record<string, unknown> | undefined;
    return {
      ok: true,
      info: {
        status: typeof d?.status === "string" ? d.status : "",
        version: typeof d?.version === "string" ? d.version : "",
        database_status: db && typeof db.status === "string" ? db.status : undefined,
        audit_system_status: audit && typeof audit.status === "string" ? audit.status : undefined,
        audit_queue_depth:
          audit && typeof audit.queue_depth === "number" ? audit.queue_depth : undefined,
        redis_status: redis && typeof redis.status === "string" ? redis.status : undefined,
      },
    };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── Reports landing page metadata (no wire fetch — pure metadata) ──────────
//
// The reports landing page renders deep links to four report families
// (user-access, failed-auth, privilege-changes, audit-log) in their
// available export formats. The /api/v1/reports/* endpoints return
// JSON / CSV / PDF directly; the UI does NOT eagerly fetch any of
// these on page load — clicking a link triggers the operator's
// browser to download or open the file. The OPERATOR is responsible
// for any data egress; the IDP emits a `data_accessed` audit event
// per §5.9 SOC2 CC6.1 on the JSON endpoints.

export interface ReportLink {
  /** Operator-visible label. */
  label: string;
  /** Wire path (relative to the IDP origin proxied through /api/idp). */
  path: string;
  /** Wire MIME, used to pick an icon / handle file vs JSON view. */
  format: "json" | "csv" | "pdf";
}

export interface ReportFamily {
  /** Stable identifier for the family. */
  key: "user_access" | "failed_auth" | "privilege_changes" | "audit_log";
  /** Operator-visible family name. */
  name: string;
  /** Short non-technical description of the report's scope. */
  description: string;
  /** Available exports for this family. */
  links: ReportLink[];
}

export const SITE_ADMIN_REPORT_FAMILIES: ReportFamily[] = [
  {
    key: "user_access",
    name: "User access",
    description: "Per-user login activity, failed attempts, and risk scoring across the tenancy.",
    links: [
      { label: "JSON", path: "/api/v1/reports/access/users", format: "json" },
      { label: "CSV", path: "/api/v1/reports/access/users.csv", format: "csv" },
      { label: "PDF", path: "/api/v1/reports/access/users.pdf", format: "pdf" },
    ],
  },
  {
    key: "failed_auth",
    name: "Failed authentication",
    description:
      "Failed login attempts with timestamp, email, IP, user agent, and rejection reason.",
    links: [
      { label: "JSON", path: "/api/v1/reports/auth/failed", format: "json" },
      { label: "CSV", path: "/api/v1/reports/auth/failed.csv", format: "csv" },
      { label: "PDF", path: "/api/v1/reports/auth/failed.pdf", format: "pdf" },
    ],
  },
  {
    key: "privilege_changes",
    name: "Privilege changes",
    description: "Role change audit trail with subject, actor, old/new role, and reason.",
    links: [
      { label: "JSON", path: "/api/v1/reports/privileges/changes", format: "json" },
      { label: "CSV", path: "/api/v1/reports/privileges/changes.csv", format: "csv" },
      { label: "PDF", path: "/api/v1/reports/privileges/changes.pdf", format: "pdf" },
    ],
  },
  {
    key: "audit_log",
    name: "Audit log",
    description:
      "Full audit log PDF export. JSON access is available via the dedicated /site-admin/audit page.",
    links: [{ label: "PDF", path: "/api/v1/reports/audit/events.pdf", format: "pdf" }],
  },
];

// ── Org-admin Settings read-only tabs (slice identuum-20260530-org-admin-settings-readonly-tabs) ──
//
// Four list helpers backing the new read-only sections on
// /org-admin/settings: Identity providers / Webhooks / Roles / Scope
// templates. The IDP backend already scrubs sensitive material at the
// mapper layer (IdentityProviderInfo's ProviderConfig drops
// ClientSecretEncrypted + BindPasswordEncrypted; the webhook list
// mapper redacts the signing secret to ""). The UI helpers below add
// explicit field projection as defence-in-depth so a future mapper
// regression cannot leak through.

// ── Identity providers (cross-tier: CE plural list vs OSS singular) ──────────
//
// CE may expose a PLURAL list endpoint returning 0..N providers; released OSS
// exposes a SINGULAR endpoint returning ONE optional provider (404 "no OIDC
// provider configured" when none). This helper tries the list form first, falls
// back to the singular, and normalizes BOTH cardinalities to a list so the
// read-only section renders identically on either tier.

/**
 * Operator-safe projection of one configured organization identity
 * provider. The wire helper reads ONLY these fields from the IDP
 * response; the backend's `config` block — which historically has
 * carried client_id / issuer_url / scopes etc. but NEVER the
 * encrypted client_secret or bind_password (those live on the domain
 * struct and are dropped by the mapper) — is EXPLICITLY dropped at
 * the helper boundary. The UI surface displays only the operator-
 * recognizable identity fields.
 */
export interface OrgIdentityProviderItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type ListOrganizationIdentityProvidersResult =
  | { ok: true; identity_providers: OrgIdentityProviderItem[]; count: number }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      featureUnavailable: boolean;
    };

export async function listOrganizationIdentityProviders(
  orgID: string
): Promise<ListOrganizationIdentityProvidersResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  }
  const base = `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}`;
  // Map one raw IDP record to the operator-safe shape (drops config/secret).
  const mapOne = (p: Record<string, unknown>): OrgIdentityProviderItem => ({
    id: typeof p.id === "string" ? p.id : "",
    name: typeof p.name === "string" ? p.name : "",
    slug: typeof p.slug === "string" ? p.slug : "",
    type: typeof p.type === "string" ? p.type : "",
    priority: typeof p.priority === "number" ? p.priority : 0,
    active: Boolean(p.active),
    created_at: typeof p.created_at === "string" ? p.created_at : "",
    updated_at: typeof p.updated_at === "string" ? p.updated_at : "",
  });
  try {
    // 1) List form first (CE, 0..N providers).
    const listRes = await fetch(`${base}/identity-providers`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (listRes.ok) {
      // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
      const d: any = await listRes.json();
      const rawList = Array.isArray(d?.identity_providers) ? d.identity_providers : [];
      const identity_providers: OrgIdentityProviderItem[] = rawList.map(mapOne);
      return {
        ok: true,
        identity_providers,
        count: typeof d?.count === "number" ? d.count : identity_providers.length,
      };
    }
    // Only a MISSING list route (404) falls through to the singular; a real
    // failure (e.g. 403 feature-gated) is surfaced as-is.
    if (listRes.status !== 404) {
      const failure = await classifyAdminReadFailure(listRes);
      return { ok: false, ...failure };
    }

    // 2) Singular fallback (OSS — one optional provider). 404 here means "none
    //    configured", which normalizes to an EMPTY list (not an error).
    const oneRes = await fetch(`${base}/identity-provider`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (oneRes.status === 404) {
      return { ok: true, identity_providers: [], count: 0 };
    }
    if (!oneRes.ok) {
      const failure = await classifyAdminReadFailure(oneRes);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const body: any = await oneRes.json();
    // Tolerate { identity_provider: {…} }, { identity_providers: [...] }, or a
    // bare provider object.
    const identity_providers: OrgIdentityProviderItem[] = Array.isArray(body?.identity_providers)
      ? body.identity_providers.map(mapOne)
      : ((): OrgIdentityProviderItem[] => {
          const one = body?.identity_provider ?? body;
          return one && typeof one === "object" && !Array.isArray(one) ? [mapOne(one)] : [];
        })();
    return { ok: true, identity_providers, count: identity_providers.length };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      featureUnavailable: false,
    };
  }
}

// ── Webhooks (GET /api/v1/organizations/:id/webhooks) ─────────────────────

/**
 * Operator-safe projection of one configured organization webhook.
 * The backend's `secret` field is redacted to "" by the
 * MapWebhookEndpointsRedacted mapper; the UI helper additionally
 * NEVER reads d.secret / d.authorization / d.headers so a future
 * mapper regression that started populating the field cannot leak
 * through. The webhook URL IS surfaced verbatim — the operator
 * configured it and needs to see it for verification — but the page
 * may choose to display only the URL host for very long URLs that
 * could carry secret query params; the helper itself returns the
 * full URL for the operator-typed UI to make that choice.
 */
export interface OrgWebhookItem {
  id: string;
  url: string;
  event_filters: string[];
  enabled: boolean;
  created_at: string;
}

export type ListOrganizationWebhooksResult =
  | { ok: true; items: OrgWebhookItem[]; total_count: number }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      featureUnavailable: boolean;
    };

export async function listOrganizationWebhooks(
  orgID: string
): Promise<ListOrganizationWebhooksResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/webhooks`,
      { method: "GET", headers: await idpAuthHeaders(), cache: "no-store" }
    );
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawList = Array.isArray(d?.items) ? d.items : [];
    const items: OrgWebhookItem[] = rawList.map((w: Record<string, unknown>) => ({
      id: typeof w.id === "string" ? w.id : "",
      url: typeof w.url === "string" ? w.url : "",
      event_filters: Array.isArray(w.event_filters)
        ? w.event_filters.map((s: unknown) => String(s))
        : [],
      enabled: Boolean(w.enabled),
      created_at: typeof w.created_at === "string" ? w.created_at : "",
    }));
    return {
      ok: true,
      items,
      total_count: typeof d?.total_count === "number" ? d.total_count : items.length,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      featureUnavailable: false,
    };
  }
}

// ── Org roles (GET /api/v1/organizations/:id/roles) ───────────────────────

export interface OrgRoleItem {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

export type ListOrgRolesResult =
  | { ok: true; roles: OrgRoleItem[] }
  | { ok: false; status: number; forbidden: boolean };

export async function listOrgRoles(orgID: string): Promise<ListOrgRolesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, forbidden: false };
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/roles`,
      { method: "GET", headers: await idpAuthHeaders(), cache: "no-store" }
    );
    if (res.status === 403) return { ok: false, status: 403, forbidden: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    const rawList = Array.isArray(d?.roles) ? d.roles : [];
    const roles: OrgRoleItem[] = rawList.map((r: Record<string, unknown>) => ({
      id: typeof r.id === "string" ? r.id : "",
      name: typeof r.name === "string" ? r.name : "",
      description: typeof r.description === "string" ? r.description : "",
      scopes: Array.isArray(r.scopes) ? r.scopes.map((s: unknown) => String(s)) : [],
      created_at: typeof r.created_at === "string" ? r.created_at : "",
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
    }));
    return { ok: true, roles };
  } catch {
    return { ok: false, status: 0, forbidden: false };
  }
}

// ── Scope templates (GET /api/v1/scope-templates) ─────────────────────────

export interface ScopeTemplateItem {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

export type ListScopeTemplatesResult =
  | { ok: true; templates: ScopeTemplateItem[] }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      featureUnavailable: boolean;
    };

export async function listScopeTemplates(): Promise<ListScopeTemplatesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  }
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/scope-templates`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitisation
    const d: any = await res.json();
    // The endpoint returns a RAW array (no wrapping envelope).
    const rawList = Array.isArray(d) ? d : [];
    const templates: ScopeTemplateItem[] = rawList.map((t: Record<string, unknown>) => ({
      id: typeof t.id === "string" ? t.id : "",
      name: typeof t.name === "string" ? t.name : "",
      description: typeof t.description === "string" ? t.description : "",
      scopes: Array.isArray(t.scopes) ? t.scopes.map((s: unknown) => String(s)) : [],
      created_at: typeof t.created_at === "string" ? t.created_at : "",
      updated_at: typeof t.updated_at === "string" ? t.updated_at : "",
    }));
    return { ok: true, templates };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      featureUnavailable: false,
    };
  }
}

// ── Bulk user create (POST /api/v1/users/bulk) ───────────────────────────────
//
// Backend contract (gograph-verified):
//   - Request:  {"users":[{"email","name"}]}   (1 ≤ len ≤ 50; both fields required per row)
//   - Response: 202 Accepted with JobAcceptedResponse:
//                 {"job_id","status_url","status":"queued"}
//   - Authorization: org_admin role (explicit role check, not just scope).
//   - Role of created users is hardcoded to org_user.
//   - The bulk executor returns activation_token per row — RAW tokens, not URLs.
//     The UI never lets a caller see those tokens directly; getBulkJobStatus
//     immediately re-projects each token into a server-built setup_url and
//     discards the raw token.

export interface BulkUserEntry {
  email: string;
  name: string;
}

export type BulkCreateUsersResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; message: string };

export async function bulkCreateUsers(entries: BulkUserEntry[]): Promise<BulkCreateUsersResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  if (entries.length === 0) {
    return { ok: false, status: 400, message: "Provide at least one entry." };
  }
  if (entries.length > 50) {
    return { ok: false, status: 400, message: "Maximum 50 entries per batch." };
  }
  const sanitized = entries.map((e) => ({
    email: e.email.toLowerCase().trim(),
    name: e.name.trim(),
  }));
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify({ users: sanitized }),
      cache: "no-store",
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    if ((res.status === 202 || res.ok) && typeof data?.job_id === "string") {
      return { ok: true, jobId: data.job_id };
    }
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not enqueue the bulk invite job.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Get bulk job status (GET /api/v1/jobs/:id) ───────────────────────────────
//
// Backend contract (gograph-verified):
//   - Response: JobStatusResponse {
//       id, type, status: queued|running|completed|failed,
//       created_at, started_at?, completed_at?, result?: json.RawMessage
//     }
//   - For job.type === "bulk_user_create", the result is BulkUserCreateResult:
//       {results:[{email,name,success,error_message?,activation_token?}],
//        created, failed, total}
//   - Tenant-scoped: cross-org lookups return 404 (oracle protection).
//   - Activation tokens in the result are SENSITIVE; this helper redacts the
//     raw token immediately and projects setup_url only.

export interface BulkJobResultItem {
  email: string;
  name: string;
  success: boolean;
  error_message: string | null;
  /**
   * Operator-facing one-time setup URL constructed server-side from the raw
   * activation_token and cfg.ui_origin. Null when the backend returned no
   * token (e.g. row failed) OR when ui_origin is not configured. The raw
   * activation_token is NEVER exposed to the caller.
   */
  setup_url: string | null;
}

export interface BulkJobResult {
  results: BulkJobResultItem[];
  created: number;
  failed: number;
  total: number;
}

export interface BulkJobStatus {
  id: string;
  type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: BulkJobResult | null;
}

export type GetBulkJobStatusResult =
  | { ok: true; job: BulkJobStatus; warning: string | null }
  | { ok: false; status: number; message: string };

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function buildSetupURL(uiOrigin: string | undefined, token: string): string | null {
  if (!uiOrigin || uiOrigin.length === 0) return null;
  if (!token || token.length === 0) return null;
  return `${trimTrailingSlash(uiOrigin)}/setup?token=${encodeURIComponent(token)}`;
}

export async function getBulkJobStatus(jobId: string): Promise<GetBulkJobStatusResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
      const errData: any = await res.json().catch(() => ({}));
      const message =
        typeof errData?.message === "string" && errData.message.length > 0
          ? errData.message
          : "Could not load job status.";
      return { ok: false, status: res.status, message };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const type = String(data?.type ?? "");
    let result: BulkJobResult | null = null;
    let warning: string | null = null;
    if (type === "bulk_user_create" && data?.result && typeof data.result === "object") {
      // biome-ignore lint/suspicious/noExplicitAny: raw executor result shape
      const r: any = data.result;
      const rawList = Array.isArray(r.results) ? r.results : [];
      const projected: BulkJobResultItem[] = rawList.map(
        // biome-ignore lint/suspicious/noExplicitAny: raw result item shape
        (it: any): BulkJobResultItem => {
          // SECURITY: read activation_token only inside this immediate scope,
          // immediately project it into setup_url, then drop the binding.
          const rawToken = typeof it.activation_token === "string" ? it.activation_token : "";
          const setupURL = rawToken ? buildSetupURL(cfg.ui_origin, rawToken) : null;
          return {
            email: typeof it.email === "string" ? it.email : "",
            name: typeof it.name === "string" ? it.name : "",
            success: Boolean(it.success),
            error_message:
              typeof it.error_message === "string" && it.error_message.length > 0
                ? it.error_message
                : null,
            setup_url: setupURL,
          };
        }
      );
      const anyTokenPresent = rawList.some(
        // biome-ignore lint/suspicious/noExplicitAny: raw result item shape
        (it: any) => typeof it.activation_token === "string" && it.activation_token.length > 0
      );
      if (anyTokenPresent && (!cfg.ui_origin || cfg.ui_origin.length === 0)) {
        warning =
          "Setup URLs could not be constructed because ui_origin is not configured in the UI runtime. Configure ui_origin to surface one-time setup links.";
      }
      result = {
        results: projected,
        created: typeof r.created === "number" ? r.created : 0,
        failed: typeof r.failed === "number" ? r.failed : 0,
        total: typeof r.total === "number" ? r.total : 0,
      };
    }
    return {
      ok: true,
      job: {
        id: String(data?.id ?? ""),
        type,
        status: String(data?.status ?? ""),
        created_at: typeof data?.created_at === "string" ? data.created_at : "",
        started_at: typeof data?.started_at === "string" ? data.started_at : null,
        completed_at: typeof data?.completed_at === "string" ? data.completed_at : null,
        result,
      },
      warning,
    };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Approve pending registration (POST /api/v1/users/:id/approve) ────────────
//
// Backend contract (gograph-verified):
//   - Empty request body.
//   - Service guard: only users with banned=true && role=org_user are
//     approvable. Mismatches return ErrInvalidRequest → 400.
//   - Authorization: org_admin (own org) or site_admin in orgs with zero
//     active org_admins. Cross-org or wrong-role → 403.
//   - Response: UserResponse {success, message, user, activation_url?}
//     activation_url is set only in air-gapped deployments. Treated as a
//     one-time copy-once secret on the UI.

export type ApproveRegistrationResult =
  | { ok: true; activationUrl: string | null }
  | { ok: false; status: number; message: string };

export async function approveUserRegistration(userId: string): Promise<ApproveRegistrationResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/approve`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data?.success) {
      const url =
        typeof data?.activation_url === "string" && data.activation_url.length > 0
          ? data.activation_url
          : null;
      return { ok: true, activationUrl: url };
    }
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not approve registration.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── List roles assigned to a user (GET /api/v1/users/:id/roles) ──────────────
//
// Backend contract (gograph-verified):
//   - Response: {"roles":[OrgRoleResponse]}
//   - OrgRoleResponse fields: id, org_id, name, description, scopes[],
//     created_at, updated_at.
//   - UI projection drops org_id (not needed for org-admin view).

export type ListUserRolesResult =
  | { ok: true; roles: OrgRoleItem[] }
  | { ok: false; status: number; forbidden: boolean };

export async function listUserRoles(userId: string): Promise<ListUserRolesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, forbidden: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/roles`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (res.status === 403) return { ok: false, status: 403, forbidden: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json();
    const rawList = Array.isArray(d?.roles) ? d.roles : [];
    const roles: OrgRoleItem[] = rawList.map((r: Record<string, unknown>) => ({
      id: typeof r.id === "string" ? r.id : "",
      name: typeof r.name === "string" ? r.name : "",
      description: typeof r.description === "string" ? r.description : "",
      scopes: Array.isArray(r.scopes) ? r.scopes.map((s: unknown) => String(s)) : [],
      created_at: typeof r.created_at === "string" ? r.created_at : "",
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
    }));
    return { ok: true, roles };
  } catch {
    return { ok: false, status: 0, forbidden: false };
  }
}

// ── Assign role to user (POST /api/v1/users/:id/roles) ───────────────────────
//
// Backend contract (gograph-verified):
//   - Request: {"role_id":"<uuid>"}
//   - Response: 204 No Content.
//   - Idempotent at the repository layer via ON CONFLICT (user_id, role_id)
//     DO NOTHING — re-assigning an already-assigned role silently succeeds.
//   - Same-org guard: targetUser.OrganizationID must match role.OrgID, else 403.
//   - Side effect: all of the target user's sessions are revoked.

export type AssignUserRoleResult = { ok: true } | { ok: false; status: number; message: string };

export async function assignUserRole(
  userId: string,
  roleId: string
): Promise<AssignUserRoleResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify({ role_id: roleId }),
      cache: "no-store",
    });
    if (res.status === 204 || res.ok) return { ok: true };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not assign the role.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Remove role from user (DELETE /api/v1/users/:id/roles/:role_id) ──────────
//
// Backend contract (gograph-verified):
//   - Response: 204 No Content.
//   - Removing a non-existent binding silently succeeds (DELETE with no match
//     returns no error from the repository).
//   - Same-org guard: mismatched org returns 403.
//   - Side effect: all of the target user's sessions are revoked.

export type RemoveUserRoleResult = { ok: true } | { ok: false; status: number; message: string };

export async function removeUserRole(
  userId: string,
  roleId: string
): Promise<RemoveUserRoleResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, status: 503, message: "IdP is not configured." };
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
      {
        method: "DELETE",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 204 || res.ok) return { ok: true };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not remove the role.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

// ── Org-admin API Resources (CRUD on /api/v1/api-resources) ──────────────────
//
// Backend contract (gograph-verified):
//   - Group base path: /api/v1/api-resources, gated by the
//     AuthorizationServer license feature (mw.RequireFeature).
//   - All routes require an org_admin (or site_admin) session and the
//     OAuth scope orgs:read (reads) or orgs:update (writes).
//   - APIResourceResponse contains ONLY safe fields:
//       id, organization_id, name, audience, active, token_ttl_secs,
//       scopes[{id,name,description}], created_at, updated_at
//     The domain object's `resource_secret_hash` is NEVER on the wire.
//   - Create returns a one-time plaintext `secret` at the top-level
//     envelope { resource, secret } — surface ONCE, never persist.
//   - Update is partial-replace; audience is IMMUTABLE (no field in the
//     request struct).
//   - List ignores any page/page_size query params (handler hardcodes
//     page=1, page_size=100).
//   - Delete returns 204 No Content.
//   - Audit events are emitted with subject_type=organization (not
//     api_resource). Resource id + name appear only in metadata. The
//     UI does NOT render a Recent activity card on this surface in
//     this slice; a backend audit-subject change would be required to
//     mirror the OAuth client resource-subject pattern.

// ── Safe input/output shapes ────────────────────────────────────────────────

export interface CreateAPIResourceScopeInput {
  name: string;
  description: string;
}

export interface CreateAPIResourceOptions {
  name: string;
  audience: string;
  token_ttl_secs?: number;
  scopes?: CreateAPIResourceScopeInput[];
}

export interface UpdateAPIResourceOptions {
  name?: string;
  active?: boolean;
  token_ttl_secs?: number;
  scopes?: CreateAPIResourceScopeInput[];
}

/**
 * Safe wire mapping of the IDP's APIResourceResponse. Sanitises every
 * field explicitly so a future backend struct expansion that added a
 * sensitive field (e.g. resource_secret_hash) would NOT silently leak
 * through to React props.
 */
function projectAPIResource(
  // biome-ignore lint/suspicious/noExplicitAny: raw API response item
  r: any
): OrgAPIResourceItem {
  // SECURITY: explicit allowlist. Do NOT spread `...r` into the result.
  const rawScopes = Array.isArray(r?.scopes) ? r.scopes : [];
  const scopes: OrgAPIResourceScope[] = rawScopes.map(
    // biome-ignore lint/suspicious/noExplicitAny: raw API scope item
    (s: any): OrgAPIResourceScope => ({
      id: typeof s?.id === "string" ? s.id : "",
      name: typeof s?.name === "string" ? s.name : "",
      description: typeof s?.description === "string" ? s.description : "",
    })
  );
  return {
    id: typeof r?.id === "string" ? r.id : "",
    organization_id: typeof r?.organization_id === "string" ? r.organization_id : "",
    name: typeof r?.name === "string" ? r.name : "",
    audience: typeof r?.audience === "string" ? r.audience : "",
    active: Boolean(r?.active),
    token_ttl_secs: typeof r?.token_ttl_secs === "number" ? r.token_ttl_secs : 0,
    scopes,
    created_at: typeof r?.created_at === "string" ? r.created_at : "",
    updated_at: typeof r?.updated_at === "string" ? r.updated_at : "",
  };
}

// ── List API resources ──────────────────────────────────────────────────────

export type ListAPIResourcesResult =
  | { ok: true; resources: OrgAPIResourceItem[] }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function listApiResources(): Promise<ListAPIResourcesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/api-resources`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // The IDP handler returns the raw array (no wrapping envelope).
    const data = await res.json();
    const rawList = Array.isArray(data) ? data : [];
    return { ok: true, resources: rawList.map(projectAPIResource) };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── Get a single API resource ───────────────────────────────────────────────

export type GetAPIResourceResult =
  | { ok: true; resource: OrgAPIResourceItem }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      featureUnavailable: boolean;
    };

export async function getApiResource(id: string): Promise<GetAPIResourceResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
    };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/api-resources/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        featureUnavailable: false,
      };
    if (res.status === 402)
      return {
        ok: false,
        status: 402,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: true,
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        featureUnavailable: false,
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
      };
    const data = await res.json();
    return { ok: true, resource: projectAPIResource(data) };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
    };
  }
}

// ── Create API resource (returns one-time plaintext secret) ─────────────────

export interface CreatedAPIResource extends OrgAPIResourceItem {
  /**
   * SINGLE-SHOT plaintext secret returned by the IDP exactly once on
   * create. The wire helper keeps the field so the calling server
   * action can surface it in the copy-once success panel; subsequent
   * fetches never re-issue it.
   */
  secret: string;
}

export type CreateAPIResourceResult =
  | { ok: true; data: CreatedAPIResource }
  | {
      ok: false;
      status: number;
      conflict: boolean;
      invalid: boolean;
      forbidden: boolean;
      featureUnavailable: boolean;
      message: string;
    };

export async function createApiResource(
  opts: CreateAPIResourceOptions
): Promise<CreateAPIResourceResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return {
      ok: false,
      status: 503,
      conflict: false,
      invalid: false,
      forbidden: false,
      featureUnavailable: false,
      message: "IdP is not configured.",
    };
  // Explicit allowlist body — no organization_id, no audience-after-create
  // surprises, no secret echoes.
  // biome-ignore lint/suspicious/noExplicitAny: typed body literal
  const body: Record<string, any> = {
    name: opts.name,
    audience: opts.audience,
  };
  if (typeof opts.token_ttl_secs === "number") body.token_ttl_secs = opts.token_ttl_secs;
  if (Array.isArray(opts.scopes) && opts.scopes.length > 0)
    body.scopes = opts.scopes.map((s) => ({ name: s.name, description: s.description }));
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/api-resources`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 201 || res.ok) {
      const projected = projectAPIResource(data?.resource);
      // SECURITY: take the one-time secret straight from the envelope. The
      // raw `data.secret` is read once here and is gone after this call
      // returns to the server action.
      const secret = typeof data?.secret === "string" ? data.secret : "";
      return { ok: true, data: { ...projected, secret } };
    }
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not create the API resource.";
    if (res.status === 402)
      return {
        ok: false,
        status: 402,
        conflict: false,
        invalid: false,
        forbidden: false,
        featureUnavailable: true,
        message,
      };
    if (res.status === 409)
      return {
        ok: false,
        status: 409,
        conflict: true,
        invalid: false,
        forbidden: false,
        featureUnavailable: false,
        message,
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        conflict: false,
        invalid: false,
        forbidden: true,
        featureUnavailable: false,
        message,
      };
    if (res.status === 400 || res.status === 422)
      return {
        ok: false,
        status: res.status,
        conflict: false,
        invalid: true,
        forbidden: false,
        featureUnavailable: false,
        message,
      };
    return {
      ok: false,
      status: res.status,
      conflict: false,
      invalid: false,
      forbidden: false,
      featureUnavailable: false,
      message,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      conflict: false,
      invalid: false,
      forbidden: false,
      featureUnavailable: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Update API resource (partial — audience is IMMUTABLE) ───────────────────

export type UpdateAPIResourceResult =
  | { ok: true; resource: OrgAPIResourceItem }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      featureUnavailable: boolean;
      message: string;
    };

export async function updateApiResource(
  id: string,
  opts: UpdateAPIResourceOptions
): Promise<UpdateAPIResourceResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "IdP is not configured.",
    };
  // biome-ignore lint/suspicious/noExplicitAny: typed body literal
  const body: Record<string, any> = {};
  if (typeof opts.name === "string") body.name = opts.name;
  if (typeof opts.active === "boolean") body.active = opts.active;
  if (typeof opts.token_ttl_secs === "number") body.token_ttl_secs = opts.token_ttl_secs;
  if (Array.isArray(opts.scopes))
    body.scopes = opts.scopes.map((s) => ({ name: s.name, description: s.description }));
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/api-resources/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await idpAuthHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    if (res.ok) {
      return { ok: true, resource: projectAPIResource(data) };
    }
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not update the API resource.";
    if (res.status === 402)
      return {
        ok: false,
        status: 402,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: true,
        message,
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        featureUnavailable: false,
        message,
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
        message,
      };
    if (res.status === 400 || res.status === 422)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: true,
        featureUnavailable: false,
        message,
      };
    return {
      ok: false,
      status: res.status,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Rotate API resource secret (POST :id/secret/regenerate) ─────────────────
//
// Backend contract (gograph-verified):
//   - Route: POST /api/v1/api-resources/:id/secret/regenerate
//   - Middleware: HybridAuth → DenyConsentPurposeSession →
//     RequireFeature(AuthorizationServer) → RequireScopesAny(orgs:update)
//   - Service guards: tenant scope on org_admin (cross-org → 403),
//     guardSiteAdminTenantAPIResource for site_admin actors.
//   - Request: no body, no Content-Type — empty POST.
//   - Response on success: RegenerateAPIResourceSecretResponse{ID, Secret}
//     — a {id, secret} envelope where Secret is the ONE-TIME plaintext
//     (32 bytes generated via crypto.GenerateRandomString, SHA-256
//     hashed for storage). The old hash is replaced atomically; any
//     future authentication using the old secret will fail. EXISTING
//     access tokens issued for this audience continue to validate at
//     the resource server until they expire because token verification
//     uses the IDP's signing keys, not the resource secret.
//   - Side effects: AuditAPIResourceSecretRotated event (org-subject);
//     api_auth cache key for the old hash is deleted.
//   - Error mapping: 400 invalid UUID; 402 missing AuthorizationServer
//     license; 403 forbidden / cross-org; 404 not found.

export type RotateAPIResourceSecretResult =
  | { ok: true; data: { id: string; secret: string } }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      featureUnavailable: boolean;
      message: string;
    };

export async function rotateApiResourceSecret(id: string): Promise<RotateAPIResourceSecretResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "IdP is not configured.",
    };
  }
  try {
    // No `body:`, no `Content-Type` header — empty POST. Tenant scope
    // is server-enforced from the actor's session cookie. The request
    // CANNOT carry organization_id, resource_secret, secret_hash, or
    // any other field by construction.
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/api-resources/${encodeURIComponent(id)}/secret/regenerate`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        featureUnavailable: false,
        message: "The API resource secret could not be rotated with the supplied id.",
      };
    if (res.status === 402)
      return {
        ok: false,
        status: 402,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: true,
        message: "The API resource endpoint is not available from this IDP backend.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        featureUnavailable: false,
        message: "You do not have permission to rotate this API resource's secret.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
        message: "The API resource was not found.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
        message: "Could not rotate the API resource secret. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json();
    // Explicit projection — the backend RegenerateAPIResourceSecretResponse
    // carries ONLY {id, secret}. Any other key returned by a future
    // backend regression is dropped on the floor here.
    return {
      ok: true,
      data: {
        id: typeof d?.id === "string" ? d.id : "",
        secret: typeof d?.secret === "string" ? d.secret : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Delete API resource (204) ───────────────────────────────────────────────

export type DeleteAPIResourceResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      featureUnavailable: boolean;
      message: string;
    };

export async function deleteApiResource(id: string): Promise<DeleteAPIResourceResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "IdP is not configured.",
    };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/api-resources/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (res.status === 204 || res.ok) return { ok: true };
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        featureUnavailable: false,
        message: "The API resource could not be deleted with the supplied id.",
      };
    if (res.status === 402)
      return {
        ok: false,
        status: 402,
        notFound: false,
        forbidden: false,
        invalid: false,
        featureUnavailable: true,
        message: "The API resource endpoint is not available from this IDP backend.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        featureUnavailable: false,
        message: "You do not have permission to delete this API resource.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        featureUnavailable: false,
        message: "The API resource was not found. It may have been removed already.",
      };
    return {
      ok: false,
      status: res.status,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "Could not delete API resource. Please try again.",
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      featureUnavailable: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Org-admin Service Accounts (CRUD on /api/v1/organizations/:id/service-accounts) ──
//
// Backend contract (gograph-verified):
//   - Three routes exposed by identuum-idp:
//       GET    /api/v1/organizations/:id/service-accounts          (list, m2m:read)
//       POST   /api/v1/organizations/:id/service-accounts          (create, m2m:create)
//       DELETE /api/v1/organizations/:id/service-accounts/:sa_id   (soft delete, m2m:delete)
//   - There is NO get-by-id route. The detail page reuses the list
//     response and filters client-side.
//   - There is NO update / disable / enable / credential issuance /
//     credential rotation route on identuum-idp. The UI surface
//     exposes only the three operations above.
//   - The IDP DTO `types.ServiceAccount` is intentionally narrow — it
//     carries id / organization_id / name / description / role /
//     created_at / updated_at and NOTHING ELSE. NO credential, NO
//     secret, NO hash, NO private-key field appears on any service-
//     account route response (the mapper drops Active / ExpiresAt /
//     OwnerUserID / OriginPeerID / OriginSPIFFEID from the DB row).
//   - Authorization: only org_admin acting on their own organization
//     can list/create/delete. site_admin is HARD 403 by service guard.

// ── Safe wire shapes ───────────────────────────────────────────────────────

export interface CreateServiceAccountOptions {
  name: string;
  description?: string;
  /** "org_user" | "org_admin" — falls back to "org_admin" server-side when empty. */
  role?: string;
  /** Optional ISO-8601 timestamp; backend caps per org's ServiceAccountExpiryDays policy. */
  expires_at?: string;
}

/**
 * Safe wire mapping of the IDP's types.ServiceAccount. Explicit
 * allowlist — never spreads `...r` so a future backend struct
 * expansion that added a sensitive field (e.g. credential / token /
 * private_key) would NOT silently leak through to React props.
 */
function projectServiceAccount(
  // biome-ignore lint/suspicious/noExplicitAny: raw API response item
  r: any
): OrgServiceAccountItem {
  return {
    id: typeof r?.id === "string" ? r.id : "",
    organization_id: typeof r?.organization_id === "string" ? r.organization_id : "",
    name: typeof r?.name === "string" ? r.name : "",
    description: typeof r?.description === "string" ? r.description : "",
    role: typeof r?.role === "string" ? r.role : "",
    // Slice identuum-20260530-service-account-active-dto-backend
    // wires the field onto the wire DTO; slice
    // identuum-20260530-service-account-disable-enable-ui-reload-
    // validation proves the persistent Active/Disabled badge round-
    // trips through a Playwright reload. The defensive fallback to
    // `true` is preserved purely as a version-skew safety net (e.g.
    // a newer UI talking to an older IDP container during a rolling
    // deploy); the happy path always reads the boolean directly.
    active: typeof r?.active === "boolean" ? r.active : true,
    created_at: typeof r?.created_at === "string" ? r.created_at : "",
    updated_at: typeof r?.updated_at === "string" ? r.updated_at : "",
  };
}

// ── List service accounts ──────────────────────────────────────────────────

export type ListServiceAccountsResult =
  | { ok: true; serviceAccounts: OrgServiceAccountItem[] }
  | { ok: false; status: number; forbidden: boolean; featureUnavailable: boolean };

export async function listServiceAccounts(orgID: string): Promise<ListServiceAccountsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return { ok: false, status: 503, forbidden: false, featureUnavailable: false };
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/service-accounts`,
      { method: "GET", headers: await idpAuthHeaders(), cache: "no-store" }
    );
    if (!res.ok) {
      const failure = await classifyAdminReadFailure(res);
      return { ok: false, ...failure };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json();
    // Released OSS returns a BARE ARRAY of service accounts; tolerate a
    // { service_accounts: [...] } envelope too.
    const rawList = Array.isArray(d)
      ? d
      : Array.isArray(d?.service_accounts)
        ? d.service_accounts
        : [];
    return { ok: true, serviceAccounts: rawList.map(projectServiceAccount) };
  } catch {
    return { ok: false, status: 0, forbidden: false, featureUnavailable: false };
  }
}

// ── Create service account (NEVER returns a credential) ───────────────────

export type CreateServiceAccountResult =
  | { ok: true; serviceAccount: OrgServiceAccountItem }
  | {
      ok: false;
      status: number;
      conflict: boolean;
      invalid: boolean;
      forbidden: boolean;
      message: string;
    };

export async function createServiceAccount(
  orgID: string,
  opts: CreateServiceAccountOptions
): Promise<CreateServiceAccountResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      conflict: false,
      invalid: false,
      forbidden: false,
      message: "IdP is not configured.",
    };
  }
  // biome-ignore lint/suspicious/noExplicitAny: typed body literal
  const body: Record<string, any> = { name: opts.name };
  if (typeof opts.description === "string") body.description = opts.description;
  if (typeof opts.role === "string") body.role = opts.role;
  if (typeof opts.expires_at === "string" && opts.expires_at.length > 0) {
    body.expires_at = opts.expires_at;
  }
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgID)}/service-accounts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await idpAuthHeaders()),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 201 || res.ok) {
      return { ok: true, serviceAccount: projectServiceAccount(data) };
    }
    const message =
      typeof data?.message === "string" && data.message.length > 0
        ? data.message
        : "Could not create the service account.";
    if (res.status === 409)
      return {
        ok: false,
        status: 409,
        conflict: true,
        invalid: false,
        forbidden: false,
        message,
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        conflict: false,
        invalid: false,
        forbidden: true,
        message,
      };
    if (res.status === 400 || res.status === 422)
      return {
        ok: false,
        status: res.status,
        conflict: false,
        invalid: true,
        forbidden: false,
        message,
      };
    return {
      ok: false,
      status: res.status,
      conflict: false,
      invalid: false,
      forbidden: false,
      message,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      conflict: false,
      invalid: false,
      forbidden: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Delete service account (soft delete, 204 No Content) ──────────────────

export type DeleteServiceAccountResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      message: string;
    };

export async function deleteServiceAccount(
  orgID: string,
  saID: string
): Promise<DeleteServiceAccountResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }
  try {
    // Released OSS: delete/update/toggle are keyed by SA id at the NON-prefixed
    // /api/v1/service-accounts/:id route (org scope is derived from the SA +
    // actor, not the URL). orgID is retained on the signature for the caller's
    // authorization intent but is not part of the path.
    void orgID;
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/service-accounts/${encodeURIComponent(saID)}`,
      {
        method: "DELETE",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 204 || res.ok) return { ok: true };
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        message: "The service account could not be deleted with the supplied id.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        message: "You do not have permission to delete this service account.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        message: "The service account was not found. It may have been removed already.",
      };
    return {
      ok: false,
      status: res.status,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "Could not delete service account. Please try again.",
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Link a Service Account to an OAuth client (POST :id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link) ──
//
// Backend contract (gograph-verified in the matching backend slice
// identuum-20260530-service-account-oauth-client-link-backend):
//   - Route: POST /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link
//   - Middleware: HybridAuth + DenyConsentPurposeSession + RequireScopesAny(m2m:create)
//   - Triple-layered authorization: handler-level role check (org_admin
//     only) + URL-org match (claims.OrganizationID == :id) + service-
//     layer same-org guards on both halves (M2MService.GetServiceAccount
//     and ClientService.GetClient).
//   - Empty POST body.
//   - Response: 200 OK with the LinkServiceAccountResponse shape — six
//     safe identifiers only (success, message, organization_id,
//     service_account_id, oauth_client_uuid, oauth_client_identifier).
//     NO client_secret / client_secret_hash / service-account credential
//     / private-key / token / cookie / session-id is part of the
//     contract.
//   - No new credential is issued. The mutation is a single column
//     update on oauth_clients.service_account_id; existing
//     client_secret_hash is untouched.

export interface LinkedServiceAccountToOAuthClient {
  organization_id: string;
  service_account_id: string;
  oauth_client_uuid: string;
  oauth_client_identifier: string;
}

export type LinkServiceAccountToOAuthClientResult =
  | { ok: true; data: LinkedServiceAccountToOAuthClient }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      message: string;
    };

export async function linkServiceAccountToOAuthClient(
  orgID: string,
  serviceAccountID: string,
  oauthClientID: string
): Promise<LinkServiceAccountToOAuthClientResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }
  try {
    // Released OSS links via the client-update surface: PUT /api/v1/clients/:id
    // with { service_account_id } (patch semantics — every other field is left
    // unchanged). The service layer validates the binding: confidential clients
    // only, SA must live in the client's org (ValidateBindingForClient), and
    // requireClientInActorOrg pins the client to the acting org_admin's org.
    // orgID stays on the signature for caller intent; the org is derived
    // server-side from the actor + the client row, never from the request.
    void orgID;
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(oauthClientID)}`,
      {
        method: "PUT",
        headers: await idpAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ service_account_id: serviceAccountID }),
        cache: "no-store",
      }
    );
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        message: "The link request was rejected — check the supplied identifiers.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        message: "You do not have permission to link this service account.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        message: "Service account or OAuth client not found.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        message: "Could not link the service account. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json().catch(() => ({}));
    // Explicit projection from the released safeClient response (top-level
    // client fields) into the four operational identifiers this result
    // carries. No secret-shaped key is ever read.
    return {
      ok: true,
      data: {
        organization_id: typeof d?.organization_id === "string" ? d.organization_id : "",
        service_account_id: typeof d?.service_account_id === "string" ? d.service_account_id : "",
        oauth_client_uuid: typeof d?.id === "string" ? d.id : "",
        oauth_client_identifier: typeof d?.client_id === "string" ? d.client_id : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── unlinkServiceAccountFromOAuthClient (slice identuum-20260530-service-account-oauth-client-unlink-ui) ──
//
// Wire helper for the org-admin "Unlink OAuth client" action on the SA
// detail page. Calls the IDP backend route added in the prior backend
// slice:
//   DELETE /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link
//
// Contract:
//   - Path params carry all three resource ids (encodeURIComponent on each).
//   - NO request body, NO Content-Type header.
//   - Authentication via the forwarded session cookie. Authorization is
//     enforced server-side (org_admin role + URL :id == claims.OrganizationID
//     + M2MService.GetServiceAccount + ClientService.GetClient + a
//     same-org cross-check + ClientService.UnlinkServiceAccount's
//     link-state invariant).
//   - Response status mapping:
//       200 → ok with safe identifiers projection.
//       400 → invalid (malformed UUID path segments).
//       403 → forbidden (role / URL-org / cross-org rejection).
//       404 → notFound (missing OAuth client).
//       409 → notLinked (client is not currently linked to the requested SA;
//             same sentinel for "linked to a different SA" — backend does
//             not disclose which SA the client is actually linked to).
//   - Explicit projection of the 6 documented safe fields from the
//     backend UnlinkServiceAccountResponse:
//       success, message, organization_id, service_account_id,
//       previously_linked_oauth_client_uuid,
//       previously_linked_oauth_client_identifier.
//     No client_secret / client_secret_hash / service-account credential
//     / private-key / token / cookie / session-id field is part of the
//     contract or this projection.
//   - No new credential is issued. The mutation sets
//     oauth_clients.service_account_id to NULL; existing
//     client_secret_hash is untouched.

export interface UnlinkedServiceAccountFromOAuthClient {
  organization_id: string;
  service_account_id: string;
  previously_linked_oauth_client_uuid: string;
  previously_linked_oauth_client_identifier: string;
}

export type UnlinkServiceAccountFromOAuthClientResult =
  | { ok: true; data: UnlinkedServiceAccountFromOAuthClient }
  | {
      ok: false;
      status: number;
      notFound: boolean;
      forbidden: boolean;
      invalid: boolean;
      notLinked: boolean;
      message: string;
    };

export async function unlinkServiceAccountFromOAuthClient(
  orgID: string,
  serviceAccountID: string,
  oauthClientID: string
): Promise<UnlinkServiceAccountFromOAuthClientResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      notFound: false,
      forbidden: false,
      invalid: false,
      notLinked: false,
      message: "IdP is not configured.",
    };
  }
  try {
    // Released OSS unlinks via the client-update surface: PUT /api/v1/clients/:id
    // with the EXPLICIT nil UUID — ClientService.UpdateClient treats a non-nil
    // pointer to uuid.Nil as "remove the binding" (patch semantics leave every
    // other field unchanged). serviceAccountID/orgID stay on the signature for
    // caller intent; scope is enforced server-side from the actor + client row.
    void orgID;
    void serviceAccountID;
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/clients/${encodeURIComponent(oauthClientID)}`,
      {
        method: "PUT",
        headers: await idpAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ service_account_id: "00000000-0000-0000-0000-000000000000" }),
        cache: "no-store",
      }
    );
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        notFound: false,
        forbidden: false,
        invalid: true,
        notLinked: false,
        message: "The unlink request was rejected — check the supplied identifiers.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        notFound: false,
        forbidden: true,
        invalid: false,
        notLinked: false,
        message: "You do not have permission to unlink this service account.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        notFound: true,
        forbidden: false,
        invalid: false,
        notLinked: false,
        message: "Service account or OAuth client not found.",
      };
    if (res.status === 409)
      return {
        ok: false,
        status: 409,
        notFound: false,
        forbidden: false,
        invalid: false,
        notLinked: true,
        message:
          "OAuth client is not currently linked to this service account. Reload the page and try again.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        notFound: false,
        forbidden: false,
        invalid: false,
        notLinked: false,
        message: "Could not unlink the service account. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json().catch(() => ({}));
    // Explicit projection of the four operational identifiers documented
    // on the backend UnlinkServiceAccountResponse. Any other key a
    // future backend regression returned would be dropped on the floor.
    return {
      ok: true,
      data: {
        organization_id: typeof d?.organization_id === "string" ? d.organization_id : "",
        service_account_id: typeof d?.service_account_id === "string" ? d.service_account_id : "",
        previously_linked_oauth_client_uuid:
          typeof d?.previously_linked_oauth_client_uuid === "string"
            ? d.previously_linked_oauth_client_uuid
            : "",
        previously_linked_oauth_client_identifier:
          typeof d?.previously_linked_oauth_client_identifier === "string"
            ? d.previously_linked_oauth_client_identifier
            : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      notFound: false,
      forbidden: false,
      invalid: false,
      notLinked: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── listServiceAccountOAuthClients (slice identuum-20260530-service-account-linked-clients-read-model-ui) ──
//
// Wire helper for the org-admin "linked OAuth clients" read on the SA
// detail page. Calls the IDP backend route added by the prior backend
// slice:
//   GET /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients
//
// Backend response shape (verbatim from
// identuum-idp/internal/handlers/handler_service_account_oauth_clients.go):
//   {
//     "success": true,
//     "oauth_clients": [
//       { "id", "client_id", "name", "is_public", "active",
//         "created_at", "updated_at" }
//     ]
//   }
//
// Contract:
//   - GET; NO request body, NO Content-Type header.
//   - Authentication via the forwarded session cookie. Authorization is
//     enforced server-side (org_admin role + URL :id ==
//     claims.OrganizationID + M2MService.GetServiceAccount + the repo
//     SQL filter on organization_id + deleted_at IS NULL).
//   - 200 → ok with explicit 7-field projection per row; empty array
//     when nothing is linked; multiple rows when the backend's
//     LIMIT-2 invariant detection has surfaced a data-integrity issue.
//     The helper preserves whatever the backend returned (operator
//     visibility) rather than silently filtering.
//   - 400 → invalid (malformed UUID path segments).
//   - 403 → forbidden (role / URL-org / cross-org / missing-SA via
//     existence-oracle masking).
//   - Other non-2xx → generic safe error.
//   - NEVER exposes client_secret / client_secret_hash / service-
//     account credential / private key / signing key / token / cookie /
//     session-id (none of those fields exist in the backend DTO; the
//     allowlist projection is an additional belt-and-suspenders guard
//     against a future backend regression).

export interface LinkedOAuthClientForServiceAccount {
  id: string;
  client_id: string;
  name: string;
  is_public: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type ListServiceAccountOAuthClientsResult =
  | { ok: true; oauth_clients: LinkedOAuthClientForServiceAccount[] }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      notFound: boolean;
      invalid: boolean;
      message: string;
    };

export async function listServiceAccountOAuthClients(
  orgID: string,
  serviceAccountID: string
): Promise<ListServiceAccountOAuthClientsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      forbidden: false,
      notFound: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }
  try {
    // Released OSS has no per-SA clients route; the org-scoped client list
    // carries service_account_id on each row (safeClient), so the linked set
    // is the org's clients filtered to this SA. The list handler org-pins an
    // org_admin actor server-side; orgID stays for caller intent only.
    void orgID;
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/clients?page=1&page_size=200`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        forbidden: false,
        notFound: false,
        invalid: true,
        message: "The linked-OAuth-clients request was rejected — check the supplied identifiers.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        forbidden: true,
        notFound: false,
        invalid: false,
        message: "You do not have permission to view this service account's OAuth clients.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        forbidden: false,
        notFound: true,
        invalid: false,
        message: "Service account not found.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        forbidden: false,
        notFound: false,
        invalid: false,
        message: "Could not load linked OAuth clients. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json().catch(() => ({}));
    // Released list shape { clients: [...] }; filter to rows bound to this SA.
    const allClients = Array.isArray(d?.clients) ? d.clients : [];
    const rawList = allClients.filter(
      // biome-ignore lint/suspicious/noExplicitAny: raw row before projection
      (r: any) =>
        typeof r?.service_account_id === "string" && r.service_account_id === serviceAccountID
    );
    // Explicit 7-field allowlist projection. Any extra key a future
    // backend regression returned would be dropped on the floor.
    const projected: LinkedOAuthClientForServiceAccount[] = rawList.map(
      // biome-ignore lint/suspicious/noExplicitAny: raw row before projection
      (r: any) => ({
        id: typeof r?.id === "string" ? r.id : "",
        client_id: typeof r?.client_id === "string" ? r.client_id : "",
        name: typeof r?.name === "string" ? r.name : "",
        is_public: typeof r?.is_public === "boolean" ? r.is_public : false,
        active: typeof r?.active === "boolean" ? r.active : false,
        created_at: typeof r?.created_at === "string" ? r.created_at : "",
        updated_at: typeof r?.updated_at === "string" ? r.updated_at : "",
      })
    );
    return { ok: true, oauth_clients: projected };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      notFound: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── disable / enable service account (slice identuum-20260530-service-account-disable-enable-ui) ──
//
// Wire helpers for the org-admin SA lifecycle UI. Call the IDP backend
// routes added by the prior backend slice:
//   POST /api/v1/organizations/:id/service-accounts/:sa_id/disable
//   POST /api/v1/organizations/:id/service-accounts/:sa_id/enable
//
// Contract:
//   - Path params carry both resource ids (encodeURIComponent on each).
//   - NO request body, NO Content-Type header.
//   - Authentication via the forwarded session cookie. Authorization is
//     enforced server-side (org_admin role + URL :id ==
//     claims.OrganizationID + M2MService.GetServiceAccount tenant guard
//     + existence-oracle masking).
//   - 200 → ok with the 8-field ServiceAccountLifecycleResponse
//     projection (success, message, organization_id, service_account_id,
//     service_account_name, role, previous_active, active).
//   - 400 → invalid (malformed UUID path segments).
//   - 403 → forbidden (role / URL-org / cross-org / missing SA).
//   - NEVER exposes client_secret / client_secret_hash / service-
//     account credential / private-key / signing-key / token / cookie /
//     session-id (the backend DTO doesn't carry any of those; the
//     explicit allowlist projection is a defence-in-depth guard
//     against a future backend regression).
//   - NO new credential is issued or rotated by either route — the
//     mutation is a single-column boolean flip on
//     service_accounts.active.

export interface ServiceAccountLifecycleResult {
  success: boolean;
  message: string;
  organization_id: string;
  service_account_id: string;
  service_account_name: string;
  role: string;
  previous_active: boolean;
  active: boolean;
}

export type DisableEnableServiceAccountResult =
  | { ok: true; data: ServiceAccountLifecycleResult }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      notFound: boolean;
      invalid: boolean;
      message: string;
    };

async function callServiceAccountLifecycle(
  orgID: string,
  serviceAccountID: string,
  segment: "disable" | "enable"
): Promise<DisableEnableServiceAccountResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      forbidden: false,
      notFound: false,
      invalid: false,
      message: "IdP is not configured.",
    };
  }
  try {
    void orgID;
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/service-accounts/${encodeURIComponent(serviceAccountID)}/${segment}`,
      {
        method: "POST",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        forbidden: false,
        notFound: false,
        invalid: true,
        message:
          segment === "disable"
            ? "The disable request was rejected — check the supplied identifiers."
            : "The enable request was rejected — check the supplied identifiers.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        forbidden: true,
        notFound: false,
        invalid: false,
        message:
          segment === "disable"
            ? "You do not have permission to disable this service account."
            : "You do not have permission to enable this service account.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        forbidden: false,
        notFound: true,
        invalid: false,
        message: "Service account not found.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        forbidden: false,
        notFound: false,
        invalid: false,
        message:
          segment === "disable"
            ? "Could not disable the service account. Please try again."
            : "Could not enable the service account. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json().catch(() => ({}));
    // Explicit 8-field allowlist projection. Any extra key a future
    // backend regression returned would be dropped on the floor.
    return {
      ok: true,
      data: {
        success: typeof d?.success === "boolean" ? d.success : true,
        message: typeof d?.message === "string" ? d.message : "",
        organization_id: typeof d?.organization_id === "string" ? d.organization_id : "",
        service_account_id: typeof d?.service_account_id === "string" ? d.service_account_id : "",
        service_account_name:
          typeof d?.service_account_name === "string" ? d.service_account_name : "",
        role: typeof d?.role === "string" ? d.role : "",
        previous_active: typeof d?.previous_active === "boolean" ? d.previous_active : false,
        active: typeof d?.active === "boolean" ? d.active : false,
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      notFound: false,
      invalid: false,
      message: "Network error. Please try again.",
    };
  }
}

export async function disableServiceAccount(
  orgID: string,
  serviceAccountID: string
): Promise<DisableEnableServiceAccountResult> {
  return callServiceAccountLifecycle(orgID, serviceAccountID, "disable");
}

export async function enableServiceAccount(
  orgID: string,
  serviceAccountID: string
): Promise<DisableEnableServiceAccountResult> {
  return callServiceAccountLifecycle(orgID, serviceAccountID, "enable");
}

// ── updateServiceAccount (slice identuum-20260530-service-account-edit-ui) ──
//
// Wire helper for the org-admin "Edit details" action on the SA
// detail page. Calls the IDP backend route added by the prior backend
// slice:
//   PATCH /api/v1/organizations/:id/service-accounts/:sa_id
//
// Contract:
//   - Path params carry both resource ids (encodeURIComponent on each).
//   - Body: JSON with EXACTLY 3 fields: name, description, role.
//   - Authentication via the forwarded session cookie. Authorization
//     is enforced server-side (org_admin role + URL :id ==
//     claims.OrganizationID + M2MService.GetServiceAccount tenant
//     guard + existence-oracle masking).
//   - 200 → ok with the safe 8-field MapServiceAccount projection
//     (id, organization_id, name, description, role, active,
//     created_at, updated_at).
//   - 400 → invalid (malformed UUID path segments / blank name /
//     invalid role).
//   - 403 → forbidden (role / URL-org / cross-org / missing SA).
//   - 404 → notFound.
//   - 409 → conflict (duplicate name — slice identuum-20260530-
//     service-account-name-conflict-backend). Surfaced as
//     {conflict: true} so the action can map to a name-field error.
//   - NEVER exposes client_secret / client_secret_hash / service-
//     account credential / secret_hash / private_key / signing_key /
//     access_token / refresh_token / authorization_code / Bearer /
//     Set-Cookie / session_id (the backend DTO doesn't carry any of
//     those; the explicit allowlist projection is a defence-in-depth
//     guard against a future backend regression).

export interface UpdateServiceAccountInput {
  name: string;
  description: string;
  role: string;
}

export type UpdateServiceAccountResult =
  | { ok: true; data: OrgServiceAccountItem }
  | {
      ok: false;
      status: number;
      forbidden: boolean;
      notFound: boolean;
      invalid: boolean;
      conflict: boolean;
      message: string;
    };

export async function updateServiceAccount(
  orgID: string,
  serviceAccountID: string,
  input: UpdateServiceAccountInput
): Promise<UpdateServiceAccountResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return {
      ok: false,
      status: 503,
      forbidden: false,
      notFound: false,
      invalid: false,
      conflict: false,
      message: "IdP is not configured.",
    };
  }
  try {
    void orgID;
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/service-accounts/${encodeURIComponent(serviceAccountID)}`,
      {
        // Released OSS updates a service account with PUT /service-accounts/:id.
        method: "PUT",
        headers: {
          ...(await idpAuthHeaders()),
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          role: input.role,
        }),
      }
    );
    if (res.status === 400)
      return {
        ok: false,
        status: 400,
        forbidden: false,
        notFound: false,
        invalid: true,
        conflict: false,
        message: "The edit request was rejected — check the supplied values.",
      };
    if (res.status === 403)
      return {
        ok: false,
        status: 403,
        forbidden: true,
        notFound: false,
        invalid: false,
        conflict: false,
        message: "You do not have permission to edit this service account.",
      };
    if (res.status === 404)
      return {
        ok: false,
        status: 404,
        forbidden: false,
        notFound: true,
        invalid: false,
        conflict: false,
        message: "Service account not found.",
      };
    if (res.status === 409)
      return {
        ok: false,
        status: 409,
        forbidden: false,
        notFound: false,
        invalid: false,
        conflict: true,
        message: "Service account name already exists.",
      };
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        forbidden: false,
        notFound: false,
        invalid: false,
        conflict: false,
        message: "Could not update the service account. Please try again.",
      };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const d: any = await res.json().catch(() => ({}));
    // Explicit 8-field projection — same shape as projectServiceAccount
    // so the action's success state mirrors what list/get returns.
    return {
      ok: true,
      data: {
        id: typeof d?.id === "string" ? d.id : "",
        organization_id: typeof d?.organization_id === "string" ? d.organization_id : "",
        name: typeof d?.name === "string" ? d.name : "",
        description: typeof d?.description === "string" ? d.description : "",
        role: typeof d?.role === "string" ? d.role : "",
        active: typeof d?.active === "boolean" ? d.active : true,
        created_at: typeof d?.created_at === "string" ? d.created_at : "",
        updated_at: typeof d?.updated_at === "string" ? d.updated_at : "",
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      forbidden: false,
      notFound: false,
      invalid: false,
      conflict: false,
      message: "Network error. Please try again.",
    };
  }
}

// ── Organization protocol settings (site_admin only) ─────────────────────────
//
// Backed by two routes added in the IDP org-protocol-settings slice:
//
//   GET  /api/v1/organizations/:id/protocol-settings
//   PUT  /api/v1/organizations/:id/protocol-settings
//
// Both routes are site_admin-only. The GET returns the effective state
// (system defaults when no explicit row exists) plus a `source` field that
// tells the UI whether an operator has explicitly configured the org.
//
// SECURITY:
//   - No DCR tokens, IATs, RATs, client_secret values, or signing material
//     ever appear in these responses — only two booleans and metadata.
//   - The sanitiser projects only the five documented fields; any
//     unexpected backend field is silently dropped.

function sanitizeOrgProtocolSettings(raw: unknown): OrgProtocolSettings {
  // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
  const r = (raw ?? {}) as any;
  const rawSource = String(r.source ?? "default");
  return {
    organization_id: String(r.organization_id ?? ""),
    dynamic_client_registration_enabled: Boolean(r.dynamic_client_registration_enabled),
    scim_enabled: Boolean(r.scim_enabled),
    source: rawSource === "explicit" ? "explicit" : "default",
    created_at: typeof r.created_at === "string" && r.created_at ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" && r.updated_at ? r.updated_at : null,
  };
}

/**
 * Fetches the per-organization DCR + SCIM enable/disable settings.
 *
 * Backend: GET /api/v1/organizations/:id/protocol-settings
 *          (site_admin for any org; same-org org_admin with orgs:settings:update scope).
 *
 * Returns a discriminated GetOrgProtocolSettingsResult so callers can render
 * per-reason copy instead of a single generic notice:
 *   ok=true  — settings fetched.
 *   ok=false — reason: not_authenticated (401) | forbidden (403) |
 *              not_found (404/501) | unavailable (IDP off / 503 / network) | unknown.
 *
 * This function never throws — all errors become a typed failure result.
 */
export async function getOrgProtocolSettings(orgId: string): Promise<GetOrgProtocolSettingsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, reason: "unavailable", status: 0 };

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgId)}/protocol-settings`,
      {
        method: "GET",
        headers: await idpAuthHeaders(),
        cache: "no-store",
      }
    );
    if (res.status === 401) return { ok: false, reason: "not_authenticated", status: 401 };
    if (!res.ok) {
      const body = res.status === 402 || res.status === 403 ? await safeErrorBody(res) : undefined;
      const classified = classifyIDPStatus(res.status, body);
      if (classified.kind === "forbidden")
        return { ok: false, reason: "forbidden", status: res.status };
      if (classified.kind === "not_licensed")
        return { ok: false, reason: "not_licensed", status: res.status };
      if (classified.kind === "feature_absent")
        return { ok: false, reason: "not_found", status: res.status };
      if (classified.kind === "unavailable")
        return { ok: false, reason: "unavailable", status: res.status };
      return { ok: false, reason: "unknown", status: res.status };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return { ok: true, settings: sanitizeOrgProtocolSettings(data) };
  } catch {
    return { ok: false, reason: "unavailable", status: 0 };
  }
}

export type UpdateOrgProtocolSettingsResult =
  | { ok: true; settings: OrgProtocolSettings }
  | {
      ok: false;
      status: number;
      reason: Exclude<IDPStatusKind, "available"> | "not_authenticated";
      notFound: boolean;
      forbidden: boolean;
      unavailable: boolean;
      notLicensed: boolean;
    };

type IDPFailureClassification = Omit<IDPStatusClassification, "kind"> & {
  kind: Exclude<IDPStatusKind, "available">;
};

function toIDPFailureClassification(classified: IDPStatusClassification): IDPFailureClassification {
  switch (classified.kind) {
    case "unavailable":
    case "feature_absent":
    case "forbidden":
    case "not_licensed":
    case "unknown":
      return { kind: classified.kind, status: classified.status };
    case "available":
      return { kind: "unknown", status: classified.status };
  }
}

function protocolSettingsFailure(
  classified: IDPFailureClassification | { kind: "not_authenticated"; status: number }
): UpdateOrgProtocolSettingsResult {
  return {
    ok: false,
    status: classified.status,
    reason: classified.kind === "feature_absent" ? "feature_absent" : classified.kind,
    notFound: classified.kind === "feature_absent",
    forbidden: classified.kind === "forbidden",
    unavailable: classified.kind === "unavailable",
    notLicensed: classified.kind === "not_licensed",
  };
}

/**
 * Updates the per-organization DCR + SCIM enable/disable settings.
 *
 * Backend: PUT /api/v1/organizations/:id/protocol-settings (site_admin only).
 * Both booleans are REQUIRED — the backend rejects partial payloads (400).
 *
 * Returns the updated settings on success. On failure, returns a
 * discriminated error so server actions can surface appropriate copy.
 */
export async function updateOrgProtocolSettings(
  orgId: string,
  opts: {
    dynamic_client_registration_enabled: boolean;
    scim_enabled: boolean;
  }
): Promise<UpdateOrgProtocolSettingsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled)
    return protocolSettingsFailure({ kind: "unavailable", status: 503 });

  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(orgId)}/protocol-settings`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(await idpAuthHeaders()),
        },
        body: JSON.stringify({
          dynamic_client_registration_enabled: opts.dynamic_client_registration_enabled,
          scim_enabled: opts.scim_enabled,
        }),
        cache: "no-store",
      }
    );

    if (res.status === 401)
      return protocolSettingsFailure({ kind: "not_authenticated", status: 401 });
    if (!res.ok) {
      const body = res.status === 402 || res.status === 403 ? await safeErrorBody(res) : undefined;
      const classified = classifyIDPStatus(res.status, body);
      return protocolSettingsFailure(toIDPFailureClassification(classified));
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return { ok: true, settings: sanitizeOrgProtocolSettings(data) };
  } catch {
    return protocolSettingsFailure({ kind: "unavailable", status: 0 });
  }
}
