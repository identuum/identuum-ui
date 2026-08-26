"use client";

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
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
            If SMTP is configured, the activation email is re-sent automatically; the token is also
            shown here for secure out-of-band delivery.
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

function SuccessPanel({
  success,
  orgName,
}: {
  success: NonNullable<AssignAdminActionState["success"]>;
  orgName: string;
}) {
  const { adminEmail, activationToken, expiresAt } = success;

  const expiryDisplay = expiresAt
    ? new Date(expiresAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "24 hours from now";

  return (
    <div className="max-w-lg space-y-5">
      {/* Primary confirmation */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="text-sm font-semibold text-emerald-700">Activation token re-issued</p>
        <p className="text-xs text-stone-500 mt-1">
          A fresh one-time activation token was issued for{" "}
          <span className="font-mono font-medium text-sky-950">{adminEmail}</span>, the pending
          administrator of <span className="font-medium text-sky-950">{orgName}</span>. Any earlier
          token no longer works. If SMTP is configured, the activation email was re-sent.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          One-time activation token
        </p>
        {/* Token displayed for copy — never placed in URL or storage */}
        <pre className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-sky-950 break-all whitespace-pre-wrap font-mono overflow-x-auto shadow-inner">
          {activationToken}
        </pre>
        <p className="text-xs text-amber-600 leading-relaxed">
          ⚠ Copy this token now. It will not be shown again after you leave this page. Deliver it
          to <span className="font-mono">{adminEmail}</span> through a secure channel. It expires{" "}
          {expiryDisplay}.
        </p>
      </div>

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
