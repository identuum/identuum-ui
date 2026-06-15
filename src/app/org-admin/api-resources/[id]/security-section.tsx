"use client";

/**
 * SecuritySection — the org-admin API Resource detail page's
 * sensitive-but-non-destructive surface for rotating the resource
 * secret. Renders BETWEEN the Scopes card and the Danger zone.
 *
 * UX:
 *   - Two-step expand pattern (mirroring the DangerZone): an
 *     `ExpandPanel` with a "Rotate API resource secret" type=button
 *     that ONLY flips a local React `expanded` flag (no POST on first
 *     click), followed by a `RotateConfirmForm` that requires typing
 *     the resource name OR the audience before the destructive submit
 *     is enabled.
 *   - Re-blanking the confirm input re-disables the submit so a stray
 *     Enter / paste cannot complete the rotation.
 *
 * Success-state contract (copy-once):
 *   - After a successful rotation the `SuccessPanel` surfaces the
 *     newly-minted plaintext secret ONCE inside a prominent banner
 *     with "Copy this secret now. It will not be shown again." copy
 *     plus a token-expiry caveat explaining that existing access
 *     tokens issued before rotation continue to validate at the
 *     resource server until they expire (only the resource-server
 *     authentication path stops accepting the old secret).
 *   - The secret value lives ONLY inside React's `useActionState`
 *     in-memory state envelope. The component NEVER writes it to
 *     `localStorage`, `sessionStorage`, `document.cookie`, the URL,
 *     or `router.push` / `window.history`. Navigation away from the
 *     detail page unmounts the React state and the value is gone.
 *   - No `useEffect`/`useState` mirrors the secret into longer-lived
 *     component state; only the single `useActionState` cell holds it.
 *
 * SECURITY:
 *   - NO console.* call anywhere in this file.
 *   - NO storage primitive write anywhere in this file.
 *   - The `confirm` input is treated as opaque.
 *   - The rotate form has ONE input (name="confirm"). It has NO
 *     resource_secret, old_secret, new_secret, organization_id, or
 *     any other secret-shaped form field.
 *   - The old secret is NEVER rendered — neither before, during, nor
 *     after rotation. The wire helper does not return it.
 */

import { Button } from "@/components/ui/button";
import { useActionState, useState } from "react";
import { type RotateAPIResourceSecretState, rotateApiResourceSecretAction } from "../actions";

const initialState: RotateAPIResourceSecretState = { phase: "idle" };

export interface SecuritySectionProps {
  resourceId: string;
  resourceName: string;
  resourceAudience: string;
}

export function SecuritySection({
  resourceId,
  resourceName,
  resourceAudience,
}: SecuritySectionProps) {
  return (
    <section
      aria-labelledby="api-resource-security-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id="api-resource-security-heading" className="text-sm font-semibold text-sky-950">
          Security
        </h2>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
          Sensitive credential operations for this API resource. Rotation invalidates future
          authentication attempts that use the old secret.
        </p>
      </div>
      <RotateSurface
        resourceId={resourceId}
        resourceName={resourceName}
        resourceAudience={resourceAudience}
      />
    </section>
  );
}

function RotateSurface({
  resourceId,
  resourceName,
  resourceAudience,
}: {
  resourceId: string;
  resourceName: string;
  resourceAudience: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const boundAction = rotateApiResourceSecretAction.bind(
    null,
    resourceId,
    resourceName,
    resourceAudience
  );
  const [state, action, pending] = useActionState(boundAction, initialState);

  if (state.phase === "success") {
    return <SuccessPanel rotated={state.rotated} />;
  }

  return !expanded ? (
    <ExpandPanel onExpand={() => setExpanded(true)} />
  ) : (
    <RotateConfirmForm
      resourceName={resourceName}
      resourceAudience={resourceAudience}
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
        Rotating the API resource secret invalidates the existing credential for future
        authentication. To proceed you will be asked to type the resource name or audience exactly.
      </p>
      <div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-colors"
        >
          Rotate API resource secret
        </button>
      </div>
    </div>
  );
}

function RotateConfirmForm({
  resourceName,
  resourceAudience,
  state,
  action,
  pending,
  onCancel,
}: {
  resourceName: string;
  resourceAudience: string;
  state: RotateAPIResourceSecretState;
  action: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const trimmed = confirm.trim();
  const matches = trimmed === resourceName || trimmed === resourceAudience;
  const submitDisabled = !matches || pending;

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
        <p>
          To confirm, type the resource name{" "}
          <span className="font-mono font-semibold">{resourceName}</span> or its audience{" "}
          <span className="font-mono font-semibold">{resourceAudience}</span>.
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
        <label
          htmlFor="rotate-api-resource-confirm"
          className="block text-sm font-medium text-sky-950"
        >
          Type to confirm <span className="text-red-500">*</span>
        </label>
        <input
          id="rotate-api-resource-confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={resourceName}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-50"
        />
        {fieldErrors.confirm && <p className="text-xs text-red-500">{fieldErrors.confirm}</p>}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={pending} size="md" disabled={submitDisabled}>
          {pending ? "Rotating…" : "Rotate API resource secret"}
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
  rotated: { id: string; name: string; audience: string; secret: string };
}) {
  return (
    <div className="px-6 py-5 space-y-5">
      <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <p className="font-semibold">{rotated.name} resource secret has been rotated.</p>
        <p className="text-xs text-amber-700 mt-2 leading-relaxed">
          Copy this secret now. It will not be shown again. If you lose it you can rotate the secret
          again — there is no way to retrieve the value later.
        </p>
      </output>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">New resource credentials</p>
        </div>
        <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="font-medium text-stone-500">Audience</dt>
          <dd className="font-mono text-sky-950 break-all">{rotated.audience}</dd>
          <dt className="font-medium text-stone-500">Resource secret</dt>
          <dd className="font-mono text-sky-950 break-all">{rotated.secret}</dd>
        </dl>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 leading-relaxed">
        <p>
          Existing access tokens issued for this audience continue to validate at the resource
          server until they expire. Future authentication attempts using the old secret will fail.
        </p>
      </div>
    </div>
  );
}
