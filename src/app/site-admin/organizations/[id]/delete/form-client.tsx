"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type DeleteOrgActionState, deleteOrgAction } from "./actions";

interface DeleteOrgFormProps {
  orgId: string;
  orgName: string;
}

const initialState: DeleteOrgActionState = {};

export function DeleteOrgForm({ orgId, orgName }: DeleteOrgFormProps) {
  const [state, action, isPending] = useActionState(deleteOrgAction, initialState);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="org_id" value={orgId} />

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="confirmed"
            value="yes"
            className="mt-0.5 accent-red-500"
            required
          />
          <span className="text-sm text-stone-600 leading-relaxed">
            I confirm I want to soft-delete{" "}
            <span className="font-semibold text-sky-950">{orgName}</span>. This action can be undone
            by a site administrator using the Restore action.
          </span>
        </label>
        {state.fieldErrors?.confirmed && (
          <p className="text-xs text-red-600 ml-6">{state.fieldErrors.confirmed}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="danger" loading={isPending} disabled={isPending}>
          {isPending ? "Deleting…" : "Soft-delete organization"}
        </Button>
        <a
          href="/site-admin/organizations"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
