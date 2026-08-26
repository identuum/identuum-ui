"use client";

/**
 * DangerZone — destructive-action panel for the org-admin Application
 * detail page.
 *
 * Wraps the `deleteApplicationAction` server action with React's
 * useActionState. The action is curried with the route's clientId +
 * the client's display name + its OAuth client_id via
 * `deleteApplicationAction.bind(null, clientId, clientName, clientID)`
 * so the form never carries those values in form data. A tampered
 * POST cannot retarget the action at a different client or pre-set
 * the type-to-confirm expectation.
 *
 * UX:
 *   - Render-time state: the destructive button is hidden behind a
 *     two-step expand pattern. The first click flips a local
 *     `expanded` flag — NO POST is sent on first click. Once expanded
 *     the operator sees the warning copy + a confirmation input + the
 *     final Delete submit button.
 *   - The submit button is DISABLED until the typed value matches the
 *     application's display name OR its OAuth client_id. This is a
 *     usability help only; the server action re-checks the same gate
 *     on submission and rejects a mismatch even if the client-side
 *     state was tampered with.
 *
 * SECURITY:
 *   - NEVER renders, requests, or accepts a `client_secret`. The form
 *     does not have a secret input at all.
 *   - NEVER writes to localStorage / sessionStorage / cookies / URL.
 *     The transient `expanded` flag and the controlled `confirm` text
 *     live ONLY in React state for the lifetime of the page.
 *   - NEVER logs anything via console.*.
 *   - The operator-typed confirmation MAY accidentally contain
 *     credential material if the operator pastes the wrong thing —
 *     the form treats it as opaque, does not log it, does not echo
 *     it in error messages, and the server action does not surface
 *     it back to the page.
 */

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { type DeleteApplicationState, deleteApplicationAction } from "../actions";

const initialState: DeleteApplicationState = { phase: "idle" };

export interface DangerZoneProps {
  clientId: string;
  clientName: string;
  clientID: string;
}

export function DangerZone({ clientId, clientName, clientID }: DangerZoneProps) {
  const [expanded, setExpanded] = useState(false);

  const boundAction = deleteApplicationAction.bind(null, clientId, clientName, clientID);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-red-100 bg-red-50">
        <h2 id="danger-zone-heading" className="text-sm font-semibold text-red-700">
          Danger zone
        </h2>
        <p className="text-xs text-red-700 mt-0.5 leading-relaxed">
          Deleting this application is permanent. Existing tokens issued for this client will
          continue to validate until they expire, but no new tokens can be issued and any OAuth
          client_id reuse will be rejected until a fresh client is created.
        </p>
      </div>

      {!expanded ? (
        <ExpandPanel onExpand={() => setExpanded(true)} />
      ) : (
        <DeleteConfirmForm
          clientName={clientName}
          clientID={clientID}
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
        This action cannot be undone. To proceed you will be asked to type the application name or
        client ID exactly.
      </p>
      <div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
        >
          Delete application
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmForm({
  clientName,
  clientID,
  state,
  action,
  pending,
  onCancel,
}: {
  clientName: string;
  clientID: string;
  state: DeleteApplicationState;
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
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700 leading-relaxed">
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
        <label htmlFor="delete-app-confirm" className="block text-sm font-medium text-sky-950">
          Type to confirm <span className="text-red-500">*</span>
        </label>
        <input
          id="delete-app-confirm"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={clientName}
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
          {pending ? "Deleting…" : "Delete application"}
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
