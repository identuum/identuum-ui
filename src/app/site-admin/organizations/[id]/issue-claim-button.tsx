"use client";

/**
 * OSS-CLAIM-UI (D-022): "Issue claim link" on an active organization with no
 * administrator. An optional email binds the link (and it is mailed only when
 * email delivery is configured on the IdP). The link is shown once, with Copy
 * and its expiry; issuing again first warns that the earlier link stops
 * working. The link lives only in this component's in-memory action state.
 */

import { useActionState, useState } from "react";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { LocalTime } from "@/components/ui/local-time";
import type { IssuedClaim } from "@/lib/idp-admin-client";
import { type IssueClaimState, issueClaimAction } from "./issue-claim-actions";

const initialState: IssueClaimState = { phase: "idle" };

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm transition-colors";

export function IssuedClaimPanel({ claim }: { claim: IssuedClaim }) {
  return (
    <div
      data-testid="claim-issued"
      className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4 space-y-3"
    >
      <p className="text-xs text-stone-600 leading-relaxed">
        Hand this link to the person who will administer the organization. It works once and expires{" "}
        <LocalTime value={claim.expiresAt} />.
        {claim.emailBound
          ? " It is bound to the email you entered, and mailed there only when email delivery is configured on the IdP."
          : " Whoever opens it chooses the administrator's email."}
      </p>
      <SetupLinkPanel
        link={claim.claimUrl}
        title="Claim link"
        description="Opening it lets the new administrator set a password and enrol an authenticator."
      />
      <p className="text-xs font-semibold text-amber-700">
        Copy it now. It will not be shown again after you leave this page.
      </p>
    </div>
  );
}

export function ClaimIssueForm({
  orgId,
  reissue,
  pending,
  action,
  onCancel,
}: {
  orgId: string;
  reissue: boolean;
  pending: boolean;
  action: (formData: FormData) => void;
  onCancel?: () => void;
}) {
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="org_id" value={orgId} />
      {reissue && (
        <p className="text-xs text-amber-700 font-medium">
          The link issued before stops working. Issue a new one?
        </p>
      )}
      <label htmlFor="claim-link-email" className="block text-xs font-semibold text-stone-700">
        Administrator email (optional)
      </label>
      <input
        id="claim-link-email"
        name="email"
        type="email"
        autoComplete="off"
        className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs"
      />
      <p className="text-xs text-stone-500 leading-relaxed">
        With an email the link is bound to it: only that address can claim it, and it is mailed only
        when email delivery is configured. Without one, whoever opens the link chooses the email.
        Issuing a link retires any link issued before for this organization.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
        >
          {pending ? "Issuing…" : "Issue link"}
        </button>
        {onCancel && (
          <button type="button" disabled={pending} onClick={onCancel} className={secondaryBtn}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function IssueClaimButton({ orgId }: { orgId: string }) {
  const [state, formAction, isPending] = useActionState(issueClaimAction, initialState);
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedClaim | null>(null);
  const shown = state.phase === "issued" ? state.claim : issued;
  if (state.phase === "issued" && issued !== state.claim) {
    setIssued(state.claim);
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      {shown && <IssuedClaimPanel claim={shown} />}
      {open ? (
        <ClaimIssueForm
          orgId={orgId}
          reissue={shown !== null}
          pending={isPending}
          action={formAction}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={secondaryBtn}>
          {shown ? "Issue a new claim link" : "Issue claim link"}
        </button>
      )}
      {state.phase === "idle" && state.error && (
        <p role="alert" className="text-xs text-red-600 leading-tight">
          {state.error}
        </p>
      )}
    </div>
  );
}
