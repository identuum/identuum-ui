/**
 * HITL / CBAA review page — approve or deny a single pending intervention.
 *
 * Fetches GET /admin/hitl/:intervention_id from the AG management surface.
 * Works for pending, approved, denied, and expired interventions.
 * If the item is not found, a safe not-found state is shown.
 *
 * Approve: POST /admin/hitl/:intervention_id/approve — empty body accepted.
 * Deny: POST /admin/hitl/:intervention_id/deny — {"reason": "..."} required.
 *
 * Security:
 *   - All AG calls server-side via agRequest(); bearer token never reaches browser.
 *   - request_payload is NEVER fetched or rendered — it may contain agent tool
 *     inputs that must not be surfaced to the operator's browser.
 *   - Raw backend error messages are not forwarded to the browser. Structured
 *     error codes from the server are mapped to safe operator-facing messages.
 *   - ACR/freshness 403 responses show a re-authentication message, not raw body.
 *   - No cookies, internal URLs, or private keys are rendered.
 *   - Approve/deny forms use Server Actions; token remains server-side.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { agRequest } from "@/lib/ag-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review Intervention — Identuum AG" };

interface HeldRequest {
  id: string;
  agent_session_id: string;
  intervention_id?: string | null;
  gate_state: string;
  pending_since: string;
  expires_at: string;
  decided_at?: string | null;
}

async function fetchItem(
  interventionId: string
): Promise<HeldRequest | "auth_error" | "not_found" | "unavailable"> {
  const res = await agRequest(`/admin/hitl/${encodeURIComponent(interventionId)}`);
  if (!res) return "unavailable";
  if (res.status === 401 || res.status === 403) return "auth_error";
  if (res.status === 404) return "not_found";
  if (!res.ok) return "unavailable";
  try {
    const raw = await res.json();
    // Backend returns {"success": true, "held_request": {...}}
    if (!raw || !raw.success || !raw.held_request) return "unavailable";
    const hr = raw.held_request as Record<string, unknown>;
    return {
      id: String(hr.id ?? ""),
      agent_session_id: String(hr.agent_session_id ?? ""),
      intervention_id: hr.intervention_id != null ? String(hr.intervention_id) : null,
      gate_state: String(hr.gate_state ?? "unknown"),
      pending_since: String(hr.pending_since ?? ""),
      expires_at: String(hr.expires_at ?? ""),
      decided_at: hr.decided_at != null ? String(hr.decided_at) : null,
      // request_payload intentionally not mapped — may contain agent tool inputs
    };
  } catch {
    return "unavailable";
  }
}

// Approval error codes carried via searchParams so Server Actions can
// communicate failure states without exposing raw backend errors.
type ReviewError =
  | "acr_required" // 403 Reviewer ACR insufficient
  | "auth_too_old" // 403 Reviewer authentication too old
  | "already_decided" // 409 Intervention already has a recorded decision
  | "not_found" // 404 Intervention not found
  | "reason_required" // UI validation: deny reason is empty
  | "reason_too_long" // UI validation: reason > 1024 chars
  | "failed" // Unexpected backend error
  | "unavailable"; // Cannot reach AG management surface

const REVIEW_ERROR_MESSAGES: Record<ReviewError, string> = {
  acr_required:
    "Stronger authentication is required before you can approve or deny this request. Re-authenticate with a higher-assurance method (e.g. MFA, passkey) and try again.",
  auth_too_old:
    "Your authentication session is too old to perform this review. Please re-authenticate and try again.",
  already_decided:
    "This intervention has already been decided. Refresh the queue to see the current state.",
  not_found: "Intervention not found. It may have expired or been decided by another operator.",
  reason_required: "A reason is required when denying an intervention.",
  reason_too_long: "The reason must be 1024 characters or fewer.",
  failed: "The action could not be completed. Please try again.",
  unavailable: "Could not reach the AG management surface. Check that identuum-ag is running.",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const errorCode = typeof sp.error === "string" ? (sp.error as ReviewError) : null;
  const reviewedDecision = typeof sp.reviewed === "string" ? sp.reviewed : null;

  const item = await fetchItem(id);

  if (item === "auth_error") redirect("/ag-admin/login");

  // -- Server Actions --

  async function approve(_formData: FormData) {
    "use server";
    const res = await agRequest(`/admin/hitl/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!res) redirect(`/ag-admin/hitl/${id}?error=unavailable`);
    if (res.status === 403) {
      let errorKey: ReviewError = "failed";
      try {
        const body = await res.json();
        if (body?.message === "Reviewer ACR insufficient") errorKey = "acr_required";
        else if (body?.message === "Reviewer authentication too old") errorKey = "auth_too_old";
        else errorKey = "acr_required"; // default for 403
      } catch {
        errorKey = "acr_required";
      }
      redirect(`/ag-admin/hitl/${id}?error=${errorKey}`);
    }
    if (res.status === 404) redirect(`/ag-admin/hitl/${id}?error=not_found`);
    if (res.status === 409) redirect(`/ag-admin/hitl/${id}?error=already_decided`);
    if (!res.ok) redirect(`/ag-admin/hitl/${id}?error=failed`);
    redirect("/ag-admin/hitl?reviewed=approved");
  }

  async function deny(formData: FormData) {
    "use server";
    const reason = formData.get("reason")?.toString().trim() ?? "";
    if (!reason) redirect(`/ag-admin/hitl/${id}?error=reason_required`);
    if (reason.length > 1024) redirect(`/ag-admin/hitl/${id}?error=reason_too_long`);
    const res = await agRequest(`/admin/hitl/${encodeURIComponent(id)}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    if (!res) redirect(`/ag-admin/hitl/${id}?error=unavailable`);
    if (res.status === 403) {
      let errorKey: ReviewError = "failed";
      try {
        const body = await res.json();
        if (body?.message === "Reviewer ACR insufficient") errorKey = "acr_required";
        else if (body?.message === "Reviewer authentication too old") errorKey = "auth_too_old";
        else errorKey = "acr_required";
      } catch {
        errorKey = "acr_required";
      }
      redirect(`/ag-admin/hitl/${id}?error=${errorKey}`);
    }
    if (res.status === 404) redirect(`/ag-admin/hitl/${id}?error=not_found`);
    if (res.status === 409) redirect(`/ag-admin/hitl/${id}?error=already_decided`);
    if (!res.ok) redirect(`/ag-admin/hitl/${id}?error=failed`);
    redirect("/ag-admin/hitl?reviewed=denied");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <a
          href="/ag-admin/hitl"
          className="text-xs text-stone-400 hover:text-sky-700 transition-colors"
        >
          ← HITL / CBAA Queue
        </a>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Review HITL / CBAA request
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Approve to allow the agent to continue, or deny to block it.
        </p>
      </div>

      {/* Success state (after redirect back) */}
      {reviewedDecision && (
        <div
          className={`rounded-2xl border px-5 py-4 text-xs font-medium ${
            reviewedDecision === "approved"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          Intervention {reviewedDecision === "approved" ? "approved" : "denied"} successfully.{" "}
          <a href="/ag-admin/hitl" className="underline">
            Back to queue →
          </a>
        </div>
      )}

      {/* Error notice */}
      {errorCode && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <p className="text-xs font-semibold text-amber-800 mb-0.5">Action failed</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {REVIEW_ERROR_MESSAGES[errorCode] ?? "An unexpected error occurred."}
          </p>
        </div>
      )}

      {/* Main content */}
      {item === "unavailable" ? (
        <UnavailableState />
      ) : item === "not_found" ? (
        <NotFoundState interventionId={id} />
      ) : (
        <ReviewDetail item={item} approve={approve} deny={deny} />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const GATE_STATE_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  denied: "bg-red-50 text-red-600",
  expired: "bg-stone-100 text-stone-500",
};

function ReviewDetail({
  item,
  approve,
  deny,
}: {
  item: HeldRequest;
  approve: (fd: FormData) => Promise<void>;
  deny: (fd: FormData) => Promise<void>;
}) {
  const stateCls = GATE_STATE_STYLES[item.gate_state] ?? "bg-stone-100 text-stone-500";
  const isPending = item.gate_state === "pending";
  const isExpired = item.gate_state === "expired" || new Date(item.expires_at) < new Date();

  return (
    <div className="space-y-5">
      {/* Intervention detail card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Intervention details</p>
        </div>
        <dl className="px-6 py-4 space-y-3">
          <Field label="State">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${stateCls}`}
            >
              {item.gate_state}
            </span>
          </Field>
          <Field label="Intervention ID">
            <span className="font-mono text-xs break-all">{item.intervention_id ?? item.id}</span>
          </Field>
          <Field label="Agent session">
            <div className="space-y-0.5">
              <a
                href={`/ag-admin/sessions/${item.agent_session_id}`}
                className="font-mono text-xs text-sky-600 hover:underline break-all"
              >
                {item.agent_session_id}
              </a>
              <p className="text-[11px] text-stone-400">
                Click to view session intent, agent, and context →
              </p>
            </div>
          </Field>
          <Field label="Pending since">{formatDate(item.pending_since)}</Field>
          <Field label="Expires">{formatDate(item.expires_at)}</Field>
          {item.decided_at && <Field label="Decided at">{formatDate(item.decided_at)}</Field>}
        </dl>
      </div>

      {/* Tool input payload notice */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl px-5 py-3">
        <p className="text-xs text-stone-600 leading-relaxed">
          <strong>Tool input payload is intentionally not displayed</strong> because it may contain
          sensitive data. To inspect the full agent session context, use the session detail link
          above.
        </p>
      </div>

      {/* Approve / Deny forms — only for pending, non-expired items */}
      {isPending && !isExpired ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Approve */}
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-100">
              <p className="text-sm font-semibold text-emerald-700">Approve</p>
              <p className="text-xs text-stone-400 mt-0.5">Allow the agent to continue.</p>
            </div>
            <div className="px-6 py-4">
              <form action={approve}>
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  Approve intervention
                </button>
              </form>
            </div>
          </div>

          {/* Deny */}
          <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-100">
              <p className="text-sm font-semibold text-red-600">Deny</p>
              <p className="text-xs text-stone-400 mt-0.5">Block the agent. Reason is required.</p>
            </div>
            <div className="px-6 py-4">
              <form action={deny} className="space-y-3">
                <div>
                  <label htmlFor="deny-reason" className="sr-only">
                    Reason for denial
                  </label>
                  <textarea
                    id="deny-reason"
                    name="reason"
                    rows={3}
                    maxLength={1024}
                    required
                    placeholder="Reason for denial (required, max 1024 chars)"
                    className="w-full text-xs rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors"
                >
                  Deny intervention
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-stone-50 border border-stone-200 rounded-2xl px-5 py-4 text-center">
          <p className="text-sm text-stone-500">
            {isExpired
              ? "This intervention has expired and can no longer be approved or denied."
              : `This intervention is in state "${item.gate_state}" and cannot be reviewed.`}
          </p>
          <a
            href="/ag-admin/hitl"
            className="mt-2 inline-block text-xs text-sky-600 hover:underline"
          >
            Back to queue
          </a>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-xs text-stone-400 w-40 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-xs text-stone-700 flex-1 break-words">{children}</dd>
    </div>
  );
}

function NotFoundState({ interventionId }: { interventionId: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Intervention not found</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
        Intervention <span className="font-mono">{interventionId.slice(0, 12)}…</span> was not
        found. It may not exist or may not be accessible from this deployment.
      </p>
      <a href="/ag-admin/hitl" className="mt-4 inline-block text-xs text-sky-600 hover:underline">
        Back to queue
      </a>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Intervention detail unavailable</p>
      <p className="text-xs text-stone-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
        Could not reach the AG management surface.
      </p>
      <a href="/ag-admin/hitl" className="mt-4 inline-block text-xs text-sky-600 hover:underline">
        Back to queue
      </a>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 19);
  }
}
