"use client";

import { Button } from "@/components/ui/button";
import type { OrgDetail } from "@/lib/types";
import { useActionState } from "react";
import { type UpdateOrgActionState, updateOrgAction } from "./actions";

interface EditOrgFormProps {
  org: OrgDetail;
}

const initialState: UpdateOrgActionState = {};

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const selectClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function EditOrgForm({ org }: EditOrgFormProps) {
  const [state, action, isPending] = useActionState(updateOrgAction, initialState);

  return (
    <form action={action} className="space-y-5 max-w-lg">
      {/* Hidden: org ID passed to server action */}
      <input type="hidden" name="org_id" value={org.id} />

      {/* Global error */}
      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor="edit-org-name" className="block text-sm font-semibold text-stone-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          name="name"
          id="edit-org-name"
          type="text"
          required
          maxLength={255}
          defaultValue={org.name}
          autoComplete="off"
          className={inputClass}
        />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600">{state.fieldErrors.name}</p>
        )}
      </div>

      {/* Active status */}
      <fieldset className="space-y-1.5">
        <legend className="block text-sm font-semibold text-stone-700">Status</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="active"
              value="true"
              defaultChecked={org.active}
              className="accent-sky-600"
            />
            <span className="text-sm text-sky-950">Active</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="active"
              value="false"
              defaultChecked={!org.active}
              className="accent-sky-600"
            />
            <span className="text-sm text-sky-950">Inactive</span>
          </label>
        </div>
        {state.fieldErrors?.active && (
          <p className="text-xs text-red-600">{state.fieldErrors.active}</p>
        )}
      </fieldset>

      {/* Auth policy */}
      <div className="space-y-1.5">
        <label
          htmlFor="edit-org-auth-policy"
          className="block text-sm font-semibold text-stone-700"
        >
          Authentication policy
        </label>
        <select
          name="auth_policy"
          id="edit-org-auth-policy"
          defaultValue={org.auth_policy}
          className={selectClass}
        >
          <option value="local_only">Local credentials only</option>
          <option value="idp_only">External IdP only</option>
          <option value="mixed">Mixed (local + external IdP)</option>
        </select>
        <p className="text-xs text-stone-400">
          Controls which authentication methods are permitted for org users.
        </p>
        {state.fieldErrors?.auth_policy && (
          <p className="text-xs text-red-600">{state.fieldErrors.auth_policy}</p>
        )}
      </div>

      {/* MFA policy */}
      <div className="space-y-1.5">
        <label htmlFor="edit-org-mfa-policy" className="block text-sm font-semibold text-stone-700">
          MFA policy
        </label>
        <select
          name="mfa_policy"
          id="edit-org-mfa-policy"
          defaultValue={org.mfa_policy}
          className={selectClass}
        >
          <option value="optional">Optional</option>
          <option value="required">Required for all users</option>
        </select>
        {state.fieldErrors?.mfa_policy && (
          <p className="text-xs text-red-600">{state.fieldErrors.mfa_policy}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        <a
          href={`/site-admin/organizations/${org.id}`}
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
