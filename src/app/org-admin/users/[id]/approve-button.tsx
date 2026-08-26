"use client";

/**
 * Approve registration button — rendered on /org-admin/users/[id] when the
 * derived status is "pending_approval" (i.e., the IDP exposes
 * banned=true && role=org_user for the target).
 *
 * The action calls POST /api/v1/users/:id/approve. The IDP guards on the
 * same predicate server-side and returns ErrInvalidRequest if the user is no
 * longer in that state, so a UI race is safe.
 *
 * The activation_url field on the response is populated only in air-gapped
 * deployments. When present, it is shown in the shared SetupLinkPanel
 * primitive — never stored or logged.
 */

import { useActionState } from "react";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { type ApproveRegistrationState, approveRegistrationAction } from "../actions";
import { APPROVE_REGISTRATION_COPY } from "./user-detail-actions";

interface ApproveButtonProps {
  userId: string;
}

const initialState: ApproveRegistrationState = { phase: "idle" };

export function ApproveButton({ userId }: ApproveButtonProps) {
  const [state, formAction, isPending] = useActionState(approveRegistrationAction, initialState);

  if (state.phase === "success") {
    return (
      <div className="space-y-2 max-w-[340px]">
        <p className="text-xs text-emerald-700 font-semibold leading-tight">
          {APPROVE_REGISTRATION_COPY.successMessage}
        </p>
        {state.activationUrl && (
          <SetupLinkPanel
            link={state.activationUrl}
            title="One-time activation link"
            description="Air-gapped deployment: share this link with the user out of band. It expires in 24 hours."
            compact
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
        >
          {isPending ? "Approving…" : APPROVE_REGISTRATION_COPY.buttonLabel}
        </button>
      </form>
      {state.phase === "error" && state.error && (
        <p className="text-[10px] text-red-600 leading-tight max-w-[280px]">{state.error}</p>
      )}
    </div>
  );
}
