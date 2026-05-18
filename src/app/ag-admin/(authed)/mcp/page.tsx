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
    <div className="space-y-6">
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

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">MCP Server status unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running and the runtime
        configuration points to the correct management URL.
      </p>
    </div>
  );
}
