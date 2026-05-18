/**
 * Agent Registry — read-only list page.
 *
 * Fetches GET /admin/agent-registry from the AG management surface
 * using the operator bearer token. All data fetching is server-side.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - Only safe operational fields are rendered: slug, name, mode, tools,
 *     enabled flag, timestamps.
 *   - On 401 the user is redirected to /ag-admin/login (session expired).
 *   - Internal AG URLs are never surfaced to the browser.
 *   - No write operations on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Agent Registry — Identuum AG" };

/** Safe subset of AgentRegistryDTO from identuum-ag handlers/agent_registry.go */
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

async function fetchAgents(): Promise<AgentEntry[] | "auth_error" | "unavailable"> {
  const res = await agRequest("/admin/agent-registry");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    return (await res.json()) as AgentEntry[];
  } catch {
    return "unavailable";
  }
}

export default async function AgentsPage() {
  const result = await fetchAgents();

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Agent Registry</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Registered agent identities and their capability configurations.
          </p>
        </div>
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>

      {result === "unavailable" ? (
        <UnavailableState />
      ) : result.length === 0 ? (
        <EmptyState />
      ) : (
        <AgentTable agents={result} />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentTable({ agents }: { agents: AgentEntry[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">Agents</p>
        <span className="text-xs text-stone-400">{agents.length} registered</span>
      </div>
      <div className="divide-y divide-stone-100">
        {agents.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentEntry }) {
  return (
    <div className="px-6 py-4 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-sky-950 font-mono">{agent.slug}</span>
          {!agent.enabled && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              disabled
            </span>
          )}
        </div>
        {agent.name && agent.name !== agent.slug && (
          <p className="text-xs text-stone-500">{agent.name}</p>
        )}
        {agent.description && (
          <p className="text-xs text-stone-400 leading-relaxed">{agent.description}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 pt-1">
          <span>
            Mode: <span className="font-medium text-stone-600">{agent.default_agent_mode}</span>
          </span>
          {agent.allowed_tools_default.length > 0 && (
            <span>
              Tools:{" "}
              <span className="font-medium text-stone-600">
                {agent.allowed_tools_default.join(", ")}
              </span>
            </span>
          )}
          {agent.default_max_input_tokens != null && (
            <span>
              Max input tokens:{" "}
              <span className="font-medium text-stone-600">
                {agent.default_max_input_tokens.toLocaleString()}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] text-stone-400 space-y-0.5">
        <p className="font-mono">{agent.id.slice(0, 8)}…</p>
        <p>{formatDate(agent.created_at)}</p>
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
