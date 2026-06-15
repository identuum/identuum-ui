"use client";

/**
 * EditDetailsCard — operator surface for the org-admin SA edit
 * affordance (slice identuum-20260530-service-account-edit-ui).
 * Mounted between the Configuration card and the LifecycleCard on
 * /org-admin/service-accounts/[id].
 *
 * Backend (gograph-verified in slice
 * identuum-20260530-service-account-edit-backend):
 *   PATCH /api/v1/organizations/:id/service-accounts/:sa_id
 *   Writes only name/description/role/updated_at; active,
 *   deleted_at, linked OAuth clients, and credentials are NOT
 *   touched. Duplicate name returns 409 (slice
 *   identuum-20260530-service-account-name-conflict-backend) →
 *   surfaced here as a name-field error.
 *
 * SECURITY invariants (pinned by Vitest):
 *   - The card renders NO client_secret / hash / credential / private-
 *     key / signing-key / token / cookie / session-id / raw metadata /
 *     IP / user-agent surface.
 *   - The form's inputs are name / description / role only; the
 *     serviceAccountId is curried via .bind so the form never
 *     carries it. The action server-side derives the organization id
 *     via getOwnOrganization() — the form never carries an
 *     organization_id either.
 *   - No write to localStorage / sessionStorage / cookies / URL.
 *   - No console.* call anywhere in this file.
 *   - No type-to-confirm gate — this is reversible metadata.
 *   - Submit + Cancel buttons; the form starts collapsed (operator
 *     must click "Edit details" to open it).
 */

import { useActionState, useState } from "react";
import { type UpdateSAState, updateServiceAccountAction } from "../actions";

const initialState: UpdateSAState = { phase: "idle" };

const NAME_MAX = 255;
const DESCRIPTION_MAX = 1024;

export interface EditDetailsCardProps {
  serviceAccountId: string;
  serviceAccountName: string;
  serviceAccountDescription: string;
  serviceAccountRole: string;
}

export function EditDetailsCard({
  serviceAccountId,
  serviceAccountName,
  serviceAccountDescription,
  serviceAccountRole,
}: EditDetailsCardProps) {
  const bound = updateServiceAccountAction.bind(null, serviceAccountId);
  const [state, action, pending] = useActionState(bound, initialState);
  const [editing, setEditing] = useState(false);

  // After a successful submit the server action's revalidatePath
  // causes Next.js to re-render the page with the updated server
  // state, so the parent passes the new name/description/role on the
  // next render. While the in-memory success state is held by
  // useActionState we surface the new values from state.updated; once
  // the parent re-renders the card, the source-of-truth shifts to
  // the props again.
  const currentName = state.phase === "success" ? state.updated.name : serviceAccountName;
  const currentDescription =
    state.phase === "success" ? state.updated.description : serviceAccountDescription;
  const currentRole = state.phase === "success" ? state.updated.role : serviceAccountRole;

  if (state.phase === "success" && !editing) {
    return (
      <section
        aria-labelledby="service-account-edit-details-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <CardHeader />
        <div className="px-6 py-5 space-y-4">
          <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">Service account updated.</p>
          </output>
          <DetailsView name={currentName} description={currentDescription} role={currentRole} />
          <div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center justify-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
            >
              Edit details
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (editing) {
    return (
      <section
        aria-labelledby="service-account-edit-details-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <CardHeader />
        <EditForm
          state={state}
          action={action}
          pending={pending}
          initialName={currentName}
          initialDescription={currentDescription}
          initialRole={currentRole}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="service-account-edit-details-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <CardHeader />
      <div className="px-6 py-5 space-y-4">
        <DetailsView name={currentName} description={currentDescription} role={currentRole} />
        <div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center justify-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
          >
            Edit details
          </button>
        </div>
      </div>
    </section>
  );
}

function CardHeader() {
  return (
    <div className="px-6 py-4 border-b border-stone-100">
      <h2 id="service-account-edit-details-heading" className="text-sm font-semibold text-sky-950">
        Edit details
      </h2>
      <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
        Update the service account{"'"}s display name, description, and role. These are operator
        metadata only — they do NOT issue a credential and do NOT change the linked OAuth client,
        the lifecycle state, or any in-flight tokens.
      </p>
    </div>
  );
}

function DetailsView({
  name,
  description,
  role,
}: {
  name: string;
  description: string;
  role: string;
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
      <dt className="font-medium text-stone-500">Name</dt>
      <dd className="text-sky-950 break-words">{name}</dd>
      <dt className="font-medium text-stone-500">Description</dt>
      <dd className="text-sky-950 break-words">
        {description.length > 0 ? description : <span className="text-stone-300">—</span>}
      </dd>
      <dt className="font-medium text-stone-500">Role</dt>
      <dd className="text-sky-950">{role || "—"}</dd>
    </dl>
  );
}

function EditForm({
  state,
  action,
  pending,
  initialName,
  initialDescription,
  initialRole,
  onCancel,
}: {
  state: UpdateSAState;
  action: (payload: FormData) => void;
  pending: boolean;
  initialName: string;
  initialDescription: string;
  initialRole: string;
  onCancel: () => void;
}) {
  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="px-6 py-5 space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {errorMessage}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="edit-sa-name" className="block text-xs font-medium text-sky-950">
          Name
        </label>
        <input
          id="edit-sa-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          maxLength={NAME_MAX}
          defaultValue={initialName}
          disabled={pending}
          className={
            fieldErrors.name
              ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
              : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
          }
        />
        {fieldErrors.name && <p className="text-[11px] text-red-600">{fieldErrors.name}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-sa-description" className="block text-xs font-medium text-sky-950">
          Description
        </label>
        <textarea
          id="edit-sa-description"
          name="description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          defaultValue={initialDescription}
          disabled={pending}
          className={
            fieldErrors.description
              ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
              : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
          }
        />
        {fieldErrors.description && (
          <p className="text-[11px] text-red-600">{fieldErrors.description}</p>
        )}
        <p className="text-[10px] text-stone-400 leading-relaxed">
          Max {DESCRIPTION_MAX} characters.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-sa-role" className="block text-xs font-medium text-sky-950">
          Role
        </label>
        <select
          id="edit-sa-role"
          name="role"
          required
          defaultValue={initialRole || "org_user"}
          disabled={pending}
          className={
            fieldErrors.role
              ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
              : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
          }
        >
          <option value="org_user">org_user</option>
          <option value="org_admin">org_admin</option>
        </select>
        {fieldErrors.role && <p className="text-[11px] text-red-600">{fieldErrors.role}</p>}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {pending ? "Saving…" : "Save details"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
