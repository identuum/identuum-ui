"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type DeactivateOrgActionState, deactivateOrgAction } from "./actions";

interface DeactivateOrgFormProps {
  orgId: string;
  orgName: string;
}

const initialState: DeactivateOrgActionState = {};

export function DeactivateOrgForm({ orgId, orgName }: DeactivateOrgFormProps) {
  const [state, action, isPending] = useActionState(deactivateOrgAction, initialState);

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
            className="mt-0.5 accent-amber-500"
            required
          />
          <span className="text-sm text-stone-600 leading-relaxed">
            I confirm I want to deactivate{" "}
            <span className="font-semibold text-sky-950">{orgName}</span>. Users will not be able to
            log in while the organization is inactive. This can be reversed using the Reactivate
            action.
          </span>
        </label>
        {state.fieldErrors?.confirmed && (
          <p className="text-xs text-red-600 ml-6">{state.fieldErrors.confirmed}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="danger"
          className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:text-amber-800 focus-visible:ring-amber-500"
          loading={isPending}
          disabled={isPending}
        >
          {isPending ? "Deactivating…" : "Deactivate organization"}
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
