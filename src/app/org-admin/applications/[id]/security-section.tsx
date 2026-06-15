"use client";

/**
 * SecuritySection — the org-admin Application detail page's
 * sensitive-but-non-destructive surface for rotating an OAuth client
 * secret. Renders ABOVE the Danger zone.
 *
 * Branching:
 *   - When `isPublic === true` the component renders a read-only
 *     informational panel ("Public clients do not have a client
 *     secret to rotate.") and NEVER renders the rotation form or
 *     button. The backend would also reject the call with 400, but
 *     the affordance should not even appear.
 *   - When `isPublic === false` the component renders a two-step
 *     expand pattern (mirroring the Danger zone): an ExpandPanel
 *     with a "Rotate client secret" type=button that ONLY flips a
 *     local React `expanded` flag (no POST on first click), followed
 *     by a RotateConfirmForm that requires typing the application
 *     name OR the OAuth client_id before the destructive submit is
 *     enabled.
 *
 * Success-state contract (copy-once):
 *   - After a successful rotation the SuccessPanel surfaces the
 *     newly-minted `client_secret` ONCE inside a prominent banner
 *     with "Copy this secret now. It will not be shown again." copy
 *     plus the token-expiry caveat explaining that existing access
 *     tokens issued before rotation continue to validate until they
 *     expire.
 *   - The secret value lives ONLY inside React's `useActionState`
 *     in-memory state envelope. The component NEVER writes it to
 *     `localStorage`, `sessionStorage`, `document.cookie`, the URL,
 *     or `router.push`/`window.history`. Navigation away from the
 *     detail page unmounts the React state and the value is gone.
 *   - No `useEffect`/`useState` mirrors the secret into longer-lived
 *     component state; only the single `useActionState` cell holds
 *     it. The expand/confirm UX uses its own short-lived `useState`
 *     flags (`expanded`, `confirm`) but never reads from or copies
 *     the secret into those.
 *
 * SECURITY:
 *   - NO console.* call anywhere in this file.
 *   - NO storage primitive write anywhere in this file.
 *   - The `confirm` input is treated as opaque (operators may type
 *     credential material by accident).
 *   - The rotate form has ONE input (`name="confirm"`). It has NO
 *     `client_secret`, `old_secret`, `new_secret`, `organization_id`,
 *     or any other secret-shaped form field.
 */

import { Button } from "@/components/ui/button";
import { useActionState, useState } from "react";
import { type RotateApplicationSecretState, rotateApplicationSecretAction } from "../actions";

const initialState: RotateApplicationSecretState = { phase: "idle" };

export interface SecuritySectionProps {
  clientId: string;
  clientName: string;
  clientID: string;
  isPublic: boolean;
}

export function SecuritySection({
  clientId,
  clientName,
  clientID,
  isPublic,
}: SecuritySectionProps) {
  return (
    <section
      aria-labelledby="security-section-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id="security-section-heading" className="text-sm font-semibold text-sky-950">
          Security
        </h2>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
          Sensitive credential operations for this OAuth client. Secret rotation is available for
          confidential clients only.
        </p>
      </div>
      {isPublic ? (
        <PublicClientNotice />
      ) : (
        <ConfidentialRotateSurface
          clientId={clientId}
          clientName={clientName}
          clientID={clientID}
        />
      )}
    </section>
  );
}

function PublicClientNotice() {
  return (
    <div className="px-6 py-5">
      <p className="text-xs text-stone-600 leading-relaxed">
        Public clients do not have a client secret to rotate. Public-client flows (PKCE, mobile,
        single-page apps) authenticate to the token endpoint without a static secret.
      </p>
    </div>
  );
}

function ConfidentialRotateSurface({
  clientId,
  clientName,
  clientID,
}: {
  clientId: string;
  clientName: string;
  clientID: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const boundAction = rotateApplicationSecretAction.bind(null, clientId, clientName, clientID);
  const [state, action, pending] = useActionState(boundAction, initialState);

  if (state.phase === "success") {
    return <SuccessPanel rotated={state.rotated} />;
  }

  return !expanded ? (
    <ExpandPanel onExpand={() => setExpanded(true)} />
  ) : (
    <RotateConfirmForm
      clientName={clientName}
      clientID={clientID}
      state={state}
      action={action}
      pending={pending}
      onCancel={() => setExpanded(false)}
    />
  );
}

function ExpandPanel({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="px-6 py-5 flex flex-col gap-3">
      <p className="text-xs text-stone-600 leading-relaxed">
        Rotating the client secret invalidates the existing credential for future token requests. To
        proceed you will be asked to type the application name or client ID exactly.
      </p>
      <div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-colors"
        >
          Rotate client secret
        </button>
      </div>
    </div>
  );
}

function RotateConfirmForm({
  clientName,
  clientID,
  state,
  action,
  pending,
  onCancel,
}: {
  clientName: string;
  clientID: string;
  state: RotateApplicationSecretState;
  action: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const trimmed = confirm.trim();
  const matches = trimmed === clientName || trimmed === clientID;
  const submitDisabled = !matches || pending;

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
        <p>
          To confirm, type the application name{" "}
          <span className="font-mono font-semibold">{clientName}</span> or its client ID{" "}
          <span className="font-mono font-semibold">{clientID}</span>.
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {errorMessage}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="rotate-app-confirm" className="block text-sm font-medium text-sky-950">
          Type to confirm <span className="text-red-500">*</span>
        </label>
        <input
          id="rotate-app-confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={clientName}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-50"
        />
        {fieldErrors.confirm && <p className="text-xs text-red-500">{fieldErrors.confirm}</p>}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={pending} size="md" disabled={submitDisabled}>
          {pending ? "Rotating…" : "Rotate client secret"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-sm text-stone-500 hover:text-stone-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SuccessPanel({
  rotated,
}: {
  rotated: { id: string; client_id: string; name: string; client_secret: string };
}) {
  return (
    <div className="px-6 py-5 space-y-5">
      <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <p className="font-semibold">{rotated.name} client secret has been rotated.</p>
        <p className="text-xs text-amber-700 mt-2 leading-relaxed">
          Copy this secret now. It will not be shown again. If you lose it you can rotate the secret
          again — there is no way to retrieve the value later.
        </p>
      </output>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">New client credentials</p>
        </div>
        <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="font-medium text-stone-500">Client ID</dt>
          <dd className="font-mono text-sky-950 break-all">{rotated.client_id}</dd>
          <dt className="font-medium text-stone-500">Client secret</dt>
          <dd className="font-mono text-sky-950 break-all">{rotated.client_secret}</dd>
        </dl>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 leading-relaxed">
        <p>
          Existing access tokens issued before rotation continue to validate until they expire.
          Future token requests using the old secret will fail.
        </p>
      </div>
    </div>
  );
}
