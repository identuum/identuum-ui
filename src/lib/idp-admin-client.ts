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
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type {
  OrgDetail,
  OrgListItem,
  OrgListResult,
  OrgUserItem,
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

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
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
 *   The IdP handler calls ToOrganizationList(orgs, adminCounts) which sets
 *   OrganizationInfo.IsClaimed = (adminCounts[org.ID] > 0).
 *   Despite the name "is_claimed", the field means "has at least one active
 *   org_admin". This mapping is intentional but fragile: if the IdP changes
 *   the semantics of is_claimed (e.g. to reflect domain activation), this
 *   mapping MUST be updated.
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
      headers: { Cookie: await cookieHeader() },
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
      // is_claimed means "has at least one active org_admin" (see mapping note above).
      has_admin: Boolean(o.is_claimed),
      // can_assign_admin: true when site_admin recovery delegation is allowed (same
      // semantics as GenerateClaimToken — expired pending invitations don't block).
      can_assign_admin: Boolean(o.can_assign_admin),
      created_at: String(o.created_at ?? ""),
      updated_at: String(o.updated_at ?? ""),
    }));

    return {
      organizations,
      total_count: Number(data.total_count ?? 0),
      count: Number(data.count ?? 0),
      offset: Number(data.offset ?? 0),
      limit: Number(data.limit ?? limit),
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
        Cookie: await cookieHeader(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 409) return { ok: false, status: 409, conflict: true };
    if (!res.ok) return { ok: false, status: res.status, conflict: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const org = data.organization ?? {};

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
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const o = data.organization ?? {};

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
      has_admin: Boolean(o.is_claimed),
      can_assign_admin: Boolean(o.can_assign_admin),
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
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const o = data.organization ?? {};

    return {
      id: String(o.id ?? ""),
      name: String(o.name ?? ""),
      domain: String(o.domain ?? ""),
      slug: String(o.org_slug ?? ""),
      active: Boolean(o.active),
      deleted: Boolean(o.deleted),
      auth_policy: String(o.auth_policy ?? "local_only"),
      mfa_policy: String(o.mfa_policy ?? "optional"),
      has_admin: Boolean(o.is_claimed),
      // org_admin views their own org; recovery affordance is not applicable here.
      can_assign_admin: false,
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

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/organizations/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: await cookieHeader(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.status === 404) return { ok: false, status: 404, notFound: true, conflict: false };
    if (res.status === 409) return { ok: false, status: 409, notFound: false, conflict: true };
    if (!res.ok) return { ok: false, status: res.status, notFound: false, conflict: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const org = data.organization ?? {};

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
      headers: { Cookie: await cookieHeader() },
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
        headers: { Cookie: await cookieHeader() },
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
          Cookie: await cookieHeader(),
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
        Cookie: await cookieHeader(),
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
        Cookie: await cookieHeader(),
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
      headers: { Cookie: await cookieHeader() },
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
      headers: { Cookie: await cookieHeader() },
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
        headers: { Cookie: await cookieHeader() },
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
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) return null;

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const u = data.user ?? {};

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
        headers: { Cookie: await cookieHeader() },
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
        Cookie: await cookieHeader(),
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
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });

    if (res.status === 403) return { ok: false, status: 403, forbidden: true };
    if (!res.ok) return { ok: false, status: res.status, forbidden: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const raw = Array.isArray(data.sessions) ? data.sessions : [];

    const sessions: SessionItem[] = raw.map((s: any) => ({
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
        Cookie: await cookieHeader(),
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
 * Safe subset of an audit event for UI display.
 * Excludes: metadata (may contain sensitive keys), raw UUIDs, user_agent (verbose),
 * request_id, correlation_id, agent_session_id.
 * Backend: GET /api/v1/audit — Professional+ tier, site_admin/org_admin only.
 */
export interface AuditEventItem {
  created_at: string;
  event_type: string;
  /** Safe human-readable summary computed server-side (e.g. "User list viewed"). Nil for self-explanatory events. */
  summary: string | null;
  actor_email: string | null;
  actor_type: string;
  actor_role: string | null;
  /** UUID of the subject (user, organization, etc.). Opaque — only used as a routing key, not displayed as text. */
  subject_id: string | null;
  subject_email: string | null;
  subject_type: string | null;
  ip_address: string | null;
  priority: string;
}

export type ListAuditEventsResult =
  | { ok: true; events: AuditEventItem[]; total_count: number; page: number; page_size: number }
  | { ok: false; status: number; featureUnavailable: boolean; forbidden: boolean };

/**
 * Lists audit events for the authenticated admin.
 * site_admin sees all events; org_admin sees only their org's events (enforced at service layer).
 * Returns featureUnavailable=true when the Professional+ license gate blocks the endpoint.
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

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (opts?.eventType) params.set("event_type", opts.eventType);
  if (opts?.subjectType) params.set("subject_type", opts.subjectType);
  if (opts?.subjectId) params.set("subject_id", opts.subjectId);
  if (opts?.startDate) params.set("start_date", opts.startDate);
  if (opts?.endDate) params.set("end_date", opts.endDate);
  if (opts?.sortOrder && opts.sortOrder !== "desc") params.set("order", opts.sortOrder);

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/audit?${params}`, {
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });

    if (res.status === 403) {
      let featureUnavailable = false;
      try {
        // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
        const body: any = await res.json();
        if (
          typeof body?.message === "string" &&
          body.message.toLowerCase().includes("license tier")
        ) {
          featureUnavailable = true;
        }
      } catch {
        // ignore parse error
      }
      return { ok: false, status: 403, featureUnavailable, forbidden: !featureUnavailable };
    }

    if (!res.ok)
      return { ok: false, status: res.status, featureUnavailable: false, forbidden: false };

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const raw = Array.isArray(data.events) ? data.events : [];

    const events: AuditEventItem[] = raw.map((e: any) => ({
      created_at: String(e.created_at ?? ""),
      event_type: String(e.event_type ?? ""),
      summary: e.summary ? String(e.summary) : null,
      actor_email: e.actor_email ? String(e.actor_email) : null,
      actor_type: String(e.actor_type ?? ""),
      actor_role: e.actor_role ? String(e.actor_role) : null,
      subject_id: e.subject_id ? String(e.subject_id) : null,
      subject_email: e.subject_email ? String(e.subject_email) : null,
      subject_type: e.subject_type ? String(e.subject_type) : null,
      ip_address: e.ip_address ? String(e.ip_address) : null,
      priority: String(e.priority ?? "normal"),
    }));

    return {
      ok: true,
      events,
      total_count: typeof data.total_count === "number" ? data.total_count : 0,
      page: typeof data.page === "number" ? data.page : page,
      page_size: typeof data.page_size === "number" ? data.page_size : pageSize,
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
 * Requires Professional+ license (inherits AppendOnlyAudit gate from audit group).
 * Returns null on any failure; callers should fall back to the static list.
 */
export async function listAuditEventTypes(): Promise<AuditEventTypeGroupFromAPI[] | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return null;

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/audit/event-types`, {
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    if (!Array.isArray(data.groups)) return null;
    return data.groups.map((g: any) => ({
      label: String(g.label ?? ""),
      types: Array.isArray(g.types)
        ? g.types.map((t: any) => ({
            value: String(t.value ?? ""),
            label: String(t.label ?? ""),
          }))
        : [],
    }));
  } catch {
    return null;
  }
}
