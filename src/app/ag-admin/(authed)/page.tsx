/**
 * AG operator dashboard — reads live state from the AG management surface.
 *
 * Runs six parallel AG calls server-side:
 *   - session counts by status (active, expired, revoked) using page_size=1
 *   - total agent count using page_size=1
 *   - recent sessions (last 5 by last_activity_at)
 *   - recent agents (last 5 by updated_at)
 *
 * All calls are server-side via agRequest(). Bearer token never reaches the
 * browser. Individual panel failures degrade gracefully without breaking the
 * rest of the page.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { agRequest } from "@/lib/ag-client";
import { agBaseUrl, loadRuntimeConfig, runtimeMode } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AG Dashboard — Identuum" };

// ── Fetch helpers ─────────────────────────────────────────────────────────────

interface PaginatedResponse<T> {
  items: T[];
  pagination: { total_items: number; has_next: boolean };
}

async function fetchPaginated<T>(
  path: string
): Promise<PaginatedResponse<T> | T[] | "auth_error" | "unavailable"> {
  const res = await agRequest(path);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && "items" in data) {
      return data as PaginatedResponse<T>;
    }
    if (Array.isArray(data)) return data as T[];
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function totalItems<T>(
  result: PaginatedResponse<T> | T[] | "auth_error" | "unavailable"
): number | null {
  if (result === "auth_error" || result === "unavailable") return null;
  if (Array.isArray(result)) return result.length;
  return result.pagination?.total_items ?? null;
}

function items<T>(result: PaginatedResponse<T> | T[] | "auth_error" | "unavailable"): T[] {
  if (result === "auth_error" || result === "unavailable") return [];
  if (Array.isArray(result)) return result;
  return result.items ?? [];
}

interface DashSession {
  id: string;
  intent: string;
  agent_mode: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string;
  revoked_at?: string | null;
  agent_id?: string | null;
}

interface DashAgent {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  default_agent_mode: string;
  enabled: boolean;
  updated_at: string;
}

async function checkAgHealth(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function AgDashboardPage() {
  const cfg = loadRuntimeConfig();
  const mode = runtimeMode(cfg);

  const [
    agHealthy,
    activeResult,
    expiredResult,
    revokedResult,
    agentCountResult,
    recentSessionsResult,
    recentAgentsResult,
  ] = await Promise.all([
    cfg?.ag.enabled ? checkAgHealth(agBaseUrl(cfg)) : Promise.resolve(null),
    fetchPaginated<DashSession>("/admin/agent-sessions?page=1&page_size=1&status=active"),
    fetchPaginated<DashSession>("/admin/agent-sessions?page=1&page_size=1&status=expired"),
    fetchPaginated<DashSession>("/admin/agent-sessions?page=1&page_size=1&status=revoked"),
    fetchPaginated<DashAgent>("/admin/agent-registry?page=1&page_size=1"),
    fetchPaginated<DashSession>(
      "/admin/agent-sessions?page=1&page_size=10&sort=last_activity_at&dir=desc&status=all"
    ),
    fetchPaginated<DashAgent>("/admin/agent-registry?page=1&page_size=10&sort=updated_at&dir=desc"),
  ]);

  // Redirect to login on auth error from any call.
  if (
    activeResult === "auth_error" ||
    expiredResult === "auth_error" ||
    revokedResult === "auth_error" ||
    agentCountResult === "auth_error" ||
    recentSessionsResult === "auth_error" ||
    recentAgentsResult === "auth_error"
  ) {
    redirect("/ag-admin/login");
  }

  const activeCount = totalItems(activeResult);
  const expiredCount = totalItems(expiredResult);
  const revokedCount = totalItems(revokedResult);
  const agentCount = totalItems(agentCountResult);
  const totalSessions =
    activeCount !== null && expiredCount !== null && revokedCount !== null
      ? activeCount + expiredCount + revokedCount
      : null;

  const recentSessions = items<DashSession>(recentSessionsResult);
  const recentAgents = items<DashAgent>(recentAgentsResult);
  const agPublicUrl = cfg?.ag.public_base_url ?? null;

  const modeLabel =
    mode === "governor-only"
      ? "Governor-only"
      : mode === "hybrid"
        ? "Hybrid (IdP + AG)"
        : mode === "auth-service"
          ? "Auth-service"
          : "Unconfigured";

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">AG Dashboard</h1>
          <p className="text-sm text-stone-500 mt-0.5">Agentic Governor operational overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              agHealthy === true
                ? "bg-emerald-100 text-emerald-700"
                : agHealthy === false
                  ? "bg-red-100 text-red-600"
                  : "bg-stone-100 text-stone-500"
            }`}
          >
            {agHealthy === true
              ? "AG healthy"
              : agHealthy === false
                ? "AG unreachable"
                : "AG unknown"}
          </span>
          <span className="text-[10px] text-stone-400 bg-stone-50 border border-stone-200 px-2 py-0.5 rounded-full">
            {modeLabel}
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total agents" value={agentCount} href="/ag-admin/agents" />
        <StatCard
          label="Total sessions"
          value={totalSessions}
          href="/ag-admin/sessions?status=all"
        />
        <StatCard
          label="Active"
          value={activeCount}
          href="/ag-admin/sessions?status=active"
          accent="green"
        />
        <StatCard label="Expired" value={expiredCount} href="/ag-admin/sessions?status=expired" />
        <StatCard
          label="Revoked"
          value={revokedCount}
          href="/ag-admin/sessions?status=revoked"
          accent="red"
        />
        <StatCard
          label="AG backend"
          value={agHealthy === true ? "Online" : agHealthy === false ? "Offline" : "Unknown"}
          href="/ag-admin"
          accent={agHealthy === true ? "green" : agHealthy === false ? "red" : undefined}
          text
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <QuickLink href="/ag-admin/agents">All agents</QuickLink>
        <QuickLink href="/ag-admin/sessions">All sessions</QuickLink>
        <QuickLink href="/ag-admin/sessions?status=active">Active sessions</QuickLink>
        <QuickLink href="/ag-admin/sessions?status=revoked">Revoked sessions</QuickLink>
        <QuickLink href="/ag-admin/sessions?status=expired">Expired sessions</QuickLink>
        <QuickLink href="/ag-admin/revocations">Revocations</QuickLink>
        <QuickLink href="/ag-admin/audit">Audit log</QuickLink>
      </div>

      {/* Governance surfaces */}
      <div>
        <h2 className="text-sm font-semibold text-sky-950 mb-3">Governance surfaces</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GovernanceCard
            title="Agent Registry"
            description="Registered agent identities, capability ceilings, and tool configurations."
            href="/ag-admin/agents"
          />
          <GovernanceCard
            title="Agent Sessions"
            description="Active sessions, token exchange history, and revocation."
            href="/ag-admin/sessions"
          />
          <GovernanceCard
            title="HITL / CBAA"
            description="Human-in-the-loop gate interventions awaiting operator review."
            href="/ag-admin/hitl"
          />
          <GovernanceCard
            title="Revocations"
            description="Operator-issued session and token revocations with reasons and timestamps."
            href="/ag-admin/revocations"
          />
          <GovernanceCard
            title="Audit / Activity"
            description="Governance event log: agent changes, session activity, HITL decisions, and admin actions."
            href="/ag-admin/audit"
          />
          <GovernanceCard
            title="MCP Server"
            description="Management MCP server status and natural-language governance tools."
            href="/ag-admin/mcp"
          />
        </div>
      </div>

      {/* System status (collapsed at bottom) */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">System status</p>
        </div>
        <div className="px-6 py-4 space-y-2">
          <StatusRow
            label="AG backend"
            value={agHealthy === true ? "Healthy" : agHealthy === false ? "Unreachable" : "Unknown"}
            ok={agHealthy === true}
            error={agHealthy === false}
          />
          <StatusRow label="Deployment mode" value={modeLabel} />
          {agPublicUrl && <StatusRow label="Management surface" value={agPublicUrl} mono />}
          {cfg?.idp.enabled !== undefined && (
            <StatusRow
              label="IdP"
              value={cfg.idp.enabled ? "Enabled" : "Disabled"}
              ok={cfg.idp.enabled}
            />
          )}
        </div>
      </div>

      {/* Recent sessions — up to 10 most recent */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-sky-950">Recent sessions</p>
          <a href="/ag-admin/sessions" className="text-xs text-sky-600 hover:underline">
            View all sessions →
          </a>
        </div>
        {recentSessionsResult === "unavailable" ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-stone-400">Recent sessions unavailable.</p>
          </div>
        ) : recentSessions.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-stone-400">No sessions recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {recentSessions.map((s) => (
              <DashSessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>

      {/* Agent registry — up to 10 most recently updated */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-sky-950">Agent registry</p>
          <a href="/ag-admin/agents" className="text-xs text-sky-600 hover:underline">
            View all agents →
          </a>
        </div>
        {recentAgentsResult === "unavailable" ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-stone-400">Agent registry unavailable.</p>
          </div>
        ) : recentAgents.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-stone-400">No agents registered yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {recentAgents.map((a) => (
              <DashAgentRow key={a.id} agent={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  href,
  accent,
  text = false,
}: {
  label: string;
  value: number | string | null;
  href: string;
  accent?: "green" | "red";
  text?: boolean;
}) {
  const accentCls =
    accent === "green" ? "text-emerald-700" : accent === "red" ? "text-red-600" : "text-sky-950";

  return (
    <a
      href={href}
      className="bg-white border border-stone-200 rounded-2xl shadow-sm px-4 py-3 hover:border-sky-200 hover:shadow-md transition-all block"
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400 mb-1">{label}</p>
      <p
        className={`font-bold tabular-nums leading-none ${text ? "text-sm" : "text-xl"} ${accentCls}`}
      >
        {value !== null ? (typeof value === "number" ? value.toLocaleString() : value) : "—"}
      </p>
    </a>
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

function sessionStatus(s: DashSession): "active" | "expired" | "revoked" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

const SESSION_STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-stone-100 text-stone-500",
  revoked: "bg-red-50 text-red-600",
};

function DashSessionRow({ session: s }: { session: DashSession }) {
  const status = sessionStatus(s);
  return (
    <div className="px-6 py-3 flex items-start gap-4 hover:bg-stone-50/60 transition-colors">
      <div className="flex-1 min-w-0 space-y-0.5">
        <a
          href={`/ag-admin/sessions/${s.id}`}
          className="text-sm font-semibold text-sky-950 hover:text-sky-700 hover:underline line-clamp-1 break-words block"
          aria-label={`Session: ${s.intent || s.id.slice(0, 8)}`}
        >
          {s.intent || "Untitled session"}
        </a>
        <p className="text-[11px] text-stone-400 font-mono">{s.id.slice(0, 12)}…</p>
      </div>
      <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${SESSION_STATUS_STYLES[status]}`}
        >
          {status}
        </span>
        <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded whitespace-nowrap">
          {s.agent_mode}
        </span>
        <span className="text-[11px] text-stone-400 whitespace-nowrap">
          {formatDate(s.last_activity_at)}
        </span>
        <a
          href={`/ag-admin/sessions/${s.id}`}
          className="text-[11px] text-sky-500 hover:text-sky-700 hover:underline font-medium"
          aria-label={`Details for session ${s.id.slice(0, 8)}`}
        >
          Details →
        </a>
      </div>
    </div>
  );
}

function DashAgentRow({ agent: a }: { agent: DashAgent }) {
  return (
    <div className="px-6 py-3 flex items-start gap-4 hover:bg-stone-50/60 transition-colors">
      <div className="flex-1 min-w-0 space-y-0.5">
        <a
          href={`/ag-admin/agents/${a.id}`}
          className="text-sm font-semibold text-sky-950 hover:text-sky-700 hover:underline block"
        >
          {a.name}
        </a>
        {a.name !== a.slug && (
          <p className="text-[11px] text-stone-400 font-mono">Agent key: {a.slug}</p>
        )}
        {a.description && <p className="text-xs text-stone-400 line-clamp-1">{a.description}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
            a.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {a.enabled ? "enabled" : "disabled"}
        </span>
        <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded whitespace-nowrap">
          {a.default_agent_mode}
        </span>
        <a
          href={`/ag-admin/agents/${a.id}`}
          className="text-[11px] text-sky-500 hover:text-sky-700 hover:underline font-medium"
          aria-label={`Details for agent ${a.slug}`}
        >
          Details →
        </a>
      </div>
    </div>
  );
}

function GovernanceCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm p-5 hover:border-sky-200 hover:shadow-md transition-all block"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-950">{title}</p>
          <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{description}</p>
        </div>
        <span className="shrink-0 text-stone-300 mt-0.5">→</span>
      </div>
    </a>
  );
}

function StatusRow({
  label,
  value,
  ok,
  error,
  mono,
}: {
  label: string;
  value: string;
  ok?: boolean;
  error?: boolean;
  mono?: boolean;
}) {
  const valueCls = ok
    ? "text-emerald-700 font-semibold"
    : error
      ? "text-red-600 font-semibold"
      : mono
        ? "text-stone-600 font-mono text-xs"
        : "text-stone-600";
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-xs text-stone-500 shrink-0">{label}</span>
      <span className={`text-xs text-right truncate max-w-xs ${valueCls}`}>{value}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}
