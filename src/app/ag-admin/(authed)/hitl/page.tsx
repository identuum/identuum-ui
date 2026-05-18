/**
 * HITL / CBAA queue — read-only page.
 *
 * Fetches GET /admin/hitl/queue from the AG management surface. Shows
 * pending held requests awaiting operator review.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; it never reaches
 *     the browser.
 *   - `request_payload` is intentionally excluded from display — it may
 *     contain agent request context, prompts, or operator-supplied task
 *     metadata that should not be rendered in a read-only summary view.
 *   - Only safe operational fields are rendered: IDs (truncated), gate
 *     state, timestamps.
 *   - On 401/403 the user is redirected to /ag-admin/login.
 *   - Write operations (approve / deny) are not wired — they require a
 *     confirmed auth flow and are deferred.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "HITL Queue — Identuum AG" };

/** Safe subset of heldRequestDTO from identuum-ag handlers/hitl_admin.go.
 *  request_payload is deliberately absent — it may contain sensitive context. */
interface HeldRequest {
  id: string;
  agent_session_id: string;
  gate_state: string;
  pending_since: string;
  expires_at: string;
  decided_at?: string | null;
}

async function fetchQueue(): Promise<HeldRequest[] | "auth_error" | "unavailable"> {
  const res = await agRequest("/admin/hitl/queue");
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (!res.ok) return "unavailable";
  try {
    // Only extract the fields we intend to display; request_payload is omitted.
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    return raw.map((r) => ({
      id: String(r.id ?? ""),
      agent_session_id: String(r.agent_session_id ?? ""),
      gate_state: String(r.gate_state ?? ""),
      pending_since: String(r.pending_since ?? ""),
      expires_at: String(r.expires_at ?? ""),
      decided_at: r.decided_at != null ? String(r.decided_at) : null,
    }));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">HITL / CBAA</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Human-in-the-loop gate interventions awaiting operator review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
            Read-only
          </span>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-3">
        <p className="text-xs text-amber-700 leading-relaxed">
          <strong>Approve / Deny actions are not yet available in this UI.</strong> To take action
          on a pending intervention, use the AG management API directly:{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">
            POST /admin/hitl/:intervention_id/approve
          </code>{" "}
          or{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">
            POST /admin/hitl/:intervention_id/deny
          </code>
          .
        </p>
      </div>

      {result === "unavailable" ? (
        <UnavailableState />
      ) : result.length === 0 ? (
        <EmptyState />
      ) : (
        <QueueTable items={result} />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QueueTable({ items }: { items: HeldRequest[] }) {
  const pending = items.filter((i) => i.gate_state === "pending");
  const other = items.filter((i) => i.gate_state !== "pending");

  return (
    <div className="space-y-4">
      {pending.length > 0 && <Section title="Pending review" items={pending} />}
      {other.length > 0 && <Section title="Decided / expired" items={other} />}
    </div>
  );
}

function Section({ title, items }: { title: string; items: HeldRequest[] }) {
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

  return (
    <div className="px-6 py-4 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono text-sky-950">{item.id.slice(0, 8)}…</span>
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${stateCls}`}
          >
            {item.gate_state}
          </span>
        </div>
        <p className="text-xs text-stone-500">
          Session: <span className="font-mono">{item.agent_session_id.slice(0, 8)}…</span>
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-400">
          <span>Pending since: {formatDate(item.pending_since)}</span>
          <span>Expires: {formatDate(item.expires_at)}</span>
          {item.decided_at && <span>Decided: {formatDate(item.decided_at)}</span>}
        </div>
      </div>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">HITL queue unavailable</p>
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
      <p className="text-sm font-semibold text-sky-950">No pending interventions</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        No held requests in the HITL queue. Interventions appear here when an agent token carries a
        required HITL posture and the feedback capability has been submitted.
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
