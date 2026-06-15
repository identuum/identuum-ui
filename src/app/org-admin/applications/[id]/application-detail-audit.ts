/**
 * Helpers for the org-admin Application detail page's Recent activity
 * card. Mirrors the user-detail Recent activity helper at
 * /org-admin/users/[id]/user-detail-actions.ts but scopes events to a
 * specific OAuth client via subject_id = client UUID.
 *
 * The IDP backend slice identuum-20260530-client-audit-resource-subjects
 * landed resource-subject audit emissions for the five client lifecycle
 * events (client_created, client_updated, client_secret_rotated,
 * client_deleted, client_linked_service_account) — each row carries
 * subject_type="oauth_client" and subject_id=<client UUID>. The
 * /api/v1/audit list endpoint accepts both filters as separate query
 * params; this card uses subject_id alone for the data fetch and
 * subject_id+event_type for per-row drill-in.
 */

/**
 * Operator-facing copy for the Recent activity card on /org-admin/applications/[id].
 * Pinned by Vitest so a future refactor cannot silently change the
 * "Latest audit events where this application is the subject."
 * subtitle to ambiguous wording.
 */
export const APPLICATION_RECENT_ACTIVITY_COPY = {
  /** Card title rendered in the recent-activity card header. */
  title: "Recent activity",
  /** Card subtitle explaining the scope of the events listed. */
  subtitle: "Latest audit events where this application is the subject.",
  /** Link label rendered top-right of the card. */
  viewAllLabel: "View all →",
  /** Empty-state body copy. */
  emptyBody: "No recent activity recorded for this application.",
  /** Error-state body copy — intentionally non-technical. */
  errorBody:
    "Could not load recent activity for this application. Reload the page or try again later.",
} as const;

/**
 * Safe operator-facing labels for the five known OAuth-client lifecycle
 * audit event types. The keys MUST match the IDP audit event constants
 * exactly (see internal/domain/audit.go); the values are non-technical
 * single-sentence labels suitable for the compact row's primary text.
 *
 * If a new event type is added on the backend it will fall through to
 * `getApplicationAuditEventLabel`'s fallback path which renders the
 * raw event_type token — that is always safe (no secret material can
 * appear in an event type string) and surfaces the new event to
 * operators without an additional UI release.
 */
export const APPLICATION_AUDIT_EVENT_LABELS: Record<string, string> = {
  client_created: "Application created",
  client_updated: "Application updated",
  client_secret_rotated: "Client secret rotated",
  client_deleted: "Application deleted",
  client_linked_service_account: "Service account linked",
  client_unlinked_service_account: "Service account unlinked",
};

/**
 * Returns the operator-facing label for an audit event type. Known
 * client lifecycle events return their documented label; unknown
 * event types fall back to the raw event_type token so the operator
 * can identify the row without an additional UI release. The raw
 * event_type is always safe — no secret material can appear in an
 * AuditEventType constant.
 *
 * Empty / undefined event types fall back to "Application activity"
 * so the row never renders an empty primary span.
 */
export function getApplicationAuditEventLabel(eventType: string | null | undefined): string {
  if (typeof eventType !== "string" || eventType.length === 0) {
    return "Application activity";
  }
  const known = APPLICATION_AUDIT_EVENT_LABELS[eventType];
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
 *   - `applicationID` is URI-encoded before being placed in the
 *     `subject_id` query param so a UUID containing reserved
 *     characters could not break the URL shape.
 *   - `eventType`, when supplied, is also URI-encoded and added as
 *     the `event_type` query param. Per-row drill-in surfaces the
 *     specific event type the row described; the "View all" link
 *     omits this so the operator sees every row for the application.
 *   - Returns a path-only string (no scheme, no host, no
 *     protocol-relative leading `//`). Belt-and-suspenders pinned by
 *     tests.
 */
export function buildOrgAdminApplicationAuditHref(
  applicationID: string,
  eventType?: string
): string {
  const base = `/org-admin/audit?subject_id=${encodeURIComponent(applicationID)}`;
  if (eventType !== undefined && eventType !== "") {
    return `${base}&event_type=${encodeURIComponent(eventType)}`;
  }
  return base;
}
