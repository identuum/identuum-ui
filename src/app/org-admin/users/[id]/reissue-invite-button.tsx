"use client";

/**
 * OSS-ONBOARD-B (D-016): "Re-issue invitation" on /org-admin/users/[id] for a
 * pending user, where the IdP mounts the invite (capabilities.user_invite).
 *
 * Asks first — re-issuing retires the link handed over before — then calls
 * POST /api/v1/users/:id/invite and shows the new invite once, in the same
 * panel as Invite user. A 409 (the user already accepted) is said plainly.
 */

import { useActionState, useState } from "react";
import { InviteIssuedPanel } from "@/components/shared/invite-issued-panel";
import { type ReissueInviteState, reissueInviteAction } from "../actions";

const initialState: ReissueInviteState = { phase: "idle" };

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm transition-colors";

/**
 * firstInvite (OSS-FIN-2): the same call for an unverified user created with
 * a password before D-017 — there is no earlier link to retire, so the copy
 * says so.
 */
export function ReissueInviteButton({
  userId,
  firstInvite = false,
}: {
  userId: string;
  firstInvite?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(reissueInviteAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.phase === "issued") {
    return (
      <div className="max-w-[420px]">
        <InviteIssuedPanel invite={state.invite} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="userId" value={userId} />
          <p className="text-xs text-stone-600 max-w-[300px] leading-relaxed">
            {firstInvite
              ? "Their current password stops mattering: they choose a new one when they accept. Issue the link?"
              : "The link you handed over before stops working. Issue a new one?"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {isPending ? "Issuing…" : "Issue new link"}
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
          {firstInvite ? "Send invitation" : "Re-issue invitation"}
        </button>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-red-600 leading-tight max-w-[300px]">
          {state.error}
        </p>
      )}
    </div>
  );
}
