/**
 * Revocations — paginated read-only list page.
 *
 * Fetches GET /admin/revocations with pagination and filters.
 * Supports: page, pageSize, kind, sort, dir.
 *
 * Safety:
 *   - agRequest() attaches bearer token server-side; never reaches browser.
 *   - `jti` field is NOT displayed — JWT claim identifier (token-adjacent).
 *   - `organization_id` is internal metadata; not rendered.
 *   - Raw backend errors are not forwarded to browser.
 *   - Long reason text is clamped in list rows.
 *   - No write/undo actions on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revocations — Identuum AG" };

/** Safe subset of revocationDTO. jti and organization_id deliberately absent. */
interface RevocationRecord {
  id: string;
  kind: string;
  agent_session_id?: string | null;
  reason: string;
  revoked_at: string;
  revoked_by_user_id?: string | null;
  expires_at?: string | null;
}

interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
}

interface FetchResult {
  records: RevocationRecord[];
  pagination: PaginationMeta | null;
  count: number;
}

const KIND_LABELS: Record<string, string> = {
  session: "Session",
  jti: "Token (JTI)",
};

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

type KindFilter = "all" | "session" | "jti";
const KIND_OPTIONS: KindFilter[] = ["all", "session", "jti"];

const BACKEND_SORT_FIELDS = new Set(["revoked_at", "expires_at"]);

// fetchCount runs a page_size=1 call to read pagination.total_items.
// Returns null on any failure so a single count call never breaks the page.
async function fetchCount(kind?: string): Promise<number | null> {
  const qs = new URLSearchParams({ page: "1", page_size: "1", sort: "revoked_at", dir: "desc" });
  if (kind) qs.set("kind", kind);
  const res = await agRequest(`/admin/revocations?${qs.toString()}`);
  if (!res || !res.ok) return null;
  try {
    const data = await res.json();
    const total = data?.pagination?.total_items;
    return typeof total === "number" ? total : null;
  } catch {
    return null;
  }
}

async function fetchRevocations(params: {
  page: number;
  pageSize: number;
  kind: KindFilter;
  sort: string;
  dir: string;
}): Promise<FetchResult | "auth_error" | "unavailable"> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("page_size", String(params.pageSize));
  if (params.kind !== "all") qs.set("kind", params.kind);
  if (params.sort && BACKEND_SORT_FIELDS.has(params.sort)) qs.set("sort", params.sort);
  if (params.dir === "asc") qs.set("dir", "asc");

  const res = await agRequest(`/admin/revocations?${qs.toString()}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    const data = await res.json();
    if (!data || !Array.isArray(data.revocations)) return "unavailable";
    const records: RevocationRecord[] = (data.revocations as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id ?? ""),
      kind: String(r.kind ?? ""),
      // jti intentionally not mapped
      agent_session_id: r.agent_session_id != null ? String(r.agent_session_id) : null,
      reason: String(r.reason ?? ""),
      revoked_at: String(r.revoked_at ?? ""),
      revoked_by_user_id: r.revoked_by_user_id != null ? String(r.revoked_by_user_id) : null,
      expires_at: r.expires_at != null ? String(r.expires_at) : null,
    }));
    const pagination = data.pagination && typeof data.pagination === "object"
      ? (data.pagination as PaginationMeta)
      : null;
    return { records, pagination, count: pagination?.total_items ?? records.length };
  } catch {
    return "unavailable";
  }
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RevocationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const rawKind = typeof sp.kind === "string" ? sp.kind : "all";
  const kindFilter: KindFilter = KIND_OPTIONS.includes(rawKind as KindFilter)
    ? (rawKind as KindFilter)
    : "all";
  const rawPageSize = parseInt(typeof sp.pageSize === "string" ? sp.pageSize : "", 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : DEFAULT_PAGE_SIZE;
  const rawPage = parseInt(typeof sp.page === "string" ? sp.page : "", 10);
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const rawSort = typeof sp.sort === "string" ? sp.sort : "revoked_at";
  const sortField = BACKEND_SORT_FIELDS.has(rawSort) ? rawSort : "revoked_at";
  const sortDir = typeof sp.dir === "string" && sp.dir === "asc" ? "asc" : "desc";

  // Run main list and all three count-only calls in parallel.
  // Count calls use page_size=1 to minimise data transfer.
  // Failures in count calls degrade to null for that card only.
  const [result, totalCount, sessionCount, jtiCount] = await Promise.all([
    fetchRevocations({ page, pageSize, kind: kindFilter, sort: sortField, dir: sortDir }),
    fetchCount(),
    fetchCount("session"),
    fetchCount("jti"),
  ]);

  if (result === "auth_error") redirect("/ag-admin/login");

  const records = result !== "unavailable" ? result.records : [];
  const pagination = result !== "unavailable" ? result.pagination : null;
  const totalPages = pagination?.total_pages ?? 1;
  const hasPrev = pagination?.has_previous ?? false;
  const hasNext = pagination?.has_next ?? false;

  function buildUrl(overrides: Record<string, string | number>) {
    const p = new URLSearchParams();
    if (kindFilter !== "all") p.set("kind", kindFilter);
    if (sortField !== "revoked_at") p.set("sort", sortField);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
    const s = p.toString();
    return `/ag-admin/revocations${s ? `?${s}` : ""}`;
  }

  function kindUrl(k: KindFilter) {
    const p = new URLSearchParams();
    if (k !== "all") p.set("kind", k);
    if (sortField !== "revoked_at") p.set("sort", sortField);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", "1");
    const s = p.toString();
    return `/ag-admin/revocations${s ? `?${s}` : ""}`;
  }

  function sortUrl(field: string) {
    if (!BACKEND_SORT_FIELDS.has(field)) return "#";
    const newDir = sortField === field && sortDir === "desc" ? "asc" : "desc";
    return buildUrl({ sort: field, dir: newDir, page: 1 });
  }

  function sortArrow(field: string) {
    if (sortField !== field) return <span className="opacity-20 ml-0.5">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Revocations</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Operator-issued revocations that prevent further use of specific sessions or tokens.
          </p>
        </div>
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>

      {/* Summary cards — counts from parallel count-only calls */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Total revocations"
          value={totalCount}
          href={`/ag-admin/revocations`}
        />
        <SummaryCard
          label="Session revocations"
          value={sessionCount}
          href={`/ag-admin/revocations?kind=session`}
        />
        <SummaryCard
          label="Token (JTI) revocations"
          value={jtiCount}
          href={`/ag-admin/revocations?kind=jti`}
        />
      </div>

      {/* Kind filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {KIND_OPTIONS.map((k) => {
          const active = kindFilter === k;
          return (
            <a
              key={k}
              href={kindUrl(k)}
              aria-current={active ? "page" : undefined}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                active
                  ? "bg-sky-700 text-white border-sky-700"
                  : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
              }`}
            >
              {k === "jti" ? "Token (JTI)" : k === "all" ? "All" : "Session"}
            </a>
          );
        })}
        <span className="text-xs text-stone-300 ml-1">|</span>
        {/* Page size */}
        <span className="text-xs text-stone-400">Per page:</span>
        {PAGE_SIZES.map((n) => {
          const active = n === pageSize;
          const ps = new URLSearchParams();
          if (kindFilter !== "all") ps.set("kind", kindFilter);
          if (sortField !== "revoked_at") ps.set("sort", sortField);
          if (sortDir !== "desc") ps.set("dir", sortDir);
          if (n !== DEFAULT_PAGE_SIZE) ps.set("pageSize", String(n));
          ps.set("page", "1");
          const href = `/ag-admin/revocations${ps.toString() ? `?${ps.toString()}` : ""}`;
          return (
            <a key={n} href={href} aria-current={active ? "true" : undefined}
              className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                active ? "bg-sky-700 text-white border-sky-700"
                : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
              }`}
            >
              {n}
            </a>
          );
        })}
      </div>

      {/* List */}
      {result === "unavailable" ? (
        <UnavailableState />
      ) : records.length === 0 ? (
        <EmptyState kind={kindFilter} />
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-stone-100 grid grid-cols-[auto_1fr_auto] gap-4 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
              <span>Kind</span>
              <span>Target / Reason</span>
              <a href={sortUrl("revoked_at")} className="hover:text-sky-700 flex items-center">
                Revoked {sortArrow("revoked_at")}
              </a>
            </div>
            <div className="divide-y divide-stone-100">
              {records.map((r) => (
                <RevocationRow key={r.id} record={r} />
              ))}
            </div>
          </div>

          {/* Pagination */}
          {pagination && (
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>{Math.min((page - 1) * pageSize + 1, pagination.total_items)}–{Math.min(page * pageSize, pagination.total_items)} of {pagination.total_items}</span>
              <div className="flex items-center gap-1.5">
                {hasPrev ? (
                  <a href={buildUrl({ page: page - 1 })} aria-label="Previous page"
                    className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 transition-colors">
                    ← Prev
                  </a>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg border border-stone-100 bg-stone-50 text-stone-300 cursor-default">← Prev</span>
                )}
                <span className="px-3 py-1.5 font-medium text-sky-950">{page} / {totalPages}</span>
                {hasNext ? (
                  <a href={buildUrl({ page: page + 1 })} aria-label="Next page"
                    className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 transition-colors">
                    Next →
                  </a>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg border border-stone-100 bg-stone-50 text-stone-300 cursor-default">Next →</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <a href={href} className="bg-white border border-stone-200 rounded-2xl shadow-sm px-4 py-3 hover:border-sky-200 hover:shadow-md transition-all block">
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums text-sky-950">
        {value !== null ? value.toLocaleString() : "—"}
      </p>
    </a>
  );
}

function RevocationRow({ record: r }: { record: RevocationRecord }) {
  return (
    <div className="px-6 py-4 grid grid-cols-[auto_1fr_auto] gap-4 items-start hover:bg-stone-50/60 transition-colors">
      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mt-0.5 whitespace-nowrap ${
        r.kind === "session" ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-500"
      }`}>
        {KIND_LABELS[r.kind] ?? r.kind}
      </span>
      <div className="min-w-0 space-y-1">
        <div className="text-xs text-stone-500">
          {r.kind === "session" && r.agent_session_id ? (
            <span>
              Session:{" "}
              <a href={`/ag-admin/sessions/${r.agent_session_id}`} className="font-mono text-sky-600 hover:underline">
                {r.agent_session_id.slice(0, 12)}…
              </a>
            </span>
          ) : (
            <span className="font-mono text-stone-400">{r.id.slice(0, 12)}…</span>
          )}
          {r.revoked_by_user_id && (
            <span className="ml-3 text-stone-400">
              by <span className="font-mono">{r.revoked_by_user_id.slice(0, 8)}…</span>
            </span>
          )}
        </div>
        <p className="text-xs text-stone-700 leading-relaxed line-clamp-2 break-words">
          {r.reason || <span className="italic text-stone-400">No reason provided</span>}
        </p>
        {r.expires_at && (
          <p className="text-[11px] text-stone-400">Expires: {formatDate(r.expires_at)}</p>
        )}
      </div>
      <span className="text-[11px] text-stone-400 whitespace-nowrap pt-0.5">
        {formatDate(r.revoked_at)}
      </span>
    </div>
  );
}

function EmptyState({ kind }: { kind: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No revocations found</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        {kind !== "all"
          ? `No ${kind === "jti" ? "token (JTI)" : kind} revocations match the current filter.`
          : "No revocations have been issued yet."}
      </p>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Revocations unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-4">
        <a href="/ag-admin/sessions" className="text-xs text-sky-600 hover:underline">Agent Sessions →</a>
        <a href="/ag-admin/agents" className="text-xs text-sky-600 hover:underline">Agent Registry →</a>
        <a href="/ag-admin" className="text-xs text-sky-600 hover:underline">Dashboard →</a>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 19);
  }
}
