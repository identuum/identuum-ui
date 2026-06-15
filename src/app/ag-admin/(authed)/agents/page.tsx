/**
 * Agent Registry — read-only list page with backend-backed pagination,
 * search, and sorting.
 *
 * Query params are forwarded to the AG backend so filtering/sorting/pagination
 * runs in the database, not in this component. The component only renders the
 * page of results returned by the backend.
 *
 * Compatibility: if the backend returns a raw JSON array (old behaviour or
 * mixed-version testing), the component falls back to rendering all items
 * with a "all rows loaded" indicator and no pagination metadata.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - Only safe operational fields are rendered: slug, name, mode, tools,
 *     enabled flag, timestamps.
 *   - On 401 the user is redirected to /ag-admin/login.
 *   - Internal AG URLs are never surfaced to the browser.
 *   - No write operations on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Agent Registry — Identuum AG" };
export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

// Backend allowlist: only fields the AG /admin/agent-registry sort param accepts.
const BACKEND_SORT_FIELDS = new Set(["slug", "name", "created_at", "updated_at", "enabled"]);

/** Safe subset of AgentRegistryDTO from identuum-ag */
interface AgentEntry {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  default_agent_mode: string;
  allowed_tools_default: string[];
  default_max_input_tokens?: number | null;
  default_max_session_tokens?: number | null;
  max_session_duration_seconds: number;
  capability_ceiling?: unknown;
  enabled: boolean;
  created_at: string;
  updated_at: string;
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
  items: AgentEntry[];
  pagination: PaginationMeta | null;
  rawArray: boolean;
}

async function fetchAgents(params: {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  dir: string;
}): Promise<FetchResult | "auth_error" | "unavailable"> {
  // Build query string forwarding all supported params to the backend.
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("page_size", String(params.pageSize));
  if (params.q) qs.set("q", params.q);
  if (params.sort && BACKEND_SORT_FIELDS.has(params.sort)) qs.set("sort", params.sort);
  if (params.dir === "asc") qs.set("dir", "asc");

  const res = await agRequest(`/admin/agent-registry?${qs.toString()}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return "unavailable";
  }

  // Paginated response shape: { items: [...], pagination: {...} }
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "items" in raw &&
    "pagination" in raw
  ) {
    const typed = raw as { items: AgentEntry[]; pagination: PaginationMeta };
    return { items: typed.items ?? [], pagination: typed.pagination, rawArray: false };
  }

  // Fallback: raw array (old backend or no pagination params honoured)
  if (Array.isArray(raw)) {
    return { items: raw as AgentEntry[], pagination: null, rawArray: true };
  }

  return "unavailable";
}

type SortDir = "asc" | "desc";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const rawSort = typeof params.sort === "string" ? params.sort : "created_at";
  const sortField = BACKEND_SORT_FIELDS.has(rawSort) ? rawSort : "created_at";
  const sortDir: SortDir = typeof params.dir === "string" && params.dir === "asc" ? "asc" : "desc";
  const rawPageSize = Number.parseInt(
    typeof params.pageSize === "string" ? params.pageSize : "",
    10
  );
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : DEFAULT_PAGE_SIZE;
  const rawPage = Number.parseInt(typeof params.page === "string" ? params.page : "", 10);
  const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);

  const result = await fetchAgents({ page, pageSize, q, sort: sortField, dir: sortDir });

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  function buildUrl(overrides: Record<string, string | number>) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (sortField !== "created_at") p.set("sort", sortField);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
    const s = p.toString();
    return `/ag-admin/agents${s ? `?${s}` : ""}`;
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

  // If backend returned a raw array, we got all rows; report this clearly.
  const totalDisplay = pagination ? pagination.total_items : items.length;
  const currentPage = pagination ? pagination.page : 1;
  const totalPages = pagination ? pagination.total_pages : 1;
  const hasPrev = pagination ? pagination.has_previous : false;
  const hasNext = pagination ? pagination.has_next : false;

  return (
    <div className="space-y-6">
      <PageHeader total={totalDisplay} query={q} rawArray={rawArray} />

      {/* Page size selector — navigation links, not a form select.
           Using links avoids the React uncontrolled/defaultValue reconciliation
           bug where client-side navigation ignores defaultValue changes. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-stone-400">Per page:</span>
        {PAGE_SIZES.map((n) => {
          const active = n === pageSize;
          // Build URL that preserves q/sort/dir but changes pageSize and resets page.
          const ps = new URLSearchParams();
          if (q) ps.set("q", q);
          if (sortField !== "created_at") ps.set("sort", sortField);
          if (sortDir !== "desc") ps.set("dir", sortDir);
          if (n !== DEFAULT_PAGE_SIZE) ps.set("pageSize", String(n));
          ps.set("page", "1");
          const href = `/ag-admin/agents${ps.toString() ? `?${ps.toString()}` : ""}`;
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
        {/* Search — separate form so page size is not affected by form serialisation */}
        <form method="GET" action="/ag-admin/agents" className="flex items-center gap-2">
          {sortField !== "created_at" && <input type="hidden" name="sort" value={sortField} />}
          {sortDir !== "desc" && <input type="hidden" name="dir" value={sortDir} />}
          {pageSize !== DEFAULT_PAGE_SIZE && (
            <input type="hidden" name="pageSize" value={String(pageSize)} />
          )}
          <label className="sr-only" htmlFor="ag-agent-search">
            Search agents
          </label>
          <input
            id="ag-agent-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by agent key, name, or mode…"
            className="text-xs rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-sky-500 w-64"
          />
          <button
            type="submit"
            className="text-xs rounded-lg bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 transition-colors"
          >
            Search
          </button>
          {q && (
            <a
              href={`/ag-admin/agents${pageSize !== DEFAULT_PAGE_SIZE ? `?pageSize=${pageSize}` : ""}`}
              className="text-xs text-stone-400 hover:text-stone-600 underline"
            >
              Clear
            </a>
          )}
        </form>
      </div>

      {items.length === 0 ? (
        q ? (
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
            <p className="text-sm font-semibold text-sky-950">No agents match</p>
            <p className="text-xs text-stone-400 mt-1.5">
              No agents matching <span className="font-mono text-stone-600">&ldquo;{q}&rdquo;</span>{" "}
              found.
            </p>
          </div>
        ) : (
          <EmptyState />
        )
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
            {/* Sortable column headers */}
            <div className="px-6 py-3 border-b border-stone-100 grid grid-cols-[1fr_auto_auto_auto] gap-4 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
              <a href={sortUrl("slug")} className="hover:text-sky-700 flex items-center">
                Agent key {sortArrow("slug")}
              </a>
              <span className="text-stone-300">Mode</span>
              <a href={sortUrl("enabled")} className="hover:text-sky-700 flex items-center">
                Status {sortArrow("enabled")}
              </a>
              <a href={sortUrl("created_at")} className="hover:text-sky-700 flex items-center">
                Created {sortArrow("created_at")}
              </a>
            </div>
            <div className="divide-y divide-stone-100">
              {items.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
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

function PageHeader({
  total,
  query,
  rawArray,
}: { total?: number; query?: string; rawArray?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Agent Registry</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Registered agent identities and their capability configurations.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {total != null && (
          <span className="text-xs text-stone-400">
            {total} agent{total !== 1 ? "s" : ""}
            {rawArray && <span className="ml-1 text-stone-300">(all loaded)</span>}
          </span>
        )}
        {query && (
          <span className="text-xs text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">filtered</span>
        )}
        <a
          href="/ag-admin/agents/new"
          className="text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 px-3 py-1.5 rounded-lg transition-colors"
        >
          + Register agent
        </a>
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentEntry }) {
  return (
    <div className="px-6 py-4 grid grid-cols-[1fr_auto_auto_auto] gap-4 items-start group hover:bg-stone-50/60 transition-colors">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/ag-admin/agents/${agent.id}`}
            className="text-sm font-semibold text-sky-950 font-mono hover:text-sky-700 hover:underline transition-colors"
          >
            {agent.slug}
          </a>
          {agent.name && agent.name !== agent.slug && (
            <span className="text-xs text-stone-400">{agent.name}</span>
          )}
        </div>
        {agent.description && (
          <p className="text-xs text-stone-400 leading-relaxed line-clamp-1">{agent.description}</p>
        )}
        {agent.allowed_tools_default.length > 0 && (
          <p className="text-xs text-stone-400">
            Tools:{" "}
            <span className="text-stone-500">
              {agent.allowed_tools_default.slice(0, 3).join(", ")}
              {agent.allowed_tools_default.length > 3 &&
                ` +${agent.allowed_tools_default.length - 3}`}
            </span>
          </p>
        )}
      </div>
      <span className="text-xs text-stone-500 font-medium whitespace-nowrap self-start pt-1">
        {agent.default_agent_mode}
      </span>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded self-start mt-0.5 ${
          agent.enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}
      >
        {agent.enabled ? "enabled" : "disabled"}
      </span>
      <div className="shrink-0 text-right text-[11px] text-stone-400 space-y-0.5 self-start">
        <p>{formatDate(agent.created_at)}</p>
        <a
          href={`/ag-admin/agents/${agent.id}`}
          className="text-sky-500 hover:text-sky-700 hover:underline text-[11px] font-medium transition-colors"
          aria-label={`Details for agent ${agent.slug}`}
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
      <p className="text-sm font-semibold text-sky-950">Agent Registry unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running and the runtime
        configuration points to the correct management URL.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No agents registered</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        No agent registry entries found. Agents can be registered via the AG management API or MCP
        server.
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
