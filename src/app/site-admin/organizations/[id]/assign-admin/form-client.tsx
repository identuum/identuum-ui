"use client";

import { useActionState } from "react";
import { ActivationIssuedPanel } from "@/components/shared/activation-issued-panel";
import { Button } from "@/components/ui/button";
import { type AssignAdminActionState, assignAdminAction } from "./actions";

interface AssignAdminFormProps {
  orgId: string;
  orgName: string;
}

const initialState: AssignAdminActionState = {};

export function AssignAdminForm({ orgId, orgName }: AssignAdminFormProps) {
  const [state, action, isPending] = useActionState(assignAdminAction, initialState);

  if (state.success) {
    return <SuccessPanel success={state.success} orgName={orgName} />;
  }

  return (
    <form action={action} className="space-y-5 max-w-lg">
      <input type="hidden" name="org_id" value={orgId} />

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">How it works</p>
        <ul className="text-xs text-stone-400 space-y-1 leading-relaxed list-disc list-inside">
          <li>
            The organization&apos;s pending administrator was chosen when the organization was
            created with an admin email. This re-issues that administrator&apos;s one-time
            activation token (any earlier token stops working).
          </li>
          <li>
            The new activation link is shown here once for you to hand over; it is also mailed only
            when email delivery is configured on the IdP.
          </li>
          <li>
            Only inactive organizations with a pending administrator qualify — an active
            organization&apos;s admin has already completed activation.
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Re-issuing token…" : "Re-issue activation token"}
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

export function SuccessPanel({
  success,
}: {
  success: NonNullable<AssignAdminActionState["success"]>;
  orgName: string;
}) {
  const { orgId: _orgId, ...activation } = success;
  return (
    <div className="max-w-lg space-y-5">
      <ActivationIssuedPanel activation={activation} />

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <a
          href="/site-admin/organizations"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Back to organizations
        </a>
      </div>
    </div>
  );
}
