/**
 * Register agent page — POST /admin/agent-registry.
 *
 * Submits via Server Action. On success redirects to the new agent detail
 * page. On failure redirects back with a structured error code so the page
 * can show a safe operator-friendly message without exposing raw backend errors.
 *
 * Security:
 *   - agRequest() attaches bearer token server-side; never reaches browser.
 *   - No credentials, token material, or secrets are collected or rendered.
 *   - Raw backend error messages are mapped to safe operator messages.
 *   - CapabilityCeiling (HITL posture JSON) is not exposed in this form
 *     because it requires structured JSON input; a dedicated editor can be
 *     added in a future task.
 */
import { agRequest } from "@/lib/ag-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Register Agent — Identuum AG" };

// Error codes carried in ?error= searchParam.
type CreateError =
  | "slug_collision" // 409 slug already in use
  | "quota_exceeded" // 403 tier quota exceeded
  | "auth_error" // 401/403 session invalid
  | "validation" // 400 field validation failed
  | "failed"; // other backend failure

const CREATE_ERROR_MESSAGES: Record<CreateError, string> = {
  slug_collision: "Agent key is already in use. Choose a different agent key.",
  quota_exceeded:
    "Agent registry quota exceeded for this license tier. Contact your account team to upgrade.",
  auth_error: "Your session is invalid. Please re-authenticate.",
  validation: "One or more fields failed validation. Correct the highlighted fields and try again.",
  failed: "Registration failed. Please try again.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewAgentPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const errorCode = typeof sp.error === "string" ? (sp.error as CreateError) : null;
  const fieldErrors: Record<string, string> = {};
  if (sp.field && sp.msg) {
    fieldErrors[String(sp.field)] = String(sp.msg);
  }

  async function createAgent(formData: FormData) {
    "use server";

    const slug = formData.get("slug")?.toString().trim() ?? "";
    const name = formData.get("name")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() ?? "";
    const toolsRaw = formData.get("allowed_tools")?.toString() ?? "";
    const allowedTools = toolsRaw
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const maxDurationRaw = formData.get("max_session_duration_seconds")?.toString().trim() ?? "";
    const maxDuration = maxDurationRaw ? Number.parseInt(maxDurationRaw, 10) : undefined;
    const enabledRaw = formData.get("enabled")?.toString();
    const enabled = enabledRaw !== "false";

    // Client-side pattern is already enforced; do a quick pre-check to give
    // a better error than a raw 400 from AG.
    if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
      redirect(
        "/ag-admin/agents/new?error=validation&field=slug&msg=Agent+key+must+be+lowercase+alphanumeric+with+hyphens+(max+64+chars)"
      );
    }
    if (!name) {
      redirect("/ag-admin/agents/new?error=validation&field=name&msg=Display+name+is+required");
    }

    const body: Record<string, unknown> = { slug, name, enabled };
    if (description) body.description = description;
    if (allowedTools.length > 0) body.allowed_tools_default = allowedTools;
    if (maxDuration !== undefined && !Number.isNaN(maxDuration) && maxDuration > 0) {
      body.max_session_duration_seconds = maxDuration;
    }

    // Optional capability ceiling (HITL gate) on create.
    const hitlEnabled = formData.get("hitl_enabled") === "on";
    if (hitlEnabled) {
      const posture = formData.get("hitl_posture")?.toString() ?? "not_required";
      const acrFloor = formData.get("hitl_review_acr_floor")?.toString() ?? "";
      const maxAgeRaw = formData.get("hitl_review_auth_max_age_seconds")?.toString().trim() ?? "";
      const maxAge = maxAgeRaw ? Number.parseInt(maxAgeRaw, 10) : 0;
      const hitl: Record<string, unknown> = { posture };
      if (acrFloor) hitl.review_acr_floor = acrFloor;
      if (maxAge > 0) hitl.review_auth_max_age_seconds = maxAge;
      body.capability_ceiling = { hitl };
    }

    const res = await agRequest("/admin/agent-registry", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res) redirect("/ag-admin/agents/new?error=failed");
    if (res.status === 401 || res.status === 403) redirect("/ag-admin/login");

    if (res.status === 400) {
      // Try to extract the first field error from the validation envelope.
      try {
        const data = (await res.json()) as { details?: Record<string, string> };
        const firstEntry = Object.entries(data.details ?? {})[0];
        if (firstEntry) {
          redirect(
            `/ag-admin/agents/new?error=validation&field=${encodeURIComponent(firstEntry[0])}&msg=${encodeURIComponent(firstEntry[1])}`
          );
        }
      } catch {
        /* ignore */
      }
      redirect("/ag-admin/agents/new?error=validation");
    }

    if (res.status === 409) redirect("/ag-admin/agents/new?error=slug_collision");
    if (res.status === 403) redirect("/ag-admin/agents/new?error=quota_exceeded");
    if (!res.ok) redirect("/ag-admin/agents/new?error=failed");

    try {
      const created = (await res.json()) as { id?: string };
      if (created.id) {
        redirect(`/ag-admin/agents/${created.id}`);
      }
    } catch {
      /* ignore */
    }
    redirect("/ag-admin/agents");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <a
          href="/ag-admin/agents"
          className="text-xs text-stone-400 hover:text-sky-700 transition-colors"
        >
          ← Agent Registry
        </a>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Register agent</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Create a new agent registration with a stable agent key and capability policy.
        </p>
      </div>

      {errorCode && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <p className="text-xs font-semibold text-amber-800 mb-0.5">Registration failed</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {CREATE_ERROR_MESSAGES[errorCode] ?? "An unexpected error occurred."}
          </p>
        </div>
      )}

      <form action={createAgent} className="space-y-5">
        <FormCard title="Identity">
          <FormField
            id="slug"
            label="Agent key"
            required
            hint="Lowercase alphanumeric with hyphens, max 64 characters. Stable machine-friendly identifier — choose carefully."
            error={fieldErrors.slug}
          >
            <input
              id="slug"
              name="slug"
              type="text"
              required
              maxLength={64}
              pattern="^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"
              placeholder="my-agent"
              className={inputCls(!!fieldErrors.slug)}
            />
          </FormField>

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
              placeholder="My Agent"
              className={inputCls(!!fieldErrors.name)}
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
              placeholder="What this agent does…"
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
              placeholder={"read_file\nlist_directory"}
              className={textareaCls(false)}
            />
          </FormField>

          <FormField
            id="max_session_duration_seconds"
            label="Max session duration (seconds)"
            hint="Leave blank to use the system default (14400 = 4 hours)."
            error={fieldErrors.max_session_duration_seconds}
          >
            <input
              id="max_session_duration_seconds"
              name="max_session_duration_seconds"
              type="number"
              min={1}
              placeholder="14400"
              className={inputCls(!!fieldErrors.max_session_duration_seconds)}
            />
          </FormField>
        </FormCard>

        <FormCard title="Status">
          <div className="flex items-center gap-3">
            <input
              id="enabled"
              name="enabled"
              type="checkbox"
              value="true"
              defaultChecked
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

        <FormCard title="Governance / HITL Gate (optional)">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                id="hitl_enabled"
                name="hitl_enabled"
                type="checkbox"
                className="h-4 w-4 rounded border-stone-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor="hitl_enabled" className="text-sm text-stone-700 font-medium">
                Configure HITL gate at registration
              </label>
            </div>
            <p className="text-xs text-stone-400 leading-relaxed">
              When checked, sets the capability ceiling HITL posture at creation time. Leave
              unchecked to configure later via Edit. Absent = bearer-only issuance (no HITL gate).
            </p>

            <div className="space-y-3 border-t border-stone-100 pt-3">
              <div className="space-y-1.5">
                <label htmlFor="hitl_posture" className="block text-xs font-medium text-stone-700">
                  HITL posture
                </label>
                <select
                  id="hitl_posture"
                  name="hitl_posture"
                  defaultValue="not_required"
                  className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="required">required — all sessions pause for review</option>
                  <option value="optional">optional — agent may request review</option>
                  <option value="not_required">not_required — no HITL gate</option>
                </select>
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
                  defaultValue=""
                  className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">None (any ACR)</option>
                  <option value="urn:identuum:loa:password">Password</option>
                  <option value="urn:identuum:loa:mfa">Multi-factor (MFA)</option>
                  <option value="urn:identuum:loa:phishing-resistant">Phishing-resistant</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="hitl_review_auth_max_age_seconds"
                  className="block text-xs font-medium text-stone-700"
                >
                  Reviewer freshness (seconds)
                </label>
                <input
                  id="hitl_review_auth_max_age_seconds"
                  name="hitl_review_auth_max_age_seconds"
                  type="number"
                  min={0}
                  placeholder="0 (no freshness requirement)"
                  className="w-full text-sm rounded-xl border border-stone-200 bg-white px-3 py-2 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>
        </FormCard>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-5 py-2 bg-sky-700 text-white text-sm font-semibold rounded-xl hover:bg-sky-800 transition-colors"
          >
            Register agent
          </button>
          <a
            href="/ag-admin/agents"
            className="px-5 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors"
          >
            Cancel
          </a>
        </div>
      </form>
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
