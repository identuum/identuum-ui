"use client";

/**
 * CreateApiResourceForm — client form bound to createApiResourceAction.
 *
 * After a successful create, the form's useActionState envelope carries
 * back the operator-safe identity (id, name, audience) PLUS the one-time
 * plaintext secret. The secret is rendered in a SetupLinkPanel-style
 * copy-once panel; it lives only in React state for the lifetime of the
 * page. A reload, navigation, or further create resets the panel.
 *
 * SECURITY invariants:
 *   - The secret is NEVER written to localStorage / sessionStorage /
 *     cookies / URL. It is held only in React's useActionState memory.
 *   - The secret is NEVER logged (no console.*).
 *   - The success panel includes an explicit "this won't be shown
 *     again" warning so the operator knows to copy it now.
 *   - The form does not carry organization_id or any field outside the
 *     documented createApiResourceAction input.
 */

import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { useActionState } from "react";
import { type CreateAPIResourceState, createApiResourceAction } from "../actions";

const initialState: CreateAPIResourceState = { phase: "idle" };

const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

const textareaClass = `${inputClass} font-mono`;
const textareaErrorClass = `${inputErrorClass} font-mono`;

export function CreateApiResourceForm() {
  const [state, action, isPending] = useActionState(createApiResourceAction, initialState);

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-700">API resource created</p>
          <p className="text-xs text-stone-600 mt-1">
            <strong className="font-semibold text-sky-950">{state.created.name}</strong> is
            registered with audience{" "}
            <span className="font-mono text-stone-700">{state.created.audience}</span>.
          </p>
        </div>

        {state.created.secret.length > 0 && (
          <div className="space-y-2">
            <SetupLinkPanel
              link={state.created.secret}
              title="One-time resource secret"
              description="This secret is shown only once. Copy it now and store it securely. Subsequent visits to this page will not reveal it. Use the rotate-secret tool (not on this page) if you need a new one."
              compact
            />
            <p className="text-[10px] text-amber-800 italic">
              Treat this string like a password. Anyone with it can authenticate as this resource
              server.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <a
            href={`/org-admin/api-resources/${encodeURIComponent(state.created.id)}`}
            className="inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
          >
            View details
          </a>
          <a
            href="/org-admin/api-resources"
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
        <label htmlFor="ar-name" className="block text-sm font-medium text-sky-950">
          Resource name <span className="text-red-500">*</span>
        </label>
        <input
          id="ar-name"
          name="name"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Billing API"
          className={fieldErrors.name ? inputErrorClass : inputClass}
        />
        {fieldErrors.name && <p className="text-xs text-red-600">{fieldErrors.name}</p>}
        <p className="text-xs text-stone-400">Human-readable label for this resource server.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="ar-audience" className="block text-sm font-medium text-sky-950">
          Audience <span className="text-red-500">*</span>
        </label>
        <input
          id="ar-audience"
          name="audience"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="https://billing.example.com"
          className={fieldErrors.audience ? inputErrorClass : inputClass}
        />
        {fieldErrors.audience && <p className="text-xs text-red-600">{fieldErrors.audience}</p>}
        <p className="text-xs text-stone-400">
          Immutable identifier embedded in issued access tokens (the OAuth{" "}
          <span className="font-mono">aud</span> claim). Cannot be changed later.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="ar-token-ttl" className="block text-sm font-medium text-sky-950">
          Token TTL (seconds) <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          id="ar-token-ttl"
          name="token_ttl_secs"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="3600"
          className={fieldErrors.token_ttl_secs ? inputErrorClass : inputClass}
        />
        {fieldErrors.token_ttl_secs && (
          <p className="text-xs text-red-600">{fieldErrors.token_ttl_secs}</p>
        )}
        <p className="text-xs text-stone-400">
          Lifetime of access tokens minted for this audience. Whole number between 60 and 86400
          seconds. Leave blank to use the IDP default.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="ar-scopes" className="block text-sm font-medium text-sky-950">
          Scopes <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="ar-scopes"
          name="scopes"
          rows={5}
          autoComplete="off"
          spellCheck={false}
          placeholder={"read:billing: Read billing data\nwrite:billing: Modify billing data"}
          className={fieldErrors.scopes ? textareaErrorClass : textareaClass}
        />
        {fieldErrors.scopes && <p className="text-xs text-red-600">{fieldErrors.scopes}</p>}
        <p className="text-xs text-stone-400">
          One scope per line in the format{" "}
          <span className="font-mono">name: human-readable description</span>. The description is
          optional. Add more scopes after create via Edit.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {isPending ? "Creating…" : "Create API resource"}
        </button>
        <a
          href="/org-admin/api-resources"
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
