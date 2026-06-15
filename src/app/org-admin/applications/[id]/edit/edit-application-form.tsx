"use client";

/**
 * EditApplicationForm — operator-facing form for the
 * /org-admin/applications/[id]/edit page.
 *
 * Wraps the updateApplicationAction server action with React's
 * useActionState. The action is curried with the client id via
 * `updateApplicationAction.bind(null, clientId)` so the form never
 * carries the id in form data — a tampered POST cannot retarget the
 * action at a different client.
 *
 * Initial values are passed down from the server page (which fetched
 * them via getOrganizationClientById). On a successful update the
 * server action revalidates the list + detail caches; the form
 * surfaces a green status banner with a link back to the detail page.
 *
 * SECURITY:
 *   - The form NEVER renders, requests, or accepts a `client_secret`.
 *     There is no Regenerate / Rotate button. There is no secret
 *     field at all.
 *   - The form NEVER stores any value in localStorage / sessionStorage
 *     / cookies / URL / router history.
 *   - No console.log of any kind anywhere in this file.
 *   - is_public / token_endpoint_auth_method / jwks_uri / jwks /
 *     signing_alg / service_account_id / skip_consent / token_ttl_secs
 *     are intentionally NOT editable — see actions.ts comment.
 */

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import { type UpdateApplicationState, updateApplicationAction } from "../../actions";

const initialState: UpdateApplicationState = { phase: "idle" };

export interface EditApplicationFormProps {
  clientId: string;
  initialName: string;
  initialClientID: string;
  initialIsPublic: boolean;
  initialAuthMethod: string;
  initialRedirectURIs: string[];
  initialPostLogoutRedirectURIs: string[];
  initialAllowedAudiences: string[];
  initialScope: string;
}

export function EditApplicationForm(props: EditApplicationFormProps) {
  const boundAction = updateApplicationAction.bind(null, props.clientId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <div className="space-y-6 max-w-2xl">
      {state.phase === "success" ? (
        <SuccessPanel updated={state.updated} clientId={props.clientId} />
      ) : (
        <Form props={props} state={state} action={action} pending={pending} />
      )}
    </div>
  );
}

function Form({
  props,
  state,
  action,
  pending,
}: {
  props: EditApplicationFormProps;
  state: UpdateApplicationState;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};
  const defaultRedirectURIs = props.initialRedirectURIs.join("\n");
  const defaultPostLogoutRedirectURIs = props.initialPostLogoutRedirectURIs.join("\n");
  const defaultAllowedAudiences = props.initialAllowedAudiences.join("\n");

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

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
        <p>
          <span className="font-semibold text-sky-950">Client ID:</span>{" "}
          <span className="font-mono break-all">{props.initialClientID}</span>
        </p>
        <p className="mt-0.5">
          <span className="font-semibold text-sky-950">Type:</span>{" "}
          {props.initialIsPublic ? "Public" : "Confidential"}
          {props.initialAuthMethod && (
            <span className="text-stone-500"> · {props.initialAuthMethod}</span>
          )}
        </p>
        <p className="mt-1 text-stone-500 leading-relaxed">
          Client ID and Type cannot be changed from this form. To switch between Public and
          Confidential, create a replacement application — secret rotation is not yet available.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="edit-app-name" className="block text-sm font-medium text-sky-950">
          Application name <span className="text-red-500">*</span>
        </label>
        <input
          id="edit-app-name"
          name="name"
          type="text"
          required
          maxLength={255}
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.initialName}
          disabled={pending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
        {fieldErrors.name && <p className="text-xs text-red-500">{fieldErrors.name}</p>}
      </div>

      <div className="space-y-1">
        <label htmlFor="edit-app-redirects" className="block text-sm font-medium text-sky-950">
          Redirect URIs <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-stone-500">
          One URI per line. Each MUST be a valid http(s) URL.
        </p>
        <textarea
          id="edit-app-redirects"
          name="redirect_uris"
          required
          rows={3}
          autoComplete="off"
          spellCheck={false}
          defaultValue={defaultRedirectURIs}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
        {fieldErrors.redirect_uris && (
          <p className="text-xs text-red-500">{fieldErrors.redirect_uris}</p>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor="edit-app-post-logout-redirects"
          className="block text-sm font-medium text-sky-950"
        >
          Post-logout redirect URIs
        </label>
        <p className="text-xs text-stone-500">
          Optional. One URI per line. Validated the same way as redirect URIs. Leave blank to clear.
        </p>
        <textarea
          id="edit-app-post-logout-redirects"
          name="post_logout_redirect_uris"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          defaultValue={defaultPostLogoutRedirectURIs}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="edit-app-allowed-audiences"
          className="block text-sm font-medium text-sky-950"
        >
          Allowed audiences
        </label>
        <p className="text-xs text-stone-500">
          Optional. One audience identifier per line. Leave blank to clear.
        </p>
        <textarea
          id="edit-app-allowed-audiences"
          name="allowed_audiences"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          defaultValue={defaultAllowedAudiences}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="edit-app-scope" className="block text-sm font-medium text-sky-950">
          Default scope
        </label>
        <p className="text-xs text-stone-500">
          Optional. Space-separated (e.g. <span className="font-mono">openid profile email</span>).
          Leave blank to clear.
        </p>
        <input
          id="edit-app-scope"
          name="scope"
          type="text"
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.initialScope}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" loading={pending} size="md">
          {pending ? "Saving…" : "Save application"}
        </Button>
        <a
          href={`/org-admin/applications/${encodeURIComponent(props.clientId)}`}
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function SuccessPanel({
  updated,
  clientId,
}: {
  updated: { id: string; client_id: string; name: string };
  clientId: string;
}) {
  return (
    <div className="space-y-5">
      <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <p className="font-semibold">{updated.name} has been updated.</p>
        <p className="text-xs text-emerald-700 mt-0.5">
          Client ID <span className="font-mono">{updated.client_id}</span> is unchanged.
        </p>
      </output>

      <div className="flex items-center gap-4">
        <a
          href={`/org-admin/applications/${encodeURIComponent(clientId)}`}
          className="inline-flex items-center text-sm font-medium text-sky-700 hover:text-sky-900 transition-colors"
        >
          ← Back to application details
        </a>
        <a
          href="/org-admin/applications"
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          All applications
        </a>
      </div>
    </div>
  );
}
