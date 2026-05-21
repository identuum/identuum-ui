/**
 * HITL / CBAA queue — read-only page.
 *
 * Fetches GET /admin/hitl/queue from the AG management surface. Shows
 * pending held requests awaiting operator review. Each item links to
 * the associated agent session for full context.
 *
 * HITL = Human-in-the-Loop: agent session paused at a gate requiring
 * an operator decision before the agent can continue.
 *
 * CBAA = Capability-Bound Agent Approval: operator must approve capability
 * use before the agent token is unblocked.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - request_payload is intentionally excluded from display — it may
 *     contain agent tool inputs that must not be surfaced in a summary view.
 *   - Only safe operational fields are rendered: IDs, gate_state, timestamps.
 *   - On 401/403 the user is redirected to /ag-admin/login.
 *   - Write operations (approve / deny) are not wired in this page yet —
 *     they require a confirmed auth-level check and are deferred.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "HITL / CBAA — Identuum AG" };

/** Safe subset of heldRequestDTO from identuum-ag internal/handlers/hitl_admin.go.
 *  request_payload is deliberately absent — may contain sensitive tool context. */
interface HeldRequest {
  id: string;
  agent_session_id: string;
  // intervention_id is the hitl_interventions UUID used for approve/deny actions.
  // Absent for pre-3.4.2 held_requests with no associated intervention row.
  intervention_id?: string | null;
  gate_state: "pending" | "approved" | "denied" | "expired" | string;
  pending_since: string;
  expires_at: string;
  decided_at?: string | null;
}

interface QueueResult {
  items: HeldRequest[];
  count: number;
}

async function fetchQueue(): Promise<QueueResult | "auth_error" | "unavailable"> {
  const res = await agRequest("/admin/hitl/queue?limit=50");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    const raw = await res.json();
    // Backend returns {"success": true, "held_requests": [...], "count": N}
    if (raw && typeof raw === "object" && "held_requests" in raw && Array.isArray(raw.held_requests)) {
      const items: HeldRequest[] = (raw.held_requests as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id ?? ""),
        agent_session_id: String(r.agent_session_id ?? ""),
        intervention_id: r.intervention_id != null ? String(r.intervention_id) : null,
        gate_state: String(r.gate_state ?? "unknown"),
        pending_since: String(r.pending_since ?? ""),
        expires_at: String(r.expires_at ?? ""),
        decided_at: r.decided_at != null ? String(r.decided_at) : null,
        // request_payload intentionally not mapped
      }));
      return { items, count: typeof raw.count === "number" ? raw.count : items.length };
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

const GATE_STATE_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  denied: "bg-red-50 text-red-600",
  expired: "bg-stone-100 text-stone-500",
};

export default async function HitlPage() {
  const result = await fetchQueue();

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  const items = result === "unavailable" ? [] : result.items;
  const pendingCount = result === "unavailable" ? null : items.filter((i) => i.gate_state === "pending").length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">HITL / CBAA</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Human-in-the-loop gate interventions and capability-bound approval requests.
          </p>
        </div>
        <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
          Read-only
        </span>
      </div>

      {/* Explanation */}
      <div className="bg-sky-50 border border-sky-100 rounded-2xl px-5 py-4 space-y-1.5">
        <p className="text-xs font-semibold text-sky-800">What is HITL / CBAA?</p>
        <p className="text-xs text-sky-700 leading-relaxed">
          <strong>HITL (Human-in-the-Loop):</strong> An agent session pauses at a gate requiring an
          operator decision — approve to let the agent continue, deny to block it.
        </p>
        <p className="text-xs text-sky-700 leading-relaxed">
          <strong>CBAA (Capability-Bound Agent Approval):</strong> An agent token requests a
          capability that requires explicit operator approval before the action can proceed.
        </p>
      </div>

      {/* Write-action note */}
      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-3">
        <p className="text-xs text-amber-700 leading-relaxed">
          <strong>Approve / Deny actions are not yet wired in this UI.</strong> The AG backend
          exposes{" "}
          <span className="font-mono bg-amber-100 px-1 rounded">
            POST /admin/hitl/:id/approve
          </span>{" "}
          and{" "}
          <span className="font-mono bg-amber-100 px-1 rounded">
            POST /admin/hitl/:id/deny
          </span>{" "}
          — these require sufficient reviewer authentication level (ACR) and are deferred to a
          dedicated review workflow.
        </p>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard
          label="Pending review"
          value={pendingCount}
          accent={pendingCount !== null && pendingCount > 0 ? "amber" : undefined}
        />
        <CountCard
          label="Approved"
          value={result === "unavailable" ? null : items.filter((i) => i.gate_state === "approved").length}
          accent="green"
        />
        <CountCard
          label="Denied"
          value={result === "unavailable" ? null : items.filter((i) => i.gate_state === "denied").length}
          accent="red"
        />
        <CountCard
          label="Expired"
          value={result === "unavailable" ? null : items.filter((i) => i.gate_state === "expired").length}
        />
      </div>

      {/* Queue */}
      {result === "unavailable" ? (
        <UnavailableState />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <QueueTable items={items} />
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pt-2">
        <QuickLink href="/ag-admin/sessions">Agent Sessions</QuickLink>
        <QuickLink href="/ag-admin/agents">Agent Registry</QuickLink>
        <QuickLink href="/ag-admin">Dashboard</QuickLink>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CountCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent?: "amber" | "green" | "red";
}) {
  const valueCls =
    accent === "amber" ? "text-amber-700" :
    accent === "green" ? "text-emerald-700" :
    accent === "red" ? "text-red-600" :
    "text-sky-950";
  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueCls}`}>
        {value !== null ? value.toLocaleString() : "—"}
      </p>
    </div>
  );
}

function QueueTable({ items }: { items: HeldRequest[] }) {
  const pending = items.filter((i) => i.gate_state === "pending");
  const decided = items.filter((i) => i.gate_state !== "pending");

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <QueueSection title="Pending review" items={pending} />
      )}
      {decided.length > 0 && (
        <QueueSection title="Decided / expired" items={decided} />
      )}
    </div>
  );
}

function QueueSection({ title, items }: { title: string; items: HeldRequest[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
        <span className="text-xs text-stone-400">{items.length}</span>
      </div>
      <div className="divide-y divide-stone-100">
        {items.map((item) => (
          <QueueRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function QueueRow({ item }: { item: HeldRequest }) {
  const stateCls = GATE_STATE_STYLES[item.gate_state] ?? "bg-stone-100 text-stone-500";
  const isPending = item.gate_state === "pending";

  return (
    <div className="px-6 py-4 flex items-start gap-4 hover:bg-stone-50/60 transition-colors">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${stateCls}`}
          >
            {item.gate_state}
          </span>
          {isPending && (
            <span className="text-[10px] text-amber-600 font-medium">Awaiting decision</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
          <span>
            Intervention:{" "}
            <span className="font-mono text-stone-600">{item.id.slice(0, 12)}…</span>
          </span>
          <span>
            Session:{" "}
            <a
              href={`/ag-admin/sessions/${item.agent_session_id}`}
              className="font-mono text-sky-600 hover:underline"
            >
              {item.agent_session_id.slice(0, 12)}…
            </a>
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-400">
          <span>Pending since: {formatDate(item.pending_since)}</span>
          <span>Expires: {formatDate(item.expires_at)}</span>
          {item.decided_at && <span>Decided: {formatDate(item.decided_at)}</span>}
        </div>
      </div>
      <div className="shrink-0 flex items-start gap-2 pt-0.5">
        {item.intervention_id && (
          <a
            href={`/ag-admin/hitl/${item.intervention_id}`}
            className="text-[11px] text-sky-600 hover:text-sky-800 hover:underline font-semibold whitespace-nowrap"
            aria-label={`Review intervention ${item.id.slice(0, 8)}`}
          >
            Review →
          </a>
        )}
        <a
          href={`/ag-admin/sessions/${item.agent_session_id}`}
          className="text-[11px] text-sky-400 hover:text-sky-600 hover:underline font-medium whitespace-nowrap"
          aria-label={`View session for intervention ${item.id.slice(0, 8)}`}
        >
          Session →
        </a>
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
      <p className="text-sm font-semibold text-sky-950">HITL / CBAA backend unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
        Could not reach the AG management surface. Check that identuum-ag is running and the
        runtime configuration points to the correct management URL.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No HITL / CBAA review items found</p>
      <p className="text-xs text-stone-400 mt-2 max-w-sm mx-auto leading-relaxed">
        No held requests in the queue. Interventions appear here when an agent token carries a
        required HITL posture and the agent submits a feedback capability token.
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
