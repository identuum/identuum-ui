/**
 * Edit agent page — PATCH /admin/agent-registry/:id.
 *
 * Fetches current agent data server-side, then presents a pre-populated form.
 * Submits via Server Action using PATCH semantics (only send changed fields).
 *
 * Immutable: agent ID (UUID).
 * Mutable: display name, agent key/slug, description, allowed tools,
 *   max session duration, enabled flag.
 * Omitted: capability_ceiling (complex JSON — requires dedicated editor),
 *   default_agent_mode (only "readonly" is currently valid — kept as-is).
 *
 * Security:
 *   - agRequest() attaches bearer token server-side; never reaches browser.
 *   - Raw backend errors mapped to safe messages only.
 *   - No token material or credential fields.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { agRequest } from "@/lib/ag-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Agent — Identuum AG" };

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
}

async function fetchAgent(
  id: string
): Promise<AgentDetail | "auth_error" | "not_found" | "unavailable"> {
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

type UpdateError =
  | "slug_collision"
  | "quota_exceeded"
  | "auth_error"
  | "validation"
  | "not_found"
  | "failed";

const UPDATE_ERROR_MESSAGES: Record<UpdateError, string> = {
  slug_collision: "Agent key is already in use. Choose a different agent key.",
  quota_exceeded: "Operation not permitted for this license tier.",
  auth_error: "Your session is invalid. Please re-authenticate.",
  validation: "One or more fields failed validation.",
  not_found: "Agent not found.",
  failed: "Update failed. Please try again.",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EditAgentPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const errorCode = typeof sp.error === "string" ? (sp.error as UpdateError) : null;
  const fieldErrors: Record<string, string> = {};
  if (sp.field && sp.msg) {
    fieldErrors[String(sp.field)] = String(sp.msg);
  }

  const agent = await fetchAgent(id);
  if (agent === "auth_error") redirect("/ag-admin/login");

  async function updateAgent(formData: FormData) {
    "use server";

    const slug = formData.get("slug")?.toString().trim();
    const name = formData.get("name")?.toString().trim();
    const description = formData.get("description")?.toString().trim();
    const toolsRaw = formData.get("allowed_tools")?.toString() ?? "";
    const allowedTools = toolsRaw
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const maxDurationRaw = formData.get("max_session_duration_seconds")?.toString().trim() ?? "";
    const maxDuration = maxDurationRaw ? Number.parseInt(maxDurationRaw, 10) : undefined;
    const enabledRaw = formData.get("enabled")?.toString();
    const enabled = enabledRaw === "on" || enabledRaw === "true";

    if (slug !== undefined && slug !== "" && !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
      redirect(
        `/ag-admin/agents/${id}/edit?error=validation&field=slug&msg=Agent+key+must+be+lowercase+alphanumeric+with+hyphens+(max+64+chars)`
      );
    }
    if (name !== undefined && name.trim() === "") {
      redirect(
        `/ag-admin/agents/${id}/edit?error=validation&field=name&msg=Display+name+must+not+be+empty`
      );
    }

    const body: Record<string, unknown> = { enabled };
    if (slug) body.slug = slug;
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    body.allowed_tools_default = allowedTools;
    if (maxDuration !== undefined && !Number.isNaN(maxDuration) && maxDuration > 0) {
      body.max_session_duration_seconds = maxDuration;
    }

    // Capability ceiling merge strategy.
    // Unknown/future top-level keys (rate limits, schedule windows, etc.) are preserved
    // by starting from the existing ceiling and modifying only the hitl key.
    //
    //   "keep"       — omit capability_ceiling from PATCH body (backend preserves existing)
    //   "set_hitl"   — merge: set/replace hitl key, preserve unknown top-level keys
    //   "clear_hitl" — merge: omit hitl key, preserve unknown top-level keys
    //   "clear_all"  — send {} to clear all capability bounds (explicit destructive action)
    const ceilingAction = formData.get("ceiling_action")?.toString() ?? "keep";

    // Resolve existing ceiling as a plain object for merge operations.
    // Treat null, absent, array, non-object, or non-agent values as empty object.
    const existingCeiling: Record<string, unknown> =
      agent !== "auth_error" &&
      agent !== "not_found" &&
      agent !== "unavailable" &&
      agent.capability_ceiling != null &&
      typeof agent.capability_ceiling === "object" &&
      !Array.isArray(agent.capability_ceiling)
        ? { ...(agent.capability_ceiling as Record<string, unknown>) }
        : {};

    if (ceilingAction === "clear_all") {
      body.capability_ceiling = {};
    } else if (ceilingAction === "set_hitl") {
      const posture = formData.get("hitl_posture")?.toString() ?? "not_required";
      const validPostures = ["required", "optional", "not_required"];
      if (!validPostures.includes(posture)) {
        redirect(
          `/ag-admin/agents/${id}/edit?error=validation&field=hitl_posture&msg=Invalid+HITL+posture`
        );
      }
      const acrFloor = formData.get("hitl_review_acr_floor")?.toString() ?? "";
      const maxAgeRaw = formData.get("hitl_review_auth_max_age_seconds")?.toString().trim() ?? "";
      const maxAge = maxAgeRaw ? Number.parseInt(maxAgeRaw, 10) : 0;
      const hitl: Record<string, unknown> = { posture };
      if (acrFloor) hitl.review_acr_floor = acrFloor;
      if (maxAge > 0) hitl.review_auth_max_age_seconds = maxAge;
      // Merge: replace only the hitl key, preserve all other top-level keys.
      body.capability_ceiling = { ...existingCeiling, hitl };
    } else if (ceilingAction === "clear_hitl") {
      // Remove only the hitl key, preserve other top-level keys.
      const merged = Object.fromEntries(
        Object.entries(existingCeiling).filter(([key]) => key !== "hitl")
      );
      body.capability_ceiling = merged; // may be {} if hitl was the only key
    }
    // ceilingAction === "keep": capability_ceiling absent from body → PATCH leaves unchanged

    const res = await agRequest(`/admin/agent-registry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    if (!res) redirect(`/ag-admin/agents/${id}/edit?error=failed`);
    if (res.status === 401 || res.status === 403) redirect("/ag-admin/login");
    if (res.status === 404) redirect(`/ag-admin/agents/${id}/edit?error=not_found`);

    if (res.status === 400) {
      try {
        const data = (await res.json()) as { details?: Record<string, string> };
        const firstEntry = Object.entries(data.details ?? {})[0];
        if (firstEntry) {
          redirect(
            `/ag-admin/agents/${id}/edit?error=validation&field=${encodeURIComponent(firstEntry[0])}&msg=${encodeURIComponent(firstEntry[1])}`
          );
        }
      } catch {
        /* ignore */
      }
      redirect(`/ag-admin/agents/${id}/edit?error=validation`);
    }

    if (res.status === 409) redirect(`/ag-admin/agents/${id}/edit?error=slug_collision`);
    if (!res.ok) redirect(`/ag-admin/agents/${id}/edit?error=failed`);

    redirect(`/ag-admin/agents/${id}`);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <a
          href={`/ag-admin/agents/${id}`}
          className="text-xs text-stone-400 hover:text-sky-700 transition-colors"
        >
          ← Agent detail
        </a>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Edit agent</h1>
        {agent !== "not_found" && agent !== "unavailable" && (
          <p className="text-sm text-stone-500 mt-0.5 font-mono">{agent.slug}</p>
        )}
      </div>

      {agent === "not_found" && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-semibold text-sky-950">Agent not found</p>
          <a
            href="/ag-admin/agents"
            className="mt-4 inline-block text-xs text-sky-600 hover:underline"
          >
            Back to Registry
          </a>
        </div>
      )}

      {agent === "unavailable" && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-semibold text-sky-950">Agent data unavailable</p>
          <p className="text-xs text-stone-400 mt-1.5">
            Could not reach the AG management surface.
          </p>
        </div>
      )}

      {agent !== "not_found" && agent !== "unavailable" && (
        <>
          {errorCode && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
              <p className="text-xs font-semibold text-amber-800 mb-0.5">Update failed</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                {UPDATE_ERROR_MESSAGES[errorCode] ?? "An unexpected error occurred."}
              </p>
            </div>
          )}

          <form action={updateAgent} className="space-y-5">
            {/* Immutable technical ID */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl px-5 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400 mb-0.5">
                Technical ID (immutable)
              </p>
              <p className="font-mono text-xs text-stone-600 break-all">{agent.id}</p>
            </div>

            <FormCard title="Identity">
              <FormField
                id="name"
                label="Display name"
                required
                hint="Human-readable label, max 256 characters."
                error={fieldErrors.name}
              >
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  maxLength={256}
                  defaultValue={agent.name}
                  className={inputCls(!!fieldErrors.name)}
                />
              </FormField>

              <FormField
                id="slug"
                label="Agent key"
                hint="Lowercase alphanumeric with hyphens, max 64 chars. Changing the agent key affects active integrations."
                error={fieldErrors.slug}
              >
                <input
                  id="slug"
                  name="slug"
                  type="text"
                  maxLength={64}
                  pattern="^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"
                  defaultValue={agent.slug}
                  className={inputCls(!!fieldErrors.slug)}
                />
              </FormField>

              <FormField
                id="description"
                label="Description"
                hint="Optional. Max 1024 characters."
                error={fieldErrors.description}
              >
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  maxLength={1024}
                  defaultValue={agent.description ?? ""}
                  className={textareaCls(!!fieldErrors.description)}
                />
              </FormField>
            </FormCard>

            <FormCard title="Capabilities">
              <FormField
                id="allowed_tools"
                label="Allowed tools"
                hint="One tool name per line. Leave empty for no restriction."
                error={fieldErrors.allowed_tools_default}
              >
                <textarea
                  id="allowed_tools"
                  name="allowed_tools"
                  rows={4}
                  defaultValue={(agent.allowed_tools_default ?? []).join("\n")}
                  className={textareaCls(false)}
                />
              </FormField>

              <FormField
                id="max_session_duration_seconds"
                label="Max session duration (seconds)"
                hint="Positive integer. Current value shown as default."
                error={fieldErrors.max_session_duration_seconds}
              >
                <input
                  id="max_session_duration_seconds"
                  name="max_session_duration_seconds"
                  type="number"
                  min={1}
                  defaultValue={agent.max_session_duration_seconds || ""}
                  className={inputCls(!!fieldErrors.max_session_duration_seconds)}
                />
              </FormField>

              <div className="text-xs text-stone-400 bg-stone-50 rounded-xl px-4 py-2.5 leading-relaxed">
                <strong>Current mode:</strong> {agent.default_agent_mode} (read-only — only
                "readonly" is supported in the current release).
              </div>
            </FormCard>

            <GovernanceFormCard agent={agent} fieldError={fieldErrors.hitl_posture} />

            <FormCard title="Status">
              <div className="flex items-center gap-3">
                <input
                  id="enabled"
                  name="enabled"
                  type="checkbox"
                  defaultChecked={agent.enabled}
                  className="h-4 w-4 rounded border-stone-300 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="enabled" className="text-sm text-stone-700 font-medium">
                  Enabled
                </label>
                <span className="text-xs text-stone-400">
                  Disabled agents cannot issue new sessions.
                </span>
              </div>
            </FormCard>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="px-5 py-2 bg-sky-700 text-white text-sm font-semibold rounded-xl hover:bg-sky-800 transition-colors"
              >
                Save changes
              </button>
              <a
                href={`/ag-admin/agents/${id}`}
                className="px-5 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </a>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ── Governance form card ──────────────────────────────────────────────────────

function GovernanceFormCard({ agent, fieldError }: { agent: AgentDetail; fieldError?: string }) {
  const existingHITL = agent.capability_ceiling?.hitl;
  // Default ceiling_action based on current state.
  const defaultAction = existingHITL ? "set_hitl" : "keep";

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Governance / Capability ceiling</p>
        <p className="text-xs text-stone-400 mt-0.5">
          Controls HITL gate posture at IBT issuance time. Absent = bearer-only (no HITL).
        </p>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="ceiling_action" className="block text-xs font-medium text-stone-700">
            Capability ceiling action
          </label>
          <select
            id="ceiling_action"
            name="ceiling_action"
            defaultValue={defaultAction}
            className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="keep">Keep existing capability ceiling</option>
            <option value="set_hitl">Set or update HITL gate</option>
            <option value="clear_hitl">Clear HITL gate only</option>
            <option value="clear_all">Clear all capability bounds</option>
          </select>
          <p className="text-xs text-stone-400 leading-relaxed">
            "Keep existing" omits capability_ceiling from the PATCH body — backend leaves it
            unchanged. "Set or update HITL gate" and "Clear HITL gate only" preserve other top-level
            capability keys.
          </p>
          <p className="text-xs text-amber-600 leading-relaxed">
            "Clear all capability bounds" removes all governance configuration including future
            capability keys. Use only if you intend to fully reset the agent's capability ceiling.
          </p>
        </div>

        <div className="space-y-4 border-t border-stone-100 pt-4">
          <p className="text-xs font-medium text-stone-600">
            HITL gate configuration (applies when action = "Set or update HITL gate")
          </p>

          <div className="space-y-1.5">
            <label htmlFor="hitl_posture" className="block text-xs font-medium text-stone-700">
              HITL posture <span className="text-red-500">*</span>
            </label>
            <select
              id="hitl_posture"
              name="hitl_posture"
              defaultValue={existingHITL?.posture ?? "not_required"}
              className={`w-full text-sm rounded-xl border ${
                fieldError
                  ? "border-red-400 focus:ring-red-400"
                  : "border-stone-200 focus:ring-sky-500"
              } bg-white px-3 py-2 text-stone-700 focus:outline-none focus:ring-1`}
            >
              <option value="required">required — all sessions pause for review</option>
              <option value="optional">optional — agent may request review</option>
              <option value="not_required">not_required — no HITL gate</option>
            </select>
            {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="hitl_review_acr_floor"
              className="block text-xs font-medium text-stone-700"
            >
              Reviewer ACR floor
            </label>
            <select
              id="hitl_review_acr_floor"
              name="hitl_review_acr_floor"
              defaultValue={existingHITL?.review_acr_floor ?? ""}
              className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">None (any ACR)</option>
              <option value="urn:identuum:loa:password">Password</option>
              <option value="urn:identuum:loa:mfa">Multi-factor (MFA)</option>
              <option value="urn:identuum:loa:phishing-resistant">Phishing-resistant</option>
            </select>
            <p className="text-xs text-stone-400">
              Minimum authentication level required of the human reviewer.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="hitl_review_auth_max_age_seconds"
              className="block text-xs font-medium text-stone-700"
            >
              Reviewer session freshness (seconds)
            </label>
            <input
              id="hitl_review_auth_max_age_seconds"
              name="hitl_review_auth_max_age_seconds"
              type="number"
              min={0}
              defaultValue={existingHITL?.review_auth_max_age_seconds || ""}
              placeholder="0 (no freshness requirement)"
              className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <p className="text-xs text-stone-400">0 or blank = no freshness requirement.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared form sub-components ────────────────────────────────────────────────

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  );
}

function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-stone-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-stone-400 leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return `w-full text-sm rounded-xl border ${
    hasError ? "border-red-400 focus:ring-red-400" : "border-stone-200 focus:ring-sky-500"
  } bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1`;
}

function textareaCls(hasError: boolean) {
  return `w-full text-sm rounded-xl border ${
    hasError ? "border-red-400 focus:ring-red-400" : "border-stone-200 focus:ring-sky-500"
  } bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 resize-none`;
}
