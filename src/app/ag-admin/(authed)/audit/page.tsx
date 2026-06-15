/**
 * Audit / Activity page — read-only governance event log.
 *
 * Fetches GET /admin/audit-log from the AG management surface.
 * Feature-gated: requires Professional or Enterprise tier.
 * Free tier returns 403 "feature_not_enabled" — shown as a distinct state.
 *
 * Safety:
 *   - agRequest() attaches bearer token server-side; never reaches browser.
 *   - `payload` (map[string]any) is intentionally NOT mapped — it may contain
 *     tool inputs, JWT claims, session validators, or other sensitive data.
 *   - `organization_id`, `correlation_id`, `request_id`, `chain_position` are
 *     internal metadata fields; not rendered.
 *   - Raw backend errors are not forwarded to the browser.
 *   - No write/undo/delete actions on this page.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit / Activity — Identuum AG" };

/** Safe subset of auditEventDTO from identuum-ag handlers/audit_log.go.
 *  payload, organization_id, correlation_id, request_id, chain_position excluded. */
interface AuditEvent {
  id: string;
  event_timestamp: string;
  event_type: string;
  event_severity: string;
  event_stream: string;
  ag_user_id?: string | null;
  agent_session_id?: string | null;
  actor_type?: string | null;
  identity_class?: string | null;
  risk_level?: string | null;
  decision?: string | null;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  ag_startup: "AG Startup",
  ag_shutdown: "AG Shutdown",
  operator_login: "Operator Login",
  operator_login_failed: "Operator Login Failed",
  operator_logout: "Operator Logout",
  operator_session_revoked: "Operator Session Revoked",
  agent_token_exchanged: "Agent Token Issued",
  agent_token_exchange_failed: "Agent Token Issue Failed",
  agent_session_created: "Agent Session Created",
  agent_session_revoked: "Agent Session Revoked",
  agent_session_expired: "Agent Session Expired",
  hitl_gate_triggered: "HITL Gate Triggered",
  hitl_approved: "HITL Approved",
  hitl_denied: "HITL Denied",
  hitl_expired: "HITL Expired",
  hitl_feedback_received: "HITL Feedback Received",
  hitl_decision_polled: "HITL Decision Polled",
  capability_bound_denied: "Capability Bound Denied",
  capability_revoked: "Capability Revoked",
  dpop_rejected: "DPoP Rejected",
  token_revoked: "Token Revoked",
  token_revocation_failed: "Token Revocation Failed",
  signing_key_generated: "Signing Key Generated",
  signing_key_rotated: "Signing Key Rotated",
  signing_key_retired: "Signing Key Retired",
  signing_key_revoked: "Signing Key Revoked",
  idp_created: "IdP Created",
  idp_updated: "IdP Updated",
  idp_deleted: "IdP Deleted",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-stone-100 text-stone-500",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const STREAM_LABELS: Record<string, string> = {
  compliance: "Compliance",
  agentic_security: "ITDR",
  system: "System",
};

const RISK_STYLES: Record<string, string> = {
  info: "bg-stone-100 text-stone-500",
  low: "bg-sky-50 text-sky-600",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

type StreamFilter = "all" | "compliance" | "agentic_security" | "system";
type SeverityFilter = "all" | "info" | "warning" | "error" | "critical";

const STREAM_OPTIONS: StreamFilter[] = ["all", "compliance", "agentic_security", "system"];
const SEVERITY_OPTIONS: SeverityFilter[] = ["all", "info", "warning", "error", "critical"];

const PAGE_SIZES = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 25;

interface FetchResult {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

async function fetchAuditLog(params: {
  limit: number;
  offset: number;
  stream: StreamFilter;
  severity: SeverityFilter;
  eventType?: string;
}): Promise<FetchResult | "auth_error" | "feature_not_enabled" | "unavailable"> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  qs.set("offset", String(params.offset));
  if (params.stream !== "all") qs.set("event_stream", params.stream);
  if (params.severity !== "all") qs.set("severity", params.severity);
  if (params.eventType) qs.set("event_type", params.eventType);

  const res = await agRequest(`/admin/audit-log?${qs.toString()}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) {
    try {
      const body = await res.json();
      if (body?.error === "feature_not_enabled") return "feature_not_enabled";
    } catch {
      /* ignore */
    }
    return "auth_error";
  }
  if (!res.ok) return "unavailable";
  try {
    const data = await res.json();
    if (!data || !Array.isArray(data.events)) return "unavailable";
    const events: AuditEvent[] = (data.events as Array<Record<string, unknown>>).map((e) => ({
      id: String(e.id ?? ""),
      event_timestamp: String(e.event_timestamp ?? ""),
      event_type: String(e.event_type ?? ""),
      event_severity: String(e.event_severity ?? ""),
      event_stream: String(e.event_stream ?? ""),
      ag_user_id: e.ag_user_id != null ? String(e.ag_user_id) : null,
      agent_session_id: e.agent_session_id != null ? String(e.agent_session_id) : null,
      actor_type: e.actor_type != null ? String(e.actor_type) : null,
      identity_class: e.identity_class != null ? String(e.identity_class) : null,
      risk_level: e.risk_level != null ? String(e.risk_level) : null,
      decision: e.decision != null ? String(e.decision) : null,
      // payload intentionally not mapped — may contain sensitive data
    }));
    return {
      events,
      total: typeof data.total === "number" ? data.total : events.length,
      limit: params.limit,
      offset: params.offset,
    };
  } catch {
    return "unavailable";
  }
}

interface OperatorDisplay {
  email: string;
  display_name?: string | null;
}

// fetchOperatorDisplayBatch calls POST /admin/ag-users/display-batch with up to
// batchDisplayMaxIDs (250) unique IDs. Returns a Map from id → OperatorDisplay,
// or null for any ID not found. Returns an empty Map on any request failure so
// the caller can fall back to short UUID for all rows.
//
// Backend enforces max 250 IDs, matching audit page max pageSize.
// No per-user N+1 HTTP requests — one batch call for the whole page.
async function fetchOperatorDisplayBatch(ids: string[]): Promise<Map<string, OperatorDisplay>> {
  if (ids.length === 0) return new Map();
  try {
    const res = await agRequest("/admin/ag-users/display-batch", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    if (!res || !res.ok) return new Map();
    const data = (await res.json()) as {
      users?: Array<{ id: string; email: string; display_name?: string | null }>;
    };
    const map = new Map<string, OperatorDisplay>();
    for (const u of data.users ?? []) {
      if (u.id && u.email) {
        map.set(u.id, { email: u.email, display_name: u.display_name ?? null });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

interface SessionDisplay {
  id: string;
  agent_id?: string | null;
  intent: string;
  task_id?: string | null;
  agent_mode: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

// fetchSessionDisplayBatch calls POST /admin/agent-sessions/display-batch.
// Returns a Map from session_id → SessionDisplay.
// Returns an empty Map on any failure — rows fall back to existing session link.
// Safe fields only: id, agent_id, intent, task_id, agent_mode, timestamps.
// Excludes token material, auth claims, tool inputs, HITL review requirements.
async function fetchSessionDisplayBatch(ids: string[]): Promise<Map<string, SessionDisplay>> {
  if (ids.length === 0) return new Map();
  try {
    const res = await agRequest("/admin/agent-sessions/display-batch", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    if (!res || !res.ok) return new Map();
    const data = (await res.json()) as {
      sessions?: Array<{
        id: string;
        agent_id?: string | null;
        intent: string;
        task_id?: string | null;
        agent_mode: string;
        created_at: string;
        expires_at: string;
        revoked_at?: string | null;
      }>;
    };
    const map = new Map<string, SessionDisplay>();
    for (const s of data.sessions ?? []) {
      if (s.id) map.set(s.id, s as SessionDisplay);
    }
    return map;
  } catch {
    return new Map();
  }
}

interface VerifyResult {
  valid: boolean;
  total_rows: number;
  tampered_at?: number | null;
  // service_error is a mapped note, not the raw backend error string
  service_error?: string | null;
}

// fetchAuditVerify calls GET /admin/audit-log/verify.
// Returns:
//   VerifyResult on 200 (valid chain) or 409 (tamper detected)
//   "feature_not_enabled" on 403 feature_not_enabled
//   "auth_error" on other 401/403
//   "unavailable" on other errors
//
// Safety: raw `error` field from backend is never forwarded to the browser.
// service_error is a safe operator-friendly note derived from backend `valid` state.
async function fetchAuditVerify(): Promise<
  VerifyResult | "feature_not_enabled" | "auth_error" | "unavailable"
> {
  const res = await agRequest("/admin/audit-log/verify");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) {
    try {
      const body = await res.json();
      if (body?.error === "feature_not_enabled") return "feature_not_enabled";
    } catch {
      /* ignore */
    }
    return "auth_error";
  }
  // 200 = valid chain, 409 = tamper detected — both return the same shape.
  if (res.status === 200 || res.status === 409) {
    try {
      const data = await res.json();
      const serviceError =
        !data?.valid && data?.tampered_at == null
          ? "Chain verification encountered an unexpected error. Contact your administrator."
          : null;
      return {
        valid: data?.valid === true,
        total_rows: typeof data?.total_rows === "number" ? data.total_rows : 0,
        tampered_at: typeof data?.tampered_at === "number" ? data.tampered_at : null,
        service_error: serviceError,
      };
    } catch {
      return "unavailable";
    }
  }
  return "unavailable";
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const rawStream = typeof sp.stream === "string" ? sp.stream : "all";
  const stream: StreamFilter = STREAM_OPTIONS.includes(rawStream as StreamFilter)
    ? (rawStream as StreamFilter)
    : "all";
  const rawSeverity = typeof sp.severity === "string" ? sp.severity : "all";
  const severity: SeverityFilter = SEVERITY_OPTIONS.includes(rawSeverity as SeverityFilter)
    ? (rawSeverity as SeverityFilter)
    : "all";
  const rawPageSize = Number.parseInt(typeof sp.pageSize === "string" ? sp.pageSize : "", 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : DEFAULT_PAGE_SIZE;
  const rawPage = Number.parseInt(typeof sp.page === "string" ? sp.page : "", 10);
  const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);
  const offset = (page - 1) * pageSize;

  // eventType: forwarded to backend as event_type; empty string means no filter.
  const eventType = typeof sp.eventType === "string" ? sp.eventType.trim() : "";

  // verify=1 in URL means the operator explicitly requested verification.
  // Without it, verification is skipped to avoid scanning the full chain on every load.
  const shouldVerify = sp.verify === "1";

  const [result, verifyResult] = await Promise.all([
    fetchAuditLog({ limit: pageSize, offset, stream, severity, eventType: eventType || undefined }),
    shouldVerify ? fetchAuditVerify() : Promise.resolve(null),
  ]);

  if (result === "auth_error") redirect("/ag-admin/login");

  const events = result !== "unavailable" && result !== "feature_not_enabled" ? result.events : [];
  const total = result !== "unavailable" && result !== "feature_not_enabled" ? result.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  // Resolve operator display labels via a single batch POST.
  // Deduplicates IDs before the request. Backend max is 250 IDs (= audit max pageSize).
  // On any batch failure, returns an empty map and rows fall back to short UUID.
  const uniqueUserIds = Array.from(
    new Set(events.map((e) => e.ag_user_id).filter((id): id is string => !!id))
  );

  const operatorMap = await fetchOperatorDisplayBatch(uniqueUserIds);

  // Resolve session display context for unique agent_session_id values.
  const uniqueSessionIds = Array.from(
    new Set(events.map((e) => e.agent_session_id).filter((id): id is string => !!id))
  );
  const sessionMap = await fetchSessionDisplayBatch(uniqueSessionIds);

  function buildUrl(overrides: Record<string, string | number>) {
    const p = new URLSearchParams();
    if (stream !== "all") p.set("stream", stream);
    if (severity !== "all") p.set("severity", severity);
    if (eventType) p.set("eventType", eventType);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
    const s = p.toString();
    return `/ag-admin/audit${s ? `?${s}` : ""}`;
  }

  function streamUrl(s: StreamFilter) {
    const p = new URLSearchParams();
    if (s !== "all") p.set("stream", s);
    if (severity !== "all") p.set("severity", severity);
    if (eventType) p.set("eventType", eventType);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
    p.set("page", "1");
    const qs = p.toString();
    return `/ag-admin/audit${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Audit / Activity</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            AG governance events: agent changes, session activity, HITL decisions, and
            administrative actions.
          </p>
        </div>
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>

      {/* Audit chain verification panel — on-demand only */}
      <ChainVerifyPanel
        verifyResult={verifyResult}
        runVerifyUrl={buildUrl({ verify: 1 })}
        shouldVerify={shouldVerify}
      />

      {/* Feature-not-enabled state */}
      {result === "feature_not_enabled" && (
        <div className="bg-amber-50 border border-amber-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-semibold text-amber-900">
            Audit log requires Professional or Enterprise tier
          </p>
          <p className="text-xs text-amber-700 mt-1.5 max-w-sm mx-auto leading-relaxed">
            The audit log read API is not available on your current license tier. Upgrade to
            Professional or Enterprise to enable audit event access.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-4">
            <a href="/ag-admin" className="text-xs text-sky-600 hover:underline">
              Dashboard →
            </a>
            <a href="/ag-admin/sessions" className="text-xs text-sky-600 hover:underline">
              Sessions →
            </a>
            <a href="/ag-admin/revocations" className="text-xs text-sky-600 hover:underline">
              Revocations →
            </a>
          </div>
        </div>
      )}

      {/* Main content — only when feature is available */}
      {result !== "feature_not_enabled" && (
        <>
          {/* Stream filter tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STREAM_OPTIONS.map((s) => {
              const active = stream === s;
              return (
                <a
                  key={s}
                  href={streamUrl(s)}
                  aria-current={active ? "page" : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                    active
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  {s === "all"
                    ? "All streams"
                    : s === "agentic_security"
                      ? "ITDR / Agentic"
                      : (STREAM_LABELS[s] ?? s)}
                </a>
              );
            })}
            <span className="text-xs text-stone-300 ml-1">|</span>
            {/* Severity filter */}
            {SEVERITY_OPTIONS.map((sv) => {
              const active = severity === sv;
              const href = buildUrl({ severity: sv, page: 1 });
              return (
                <a
                  key={sv}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`text-xs px-2 py-1 rounded-lg border font-medium capitalize transition-colors ${
                    active
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  {sv === "all" ? "All" : sv}
                </a>
              );
            })}
            <span className="text-xs text-stone-300 ml-1">|</span>
            {/* Page size */}
            <span className="text-xs text-stone-400">Per page:</span>
            {PAGE_SIZES.map((n) => {
              const active = n === pageSize;
              const p = new URLSearchParams();
              if (stream !== "all") p.set("stream", stream);
              if (severity !== "all") p.set("severity", severity);
              if (eventType) p.set("eventType", eventType);
              if (n !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(n));
              p.set("page", "1");
              const href = `/ag-admin/audit${p.toString() ? `?${p.toString()}` : ""}`;
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
          </div>

          {/* Event type filter */}
          <form method="GET" action="/ag-admin/audit" className="flex items-center gap-2 flex-wrap">
            {stream !== "all" && <input type="hidden" name="stream" value={stream} />}
            {severity !== "all" && <input type="hidden" name="severity" value={severity} />}
            {pageSize !== DEFAULT_PAGE_SIZE && (
              <input type="hidden" name="pageSize" value={String(pageSize)} />
            )}
            <input type="hidden" name="page" value="1" />
            <label htmlFor="ag-audit-event-type" className="text-xs text-stone-400 shrink-0">
              Event type:
            </label>
            <select
              id="ag-audit-event-type"
              name="eventType"
              defaultValue={eventType}
              className="text-xs rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">All event types</option>
              <optgroup label="Operator">
                <option value="operator_login">Operator Login</option>
                <option value="operator_logout">Operator Logout</option>
                <option value="operator_login_failed">Operator Login Failed</option>
                <option value="operator_session_revoked">Operator Session Revoked</option>
              </optgroup>
              <optgroup label="Agent Sessions">
                <option value="agent_session_created">Agent Session Created</option>
                <option value="agent_session_revoked">Agent Session Revoked</option>
                <option value="agent_session_expired">Agent Session Expired</option>
                <option value="agent_token_exchanged">Agent Token Issued</option>
                <option value="agent_token_exchange_failed">Agent Token Issue Failed</option>
              </optgroup>
              <optgroup label="HITL / CBAA">
                <option value="hitl_gate_triggered">HITL Gate Triggered</option>
                <option value="hitl_approved">HITL Approved</option>
                <option value="hitl_denied">HITL Denied</option>
                <option value="hitl_expired">HITL Expired</option>
                <option value="hitl_feedback_received">HITL Feedback Received</option>
              </optgroup>
              <optgroup label="Capabilities">
                <option value="capability_bound_denied">Capability Bound Denied</option>
                <option value="capability_revoked">Capability Revoked</option>
                <option value="dpop_rejected">DPoP Rejected</option>
              </optgroup>
              <optgroup label="Tokens &amp; Revocations">
                <option value="token_revoked">Token Revoked</option>
                <option value="token_revocation_failed">Token Revocation Failed</option>
              </optgroup>
              <optgroup label="Agent Registry">
                <option value="agent_registry_created">Agent Registry Created</option>
                <option value="agent_registry_updated">Agent Registry Updated</option>
                <option value="agent_registry_deleted">Agent Registry Deleted</option>
              </optgroup>
              <optgroup label="Signing Keys">
                <option value="signing_key_generated">Signing Key Generated</option>
                <option value="signing_key_rotated">Signing Key Rotated</option>
                <option value="signing_key_retired">Signing Key Retired</option>
                <option value="signing_key_revoked">Signing Key Revoked</option>
              </optgroup>
              <optgroup label="Identity Providers">
                <option value="idp_created">IdP Created</option>
                <option value="idp_updated">IdP Updated</option>
                <option value="idp_deleted">IdP Deleted</option>
              </optgroup>
              <optgroup label="Org Link">
                <option value="org_link_set">Org Link Set</option>
                <option value="org_link_cleared">Org Link Cleared</option>
                <option value="org_link_organization_imported">Org Link Imported</option>
              </optgroup>
              <optgroup label="Audit Chain">
                <option value="audit_chain_verified">Audit Chain Verified</option>
                <option value="audit_chain_tampered">Audit Chain Tampered</option>
              </optgroup>
              <optgroup label="System">
                <option value="ag_startup">AG Startup</option>
                <option value="ag_shutdown">AG Shutdown</option>
              </optgroup>
            </select>
            <button
              type="submit"
              className="text-xs rounded-lg bg-sky-700 px-2.5 py-1.5 font-medium text-white hover:bg-sky-800 transition-colors"
            >
              Filter
            </button>
            {eventType && (
              <a
                href={(() => {
                  const p = new URLSearchParams();
                  if (stream !== "all") p.set("stream", stream);
                  if (severity !== "all") p.set("severity", severity);
                  if (pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(pageSize));
                  p.set("page", "1");
                  const qs = p.toString();
                  return `/ag-admin/audit${qs ? `?${qs}` : ""}`;
                })()}
                className="text-xs text-stone-400 hover:text-stone-600 underline"
              >
                Clear event type
              </a>
            )}
          </form>

          {/* List */}
          {result === "unavailable" ? (
            <UnavailableState />
          ) : events.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
                <div className="px-6 py-3 border-b border-stone-100 grid grid-cols-[auto_1fr_auto] gap-4 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                  <span>Event / Severity</span>
                  <span>Details</span>
                  <span>Timestamp</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {events.map((e) => (
                    <AuditEventRow
                      key={e.id}
                      event={e}
                      operatorMap={operatorMap}
                      sessionMap={sessionMap}
                    />
                  ))}
                </div>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>
                  {Math.min(offset + 1, total)}–{Math.min(offset + pageSize, total)} of {total}
                </span>
                <div className="flex items-center gap-1.5">
                  {hasPrev ? (
                    <a
                      href={buildUrl({ page: page - 1 })}
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
                  {hasNext ? (
                    <a
                      href={buildUrl({ page: page + 1 })}
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
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Chain verification panel ──────────────────────────────────────────────────

function ChainVerifyPanel({
  verifyResult,
  runVerifyUrl,
  shouldVerify,
}: {
  verifyResult: VerifyResult | "feature_not_enabled" | "auth_error" | "unavailable" | null;
  runVerifyUrl: string;
  shouldVerify: boolean;
}) {
  // Not yet requested — show idle state with explanation and run link.
  if (!shouldVerify || verifyResult === null) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-stone-700">Audit chain verification</p>
          <p className="text-xs text-stone-400 leading-relaxed">
            Verification has not been run for this view. Run to check the append-only audit hash
            chain. This may take time on large logs.
          </p>
        </div>
        <a
          href={runVerifyUrl}
          className="shrink-0 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Run verification
        </a>
      </div>
    );
  }

  if (verifyResult === "auth_error") return null;

  if (verifyResult === "unavailable") {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 shrink-0">
            Chain
          </span>
          <p className="text-xs text-stone-400 leading-relaxed">
            Chain verification unavailable — could not reach the AG management surface.
          </p>
        </div>
        <a
          href={runVerifyUrl}
          className="shrink-0 text-xs text-sky-600 hover:underline font-medium"
        >
          Run again
        </a>
      </div>
    );
  }

  if (verifyResult === "feature_not_enabled") {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm px-5 py-4 flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-stone-100 text-stone-400 shrink-0">
          Chain
        </span>
        <p className="text-xs text-stone-400 leading-relaxed">
          Hash-chain verification requires Enterprise tier. Upgrade to verify append-only audit
          integrity.
        </p>
      </div>
    );
  }

  if (!verifyResult.valid && verifyResult.service_error) {
    return (
      <div className="bg-white border border-amber-200 rounded-2xl shadow-sm px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0 mt-0.5">
            Chain
          </span>
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-amber-800">Verification error</p>
            <p className="text-xs text-amber-700 leading-relaxed">{verifyResult.service_error}</p>
            <p className="text-[11px] text-stone-400">
              {verifyResult.total_rows.toLocaleString()} events checked
            </p>
          </div>
        </div>
        <a
          href={runVerifyUrl}
          className="shrink-0 text-xs text-sky-600 hover:underline font-medium"
        >
          Run again
        </a>
      </div>
    );
  }

  if (!verifyResult.valid) {
    return (
      <div className="bg-white border border-red-300 rounded-2xl shadow-sm px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-50 text-red-700 shrink-0 mt-0.5">
            Chain break
          </span>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-red-800">Chain integrity check failed</p>
            <p className="text-xs text-red-700 leading-relaxed">
              AG detected a break in the append-only audit hash chain.
              {verifyResult.tampered_at != null && (
                <span>
                  {" "}
                  First divergence at chain position{" "}
                  <span className="font-mono">{verifyResult.tampered_at}</span>.
                </span>
              )}
            </p>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              In local development this can occur after test database resets, seeded fixture audit
              rows, or partial E2E test data. In production, investigate immediately.
            </p>
            <p className="text-[11px] text-stone-400">
              {verifyResult.total_rows.toLocaleString()} events checked
            </p>
          </div>
        </div>
        <a
          href={runVerifyUrl}
          className="shrink-0 text-xs text-sky-600 hover:underline font-medium"
        >
          Run again
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white border border-emerald-200 rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">
          Verified
        </span>
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-emerald-800">Append-only chain verified</p>
          <p className="text-[11px] text-stone-400">
            {verifyResult.total_rows.toLocaleString()} event
            {verifyResult.total_rows !== 1 ? "s" : ""} verified — no chain break detected.
          </p>
        </div>
      </div>
      <a href={runVerifyUrl} className="shrink-0 text-xs text-sky-600 hover:underline font-medium">
        Run again
      </a>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function sessionStatusLabel(s: SessionDisplay): "active" | "expired" | "revoked" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at) < new Date()) return "expired";
  return "active";
}

const SESSION_STATUS_MINI_STYLES = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-stone-100 text-stone-500",
  revoked: "bg-red-50 text-red-600",
};

function AuditEventRow({
  event: e,
  operatorMap,
  sessionMap,
}: {
  event: AuditEvent;
  operatorMap: Map<string, OperatorDisplay>;
  sessionMap: Map<string, SessionDisplay>;
}) {
  const label = EVENT_TYPE_LABELS[e.event_type] ?? e.event_type;
  const severityCls = SEVERITY_STYLES[e.event_severity] ?? "bg-stone-100 text-stone-500";
  const streamLabel = STREAM_LABELS[e.event_stream] ?? e.event_stream;
  // Operator display: prefer display_name, then email, then short UUID fallback.
  const opDisplay = e.ag_user_id ? operatorMap.get(e.ag_user_id) : undefined;
  const opPrimary = opDisplay
    ? opDisplay.display_name || opDisplay.email
    : e.ag_user_id
      ? `${e.ag_user_id.slice(0, 8)}…`
      : null;
  const opSecondary = opDisplay?.display_name ? opDisplay.email : null;
  // Session display context if available.
  const sessDisplay = e.agent_session_id ? sessionMap.get(e.agent_session_id) : undefined;
  const sessStatus = sessDisplay ? sessionStatusLabel(sessDisplay) : null;

  return (
    <div className="px-6 py-3 grid grid-cols-[auto_1fr_auto] gap-4 items-start hover:bg-stone-50/60 transition-colors">
      {/* Event type + severity */}
      <div className="space-y-1 w-44 shrink-0">
        <p className="text-xs font-semibold text-sky-950 leading-snug break-words">{label}</p>
        <div className="flex flex-wrap gap-1">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${severityCls}`}
          >
            {e.event_severity}
          </span>
          {e.event_stream && (
            <span className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-100">
              {streamLabel}
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="min-w-0 space-y-0.5 text-xs">
        {e.agent_session_id && (
          <div className="space-y-0.5">
            <p className="text-stone-500 flex items-center gap-1.5 flex-wrap">
              <span className="text-stone-400 text-[10px] uppercase tracking-wide shrink-0">
                Session
              </span>
              <a
                href={`/ag-admin/sessions/${e.agent_session_id}`}
                className="font-mono text-sky-600 hover:underline text-[11px]"
              >
                {e.agent_session_id.slice(0, 12)}…
              </a>
              {sessStatus && (
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${SESSION_STATUS_MINI_STYLES[sessStatus]}`}
                >
                  {sessStatus}
                </span>
              )}
            </p>
            {sessDisplay?.intent && (
              <p className="text-stone-600 leading-relaxed line-clamp-1 break-words">
                {sessDisplay.intent}
              </p>
            )}
            {sessDisplay?.task_id && (
              <p className="text-[11px] text-stone-400 font-mono truncate">
                Task: {sessDisplay.task_id}
              </p>
            )}
          </div>
        )}
        {opPrimary && (
          <div className="space-y-0">
            <p className="text-stone-600">
              <span className="text-stone-400 text-[10px] uppercase tracking-wide mr-1">
                Operator
              </span>
              <span className={opDisplay ? "" : "font-mono text-stone-400"}>{opPrimary}</span>
            </p>
            {opSecondary && <p className="text-[11px] text-stone-400">{opSecondary}</p>}
          </div>
        )}
        {e.risk_level && (
          <span
            className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${RISK_STYLES[e.risk_level] ?? "bg-stone-100 text-stone-500"}`}
          >
            Risk: {e.risk_level}
          </span>
        )}
        {e.decision && (
          <span className="inline-block text-[10px] font-medium text-stone-500 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-100 ml-1">
            {e.decision}
          </span>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[11px] text-stone-400 whitespace-nowrap pt-0.5">
        {formatDate(e.event_timestamp)}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No audit events found</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        No events match the current filter. Try changing the stream or severity filter.
      </p>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Audit log unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-4">
        <a href="/ag-admin" className="text-xs text-sky-600 hover:underline">
          Dashboard →
        </a>
        <a href="/ag-admin/agents" className="text-xs text-sky-600 hover:underline">
          Agent Registry →
        </a>
        <a href="/ag-admin/sessions" className="text-xs text-sky-600 hover:underline">
          Sessions →
        </a>
        <a href="/ag-admin/revocations" className="text-xs text-sky-600 hover:underline">
          Revocations →
        </a>
      </div>
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
