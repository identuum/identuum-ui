"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type RestoreOrgActionState, restoreOrgAction } from "./actions";

interface RestoreOrgFormProps {
  orgId: string;
  orgName: string;
}

const initialState: RestoreOrgActionState = {};

export function RestoreOrgForm({ orgId, orgName }: RestoreOrgFormProps) {
  const [state, action, isPending] = useActionState(restoreOrgAction, initialState);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="org_id" value={orgId} />

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <p className="text-sm text-stone-600">
        Restore <span className="font-semibold text-sky-950">{orgName}</span> to make it active
        again. Existing users and settings will be preserved.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Restoring…" : "Restore organization"}
        </Button>
        <a
          href="/site-admin/organizations?deleted=true"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
