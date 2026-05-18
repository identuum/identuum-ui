/**
 * Agent Sessions — read-only list page.
 *
 * Fetches GET /admin/agent-sessions from the AG management surface
 * using the operator bearer token. All data fetching is server-side.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - Only safe operational fields are rendered. cnf_jkt (DPoP thumbprint),
 *     IBTs, tokens, acr, auth_time, and HITL metadata are excluded by AG
 *     and never present in the response.
 *   - On 401/403 the user is redirected to /ag-admin/login.
 *   - Internal AG URLs are never surfaced to the browser.
 *   - No write operations on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Agent Sessions — Identuum AG" };

/** Safe subset of AgentSessionDTO from identuum-ag handlers/agent_session_admin.go */
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

async function fetchSessions(): Promise<AgentSession[] | "auth_error" | "unavailable"> {
  const res = await agRequest("/admin/agent-sessions");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    return (await res.json()) as AgentSession[];
  } catch {
    return "unavailable";
  }
}

function sessionStatus(s: AgentSession): "revoked" | "expired" | "active" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

export default async function SessionsPage() {
  const result = await fetchSessions();

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  if (result === "unavailable") {
    return (
      <div className="space-y-6">
        <PageHeader />
        <UnavailableState />
      </div>
    );
  }

  const active = result.filter((s) => sessionStatus(s) === "active");
  const expired = result.filter((s) => sessionStatus(s) === "expired");
  const revoked = result.filter((s) => sessionStatus(s) === "revoked");

  return (
    <div className="space-y-6">
      <PageHeader total={result.length} />

      {result.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {active.length > 0 && <SessionSection title="Active" items={active} />}
          {expired.length > 0 && <SessionSection title="Expired" items={expired} />}
          {revoked.length > 0 && <SessionSection title="Revoked" items={revoked} />}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ total }: { total?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Agent Sessions</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Active and recent AG-native agent sessions. Showing up to 100 most recent.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {total != null && (
          <span className="text-xs text-stone-400">
            {total} session{total !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>
    </div>
  );
}

function SessionSection({ title, items }: { title: string; items: AgentSession[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
        <span className="text-xs text-stone-400">{items.length}</span>
      </div>
      <div className="divide-y divide-stone-100">
        {items.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
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
  const badgeCls = STATUS_STYLES[status];

  return (
    <div className="px-6 py-4 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono text-sky-950">{s.id.slice(0, 8)}…</span>
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${badgeCls}`}
          >
            {status}
          </span>
          <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
            {s.agent_mode}
          </span>
        </div>

        <p className="text-xs text-stone-600 font-medium">{s.intent}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
          {s.agent_id && (
            <span>
              Agent: <span className="font-mono">{s.agent_id.slice(0, 8)}…</span>
            </span>
          )}
          {s.ag_user_id && (
            <span>
              User: <span className="font-mono">{s.ag_user_id.slice(0, 8)}…</span>
            </span>
          )}
          {s.task_id && (
            <span>
              Task: <span className="font-mono text-stone-400">{s.task_id}</span>
            </span>
          )}
        </div>

        {s.allowed_tools.length > 0 && (
          <p className="text-xs text-stone-400">
            Tools: <span className="text-stone-500">{s.allowed_tools.join(", ")}</span>
          </p>
        )}

        {status === "revoked" && s.revocation_reason && (
          <p className="text-xs text-red-500">Reason: {s.revocation_reason}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-400 pt-0.5">
          <span>Created: {formatDate(s.created_at)}</span>
          <span>Last active: {formatDate(s.last_activity_at)}</span>
          <span>Expires: {formatDate(s.expires_at)}</span>
          {s.revoked_at && <span>Revoked: {formatDate(s.revoked_at)}</span>}
        </div>
      </div>

      <div className="shrink-0 text-right text-[11px] text-stone-400 space-y-0.5">
        <p className="font-mono">{s.id.slice(0, 8)}…</p>
        {s.max_input_tokens != null && <p>{s.max_input_tokens.toLocaleString()} in</p>}
        {s.max_session_tokens != null && <p>{s.max_session_tokens.toLocaleString()} sess</p>}
      </div>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Agent Sessions unavailable</p>
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
      <p className="text-sm font-semibold text-sky-950">No sessions found</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        No agent sessions exist yet. Sessions are created when an agent exchanges a subject token
        via the AG token endpoint.
      </p>
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
