"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type ReactivateOrgActionState, reactivateOrgAction } from "./actions";

interface ReactivateOrgFormProps {
  orgId: string;
  orgName: string;
}

const initialState: ReactivateOrgActionState = {};

export function ReactivateOrgForm({ orgId, orgName }: ReactivateOrgFormProps) {
  const [state, action, isPending] = useActionState(reactivateOrgAction, initialState);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="org_id" value={orgId} />

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <p className="text-sm text-stone-600">
        Reactivate <span className="font-semibold text-sky-950">{orgName}</span> to allow users to
        log in again. Existing users and settings are preserved.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Reactivating…" : "Reactivate organization"}
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
