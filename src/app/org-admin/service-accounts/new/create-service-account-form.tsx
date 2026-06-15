"use client";

/**
 * CreateServiceAccountForm — client form bound to createServiceAccountAction.
 *
 * IMPORTANT: the IDP's POST /api/v1/organizations/:id/service-accounts
 * endpoint does NOT return a credential. There is therefore no
 * copy-once panel in the success state — only a confirmation banner
 * and a "View details" link. A future slice that wires the IDP's
 * currently-unrouted service_account_credentials lifecycle would add
 * credential-issuance UX here.
 *
 * SECURITY invariants:
 *   - The form has NO credential / secret / hash / private-key /
 *     token field. The only inputs are name, description, role, and
 *     expires_at.
 *   - No console.* call.
 *   - No localStorage / sessionStorage / cookie / URL write.
 */

import { useActionState } from "react";
import { type CreateServiceAccountState, createServiceAccountAction } from "../actions";

const initialState: CreateServiceAccountState = { phase: "idle" };

const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function CreateServiceAccountForm() {
  const [state, action, isPending] = useActionState(createServiceAccountAction, initialState);

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-700">Service account created</p>
          <p className="text-xs text-stone-600 mt-1">
            <strong className="font-semibold text-sky-950">{state.created.name}</strong> is
            registered with role{" "}
            <span className="font-mono text-stone-700">{state.created.role || "org_admin"}</span>.
          </p>
          <p className="text-xs text-stone-500 mt-2 leading-relaxed">
            No credential was issued. Link this service account to an OAuth client (a future
            feature) to obtain a usable client_credentials grant.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <a
            href={`/org-admin/service-accounts/${encodeURIComponent(state.created.id)}`}
            className="inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
          >
            View details
          </a>
          <a
            href="/org-admin/service-accounts"
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Back to list
          </a>
        </div>
      </div>
    );
  }

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="space-y-5">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {errorMessage}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="sa-name" className="block text-sm font-medium text-sky-950">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="sa-name"
          name="name"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="billing-pipeline"
          className={fieldErrors.name ? inputErrorClass : inputClass}
        />
        {fieldErrors.name && <p className="text-xs text-red-600">{fieldErrors.name}</p>}
      </div>

      <div className="space-y-1">
        <label htmlFor="sa-description" className="block text-sm font-medium text-sky-950">
          Description <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          id="sa-description"
          name="description"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Nightly batch job that reconciles invoices."
          className={fieldErrors.description ? inputErrorClass : inputClass}
        />
        {fieldErrors.description && (
          <p className="text-xs text-red-600">{fieldErrors.description}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="sa-role" className="block text-sm font-medium text-sky-950">
          Role{" "}
          <span className="text-stone-400 font-normal">(optional — defaults to org_admin)</span>
        </label>
        <select
          id="sa-role"
          name="role"
          defaultValue=""
          className={fieldErrors.role ? inputErrorClass : inputClass}
        >
          <option value="">org_admin (default)</option>
          <option value="org_admin">org_admin</option>
          <option value="org_user">org_user</option>
        </select>
        {fieldErrors.role && <p className="text-xs text-red-600">{fieldErrors.role}</p>}
        <p className="text-xs text-stone-400">
          The role this identity will have inside your organization once it can authenticate. The
          IDP rejects roles outside this allowlist.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="sa-expires-at" className="block text-sm font-medium text-sky-950">
          Expires at <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          id="sa-expires-at"
          name="expires_at"
          type="date"
          autoComplete="off"
          className={fieldErrors.expires_at ? inputErrorClass : inputClass}
        />
        {fieldErrors.expires_at && <p className="text-xs text-red-600">{fieldErrors.expires_at}</p>}
        <p className="text-xs text-stone-400">
          Leave blank for the organization-default expiry. The backend caps expiry per the org{"'"}s
          ServiceAccountExpiryDays policy.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {isPending ? "Creating…" : "Create service account"}
        </button>
        <a
          href="/org-admin/service-accounts"
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
