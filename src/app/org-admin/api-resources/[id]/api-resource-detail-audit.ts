/**
 * Helpers for the org-admin API Resource detail page's Recent activity
 * card. Mirrors the Application audit-card helper at
 * /org-admin/applications/[id]/application-detail-audit.ts but scopes
 * events to a specific API resource via subject_id=<resource UUID>.
 *
 * The IDP backend slice identuum-20260530-api-resource-audit-subjects-backend
 * landed resource-subject audit emissions for the four API resource
 * lifecycle events (api_resource_created, api_resource_updated,
 * api_resource_deleted, api_resource_secret_rotated) — each row carries
 * subject_type="api_resource" and subject_id=<resource UUID>. The
 * /api/v1/audit list endpoint accepts both filters as separate query
 * params; this card uses subject_id alone for the data fetch and
 * subject_id+event_type for per-row drill-in.
 */

/**
 * Operator-facing copy for the Recent activity card on
 * /org-admin/api-resources/[id]. Pinned by Vitest so a future refactor
 * cannot silently change the "Latest audit events where this API
 * resource is the subject." subtitle to ambiguous wording.
 */
export const API_RESOURCE_RECENT_ACTIVITY_COPY = {
  /** Card title rendered in the recent-activity card header. */
  title: "Recent activity",
  /** Card subtitle explaining the scope of the events listed. */
  subtitle: "Latest audit events where this API resource is the subject.",
  /** Link label rendered top-right of the card. */
  viewAllLabel: "View all →",
  /** Empty-state body copy. */
  emptyBody: "No recent activity recorded for this API resource.",
  /** Error-state body copy — intentionally non-technical. */
  errorBody:
    "Could not load recent activity for this API resource. Reload the page or try again later.",
} as const;

/**
 * Safe operator-facing labels for the four known API resource
 * lifecycle audit event types. The keys MUST match the IDP audit event
 * constants exactly (see identuum-idp/internal/domain/audit.go:144-147);
 * the values are non-technical single-sentence labels suitable for the
 * compact row's primary text.
 *
 * If a new event type is added on the backend it will fall through to
 * `getApiResourceAuditEventLabel`'s fallback path which renders the
 * raw event_type token — that is always safe (no secret material can
 * appear in an AuditEventType constant) and surfaces the new event to
 * operators without an additional UI release.
 */
export const API_RESOURCE_AUDIT_EVENT_LABELS: Record<string, string> = {
  api_resource_created: "API resource created",
  api_resource_updated: "API resource updated",
  api_resource_deleted: "API resource deleted",
  api_resource_secret_rotated: "API resource secret rotated",
};

/**
 * Returns the operator-facing label for an audit event type. Known
 * lifecycle events return their documented label; unknown event types
 * fall back to the raw event_type token so the operator can identify
 * the row without an additional UI release. The raw event_type is
 * always safe — no secret material can appear in an AuditEventType
 * constant.
 *
 * Empty / undefined event types fall back to "API resource activity"
 * so the row never renders an empty primary span.
 */
export function getApiResourceAuditEventLabel(eventType: string | null | undefined): string {
  if (typeof eventType !== "string" || eventType.length === 0) {
    return "API resource activity";
  }
  const known = API_RESOURCE_AUDIT_EVENT_LABELS[eventType];
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
 *   - `resourceID` is URI-encoded before being placed in the
 *     `subject_id` query param so a UUID containing reserved
 *     characters could not break the URL shape.
 *   - `eventType`, when supplied, is also URI-encoded and added as
 *     the `event_type` query param. Per-row drill-in surfaces the
 *     specific event type the row described; the "View all" link
 *     omits this so the operator sees every row for the API resource.
 *   - Returns a path-only string (no scheme, no host, no
 *     protocol-relative leading `//`). Belt-and-suspenders pinned by
 *     tests.
 */
export function buildOrgAdminApiResourceAuditHref(resourceID: string, eventType?: string): string {
  const base = `/org-admin/audit?subject_id=${encodeURIComponent(resourceID)}`;
  if (eventType !== undefined && eventType !== "") {
    return `${base}&event_type=${encodeURIComponent(eventType)}`;
  }
  return base;
}
