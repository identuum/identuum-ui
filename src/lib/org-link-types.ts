/**
 * org-link-types.ts
 *
 * Types for the organization-only link/import planning surface.
 *
 * SCOPE: organizations only.
 * NOT IN SCOPE: users, org_admins, passwords, MFA, role bindings, reviewers,
 * auditors, or any credential/identity data.
 */

/** Safe organization summary from the AG backend for link planning. */
export interface AGOrgSummary {
  id: string;
  name: string;
  display_name: string;
  status: string;
  created_at: string;
}

/**
 * AG organization summary extended with link state fields.
 * Added in AG migration 0028; returned by GET /api/v1/org-link/plan.
 */
export interface AGOrgSummaryWithLink extends AGOrgSummary {
  /** IDP organization UUID this AG org is linked to. Null/absent when unlinked. */
  linked_idp_org_id?: string | null;
  /** "linked" | "unlinked" */
  link_status: "linked" | "unlinked";
}

/** AG org-link plan response from GET /api/v1/org-link/plan. */
export interface AGOrgLinkPlanResponse {
  component: string;
  organizations: AGOrgSummaryWithLink[];
  import_available: boolean;
  import_unavailable_reason?: string;
}

/**
 * Safe organization summary from the IDP backend for link planning.
 * Sourced from the existing OrgListItem type (idp-admin-client already sanitizes it).
 */
export interface IDPOrgSummaryForLink {
  id: string;
  name: string;
  slug: string;
  domain: string;
  active: boolean;
  deleted: boolean;
  /**
   * Mirrors OrgListItem.has_admin: undefined when the backend did not emit
   * admin state (ABSENT ≠ NEGATIVE — only `false` may render "no admin").
   */
  has_admin: boolean | undefined;
}

/**
 * Combined org-link planning state returned by GET /api/org-link/plan.
 * No sensitive data — org names/IDs only, no user/credential/role data.
 */
export interface OrgLinkPlanState {
  /** True when IDP is configured and reachable. */
  idp_available: boolean;
  /** True when AG is configured and reachable. */
  ag_available: boolean;
  /** IDP organizations available for link planning. Empty when IDP unavailable. */
  idp_organizations: IDPOrgSummaryForLink[];
  /** AG organizations available for link planning. Empty when AG unavailable. */
  ag_organizations: AGOrgSummaryWithLink[];
  /** Whether org import/link is implemented and available on AG side. */
  import_available: boolean;
  /** Safe reason code when import is not available. */
  import_unavailable_reason: string | null;
  /** Safe error code if discovery failed; null on success. */
  error_code: string | null;
}

/** Safe error codes returned by the UI org-link write proxy routes. */
export type OrgLinkWriteErrorCode =
  | "invalid_request"
  /** AG operator session cookie is absent or the request was rejected with 401. */
  | "ag_auth_required"
  /** AG returned 403 for a reason other than system_org_not_allowed. */
  | "ag_forbidden"
  | "system_org_not_allowed"
  | "org_not_found"
  | "idp_org_already_linked"
  /** AG reports the requested organization name is already in use. */
  | "org_name_already_exists"
  /** AG write path is not configured (AG 503). */
  | "not_configured"
  /** AG backend is unreachable (network failure). */
  | "ag_unavailable"
  | "write_failed";

/** Safe result returned by link/unlink write operations. */
export interface OrgLinkWriteResult {
  ok: boolean;
  /** Updated organization summary on success. */
  organization?: AGOrgSummaryWithLink;
  /** Safe opaque error code on failure. No raw DB/AG errors. */
  error_code?: OrgLinkWriteErrorCode;
  /** Safe human-readable message for UI display. */
  message?: string;
}

/**
 * Safe batch result returned by the import-all action.
 * Organization-only: no user/admin/credential/role data.
 */
export interface ImportAllBatchResult {
  /** Number of organizations successfully imported. */
  imported: number;
  /** Number of organizations skipped (already linked, so no action needed). */
  skipped: number;
  /** Number of organizations that failed for reasons other than already-linked. */
  failed: number;
  /** Safe human-readable summary for UI display. */
  message: string;
  /** True when the batch completed without any unexpected failures. */
  ok: boolean;
  /** Safe error code when the entire operation was blocked before any work. */
  error_code?: OrgLinkWriteErrorCode;
}
