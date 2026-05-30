"use client";

/**
 * CreateApplicationForm — operator-facing form for the
 * /org-admin/applications/new page.
 *
 * Wraps the createApplicationAction server action with React's
 * useActionState. The action returns one of three phases:
 *   - "idle":    initial render or after a reset
 *   - "error":   surface a red banner + optional field-level hints
 *   - "success": surface a single-shot panel containing the
 *                generated client_id + client_secret + a copy-once
 *                warning. The secret lives ONLY inside this in-memory
 *                state envelope; it is not persisted, never logged,
 *                never re-fetched, never written to localStorage /
 *                sessionStorage / cookies / URL.
 *
 * SECURITY:
 *   - No useEffect / useState that would mirror the secret into
 *     longer-lived component state. The single useActionState cell
 *     is the only place the value lives, and React unmounts it on
 *     navigation away.
 *   - No console.log of any kind anywhere in this file.
 *   - The success panel includes a prominent "Copy this secret now"
 *     warning so the operator knows the value is single-shot.
 */

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import {
  type CreateApplicationState,
  createApplicationAction,
} from "../actions";

const initialState: CreateApplicationState = { phase: "idle" };

export function CreateApplicationForm() {
  const [state, action, pending] = useActionState(createApplicationAction, initialState);

  return (
    <div className="space-y-6 max-w-2xl">
      {state.phase === "success" ? (
        <SuccessPanel created={state.created} />
      ) : (
        <Form state={state} action={action} pending={pending} />
      )}
    </div>
  );
}

function Form({
  state,
  action,
  pending,
}: {
  state: CreateApplicationState;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
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
        <label htmlFor="app-name" className="block text-sm font-medium text-sky-950">
          Application name <span className="text-red-500">*</span>
        </label>
        <input
          id="app-name"
          name="name"
          type="text"
          required
          maxLength={255}
          autoComplete="off"
          spellCheck={false}
          placeholder="My web app"
          disabled={pending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
        {fieldErrors.name && (
          <p className="text-xs text-red-500">{fieldErrors.name}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="app-redirects" className="block text-sm font-medium text-sky-950">
          Redirect URIs <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-stone-500">
          One URI per line. Each MUST be a valid http(s) URL.
        </p>
        <textarea
          id="app-redirects"
          name="redirect_uris"
          required
          rows={3}
          autoComplete="off"
          spellCheck={false}
          placeholder={"https://app.example.com/callback\nhttps://app.example.com/silent-renew"}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
        {fieldErrors.redirect_uris && (
          <p className="text-xs text-red-500">{fieldErrors.redirect_uris}</p>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor="app-post-logout-redirects"
          className="block text-sm font-medium text-sky-950"
        >
          Post-logout redirect URIs
        </label>
        <p className="text-xs text-stone-500">
          Optional. One URI per line. Validated the same way as redirect URIs.
        </p>
        <textarea
          id="app-post-logout-redirects"
          name="post_logout_redirect_uris"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://app.example.com/post-logout"
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="app-allowed-audiences"
          className="block text-sm font-medium text-sky-950"
        >
          Allowed audiences
        </label>
        <p className="text-xs text-stone-500">
          Optional. One audience identifier per line.
        </p>
        <textarea
          id="app-allowed-audiences"
          name="allowed_audiences"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://api.example.com"
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="app-scope" className="block text-sm font-medium text-sky-950">
          Default scope
        </label>
        <p className="text-xs text-stone-500">
          Optional. Space-separated (e.g. <span className="font-mono">openid profile email</span>).
        </p>
        <input
          id="app-scope"
          name="scope"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="openid profile email"
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id="app-public"
          name="is_public"
          type="checkbox"
          disabled={pending}
          className="mt-0.5 rounded border-stone-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50"
        />
        <label htmlFor="app-public" className="text-sm text-sky-950 leading-tight">
          Public client
          <span className="block text-xs text-stone-500 mt-0.5">
            For single-page or mobile apps that cannot store a secret. Confidential
            (server-side) clients get a one-time client secret on the next screen.
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" loading={pending} size="md">
          {pending ? "Creating…" : "Create application"}
        </Button>
        <a
          href="/org-admin/applications"
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function SuccessPanel({ created }: { created: NonNullable<Extract<CreateApplicationState, { phase: "success" }>>["created"] }) {
  const hasSecret = created.client_secret.length > 0;
  return (
    <div className="space-y-5">
      <div
        role="status"
        className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        <p className="font-semibold">{created.name} has been created.</p>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Application credentials</p>
          {hasSecret && (
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              Copy this secret now. It will not be shown again. If you lose it, create a
              replacement application — secret rotation is not yet available from this
              page.
            </p>
          )}
          {!hasSecret && (
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">
              This is a public client, so no client secret was generated.
            </p>
          )}
        </div>
        <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="font-medium text-stone-500">Client ID</dt>
          <dd className="font-mono text-sky-950 break-all">{created.client_id}</dd>
          {hasSecret && (
            <>
              <dt className="font-medium text-stone-500">Client secret</dt>
              <dd className="font-mono text-sky-950 break-all">{created.client_secret}</dd>
            </>
          )}
          <dt className="font-medium text-stone-500">Type</dt>
          <dd className="text-sky-950">
            {created.is_public ? "Public" : "Confidential"}
            {created.token_endpoint_auth_method && (
              <span className="text-stone-500"> · {created.token_endpoint_auth_method}</span>
            )}
          </dd>
          <dt className="font-medium text-stone-500">Redirect URIs</dt>
          <dd className="font-mono text-sky-950">
            <ul className="space-y-0.5 break-all">
              {created.redirect_uris.map((u, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: URI list has no stable key
                <li key={i}>{u}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="/org-admin/applications"
          className="inline-flex items-center text-sm font-medium text-sky-700 hover:text-sky-900 transition-colors"
        >
          ← Back to Applications
        </a>
      </div>
    </div>
  );
}
