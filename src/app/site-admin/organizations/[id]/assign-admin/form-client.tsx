"use client";

import { Button } from "@/components/ui/button";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { useActionState } from "react";
import { type AssignAdminActionState, assignAdminAction } from "./actions";

interface AssignAdminFormProps {
  orgId: string;
  orgName: string;
}

const initialState: AssignAdminActionState = {};

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

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

      <div className="space-y-1.5">
        <label htmlFor="recipient-email" className="block text-sm font-semibold text-stone-700">
          Admin email address <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          name="recipient_email"
          id="recipient-email"
          type="email"
          maxLength={255}
          placeholder="admin@example.com"
          autoComplete="off"
          className={inputClass}
        />
        {state.fieldErrors?.recipient_email && (
          <p className="text-xs text-red-600">{state.fieldErrors.recipient_email}</p>
        )}
        <p className="text-xs text-stone-400 leading-relaxed">
          Leave blank to generate a setup link for manual delivery. If provided, the link will be
          bound to this exact address and emailed automatically when SMTP is configured.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">How it works</p>
        <ul className="text-xs text-stone-400 space-y-1 leading-relaxed list-disc list-inside">
          <li>
            Without an email, the one-time link is shown immediately for out-of-band delivery. The
            claimant enters their email when setting up their account.
          </li>
          <li>
            With an email, the link is bound to that address. If SMTP is configured, Identuum emails
            it automatically.
          </li>
          <li>Only organizations with no active administrator can be assigned here.</li>
        </ul>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Generating link…" : "Generate admin setup link"}
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
  const { recipientEmail, claimUrl, expiresAt, emailSent } = success;

  const expiryDisplay = expiresAt
    ? new Date(expiresAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "48 hours from now";

  const hasEmail = recipientEmail.length > 0;

  return (
    <div className="max-w-lg space-y-5">
      {/* Primary confirmation */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="text-sm font-semibold text-emerald-700">Admin setup link generated</p>
        <p className="text-xs text-stone-500 mt-1">
          {hasEmail ? (
            <>
              A one-time setup link has been created for{" "}
              <span className="font-mono font-medium text-sky-950">{recipientEmail}</span> to claim
              org_admin access for <span className="font-medium text-sky-950">{orgName}</span>.
            </>
          ) : (
            <>
              A one-time setup link has been created for manual delivery. Deliver it securely to the
              prospective administrator of{" "}
              <span className="font-medium text-sky-950">{orgName}</span>. They will enter their
              email when setting up their account.
            </>
          )}
        </p>
      </div>

      {/* Email delivery status */}
      {hasEmail && emailSent && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs text-stone-500">
            ✉ The setup link was emailed to{" "}
            <span className="font-mono font-medium text-sky-950">{recipientEmail}</span>. If the
            email does not arrive, use the link below to deliver it manually.
          </p>
        </div>
      )}
      {hasEmail && !emailSent && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700 font-semibold">Email delivery not configured</p>
          <p className="text-xs text-stone-500 mt-1">
            The setup link could not be emailed automatically. Copy the link below and deliver it
            securely to <span className="font-mono font-medium text-sky-950">{recipientEmail}</span>
            .
          </p>
        </div>
      )}
      {!hasEmail && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700 font-semibold">Manual delivery required</p>
          <p className="text-xs text-stone-500 mt-1">
            No email address was provided. Copy the link below and deliver it securely out-of-band.
            The claimant will choose their email when setting up their account.
          </p>
        </div>
      )}

      {/* One-time claim URL — kept in React state only, never in URL/localStorage */}
      <SetupLinkPanel
        link={claimUrl}
        title="One-time admin setup link"
        description={
          hasEmail
            ? `Expires ${expiryDisplay} and is bound to ${recipientEmail}.`
            : `Expires ${expiryDisplay}. Anyone with this link can claim org_admin access for ${orgName}.`
        }
      />

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <a
          href="/site-admin/organizations"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          View all organizations
        </a>
        <a
          href="/site-admin/organizations/new"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Create another organization
        </a>
      </div>
    </div>
  );
}
