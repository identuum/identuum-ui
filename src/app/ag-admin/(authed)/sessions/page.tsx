/**
 * Agent Sessions — read-only list page with backend-backed pagination,
 * search, sorting, status filtering, and optional agent_id exact-match filter.
 *
 * URL params: q, status, sort, dir, page, pageSize, agentId (UUID)
 *
 * agentId validation: only a well-formed UUID is forwarded to the backend as
 * agent_id. Non-UUID values show a safe invalid-filter notice and are never
 * sent to the backend.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - cnf_jkt, IBTs, tokens, acr, auth_time, and HITL metadata are excluded
 *     by AG and never present in the response.
 *   - On 401/403 the user is redirected to /ag-admin/login.
 *   - Internal AG URLs are never surfaced to the browser.
 *   - No write operations on this page.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalTime } from "@/components/ui/local-time";
import { agRequest } from "@/lib/ag-client";

export const metadata: Metadata = { title: "Agent Sessions — Identuum AG" };
export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const BACKEND_SORT_FIELDS = new Set(["created_at", "expires_at", "last_activity_at", "agent_mode"]);

const STATUS_FILTER_OPTIONS = ["all", "active", "expired", "revoked"] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

interface AgentSession {
  id: string;
  organization_id: string;
  ag_user_id?: string | null;
  agent_id?: string | null;
  intent: string;
  task_id?: string | null;
  agent_mode: string;
  allowed_tools: string[];
  max_input_tokens?: number | null;
  max_session_tokens?: number | null;
  created_at: string;
  last_activity_at: string;
  expires_at: string;
  revoked_at?: string | null;
  revocation_reason?: string | null;
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
  items: AgentSession[];
  pagination: PaginationMeta | null;
  rawArray: boolean;
}

interface AgentLabel {
  slug: string;
  name: string;
}

async function fetchSessions(params: {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  dir: string;
  status: StatusFilter;
  agentId?: string;
}): Promise<FetchResult | "auth_error" | "unavailable"> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("page_size", String(params.pageSize));
  if (params.q) qs.set("q", params.q);
  if (params.sort && BACKEND_SORT_FIELDS.has(params.sort)) qs.set("sort", params.sort);
  if (params.dir === "asc") qs.set("dir", "asc");
  if (params.status && params.status !== "all") qs.set("status", params.status);
  // Only forward agentId when it is a validated UUID.
  if (params.agentId && isUUID(params.agentId)) qs.set("agent_id", params.agentId);

  const res = await agRequest(`/admin/agent-sessions?${qs.toString()}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return "unavailable";
  }

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "items" in raw &&
    "pagination" in raw
  ) {
    const typed = raw as { items: AgentSession[]; pagination: PaginationMeta };
    return { items: typed.items ?? [], pagination: typed.pagination, rawArray: false };
  }

  if (Array.isArray(raw)) {
    return { items: raw as AgentSession[], pagination: null, rawArray: true };
  }

  return "unavailable";
}

async function fetchAgentLabel(agentId: string): Promise<AgentLabel | null> {
  try {
    const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(agentId)}`);
    if (!res || !res.ok) return null;
    const d = (await res.json()) as { slug?: string; name?: string };
    if (!d.slug) return null;
    return { slug: d.slug, name: d.name ?? d.slug };
  } catch {
    return null;
  }
}

function sessionStatus(s: AgentSession): "revoked" | "expired" | "active" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

type SortDir = "asc" | "desc";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SessionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const rawSort = typeof params.sort === "string" ? params.sort : "created_at";
  const sortField = BACKEND_SORT_FIELDS.has(rawSort) ? rawSort : "created_at";
  const sortDir: SortDir = typeof params.dir === "string" && params.dir === "asc" ? "asc" : "desc";
  const statusFilter = (
    STATUS_FILTER_OPTIONS.includes(params.status as StatusFilter) ? params.status : "all"
  ) as StatusFilter;
  const rawPageSize = Number.parseInt(
    typeof params.pageSize === "string" ? params.pageSize : "",
    10
  );
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : DEFAULT_PAGE_SIZE;
  const rawPage = Number.parseInt(typeof params.page === "string" ? params.page : "", 10);
  const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);

  // agentId: read from URL, validate as UUID before forwarding to backend.
  const rawAgentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const validAgentId = rawAgentId && isUUID(rawAgentId) ? rawAgentId : null;
  const invalidAgentId = rawAgentId && !validAgentId ? rawAgentId : null;

  // Fetch sessions and agent label (when filter active) in parallel.
  const [result, agentLabel] = await Promise.all([
    fetchSessions({
      page,
      pageSize,
      q,
      sort: sortField,
      dir: sortDir,
      status: statusFilter,
      agentId: validAgentId ?? undefined,
    }),
    validAgentId ? fetchAgentLabel(validAgentId) : Promise.resolve(null),
  ]);

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  // buildUrl produces a URL for navigation links, preserving the active filter state.
  // validAgentId is always preserved so pagination/sort/status stay scoped to the agent.
  function buildUrl(overrides: Record<string, string | number>) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (validAgentId) p.set("agentId", validAgentId);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (sortField !== "created_at") p.set("sort", sortField);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
    const s = p.toString();
    return `/ag-admin/sessions${s ? `?${s}` : ""}`;
  }

  // clearAgentUrl removes agentId while preserving other active filters.
  function clearAgentUrl() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (sortField !== "created_at") p.set("sort", sortField);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    const s = p.toString();
    return `/ag-admin/sessions${s ? `?${s}` : ""}`;
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

  if (result === "unavailable") {
    return (
      <div className="space-y-6">
        <PageHeader />
        <UnavailableState />
      </div>
    );
  }

  const { items, pagination, rawArray } = result;
  const totalDisplay = pagination ? pagination.total_items : items.length;
  const currentPage = pagination ? pagination.page : 1;
  const totalPages = pagination ? pagination.total_pages : 1;
  const hasPrev = pagination ? pagination.has_previous : false;
  const hasNext = pagination ? pagination.has_next : false;

  return (
    <div className="space-y-6">
      <PageHeader total={totalDisplay} rawArray={rawArray} />

      {/* Agent filter banner — shown when a valid agentId filter is active */}
      {validAgentId && (
        <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 text-xs">
          <div className="flex-1 text-sky-800">
            {agentLabel ? (
              <>
                Showing sessions for agent{" "}
                <a
                  href={`/ag-admin/agents/${validAgentId}`}
                  className="font-semibold hover:underline"
                >
                  {agentLabel.name}
                </a>
                {agentLabel.name !== agentLabel.slug && (
                  <span className="text-sky-500 ml-1 font-mono text-[10px]">
                    (Agent key: {agentLabel.slug})
                  </span>
                )}
              </>
            ) : (
              <>
                Showing sessions for agent{" "}
                <span className="font-mono">{validAgentId.slice(0, 12)}…</span>
              </>
            )}
          </div>
          <a
            href={clearAgentUrl()}
            className="shrink-0 text-sky-600 hover:text-sky-800 hover:underline font-medium"
            aria-label="Clear agent filter"
          >
            Clear filter
          </a>
        </div>
      )}

      {/* Invalid agentId notice — shown when agentId URL param is not a UUID */}
      {invalidAgentId && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs">
          <span className="flex-1 text-amber-800">
            Invalid agent filter — <span className="font-mono">{invalidAgentId.slice(0, 40)}</span>{" "}
            is not a valid UUID. Showing all sessions.
          </span>
          <a
            href="/ag-admin/sessions"
            className="shrink-0 text-amber-600 hover:text-amber-800 hover:underline font-medium"
          >
            Clear filter
          </a>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTER_OPTIONS.map((s) => {
          const active = statusFilter === s;
          const url = buildUrl({ status: s, page: 1 });
          return (
            <a
              key={s}
              href={url}
              aria-current={active ? "page" : undefined}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium capitalize transition-colors ${
                active
                  ? "bg-sky-700 text-white border-sky-700"
                  : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
              }`}
            >
              {s}
            </a>
          );
        })}
      </div>

      {/* Page size selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-stone-400">Per page:</span>
        {PAGE_SIZES.map((n) => {
          const active = n === pageSize;
          const ps = new URLSearchParams();
          if (q) ps.set("q", q);
          if (validAgentId) ps.set("agentId", validAgentId);
          if (statusFilter !== "all") ps.set("status", statusFilter);
          if (sortField !== "created_at") ps.set("sort", sortField);
          if (sortDir !== "desc") ps.set("dir", sortDir);
          if (n !== DEFAULT_PAGE_SIZE) ps.set("pageSize", String(n));
          ps.set("page", "1");
          const href = `/ag-admin/sessions${ps.toString() ? `?${ps.toString()}` : ""}`;
          return (
            <a
              key={n}
              href={href}
              aria-current={active ? "true" : undefined}
              className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                active
                  ? "bg-sky-700 text-white border-sky-700"
                  : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
              }`}
            >
              {n}
            </a>
          );
        })}
        <span className="text-xs text-stone-300 ml-1">|</span>
        {/* Search form — hidden inputs preserve active filters */}
        <form method="GET" action="/ag-admin/sessions" className="flex items-center gap-2">
          {validAgentId && <input type="hidden" name="agentId" value={validAgentId} />}
          {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
          {sortField !== "created_at" && <input type="hidden" name="sort" value={sortField} />}
          {sortDir !== "desc" && <input type="hidden" name="dir" value={sortDir} />}
          {pageSize !== DEFAULT_PAGE_SIZE && (
            <input type="hidden" name="pageSize" value={String(pageSize)} />
          )}
          <label className="sr-only" htmlFor="ag-session-search">
            Search sessions
          </label>
          <input
            id="ag-session-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by intent, mode, session ID prefix…"
            className="text-xs rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-sky-500 w-72"
          />
          <button
            type="submit"
            className="text-xs rounded-lg bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 transition-colors"
          >
            Search
          </button>
          {/* Clear all: removes q and status but preserves agentId */}
          {(q || statusFilter !== "all") && (
            <a
              href={(() => {
                const p = new URLSearchParams();
                if (validAgentId) p.set("agentId", validAgentId);
                if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
                const s = p.toString();
                return `/ag-admin/sessions${s ? `?${s}` : ""}`;
              })()}
              className="text-xs text-stone-400 hover:text-stone-600 underline"
            >
              Clear all
            </a>
          )}
        </form>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-semibold text-sky-950">
            {totalDisplay === 0 && !q && !validAgentId ? "No sessions found" : "No sessions match"}
          </p>
          <p className="text-xs text-stone-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
            {totalDisplay === 0 && !q && !validAgentId
              ? "No agent sessions exist yet. Sessions are created when an agent exchanges a subject token."
              : `No sessions match your current filter${q ? ` for "${q}"` : ""}${validAgentId ? " for this agent" : ""}.`}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-stone-100 grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
              <span>Session / Intent</span>
              <span>Status</span>
              <span>Mode</span>
              <a
                href={sortUrl("last_activity_at")}
                className="hover:text-sky-700 flex items-center"
              >
                Last active {sortArrow("last_activity_at")}
              </a>
              <a href={sortUrl("created_at")} className="hover:text-sky-700 flex items-center">
                Created {sortArrow("created_at")}
              </a>
            </div>
            <div className="divide-y divide-stone-100">
              {items.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          </div>

          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            total={totalDisplay}
            pageSize={pageSize}
            rawArray={rawArray}
            prevUrl={hasPrev ? buildUrl({ page: currentPage - 1 }) : null}
            nextUrl={hasNext ? buildUrl({ page: currentPage + 1 }) : null}
          />
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ total, rawArray }: { total?: number; rawArray?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Agent Sessions</h1>
        <p className="text-sm text-stone-500 mt-0.5">Active and recent AG-native agent sessions.</p>
      </div>
      <div className="flex items-center gap-2">
        {total != null && (
          <span className="text-xs text-stone-400">
            {total} session{total !== 1 ? "s" : ""}
            {rawArray && <span className="ml-1 text-stone-300">(all loaded)</span>}
          </span>
        )}
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-stone-100 text-stone-500",
  revoked: "bg-red-50 text-red-600",
};

function SessionRow({ session: s }: { session: AgentSession }) {
  const status = sessionStatus(s);
  return (
    <div className="px-6 py-4 grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-start group hover:bg-stone-50/60 transition-colors">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/ag-admin/sessions/${s.id}`}
            className="text-sm font-semibold text-sky-950 hover:text-sky-700 hover:underline transition-colors truncate block max-w-sm"
            aria-label={`Session details: ${s.intent || s.id.slice(0, 8)}`}
          >
            {s.intent || "Untitled session"}
          </a>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400">
          <span className="font-mono">{s.id.slice(0, 12)}…</span>
          {s.agent_id && (
            <span>
              Agent:{" "}
              <a
                href={`/ag-admin/agents/${s.agent_id}`}
                className="font-mono hover:text-sky-600 hover:underline"
              >
                {s.agent_id.slice(0, 8)}…
              </a>
            </span>
          )}
          {s.task_id && (
            <span>
              Task: <span className="font-mono text-stone-300">{s.task_id.slice(0, 12)}…</span>
            </span>
          )}
        </div>
        {status === "revoked" && s.revocation_reason && (
          <p className="text-xs text-red-500">Reason: {s.revocation_reason}</p>
        )}
      </div>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded self-start mt-0.5 ${STATUS_STYLES[status]}`}
      >
        {status}
      </span>
      <span className="text-xs text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded text-[10px] font-medium self-start mt-0.5 whitespace-nowrap">
        {s.agent_mode}
      </span>
      <span className="text-[11px] text-stone-400 self-start pt-1 whitespace-nowrap">
        <LocalTime value={s.last_activity_at} />
      </span>
      <div className="shrink-0 text-right text-[11px] text-stone-400 space-y-0.5 self-start">
        <p>
          <LocalTime value={s.created_at} />
        </p>
        <a
          href={`/ag-admin/sessions/${s.id}`}
          className="text-sky-500 hover:text-sky-700 hover:underline text-[11px] font-medium transition-colors"
          aria-label={`Details for session ${s.id.slice(0, 8)}`}
        >
          Details →
        </a>
      </div>
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  rawArray,
  prevUrl,
  nextUrl,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  rawArray: boolean;
  prevUrl: string | null;
  nextUrl: string | null;
}) {
  if (rawArray) {
    return (
      <p className="text-xs text-stone-400 text-center">
        All {total} rows loaded — upgrade AG to enable backend pagination.
      </p>
    );
  }
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between text-xs text-stone-500">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        {prevUrl ? (
          <a
            href={prevUrl}
            aria-label="Previous page"
            className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 transition-colors"
          >
            ← Prev
          </a>
        ) : (
          <span className="px-3 py-1.5 rounded-lg border border-stone-100 bg-stone-50 text-stone-300 cursor-default">
            ← Prev
          </span>
        )}
        <span className="px-3 py-1.5 font-medium text-sky-950">
          {page} / {totalPages}
        </span>
        {nextUrl ? (
          <a
            href={nextUrl}
            aria-label="Next page"
            className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 transition-colors"
          >
            Next →
          </a>
        ) : (
          <span className="px-3 py-1.5 rounded-lg border border-stone-100 bg-stone-50 text-stone-300 cursor-default">
            Next →
          </span>
        )}
      </div>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Agent Sessions unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface.
      </p>
    </div>
  );
}
