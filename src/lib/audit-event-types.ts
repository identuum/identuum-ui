/**
 * The audit filter's event list comes from the server (GET
 * /api/v1/audit/event-types, UI-0913-C-FOLLOWUP). The compile-time list that
 * lived here is gone, so it can no longer drift from what the server records.
 */

/** Convert a snake_case / UPPER_CASE event type to a readable label. */
export function humanizeEventType(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
