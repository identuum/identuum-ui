/**
 * Audit log viewer — org_admin only (read-only).
 *
 * Auth and role are enforced by the parent /org-admin layout.
 * This page does NOT repeat the guard.
 *
 * Backend: GET /api/v1/audit
 *   - Requires Professional+ license tier (AppendOnlyAudit feature).
 *   - org_admin sees only events scoped to their own organization (enforced at service layer).
 *   - Filters and pagination are URL-backed via ?event_type, ?subject_type,
 *     ?window, ?start_date, ?end_date, ?sort, ?page.
 *
 * Security:
 *   - Metadata fields are excluded.
 *   - org_admin scoping is server-enforced — filters do not broaden visibility.
 *   - All filter params are validated server-side before forwarding to backend.
 */
import { listAuditEvents, listAuditEventTypes } from "@/lib/idp-admin-client";
import type { AuditEventItem } from "@/lib/idp-admin-client";
import { AuditIdentityCell } from "@/components/shared/audit-identity-cell";
import { AuditFilterPanel } from "@/components/shared/audit-filter-panel";
import type { AuditFilterValues } from "@/components/shared/audit-filter-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit Log — Identuum" };

const BASE_PATH = "/org-admin/audit";
const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

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
} {
  const eventType = str(params, "event_type", 64);
  const subjectType = str(params, "subject_type", 32);
  const window = str(params, "window", 8);
  const rawSort = str(params, "sort", 8);
  const sortOrder: "asc" | "desc" = rawSort === "asc" ? "asc" : "desc";

  const startDate = str(params, "start_date", 32);
  const endDate = str(params, "end_date", 32);

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
      const d = new Date(endDate);
      d.setUTCHours(23, 59, 59, 999);
      endDateISO = d.toISOString();
    }
  }

  return {
    filters: { eventType, subjectType, window, startDate, endDate, sortOrder },
    startDateISO,
    endDateISO,
  };
}

function pageHref(page: number, filters: AuditFilterValues): string {
  const p = new URLSearchParams({ page: String(page) });
  if (filters.eventType) p.set("event_type", filters.eventType);
  if (filters.subjectType) p.set("subject_type", filters.subjectType);
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

export default async function OrgAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const { filters, startDateISO, endDateISO } = parseAuditFilters(params);

  const [result, eventTypeGroups] = await Promise.all([
    listAuditEvents({
      page,
      pageSize: PAGE_SIZE,
      eventType: filters.eventType,
      subjectType: filters.subjectType,
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
        <p className="text-sm text-stone-500 mt-0.5">
          Audit events for your organization. Read-only.
        </p>
      </div>

      <AuditFilterPanel basePath={BASE_PATH} filters={filters} eventTypeGroups={eventTypeGroups} />

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
              sortHref={pageHref(1, {
                ...filters,
                sortOrder: filters.sortOrder === "desc" ? "asc" : "desc",
              })}
            />
          ) : (
            <EmptyPanel />
          )}
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between pt-2">
              <PaginationLink
                href={hasPrev ? pageHref(page - 1, filters) : undefined}
                label="← Previous"
                disabled={!hasPrev}
              />
              <span className="text-xs text-stone-400">Page {page}</span>
              <PaginationLink
                href={hasNext ? pageHref(page + 1, filters) : undefined}
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
                {e.summary && (
                  <p className="text-[10px] text-stone-400 mt-0.5 leading-tight">{e.summary}</p>
                )}
              </td>
              <td className="px-4 py-3 max-w-[180px]">
                <AuditIdentityCell value={e.actor_email} fallback={e.actor_type} />
              </td>
              <td className="px-4 py-3 max-w-[180px]">
                <AuditIdentityCell value={e.subject_email} fallback={e.subject_type} />
              </td>
              <td className="px-4 py-3 text-xs text-stone-400 font-mono whitespace-nowrap">
                {e.ip_address ?? <span className="text-stone-300">—</span>}
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
}: { href?: string; label: string; disabled: boolean }) {
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
    <div className="bg-white border border-stone-200 rounded-[1.5rem] px-6 py-8 shadow-sm">
      <p className="text-sm font-semibold text-stone-700">Audit log requires Professional tier</p>
      <p className="text-xs text-stone-400 mt-1 leading-relaxed">
        The audit log feature is available on Professional and Enterprise license tiers. Contact
        your site administrator to upgrade the license.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] px-6 py-8 shadow-sm">
      <p className="text-sm font-semibold text-red-600">Access denied</p>
      <p className="text-xs text-stone-400 mt-1">
        You do not have permission to view audit events.
      </p>
    </div>
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
