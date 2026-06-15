/**
 * MCP Server — read-only status page.
 *
 * Fetches GET /admin/mcp/status from the AG management surface.
 * All data fetching is server-side.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - Only safe operational fields are rendered: available flag,
 *     management path, tool category labels.
 *   - The /mcp transport endpoint is NOT called here. /mcp is the MCP
 *     Streamable HTTP transport — it is not a REST management endpoint.
 *     Only /admin/mcp/status (a REST endpoint) is used.
 *   - On 401/403 the user is redirected to /ag-admin/login.
 *   - Internal AG URLs are never surfaced to the browser.
 *   - No write operations on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MCP Server — Identuum AG" };

/** Safe subset of MCPStatusDTO from identuum-ag handlers/mcp_admin.go */
interface MCPStatus {
  available: boolean;
  path: string;
  tool_categories: string[];
}

async function fetchMCPStatus(): Promise<MCPStatus | "auth_error" | "unavailable"> {
  const res = await agRequest("/admin/mcp/status");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    return (await res.json()) as MCPStatus;
  } catch {
    return "unavailable";
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  agent_registry: "Agent Registry",
  agent_sessions: "Agent Sessions",
  hitl_queue: "HITL / CBAA Queue",
};

export default async function McpPage() {
  const result = await fetchMCPStatus();

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">MCP Server</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            AG management MCP server — natural-language governance via operator tools.
          </p>
        </div>
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>

      {/* Explanation */}
      <div className="bg-sky-50 border border-sky-100 rounded-2xl px-5 py-4 space-y-1.5">
        <p className="text-xs font-semibold text-sky-800">What is the AG MCP Server?</p>
        <p className="text-xs text-sky-700 leading-relaxed">
          The Identuum AG management MCP server exposes operator tools for governing agents,
          sessions, and HITL/CBAA review items through a natural-language interface. Connect an
          MCP-compatible client (e.g., Claude Desktop, Cursor) to the AG management surface to
          inspect and govern agent activity without writing code.
        </p>
        <p className="text-xs text-sky-700 leading-relaxed">
          MCP governance is constrained by agent policy — allowed tools, readonly mode, session
          context, and HITL/CBAA gates all apply. Governed MCP actions appear as agent sessions.
        </p>
      </div>

      {result === "unavailable" ? (
        <UnavailableState />
      ) : (
        <div className="space-y-4">
          <StatusCard status={result} />
          <TransportNote path={result.path} />
          {result.tool_categories.length > 0 && (
            <ToolCategoriesCard categories={result.tool_categories} />
          )}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pt-2">
        <QuickLink href="/ag-admin/sessions">Agent Sessions</QuickLink>
        <QuickLink href="/ag-admin/agents">Agent Registry</QuickLink>
        <QuickLink href="/ag-admin/hitl">HITL / CBAA</QuickLink>
        <QuickLink href="/ag-admin">Dashboard</QuickLink>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusCard({ status }: { status: MCPStatus }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Server status</p>
      </div>
      <div className="px-6 py-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">Availability</span>
          {status.available ? (
            <span className="text-sm font-semibold text-emerald-700">Available</span>
          ) : (
            <span className="text-sm font-semibold text-stone-400">Not licensed</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">Management path</span>
          <span className="text-sm font-mono text-stone-600">{status.path}</span>
        </div>
        {!status.available && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>MCP Server requires an Enterprise license.</strong> Contact your account team
              to upgrade. When licensed, the MCP server exposes operator tools for natural-language
              agent governance over the management surface.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TransportNote({ path }: { path: string }) {
  return (
    <div className="bg-sky-50 border border-sky-100 rounded-2xl px-5 py-3">
      <p className="text-xs text-sky-700 leading-relaxed">
        <strong>About the MCP transport.</strong> The{" "}
        <code className="font-mono bg-sky-100 px-1 rounded">{path}</code> endpoint is the MCP
        Streamable HTTP transport for MCP-compatible clients (e.g. Claude Desktop, Cursor). It is
        not a REST management endpoint and cannot be used directly from this UI. Connect your MCP
        client to the AG management surface URL to use it.
      </p>
    </div>
  );
}

function ToolCategoriesCard({ categories }: { categories: string[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Tool categories</p>
      </div>
      <div className="divide-y divide-stone-100">
        {categories.map((cat) => (
          <div key={cat} className="px-6 py-3 flex items-center gap-3">
            <span className="text-xs font-mono text-stone-400 w-40 shrink-0">{cat}</span>
            <span className="text-sm text-stone-600">{CATEGORY_LABELS[cat] ?? cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 font-medium transition-colors"
    >
      {children}
    </a>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">MCP Server status unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running and the runtime
        configuration points to the correct management URL.
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        <a href="/ag-admin/sessions" className="text-xs text-sky-600 hover:underline">
          Agent Sessions →
        </a>
        <a href="/ag-admin/agents" className="text-xs text-sky-600 hover:underline">
          Agent Registry →
        </a>
        <a href="/ag-admin/hitl" className="text-xs text-sky-600 hover:underline">
          HITL / CBAA →
        </a>
        <a href="/ag-admin" className="text-xs text-sky-600 hover:underline">
          Dashboard →
        </a>
      </div>
    </div>
  );
}
