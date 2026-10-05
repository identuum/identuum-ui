/**
 * FUNC-M16: the IdP pages audit events with limit/offset and answers
 * {events, has_more} with no total. The pages offer "Next" from has_more and
 * state only the range they show, never an invented total.
 */
export interface AuditPage {
  events: readonly unknown[];
  has_more: boolean;
  /** The absolute total, only when the IdP reports one. */
  total: number | null;
}

/** "Showing 51–100 events", or "… of N events" when the IdP gave a total. */
export function auditRangeLabel(page: number, pageSize: number, r: AuditPage): string {
  if (r.events.length === 0) {
    return page > 1 ? "No more audit events." : "No audit events found.";
  }
  const first = (page - 1) * pageSize + 1;
  const last = first + r.events.length - 1;
  if (r.total !== null) return `Showing ${first}–${last} of ${r.total} events`;
  return r.has_more
    ? `Showing ${first}–${last} — older events on the next page`
    : `Showing ${first}–${last} events`;
}
