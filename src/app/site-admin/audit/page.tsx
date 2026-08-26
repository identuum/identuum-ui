import type { Metadata } from "next";
import type { AuditFilterValues } from "@/components/shared/audit-filter-panel";
import { AuditFilterPanel } from "@/components/shared/audit-filter-panel";
import { AuditIdentityCell } from "@/components/shared/audit-identity-cell";
import { AuditIPAddressCell } from "@/components/shared/audit-ip-address-cell";
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";
import type { AuditEventItem } from "@/lib/idp-admin-client";
/**
 * Audit log viewer — site_admin only (read-only).
 *
 * Auth and role are enforced by the parent /site-admin layout.
 * This page does NOT repeat the guard.
 *
 * Backend: GET /api/v1/audit
 *   - Requires Enterprise/CE commercial capability (AppendOnlyAudit feature).
 *   - site_admin sees all events system-wide.
 *   - Filters and pagination are URL-backed via ?event_type, ?subject_type,
 *     ?window, ?start_date, ?end_date, ?sort, ?page.
 *
 * Security:
 *   - Each event carries an expandable, read-only Details view (AuditEventDetails)
 *     surfacing the measured wire-contract fields the backend already ships:
 *     outcome, actor_id, actor_organization_id, user_agent, request_id,
 *     correlation_id, event id, and metadata (rendered via JSON.stringify).
 *     The backend's own redaction owns what enters audit rows — the UI reads
 *     only contract keys and invents nothing (AUDIT-DETAILS-1).
 *   - All filters are validated/sanitized server-side before forwarding to backend.
 *   - Backend enforces all authorization — no client-side filtering.
 */
import { listAuditEvents, listAuditEventTypes } from "@/lib/idp-admin-client";

export const metadata: Metadata = { title: "Audit Log — Identuum Admin" };

const BASE_PATH = "/site-admin/audit";
const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Zero UUID indicates a system/bootstrap context, not a real tenant org.
// Never link to an org detail page for this value.
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// ── Server-side param parsing ─────────────────────────────────────────────────

function str(
  params: Record<string, string | string[] | undefined>,
  key: string,
  maxLen = 100
): string | null {
  const v = Array.isArray(params[key]) ? (params[key] as string[])[0] : params[key];
  if (!v) return null;
  const s = v.trim().slice(0, maxLen);
  return s || null;
}

function parsePage(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_PAGE) return 1;
  return n;
}

function parseAuditFilters(params: Record<string, string | string[] | undefined>): {
  filters: AuditFilterValues;
  startDateISO: string | null;
  endDateISO: string | null;
  subjectId: string | null;
} {
  const eventType = str(params, "event_type", 64);
  const subjectType = str(params, "subject_type", 32);
  const subjectId = str(params, "subject_id", 36); // UUID = 36 chars max
  const window = str(params, "window", 8);
  const rawSort = str(params, "sort", 8);
  const sortOrder: "asc" | "desc" = rawSort === "asc" ? "asc" : "desc";

  // YYYY-MM-DD for form defaultValues
  const startDate = str(params, "start_date", 32);
  const endDate = str(params, "end_date", 32);

  // Compute ISO timestamps for backend from either preset or custom dates
  let startDateISO: string | null = null;
  let endDateISO: string | null = null;

  if (window === "24h") {
    startDateISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  } else if (window === "7d") {
    startDateISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (window === "30d") {
    startDateISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    if (startDate && !Number.isNaN(Date.parse(startDate))) {
      startDateISO = new Date(startDate).toISOString();
    }
    if (endDate && !Number.isNaN(Date.parse(endDate))) {
      // End of the specified day
      const d = new Date(endDate);
      d.setUTCHours(23, 59, 59, 999);
      endDateISO = d.toISOString();
    }
  }

  return {
    filters: { eventType, subjectType, window, startDate, endDate, sortOrder },
    startDateISO,
    endDateISO,
    subjectId,
  };
}

/** Build a pagination href that preserves active filters including subject_id */
function pageHref(page: number, filters: AuditFilterValues, subjectId?: string | null): string {
  const p = new URLSearchParams({ page: String(page) });
  if (filters.eventType) p.set("event_type", filters.eventType);
  if (filters.subjectType) p.set("subject_type", filters.subjectType);
  if (subjectId) p.set("subject_id", subjectId);
  if (filters.window) {
    p.set("window", filters.window);
  } else {
    if (filters.startDate) p.set("start_date", filters.startDate);
    if (filters.endDate) p.set("end_date", filters.endDate);
  }
  if (filters.sortOrder === "asc") p.set("sort", "asc");
  return `${BASE_PATH}?${p}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SiteAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const { filters, startDateISO, endDateISO, subjectId } = parseAuditFilters(params);

  const [result, eventTypeGroups] = await Promise.all([
    listAuditEvents({
      page,
      pageSize: PAGE_SIZE,
      eventType: filters.eventType,
      subjectType: filters.subjectType,
      subjectId,
      startDate: startDateISO,
      endDate: endDateISO,
      sortOrder: filters.sortOrder,
    }).catch(
      (): ReturnType<typeof listAuditEvents> =>
        Promise.resolve({ ok: false, status: 0, featureUnavailable: false, forbidden: false })
    ),
    listAuditEventTypes().catch(() => null),
  ]);

  const hasPrev = page > 1;
  const hasNext = result.ok && result.total_count > page * PAGE_SIZE;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Audit log</h1>
        <p className="text-sm text-stone-500 mt-0.5">System-wide audit events. Read-only.</p>
      </div>

      {/* Active subject filter notice — shown when subject_id comes from a "View all" or per-row link */}
      {subjectId && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
          <span className="text-xs text-stone-500">Subject filter active:</span>
          {filters.subjectType && (
            <span className="text-xs font-semibold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">
              {filters.subjectType}
            </span>
          )}
          {/* Org subject: replace raw truncated UUID with a clear message and optional link */}
          {filters.subjectType === "organization" &&
          UUID_RE.test(subjectId) &&
          subjectId !== ZERO_UUID ? (
            <>
              <span className="text-xs text-stone-500">Viewing events for one organization</span>
              <a
                href={`/site-admin/organizations/${subjectId}`}
                className="text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors"
              >
                View organization →
              </a>
            </>
          ) : filters.subjectType === "organization" && subjectId === ZERO_UUID ? (
            <span className="text-xs text-stone-500">System-level organization events</span>
          ) : (
            <span className="text-xs font-mono text-stone-500">{subjectId.slice(0, 8)}…</span>
          )}
          {filters.eventType && (
            <>
              <span className="text-xs text-stone-400">·</span>
              <span className="text-xs font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded font-mono">
                {filters.eventType}
              </span>
            </>
          )}
          <a
            href={BASE_PATH}
            className="ml-auto text-xs text-stone-400 hover:text-red-600 transition-colors"
            aria-label="Clear subject filter"
          >
            ✕ Clear
          </a>
        </div>
      )}

      <AuditFilterPanel
        basePath={BASE_PATH}
        filters={filters}
        eventTypeGroups={eventTypeGroups}
        subjectId={subjectId}
      />

      {!result.ok && result.featureUnavailable && <FeatureUnavailablePanel />}
      {!result.ok && result.forbidden && <ForbiddenPanel />}
      {!result.ok && !result.featureUnavailable && !result.forbidden && <ErrorPanel />}

      {result.ok && (
        <>
          <p className="text-xs text-stone-400">
            {result.total_count === 0
              ? "No audit events found."
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, result.total_count)} of ${result.total_count} events`}
          </p>
          {result.events.length > 0 ? (
            <AuditTable
              events={result.events}
              sortOrder={filters.sortOrder}
              sortHref={pageHref(
                1,
                {
                  ...filters,
                  sortOrder: filters.sortOrder === "desc" ? "asc" : "desc",
                },
                subjectId
              )}
            />
          ) : (
            <EmptyPanel />
          )}
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between pt-2">
              <PaginationLink
                href={hasPrev ? pageHref(page - 1, filters, subjectId) : undefined}
                label="← Previous"
                disabled={!hasPrev}
              />
              <span className="text-xs text-stone-400">Page {page}</span>
              <PaginationLink
                href={hasNext ? pageHref(page + 1, filters, subjectId) : undefined}
                label="Next →"
                disabled={!hasNext}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AuditTable({
  events,
  sortOrder,
  sortHref,
}: {
  events: AuditEventItem[];
  sortOrder: "asc" | "desc";
  sortHref: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 bg-white">
            <Th href={sortHref} title={sortOrder === "desc" ? "Oldest first" : "Newest first"}>
              Time {sortOrder === "desc" ? "↓" : "↑"}
            </Th>
            <Th>Event</Th>
            <Th>Actor</Th>
            <Th>Target</Th>
            <Th>IP</Th>
            <Th>Priority</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
            <tr key={i} className="hover:bg-stone-50/60 transition-colors">
              <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                {formatDate(e.created_at)}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs font-mono text-sky-950">{e.event_type}</span>
                {/* AUDIT-DETAILS-1: per-event read-only expandable details —
                    the fields the backend already ships (outcome, actor/request/
                    correlation ids, user agent, metadata) that the log used to
                    drop. No mutation; no navigation off the page. */}
                <AuditEventDetails event={e} />
              </td>
              <td className="px-4 py-3 max-w-[180px]">
                <AuditIdentityCell value={e.actor_email} fallback={e.actor_type} />
              </td>
              <td className="px-4 py-3 max-w-[200px]">
                <div className="space-y-0.5">
                  {/* Zero UUID = system/collection context — show a clearer label
                      instead of a generic "organization" fallback */}
                  {e.subject_type === "organization" && e.subject_id === ZERO_UUID ? (
                    <span className="text-xs text-stone-400">organization collection</span>
                  ) : (
                    <AuditIdentityCell value={e.subject_email} fallback={e.subject_type} />
                  )}
                  {/* Safe navigation link — excluded for zero UUID (system context) */}
                  {e.subject_type === "organization" &&
                    e.subject_id &&
                    UUID_RE.test(e.subject_id) &&
                    e.subject_id !== ZERO_UUID && (
                      <a
                        href={`/site-admin/organizations/${e.subject_id}`}
                        className="block text-[10px] text-sky-600 hover:text-sky-800 transition-colors"
                      >
                        View organization →
                      </a>
                    )}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-stone-400 font-mono whitespace-nowrap">
                <AuditIPAddressCell value={e.ip_address} />
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={e.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// AUDIT-DETAILS-1: a read-only expandable view of the per-event details the
// backend already ships (outcome, actor/request/correlation ids, user agent,
// metadata). It renders nothing when the event carries none of them, so
// self-explanatory events stay uncluttered. No mutation, no navigation.
function AuditEventDetails({ event }: { event: AuditEventItem }) {
  const rows: Array<[string, string | null]> = [
    ["Outcome", event.outcome],
    ["Actor ID", event.actor_id],
    ["Actor org", event.actor_organization_id],
    ["User agent", event.user_agent],
    ["Request ID", event.request_id],
    ["Correlation ID", event.correlation_id],
    ["Event ID", event.id],
  ];
  const shown = rows.filter(([, v]) => v);
  const hasMetadata = event.metadata != null && Object.keys(event.metadata).length > 0;
  if (shown.length === 0 && !hasMetadata) return null;
  return (
    <details className="mt-1">
      <summary className="text-[10px] text-sky-600 cursor-pointer select-none hover:text-sky-800">
        Details
      </summary>
      <dl className="mt-1 space-y-0.5 text-[10px]">
        {shown.map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="font-medium text-stone-400 shrink-0">{label}:</dt>
            <dd className="font-mono break-all text-stone-600">{value}</dd>
          </div>
        ))}
        {hasMetadata && (
          <div className="flex gap-1.5">
            <dt className="font-medium text-stone-400 shrink-0">Metadata:</dt>
            <dd className="font-mono break-all whitespace-pre-wrap text-stone-600">
              {JSON.stringify(event.metadata)}
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}

function Th({
  children,
  href,
  title,
}: {
  children: React.ReactNode;
  href?: string;
  title?: string;
}) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">
      {href ? (
        <a href={href} title={title} className="hover:text-sky-700 transition-colors">
          {children}
        </a>
      ) : (
        children
      )}
    </th>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase();
  if (p === "critical")
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
        critical
      </span>
    );
  if (p === "high")
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        high
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 border border-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
      normal
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function PaginationLink({
  href,
  label,
  disabled,
}: {
  href?: string;
  label: string;
  disabled: boolean;
}) {
  if (disabled || !href)
    return (
      <span className="text-xs text-stone-300 px-3 py-1.5 rounded-lg cursor-not-allowed select-none">
        {label}
      </span>
    );
  return (
    <a
      href={href}
      className="text-xs text-stone-500 hover:text-sky-950 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-stone-300 transition-colors"
    >
      {label}
    </a>
  );
}

function FeatureUnavailablePanel() {
  return (
    <FeatureBoundaryPanel
      title="Audit log requires Enterprise/CE"
      body="The system-wide audit log is a commercial IDP capability. In IDP OSS, direct access shows this boundary instead of treating the page as a supported Starter feature."
    />
  );
}

function ForbiddenPanel() {
  return (
    <FeatureBoundaryPanel
      title="Access denied"
      body="You do not have permission to view audit events."
      tone="error"
    />
  );
}

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] px-6 py-8 shadow-sm">
      <p className="text-sm font-medium text-red-600">Could not load audit events</p>
      <p className="text-xs text-stone-500 mt-1">
        The IdP returned an error or is temporarily unavailable. Reload to retry.
      </p>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] px-6 py-12 text-center shadow-sm">
      <p className="text-sm font-medium text-stone-400">No audit events found.</p>
    </div>
  );
}
