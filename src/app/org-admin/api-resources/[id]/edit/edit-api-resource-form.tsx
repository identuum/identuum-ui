"use client";

/**
 * EditApiResourceForm — client form bound to updateApiResourceAction.
 *
 * The action is curried with the route's resourceId via
 * `updateApiResourceAction.bind(null, resourceId)` so the form never
 * carries the id from form data.
 *
 * SECURITY:
 *   - Audience is displayed read-only; the form does not POST it. The
 *     IDP rejects audience changes by design (the field is absent from
 *     UpdateAPIResourceRequest). Sending it would be a no-op anyway.
 *   - No secret/hash/JWKS/private-key field is rendered, accepted, or
 *     persisted.
 *   - The success branch shows the updated resource name and links
 *     back to the detail page; nothing about the response is held in
 *     the URL, storage, or cookies.
 */

import type { OrgAPIResourceScope } from "@/lib/types";
import { useActionState } from "react";
import { type UpdateAPIResourceState, updateApiResourceAction } from "../../actions";

const initialState: UpdateAPIResourceState = { phase: "idle" };

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

interface EditApiResourceFormProps {
  resourceId: string;
  initialName: string;
  initialAudience: string;
  initialActive: boolean;
  initialTokenTTLSecs: number;
  initialScopes: OrgAPIResourceScope[];
}

function scopesToTextarea(scopes: OrgAPIResourceScope[]): string {
  return scopes.map((s) => (s.description ? `${s.name}: ${s.description}` : s.name)).join("\n");
}

export function EditApiResourceForm({
  resourceId,
  initialName,
  initialAudience,
  initialActive,
  initialTokenTTLSecs,
  initialScopes,
}: EditApiResourceFormProps) {
  const boundAction = updateApiResourceAction.bind(null, resourceId);
  const [state, action, isPending] = useActionState(boundAction, initialState);

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="space-y-5">
      {state.phase === "success" && (
        <output
          aria-live="polite"
          className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Saved changes to <strong className="font-semibold">{state.updated.name}</strong>.
        </output>
      )}

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
          defaultValue={initialName}
          className={fieldErrors.name ? inputErrorClass : inputClass}
        />
        {fieldErrors.name && <p className="text-xs text-red-600">{fieldErrors.name}</p>}
      </div>

      <div className="space-y-1">
        <p className="block text-sm font-medium text-sky-950">Audience</p>
        <p className="font-mono text-xs text-stone-600 bg-stone-100 rounded-lg px-3 py-2 break-all">
          {initialAudience}
        </p>
        <p className="text-xs text-stone-400">Audience is immutable after create.</p>
      </div>

      <div className="space-y-1">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-sky-950">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initialActive}
            className="h-4 w-4 rounded border-stone-300 text-sky-600 focus:ring-sky-500/40"
          />
          Active
        </label>
        <p className="text-xs text-stone-400">
          When inactive, new access tokens for this audience are rejected.
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
          defaultValue={initialTokenTTLSecs > 0 ? String(initialTokenTTLSecs) : ""}
          className={fieldErrors.token_ttl_secs ? inputErrorClass : inputClass}
        />
        {fieldErrors.token_ttl_secs && (
          <p className="text-xs text-red-600">{fieldErrors.token_ttl_secs}</p>
        )}
        <p className="text-xs text-stone-400">
          Whole number between 60 and 86400. Leave blank to clear and use the IDP default.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="ar-scopes" className="block text-sm font-medium text-sky-950">
          Scopes
        </label>
        <textarea
          id="ar-scopes"
          name="scopes"
          rows={6}
          autoComplete="off"
          spellCheck={false}
          defaultValue={scopesToTextarea(initialScopes)}
          className={fieldErrors.scopes ? textareaErrorClass : textareaClass}
        />
        {fieldErrors.scopes && <p className="text-xs text-red-600">{fieldErrors.scopes}</p>}
        <p className="text-xs text-stone-400">
          One scope per line in the format <span className="font-mono">name: description</span>. The
          submitted list REPLACES the current catalog. Leave blank to clear all scopes.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <a
          href={`/org-admin/api-resources/${encodeURIComponent(resourceId)}`}
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
