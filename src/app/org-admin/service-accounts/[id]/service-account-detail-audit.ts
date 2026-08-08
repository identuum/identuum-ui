/**
 * Helpers for the org-admin Service Account detail page's Recent
 * activity card. Mirrors the API Resource audit-card helper at
 * /org-admin/api-resources/[id]/api-resource-detail-audit.ts and the
 * OAuth client audit-card helper at
 * /org-admin/applications/[id]/application-detail-audit.ts but scopes
 * events to a specific service account via subject_id=<sa UUID>.
 *
 * The IDP backend slice
 * identuum-20260530-org-admin-service-account-recent-activity-backend
 * landed resource-subject audit emissions for the three service-account
 * lifecycle events (service_account_created, service_account_deleted,
 * service_account_linked_oauth_client) — each row carries
 * subject_type="service_account" and subject_id=<service account UUID>.
 * The /api/v1/audit list endpoint accepts both filters as separate
 * query params; this card uses subject_id alone for the data fetch and
 * subject_id+event_type for per-row drill-in.
 */

/**
 * Operator-facing copy for the Recent activity card on
 * /org-admin/service-accounts/[id]. Pinned by Vitest so a future
 * refactor cannot silently change the subtitle to ambiguous wording.
 */
export const SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY = {
  /** Card title rendered in the recent-activity card header. */
  title: "Recent activity",
  /** Card subtitle explaining the scope of the events listed. */
  subtitle: "Latest audit events where this service account is the subject.",
  /** Link label rendered top-right of the card. */
  viewAllLabel: "View all →",
  /** Empty-state body copy. */
  emptyBody: "No recent activity recorded for this service account.",
  /** Error-state body copy — intentionally non-technical. */
  errorBody:
    "Could not load recent activity for this service account. Reload the page or try again later.",
} as const;

/**
 * Safe operator-facing labels for the three known service-account
 * lifecycle audit event types. The keys MUST match the IDP audit event
 * constants exactly (see
 * identuum-idp/internal/domain/audit.go AuditServiceAccount* group);
 * the values are non-technical single-sentence labels suitable for the
 * compact row's primary text.
 *
 * If a new event type is added on the backend it will fall through to
 * `getServiceAccountAuditEventLabel`'s fallback path which renders the
 * raw event_type token — that is always safe (no secret material can
 * appear in an AuditEventType constant) and surfaces the new event to
 * operators without an additional UI release.
 */
export const SERVICE_ACCOUNT_AUDIT_EVENT_LABELS: Record<string, string> = {
  service_account_created: "Service account created",
  service_account_updated: "Service account updated",
  service_account_deleted: "Service account deleted",
  service_account_linked_oauth_client: "OAuth client linked",
  service_account_unlinked_oauth_client: "OAuth client unlinked",
  service_account_disabled: "Service account disabled",
  service_account_enabled: "Service account enabled",
  // Released identuum-idp-oss emits DOT-FORM actions (audit.Event.Action —
  // v0.3.2 subject-tags + tenant-scopes the whole family); the underscore
  // keys above are the retired monolith's spelling, kept for envelope
  // compatibility. Same labels, both spellings.
  "service_account.created": "Service account created",
  "service_account.updated": "Service account updated",
  "service_account.deleted": "Service account deleted",
  "service_account.linked_oauth_client": "OAuth client linked",
  "service_account.unlinked_oauth_client": "OAuth client unlinked",
  "service_account.disabled": "Service account disabled",
  "service_account.enabled": "Service account enabled",
};

/**
 * Returns the operator-facing label for an audit event type. Known
 * lifecycle events return their documented label; unknown event types
 * fall back to the raw event_type token so the operator can identify
 * the row without an additional UI release. The raw event_type is
 * always safe — no secret material can appear in an AuditEventType
 * constant.
 *
 * Empty / undefined event types fall back to "Service account activity"
 * so the row never renders an empty primary span.
 */
export function getServiceAccountAuditEventLabel(eventType: string | null | undefined): string {
  if (typeof eventType !== "string" || eventType.length === 0) {
    return "Service account activity";
  }
  const known = SERVICE_ACCOUNT_AUDIT_EVENT_LABELS[eventType];
  return known ?? eventType;
}

/**
 * Builds the audit page href for the Recent activity card's "View all"
 * link and (when an event_type is supplied) the per-row "View in
 * audit" link.
 *
 * Contract:
 *   - Always rooted at `/org-admin/audit` — NEVER `/site-admin/audit`.
 *     This is the org-admin authority surface; an org_admin must not
 *     be silently routed to the site-admin audit shell which they
 *     cannot access anyway.
 *   - `serviceAccountID` is URI-encoded before being placed in the
 *     `subject_id` query param so a UUID containing reserved
 *     characters could not break the URL shape.
 *   - `eventType`, when supplied, is also URI-encoded and added as
 *     the `event_type` query param. Per-row drill-in surfaces the
 *     specific event type the row described; the "View all" link
 *     omits this so the operator sees every row for the service
 *     account.
 *   - Returns a path-only string (no scheme, no host, no
 *     protocol-relative leading `//`). Belt-and-suspenders pinned by
 *     tests.
 */
export function buildOrgAdminServiceAccountAuditHref(
  serviceAccountID: string,
  eventType?: string
): string {
  const base = `/org-admin/audit?subject_id=${encodeURIComponent(serviceAccountID)}`;
  if (eventType !== undefined && eventType !== "") {
    return `${base}&event_type=${encodeURIComponent(eventType)}`;
  }
  return base;
}
