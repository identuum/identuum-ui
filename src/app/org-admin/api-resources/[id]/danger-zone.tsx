"use client";

/**
 * DangerZone — destructive-action panel for the org-admin API Resource
 * detail page.
 *
 * Mirrors src/app/org-admin/applications/[id]/danger-zone.tsx. The
 * action is curried with the route's resourceId + the resource's
 * display name + its audience via
 * `deleteApiResourceAction.bind(null, resourceId, resourceName, resourceAudience)`
 * so the form never carries those values in form data. A tampered POST
 * cannot retarget the action at a different resource or pre-set the
 * type-to-confirm expectation.
 *
 * SECURITY invariants:
 *   - No secret/hash/private-key/token field is ever rendered, requested,
 *     accepted, logged, or stored.
 *   - The two-step expand pattern means the first click flips a local
 *     `expanded` flag with NO POST sent.
 *   - The submit button is DISABLED until the typed value matches the
 *     resource's display name OR its audience. The server action
 *     re-checks the same gate.
 *   - The operator-typed confirmation is treated as opaque (no
 *     console.*, no echoes in errors, no persistence).
 *   - No write to localStorage / sessionStorage / cookies / URL — only
 *     React state for the lifetime of the page.
 */

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { type DeleteAPIResourceState, deleteApiResourceAction } from "../actions";

const initialState: DeleteAPIResourceState = { phase: "idle" };

export interface DangerZoneProps {
  resourceId: string;
  resourceName: string;
  resourceAudience: string;
}

export function DangerZone({ resourceId, resourceName, resourceAudience }: DangerZoneProps) {
  const [expanded, setExpanded] = useState(false);

  const boundAction = deleteApiResourceAction.bind(
    null,
    resourceId,
    resourceName,
    resourceAudience
  );
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <section
      aria-labelledby="api-resource-danger-zone-heading"
      className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-red-100 bg-red-50">
        <h2 id="api-resource-danger-zone-heading" className="text-sm font-semibold text-red-700">
          Danger zone
        </h2>
        <p className="text-xs text-red-700 mt-0.5 leading-relaxed">
          Deleting this API resource is permanent. Access tokens minted for this audience will
          continue to validate until they expire, but no new tokens will be issued and clients with
          this audience configured will be rejected.
        </p>
      </div>

      {!expanded ? (
        <ExpandPanel onExpand={() => setExpanded(true)} />
      ) : (
        <DeleteConfirmForm
          resourceName={resourceName}
          resourceAudience={resourceAudience}
          state={state}
          action={action}
          pending={pending}
          onCancel={() => setExpanded(false)}
        />
      )}
    </section>
  );
}

function ExpandPanel({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="px-6 py-5 flex flex-col gap-3">
      <p className="text-xs text-stone-600 leading-relaxed">
        This action cannot be undone. To proceed you will be asked to type the resource name or
        audience exactly.
      </p>
      <div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
        >
          Delete API resource
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmForm({
  resourceName,
  resourceAudience,
  state,
  action,
  pending,
  onCancel,
}: {
  resourceName: string;
  resourceAudience: string;
  state: DeleteAPIResourceState;
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
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700 leading-relaxed">
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
          htmlFor="delete-api-resource-confirm"
          className="block text-sm font-medium text-sky-950"
        >
          Type to confirm <span className="text-red-500">*</span>
        </label>
        <input
          id="delete-api-resource-confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={resourceName}
          disabled={pending}
          className="w-full font-mono rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
        />
        {fieldErrors.confirm && <p className="text-xs text-red-500">{fieldErrors.confirm}</p>}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="danger"
          loading={pending}
          size="md"
          disabled={submitDisabled}
        >
          {pending ? "Deleting…" : "Delete API resource"}
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
