/**
 * AuditIPAddressCell — renders the IP column on the full audit
 * table (/org-admin/audit + /site-admin/audit).
 *
 * When the IDP recorded a client IP for the event the cell renders
 * the value verbatim — typically `<ip>/32` because Postgres INET
 * stringifies single-host addresses with the /32 prefix.
 *
 * When the IDP did not capture an IP — either because the event was
 * a system-emitted event with no request context, or because a
 * request-backed emission path forgot to thread c.ClientIP() (see
 * identuum-20260530-audit-event-ip-propagation-fix for the IDP-side
 * fix that closed the known gaps) — the cell renders the operator-
 * facing copy "Not captured" instead of a bare em dash. This is
 * clearer than "—" about the difference between "no IP recorded"
 * and "IP intentionally redacted".
 *
 * SECURITY:
 *   - This component is for the FULL audit table only. The compact
 *     Recent activity card on /org-admin/users/[id] is explicitly
 *     forbidden from rendering ip_address (see UI-FEATURES.md §6b
 *     "Compact recent-activity row content is operator-safe"). Do
 *     NOT import this component from the recent-activity card path.
 *   - The cell never renders raw audit metadata, never renders the
 *     user agent, never decodes or transforms the IP string.
 *   - An empty string is treated equivalently to null — the IDP-
 *     side prepareEvent coerces "" → nil, but the UI also defends
 *     against an empty-string slipping through any future regression.
 */

interface AuditIPAddressCellProps {
  /**
   * The ip_address field from AuditEventItem. Null / undefined /
   * empty string all render the "Not captured" placeholder.
   */
  value: string | null | undefined;
}

/**
 * Operator-facing copy for the not-captured placeholder. Exported
 * so tests can pin the exact string without depending on rendered
 * DOM.
 */
export const AUDIT_IP_NOT_CAPTURED_COPY = "Not captured";

export function AuditIPAddressCell({ value }: AuditIPAddressCellProps) {
  if (value && value.length > 0) {
    return <>{value}</>;
  }
  return (
    <span className="text-stone-400 italic" title="No client IP was recorded for this event">
      {AUDIT_IP_NOT_CAPTURED_COPY}
    </span>
  );
}
