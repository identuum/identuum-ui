"use client";

/**
 * DangerZone — destructive-action panel for the org-admin Service
 * Account detail page. Mirrors the API Resource DangerZone pattern.
 *
 * The action is curried with the route's serviceAccountId + the
 * service-account display name via
 * `deleteServiceAccountAction.bind(null, serviceAccountId, serviceAccountName)`
 * so the form never carries those values in form data — a tampered
 * POST cannot retarget the action at a different service account or
 * pre-set the type-to-confirm expectation.
 *
 * SECURITY invariants:
 *   - No credential / secret / hash / private-key field is ever
 *     rendered, requested, accepted, logged, or stored.
 *   - The two-step expand pattern means the first click flips a local
 *     React `expanded` flag with NO POST sent.
 *   - The submit button is DISABLED until the typed value matches the
 *     service-account display name exactly. The server action
 *     re-checks the same gate.
 *   - No write to localStorage / sessionStorage / cookies / URL.
 *   - The backend performs a SOFT delete (sets deleted_at). The
 *     operator's intent is "remove from the active list"; the row is
 *     retained in DB for audit lineage.
 */

import { Button } from "@/components/ui/button";
import { useActionState, useState } from "react";
import { type DeleteServiceAccountState, deleteServiceAccountAction } from "../actions";

const initialState: DeleteServiceAccountState = { phase: "idle" };

export interface DangerZoneProps {
  serviceAccountId: string;
  serviceAccountName: string;
}

export function DangerZone({ serviceAccountId, serviceAccountName }: DangerZoneProps) {
  const [expanded, setExpanded] = useState(false);

  const boundAction = deleteServiceAccountAction.bind(null, serviceAccountId, serviceAccountName);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <section
      aria-labelledby="service-account-danger-zone-heading"
      className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-red-100 bg-red-50">
        <h2 id="service-account-danger-zone-heading" className="text-sm font-semibold text-red-700">
          Danger zone
        </h2>
        <p className="text-xs text-red-700 mt-0.5 leading-relaxed">
          Deleting this service account removes it from the active list. The backend performs a soft
          delete (the row is retained for audit lineage); any future credential issuance against
          this identity will be rejected.
        </p>
      </div>

      {!expanded ? (
        <ExpandPanel onExpand={() => setExpanded(true)} />
      ) : (
        <DeleteConfirmForm
          serviceAccountName={serviceAccountName}
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
        To proceed you will be asked to type the service account name exactly.
      </p>
      <div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
        >
          Delete service account
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmForm({
  serviceAccountName,
  state,
  action,
  pending,
  onCancel,
}: {
  serviceAccountName: string;
  state: DeleteServiceAccountState;
  action: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim() === serviceAccountName;
  const submitDisabled = !matches || pending;

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700 leading-relaxed">
        <p>
          To confirm, type the service account name{" "}
          <span className="font-mono font-semibold">{serviceAccountName}</span>.
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
          htmlFor="delete-service-account-confirm"
          className="block text-sm font-medium text-sky-950"
        >
          Type to confirm <span className="text-red-500">*</span>
        </label>
        <input
          id="delete-service-account-confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={serviceAccountName}
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
          {pending ? "Deleting…" : "Delete service account"}
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
