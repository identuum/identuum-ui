/**
 * Agent Session detail page — read-only.
 *
 * Fetches GET /admin/agent-sessions/:id and, when an agent_id is present,
 * fetches GET /admin/agent-registry/:id to resolve the agent name/slug for
 * human-readable display. Both calls are server-side.
 *
 * Human-readable identity principle:
 *   - Intent is the primary page title (describes what was happening).
 *   - Agent name/slug is primary; UUID is secondary technical metadata.
 *   - Operator/user and organization IDs are shown as labeled technical IDs
 *     because no name/email endpoint is currently available for those.
 *
 * Security:
 *   - agRequest() attaches bearer token server-side; never reaches browser.
 *   - cnf_jkt, IBTs, tokens, acr, auth_time, and HITL metadata are excluded
 *     by AG and never returned in the response.
 *   - Internal AG URLs never surfaced.
 *   - On 401/403 redirects to /ag-admin/login.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session Detail — Identuum AG" };

// AG system organization sentinel UUID. Sessions belonging to the system org
// are platform-level and are not tenant organizations — their display lookup
// returns 404 by design, not because data is missing.
const AG_SYSTEM_ORG_ID = "00000000-0000-7000-0000-000000000000";

function isSystemOrg(orgId: string): boolean {
  return orgId.toLowerCase() === AG_SYSTEM_ORG_ID;
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

interface AgentSummary {
  slug: string;
  name: string;
}

interface OperatorDisplay {
  id: string;
  email: string;
  display_name?: string | null;
}

interface OrgDisplay {
  id: string;
  name: string;
  display_name: string;
}

async function fetchSession(id: string): Promise<AgentSession | "auth_error" | "not_found" | "unavailable"> {
  const res = await agRequest(`/admin/agent-sessions/${encodeURIComponent(id)}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (res.status === 404) return "not_found";
  if (res.status === 400) return "not_found";
  if (!res.ok) return "unavailable";
  try {
    return (await res.json()) as AgentSession;
  } catch {
    return "unavailable";
  }
}

async function fetchAgentSummary(agentId: string): Promise<AgentSummary | null> {
  try {
    const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(agentId)}`);
    if (!res || !res.ok) return null;
    const data = (await res.json()) as { slug?: string; name?: string };
    if (!data.slug) return null;
    return { slug: data.slug, name: data.name ?? data.slug };
  } catch {
    return null;
  }
}

async function fetchOperatorDisplay(userId: string): Promise<OperatorDisplay | null> {
  try {
    const res = await agRequest(`/admin/ag-users/${encodeURIComponent(userId)}/display`);
    if (!res || !res.ok) return null;
    return (await res.json()) as OperatorDisplay;
  } catch {
    return null;
  }
}

async function fetchOrgDisplay(orgId: string): Promise<OrgDisplay | null> {
  try {
    const res = await agRequest(`/admin/organizations/${encodeURIComponent(orgId)}/display`);
    if (!res || !res.ok) return null;
    return (await res.json()) as OrgDisplay;
  } catch {
    return null;
  }
}

function sessionStatus(s: AgentSession): "revoked" | "expired" | "active" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const REVOKE_ERROR_MESSAGES: Record<string, string> = {
  already_revoked: "This session has already been revoked.",
  not_found: "Session not found. It may have expired and been cleaned up.",
  reason_required: "A reason is required to revoke a session.",
  failed: "Revocation failed. Please try again.",
  unavailable: "Could not reach the AG management surface.",
};

export default async function SessionDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const confirmRevoke = sp.confirm_revoke === "1";
  const revokeError = typeof sp.revoke_error === "string" ? sp.revoke_error : null;

  const result = await fetchSession(id);

  if (result === "auth_error") redirect("/ag-admin/login");

  // Run secondary display lookups in parallel to minimise latency.
  let agentInfo: AgentSummary | null = null;
  let operatorDisplay: OperatorDisplay | null = null;
  let orgDisplay: OrgDisplay | null = null;

  if (result !== "not_found" && result !== "unavailable") {
    [agentInfo, operatorDisplay, orgDisplay] = await Promise.all([
      result.agent_id ? fetchAgentSummary(result.agent_id) : Promise.resolve(null),
      result.ag_user_id ? fetchOperatorDisplay(result.ag_user_id) : Promise.resolve(null),
      fetchOrgDisplay(result.organization_id),
    ]);
  }

  // Server Action — bearer token stays server-side via agRequest().
  // Uses POST /admin/revocations with kind=session and a required reason.
  async function revokeSession(formData: FormData) {
    "use server";
    const reason = formData.get("reason")?.toString().trim() ?? "";
    if (!reason) {
      redirect(`/ag-admin/sessions/${id}?confirm_revoke=1&revoke_error=reason_required`);
    }
    const res = await agRequest("/admin/revocations", {
      method: "POST",
      body: JSON.stringify({ kind: "session", agent_session_id: id, reason }),
    });
    if (!res) redirect(`/ag-admin/sessions/${id}?revoke_error=unavailable`);
    if (res.status === 401 || res.status === 403) redirect("/ag-admin/login");
    if (res.status === 409) redirect(`/ag-admin/sessions/${id}?revoke_error=already_revoked`);
    if (res.status === 404) redirect(`/ag-admin/sessions/${id}?revoke_error=not_found`);
    if (!res.ok) redirect(`/ag-admin/sessions/${id}?revoke_error=failed`);
    redirect(`/ag-admin/sessions/${id}`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <a href="/ag-admin/sessions" className="text-xs text-stone-400 hover:text-sky-700 transition-colors">
          ← Sessions
        </a>
      </div>

      {result === "not_found" ? (
        <NotFoundState id={id} />
      ) : result === "unavailable" ? (
        <UnavailableState />
      ) : (
        <SessionDetailView
          session={result}
          agentInfo={agentInfo}
          operatorDisplay={operatorDisplay}
          orgDisplay={orgDisplay}
          confirmRevoke={confirmRevoke}
          revokeError={revokeError}
          revokeSession={revokeSession}
        />
      )}
    </div>
  );
}

function SessionDetailView({
  session: s,
  agentInfo,
  operatorDisplay,
  orgDisplay,
  confirmRevoke,
  revokeError,
  revokeSession,
}: {
  session: AgentSession;
  agentInfo: AgentSummary | null;
  operatorDisplay: OperatorDisplay | null;
  orgDisplay: OrgDisplay | null;
  confirmRevoke: boolean;
  revokeError: string | null;
  revokeSession: (fd: FormData) => Promise<void>;
}) {
  const status = sessionStatus(s);
  const statusStyles = {
    active: "bg-emerald-100 text-emerald-700",
    expired: "bg-stone-100 text-stone-500",
    revoked: "bg-red-100 text-red-600",
  };
  const isRevocable = status === "active";

  // Intent is the primary page title. Clamp in the header to prevent enormous h1;
  // full text is always visible in the Task & Capabilities section.
  const pageTitle = s.intent || "Untitled session";

  return (
    <div className="space-y-6">
      {/* Header — intent as primary title, session ID as secondary */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusStyles[status]}`}>
              {status}
            </span>
            <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
              {s.agent_mode}
            </span>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-sky-950 leading-snug line-clamp-3 break-words">
            {pageTitle}
          </h1>
          {/* Session ID secondary */}
          <p className="text-xs text-stone-400 font-mono">
            Session <span className="text-stone-500">{s.id.slice(0, 12)}…</span>
          </p>
        </div>
        {isRevocable ? (
          <a
            href={`/ag-admin/sessions/${s.id}?confirm_revoke=1`}
            className="text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            Revoke session
          </a>
        ) : (
          <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full shrink-0">
            {status === "revoked" ? "Revoked" : "Read-only"}
          </span>
        )}
      </div>

      {/* Revocation error notice */}
      {revokeError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
          <p className="text-xs font-semibold text-amber-800 mb-0.5">Revocation failed</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {REVOKE_ERROR_MESSAGES[revokeError] ?? "An unexpected error occurred. Please try again."}
          </p>
        </div>
      )}

      {/* Revocation confirmation card */}
      {confirmRevoke && isRevocable && (
        <div className="bg-white border border-red-300 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-red-100 bg-red-50">
            <p className="text-sm font-semibold text-red-900">Confirm: Revoke session</p>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-stone-700 leading-relaxed">
              Revoking this session immediately invalidates the agent token. The agent will no
              longer be able to make governed requests using this session. Any in-progress HITL
              review items for this session are not automatically resolved.
            </p>
            <form action={revokeSession} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="revoke-reason" className="block text-xs font-medium text-stone-700">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="revoke-reason"
                  name="reason"
                  rows={3}
                  required
                  maxLength={1024}
                  placeholder="Reason for revocation (required, max 1024 chars)"
                  className="w-full text-xs rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none"
                />
                {revokeError === "reason_required" && (
                  <p className="text-xs text-red-600">A reason is required.</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors"
                >
                  Confirm revocation
                </button>
                <a
                  href={`/ag-admin/sessions/${s.id}`}
                  className="px-4 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </a>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Session Identity */}
      <Card title="Session Identity">
        <Field
          label="Session"
          value={
            <div className="space-y-0.5">
              <p className="font-mono text-xs text-stone-700 break-all">{s.id}</p>
            </div>
          }
        />
        {s.agent_id && (
          <Field
            label="Agent"
            value={
              <div className="space-y-0.5">
                {agentInfo ? (
                  <a
                    href={`/ag-admin/agents/${s.agent_id}`}
                    className="text-sm font-semibold text-sky-700 hover:underline"
                  >
                    {agentInfo.name}
                  </a>
                ) : (
                  <a
                    href={`/ag-admin/agents/${s.agent_id}`}
                    className="font-mono text-xs text-sky-600 hover:underline"
                  >
                    {s.agent_id.slice(0, 8)}…
                  </a>
                )}
                {agentInfo && agentInfo.name !== agentInfo.slug && (
                  <p className="text-[11px] text-stone-400 font-mono">Agent key: {agentInfo.slug}</p>
                )}
                <p className="text-[11px] text-stone-300 font-mono">
                  Technical ID: {s.agent_id}
                </p>
              </div>
            }
          />
        )}
        {s.ag_user_id && (
          <Field
            label="Operator"
            value={
              <div className="space-y-0.5">
                {operatorDisplay ? (
                  <>
                    {operatorDisplay.display_name && (
                      <p className="text-sm font-medium text-stone-800">{operatorDisplay.display_name}</p>
                    )}
                    <p className="text-xs text-stone-600">{operatorDisplay.email}</p>
                  </>
                ) : (
                  <p className="text-xs text-stone-500 italic">Operator display unavailable</p>
                )}
                <p className="text-[11px] text-stone-300 font-mono">Operator ID: {s.ag_user_id}</p>
              </div>
            }
          />
        )}
        <Field
          label="Organization"
          value={
            <div className="space-y-0.5">
              {isSystemOrg(s.organization_id) ? (
                <p className="text-sm font-medium text-stone-700">System organization (platform scope)</p>
              ) : orgDisplay ? (
                <>
                  <p className="text-sm font-medium text-stone-800">{orgDisplay.display_name || orgDisplay.name}</p>
                  {orgDisplay.display_name && orgDisplay.name !== orgDisplay.display_name && (
                    <p className="text-xs text-stone-500 font-mono">{orgDisplay.name}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-stone-500 italic">Organization display unavailable</p>
              )}
              <p className="text-[11px] text-stone-300 font-mono">Org ID: {s.organization_id}</p>
            </div>
          }
        />
      </Card>

      {/* Task */}
      <Card title="Task & Capabilities">
        <Field label="Intent" value={
          <span className="text-stone-800 leading-relaxed break-words whitespace-pre-wrap">
            {s.intent || "No intent provided"}
          </span>
        } />
        {s.task_id && (
          <Field label="Task ID" value={<span className="font-mono text-xs break-all text-stone-700">{s.task_id}</span>} />
        )}
        <Field
          label="Agent mode"
          value={<span className="font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded text-xs">{s.agent_mode}</span>}
        />
        {s.allowed_tools.length > 0 ? (
          <Field
            label="Allowed tools"
            value={
              <div className="flex flex-wrap gap-1">
                {s.allowed_tools.map((t) => (
                  <span key={t} className="text-xs bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-mono">
                    {t}
                  </span>
                ))}
              </div>
            }
          />
        ) : (
          <Field label="Allowed tools" value={<span className="text-xs text-stone-500">No tool restriction (all tools permitted)</span>} />
        )}
        {s.max_input_tokens != null && (
          <Field label="Max input tokens" value={<span className="font-mono text-xs">{s.max_input_tokens.toLocaleString()}</span>} />
        )}
        {s.max_session_tokens != null && (
          <Field label="Max session tokens" value={<span className="font-mono text-xs">{s.max_session_tokens.toLocaleString()}</span>} />
        )}
      </Card>

      {/* Lifecycle */}
      <Card title="Lifecycle">
        <Field
          label="Status"
          value={
            <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${statusStyles[status]}`}>
              {status}
            </span>
          }
        />
        <Field label="Created" value={formatDateFull(s.created_at)} />
        <Field label="Last active" value={formatDateFull(s.last_activity_at)} />
        <Field label="Expires" value={formatDateFull(s.expires_at)} />
        {s.revoked_at && (
          <Field
            label="Revoked at"
            value={<span className="text-red-600 font-medium">{formatDateFull(s.revoked_at)}</span>}
          />
        )}
        {s.revocation_reason && (
          <Field
            label="Revocation reason"
            value={<span className="text-red-500">{s.revocation_reason}</span>}
          />
        )}
      </Card>
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

function NotFoundState({ id }: { id: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Session not found</p>
      <p className="text-xs text-stone-400 mt-1.5 font-mono">{id}</p>
      <p className="text-xs text-stone-400 mt-2 max-w-xs mx-auto">
        The session may have expired and been cleaned up, or the ID is invalid.
      </p>
      <a href="/ag-admin/sessions" className="mt-4 inline-block text-xs text-sky-600 hover:underline">
        Back to Sessions
      </a>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Session detail unavailable</p>
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
