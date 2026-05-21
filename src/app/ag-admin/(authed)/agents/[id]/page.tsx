/**
 * Agent Registry detail page — read-only.
 *
 * Fetches GET /admin/agent-registry/:id for identity/config/audit.
 * Fetches GET /admin/agent-sessions?agent_id=<id>&... for operational context.
 * Both calls are server-side via agRequest(); bearer token never reaches browser.
 *
 * Security:
 *   - agRequest() attaches bearer token server-side.
 *   - Only safe operational fields are rendered.
 *   - Internal AG URLs, tokens, cookies never surfaced.
 *   - On 401/403 redirects to /ag-admin/login.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent Detail — Identuum AG" };

interface HITLPolicy {
  posture: string;
  review_acr_floor?: string;
  review_auth_max_age_seconds?: number;
}

interface CapabilityCeiling {
  hitl?: HITLPolicy;
}

interface AgentDetail {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  default_agent_mode: string;
  allowed_tools_default: string[];
  default_max_input_tokens?: number | null;
  default_max_session_tokens?: number | null;
  max_session_duration_seconds: number;
  capability_ceiling?: CapabilityCeiling | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by_user_id?: string | null;
}

interface SessionSummary {
  id: string;
  intent: string;
  agent_mode: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

interface SessionsResult {
  items: SessionSummary[];
  totalCount: number;
  hasMore: boolean;
}

async function fetchAgent(id: string): Promise<AgentDetail | "auth_error" | "not_found" | "unavailable"> {
  const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(id)}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (res.status === 404) return "not_found";
  if (!res.ok) return "unavailable";
  try {
    return (await res.json()) as AgentDetail;
  } catch {
    return "unavailable";
  }
}

async function fetchRecentSessions(agentId: string): Promise<SessionsResult | "unavailable"> {
  try {
    const params = new URLSearchParams({
      page: "1",
      page_size: "5",
      agent_id: agentId,
      sort: "last_activity_at",
      dir: "desc",
      status: "all",
    });
    const res = await agRequest(`/admin/agent-sessions?${params.toString()}`);
    if (!res || !res.ok) return "unavailable";
    const data = (await res.json()) as
      | { items: SessionSummary[]; pagination: { total_items: number; has_next: boolean } }
      | SessionSummary[];
    if (Array.isArray(data)) {
      return { items: data, totalCount: data.length, hasMore: false };
    }
    if (data && "items" in data) {
      return {
        items: data.items,
        totalCount: data.pagination?.total_items ?? data.items.length,
        hasMore: data.pagination?.has_next ?? false,
      };
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const confirmDisable = sp.confirm_disable === "1";
  const lifecycleError = typeof sp.lifecycle_error === "string" ? sp.lifecycle_error : null;

  const [agentResult, sessionsResult] = await Promise.all([
    fetchAgent(id),
    fetchRecentSessions(id),
  ]);

  if (agentResult === "auth_error") redirect("/ag-admin/login");

  // Server Actions — token stays server-side via agRequest().
  // Both send only the `enabled` field so no other agent state is overwritten.

  async function enableAgent(_formData: FormData) {
    "use server";
    const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    if (!res) redirect(`/ag-admin/agents/${id}?lifecycle_error=unavailable`);
    if (res.status === 401 || res.status === 403) redirect("/ag-admin/login");
    if (!res.ok) redirect(`/ag-admin/agents/${id}?lifecycle_error=failed`);
    redirect(`/ag-admin/agents/${id}`);
  }

  async function disableAgent(_formData: FormData) {
    "use server";
    const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    if (!res) redirect(`/ag-admin/agents/${id}?lifecycle_error=unavailable`);
    if (res.status === 401 || res.status === 403) redirect("/ag-admin/login");
    if (!res.ok) redirect(`/ag-admin/agents/${id}?lifecycle_error=failed`);
    redirect(`/ag-admin/agents/${id}`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <a
          href="/ag-admin/agents"
          className="text-xs text-stone-400 hover:text-sky-700 transition-colors"
        >
          ← Agents
        </a>
      </div>

      {agentResult === "not_found" ? (
        <NotFoundState id={id} />
      ) : agentResult === "unavailable" ? (
        <UnavailableState />
      ) : (
        <AgentDetailView
          agent={agentResult}
          sessions={sessionsResult}
          confirmDisable={confirmDisable}
          lifecycleError={lifecycleError}
          enableAgent={enableAgent}
          disableAgent={disableAgent}
        />
      )}
    </div>
  );
}

const LIFECYCLE_ERROR_MESSAGES: Record<string, string> = {
  failed: "Lifecycle action failed. The agent may have been modified by another operator. Refresh and try again.",
  unavailable: "Could not reach the AG management surface. Check that identuum-ag is running.",
};

function AgentDetailView({
  agent,
  sessions,
  confirmDisable,
  lifecycleError,
  enableAgent,
  disableAgent,
}: {
  agent: AgentDetail;
  sessions: SessionsResult | "unavailable";
  confirmDisable: boolean;
  lifecycleError: string | null;
  enableAgent: (fd: FormData) => Promise<void>;
  disableAgent: (fd: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 font-mono">
              {agent.slug}
            </h1>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                agent.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {agent.enabled ? "enabled" : "disabled"}
            </span>
          </div>
          {agent.name && agent.name !== agent.slug && (
            <p className="text-sm text-stone-500">{agent.name}</p>
          )}
          {agent.description && (
            <p className="text-sm text-stone-500 max-w-xl leading-relaxed">{agent.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`/ag-admin/agents/${agent.id}/edit`}
            className="text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            Edit
          </a>
          {agent.enabled ? (
            <a
              href={`/ag-admin/agents/${agent.id}?confirm_disable=1`}
              className="text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Disable
            </a>
          ) : (
            <form action={enableAgent}>
              <button
                type="submit"
                className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Enable
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Lifecycle error notice */}
      {lifecycleError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            <strong>Lifecycle action failed:</strong>{" "}
            {LIFECYCLE_ERROR_MESSAGES[lifecycleError] ?? "An unexpected error occurred. Please try again."}
          </p>
        </div>
      )}

      {/* Disable confirmation card */}
      {confirmDisable && agent.enabled && (
        <div className="bg-white border border-amber-300 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-100 bg-amber-50">
            <p className="text-sm font-semibold text-amber-900">Confirm: Disable agent</p>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-stone-700 leading-relaxed">
              Disabling agent <span className="font-mono font-semibold">{agent.slug}</span> prevents
              it from issuing new governed agent sessions. Active sessions already in progress are
              not affected by this change. You can re-enable the agent at any time.
            </p>
            <div className="flex items-center gap-3">
              <form action={disableAgent}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700 transition-colors"
                >
                  Confirm disable
                </button>
              </form>
              <a
                href={`/ag-admin/agents/${agent.id}`}
                className="px-4 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </a>
            </div>
          </div>
        </div>
      )}


      {/* Operational Summary */}
      <OperationalSummary agent={agent} sessions={sessions} />

      {/* Identity */}
      <Card title="Identity">
        <Field label="ID" value={<span className="font-mono text-xs">{agent.id}</span>} />
        <Field label="Agent key" value={<span className="font-mono">{agent.slug}</span>} />
        {agent.name && <Field label="Display name" value={agent.name} />}
      </Card>

      {/* Configuration */}
      <Card title="Configuration">
        <Field label="Default agent mode" value={<ModeBadge mode={agent.default_agent_mode} />} />
        {agent.allowed_tools_default.length > 0 && (
          <Field
            label="Allowed tools (default)"
            value={
              <div className="flex flex-wrap gap-1">
                {agent.allowed_tools_default.map((t) => (
                  <span key={t} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded font-mono">
                    {t}
                  </span>
                ))}
              </div>
            }
          />
        )}
        {agent.default_max_input_tokens != null && (
          <Field label="Max input tokens" value={agent.default_max_input_tokens.toLocaleString()} />
        )}
        {agent.default_max_session_tokens != null && (
          <Field label="Max session tokens" value={agent.default_max_session_tokens.toLocaleString()} />
        )}
        <Field
          label="Max session duration"
          value={formatDuration(agent.max_session_duration_seconds)}
        />
      </Card>

      {/* Governance */}
      <GovernanceCard ceiling={agent.capability_ceiling} agentId={agent.id} />

      {/* Audit */}
      <Card title="Audit">
        <Field label="Created" value={formatDateFull(agent.created_at)} />
        <Field label="Last updated" value={formatDateFull(agent.updated_at)} />
        {agent.created_by_user_id && (
          <Field
            label="Created by"
            value={<span className="font-mono text-xs">{agent.created_by_user_id.slice(0, 8)}…</span>}
          />
        )}
      </Card>

      {/* Recent Sessions */}
      <RecentSessions agentId={agent.id} sessions={sessions} />
    </div>
  );
}

function OperationalSummary({
  agent,
  sessions,
}: {
  agent: AgentDetail;
  sessions: SessionsResult | "unavailable";
}) {
  const hasSessionData = sessions !== "unavailable";
  const totalCount = hasSessionData ? sessions.totalCount : null;
  const mostRecentActivity =
    hasSessionData && sessions.items.length > 0 ? sessions.items[0].last_activity_at : null;

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Operational summary</p>
      </div>
      <div className="px-6 py-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCell
          label="State"
          value={
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                agent.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {agent.enabled ? "enabled" : "disabled"}
            </span>
          }
        />
        <StatCell
          label="Sessions"
          value={
            totalCount !== null ? (
              <span className="text-lg font-bold text-sky-950 tabular-nums">
                {totalCount.toLocaleString()}
              </span>
            ) : (
              <span className="text-xs text-stone-400 italic">unavailable</span>
            )
          }
        />
        <StatCell
          label="Last active"
          value={
            mostRecentActivity ? (
              <span className="text-xs text-stone-700">{formatDateFull(mostRecentActivity)}</span>
            ) : totalCount === 0 ? (
              <span className="text-xs text-stone-400 italic">never</span>
            ) : (
              <span className="text-xs text-stone-400 italic">unknown</span>
            )
          }
        />
        <StatCell
          label="Default mode"
          value={<ModeBadge mode={agent.default_agent_mode} />}
        />
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <div>{value}</div>
    </div>
  );
}

function RecentSessions({
  agentId,
  sessions,
}: {
  agentId: string;
  sessions: SessionsResult | "unavailable";
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">Recent sessions</p>
        <a
          href={`/ag-admin/sessions?agentId=${encodeURIComponent(agentId)}`}
          className="text-xs text-sky-600 hover:text-sky-800 hover:underline transition-colors"
          aria-label="View all sessions for this agent"
        >
          All sessions →
        </a>
      </div>

      {sessions === "unavailable" ? (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-stone-400">Recent sessions unavailable.</p>
          <p className="text-xs text-stone-300 mt-1">Could not reach the AG management surface.</p>
        </div>
      ) : sessions.items.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-stone-400">No sessions recorded for this agent yet.</p>
          <p className="text-xs text-stone-300 mt-1">Sessions appear here when this agent is activated.</p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100">
          {sessions.items.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
          {sessions.hasMore && (
            <div className="px-6 py-3 text-xs text-stone-400 text-center">
              Showing 5 most recent · {sessions.totalCount.toLocaleString()} total
            </div>
          )}
        </div>
      )}

      {/* Note: link to filtered session list requires sessions page agent_id param support */}
      <div className="px-6 py-3 border-t border-stone-100">
        <p className="text-[10px] text-stone-300">
          Showing sessions for agent ID: <span className="font-mono">{agentId}</span>
        </p>
      </div>
    </div>
  );
}

const SESSION_STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-stone-100 text-stone-500",
  revoked: "bg-red-50 text-red-600",
};

function sessionStatus(s: SessionSummary): "active" | "expired" | "revoked" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

function SessionRow({ session: s }: { session: SessionSummary }) {
  const status = sessionStatus(s);
  return (
    <div className="px-6 py-3 flex items-start gap-4 hover:bg-stone-50/60 transition-colors group">
      <div className="min-w-0 flex-1 space-y-0.5">
        <a
          href={`/ag-admin/sessions/${s.id}`}
          className="text-sm font-semibold text-sky-950 hover:text-sky-700 hover:underline truncate block"
          aria-label={`Session details: ${s.intent || s.id.slice(0, 8)}`}
        >
          {s.intent || "Untitled session"}
        </a>
        <p className="text-[11px] text-stone-400 font-mono">{s.id.slice(0, 12)}…</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${SESSION_STATUS_STYLES[status]}`}>
          {status}
        </span>
        <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
          {s.agent_mode}
        </span>
        <span className="text-[11px] text-stone-400 whitespace-nowrap">
          {formatDateFull(s.last_activity_at)}
        </span>
        <a
          href={`/ag-admin/sessions/${s.id}`}
          className="text-[11px] text-sky-500 hover:text-sky-700 hover:underline font-medium transition-colors"
          aria-label={`Details for session ${s.id.slice(0, 8)}`}
        >
          Details →
        </a>
      </div>
    </div>
  );
}

// ── Governance card ───────────────────────────────────────────────────────────

const POSTURE_LABELS: Record<string, string> = {
  required: "Required",
  optional: "Optional",
  not_required: "Not required",
};

const ACR_LABELS: Record<string, string> = {
  "urn:identuum:loa:password": "Password",
  "urn:identuum:loa:mfa": "Multi-factor (MFA)",
  "urn:identuum:loa:phishing-resistant": "Phishing-resistant",
};

function GovernanceCard({ ceiling, agentId }: { ceiling?: CapabilityCeiling | null; agentId: string }) {
  const hitl = ceiling?.hitl;
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">Governance / Capability ceiling</p>
        <a
          href={`/ag-admin/agents/${agentId}/edit`}
          className="text-[11px] text-sky-600 hover:underline font-medium"
        >
          Edit →
        </a>
      </div>
      {!hitl ? (
        <div className="px-6 py-4">
          <p className="text-xs text-stone-400 italic">
            No capability ceiling configured. Agent operates with default bearer-only issuance
            (no HITL gate).
          </p>
        </div>
      ) : (
        <dl className="px-6 py-4 space-y-2.5">
          <div className="flex items-start gap-4">
            <dt className="text-xs text-stone-400 w-44 shrink-0 pt-0.5">HITL posture</dt>
            <dd className="text-xs text-stone-700">
              <span className={`font-semibold ${
                hitl.posture === "required" ? "text-amber-700" :
                hitl.posture === "optional" ? "text-sky-700" : "text-stone-500"
              }`}>
                {POSTURE_LABELS[hitl.posture] ?? hitl.posture}
              </span>
            </dd>
          </div>
          {hitl.review_acr_floor && (
            <div className="flex items-start gap-4">
              <dt className="text-xs text-stone-400 w-44 shrink-0 pt-0.5">Reviewer ACR floor</dt>
              <dd className="text-xs text-stone-700">
                {ACR_LABELS[hitl.review_acr_floor] ?? hitl.review_acr_floor}
              </dd>
            </div>
          )}
          {hitl.review_auth_max_age_seconds ? (
            <div className="flex items-start gap-4">
              <dt className="text-xs text-stone-400 w-44 shrink-0 pt-0.5">Reviewer freshness</dt>
              <dd className="text-xs text-stone-700">{hitl.review_auth_max_age_seconds}s max age</dd>
            </div>
          ) : null}
        </dl>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
      </div>
      <dl className="px-6 py-4 space-y-3">{children}</dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-xs text-stone-400 w-44 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-xs text-stone-700 flex-1 leading-relaxed">{value}</dd>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className="text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
      {mode}
    </span>
  );
}

function NotFoundState({ id }: { id: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Agent not found</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed font-mono">
        {id}
      </p>
      <a href="/ag-admin/agents" className="mt-4 inline-block text-xs text-sky-600 hover:underline">
        Back to Agents
      </a>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Agent detail unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface.
      </p>
    </div>
  );
}

function formatDateFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 19);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}
