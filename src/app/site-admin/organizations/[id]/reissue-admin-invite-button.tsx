"use client";

/**
 * FUNC-M13: "Re-issue invite" for the administrator of an ACTIVE organization
 * who has not accepted their invite (pendingInvitedAdmin). Asks first —
 * re-issuing retires the link handed over before — then shows the new
 * invite once, in InviteIssuedPanel. A refusal is said plainly.
 */

import { useActionState, useState } from "react";
import { InviteIssuedPanel } from "@/components/shared/invite-issued-panel";
import {
  type ReissueAdminInviteState,
  reissueAdminInviteAction,
} from "./reissue-activation-actions";

const initialState: ReissueAdminInviteState = { phase: "idle" };

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm transition-colors";

export function ReissueAdminInviteButton({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(reissueAdminInviteAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.phase === "issued") {
    return <InviteIssuedPanel invite={state.invite} />;
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="user_id" value={userId} />
          <p className="text-xs text-stone-600 leading-relaxed">
            The invite link you handed over before stops working. Issue a new one?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {isPending ? "Issuing…" : "Issue new invite"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(false)}
              className={secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={secondaryBtn}>
          Re-issue invite
        </button>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-red-600 leading-tight">
          {state.error}
        </p>
      )}
    </div>
  );
}
