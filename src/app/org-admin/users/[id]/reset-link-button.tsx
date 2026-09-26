"use client";

/**
 * CE-UI-2b: "Create password reset link" on /org-admin/users/[id], rendered
 * only where the IdP issues admin reset links (capabilities.admin_reset_link,
 * identuum-idp-ce — which sends no mail).
 *
 * The action calls POST /api/v1/users/:id/recovery/reset-link. The link is
 * single-use and lives 24 hours; it is shown once, in the shared
 * SetupLinkPanel with its copy button, held only in this component's state —
 * never stored, logged or put in a URL. Redeeming it sets a new password and
 * signs the user out everywhere; their authenticator stays enrolled.
 */

import { useActionState } from "react";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { type CreateResetLinkState, createResetLinkAction } from "../actions";

const initialState: CreateResetLinkState = { phase: "idle" };

export function ResetLinkButton({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(createResetLinkAction, initialState);

  if (state.phase === "success" && state.resetUrl) {
    return (
      <div className="space-y-2 max-w-[340px]">
        <SetupLinkPanel
          link={state.resetUrl}
          title="One-time password reset link"
          description="Share this link with the user through a secure channel. It works once and expires in 24 hours. It is not shown again."
          compact
        />
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
          className="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm transition-colors"
        >
          {isPending ? "Creating…" : "Create password reset link"}
        </button>
      </form>
      {state.phase === "error" && state.error && (
        <p className="text-[10px] text-red-600 leading-tight max-w-[280px]">{state.error}</p>
      )}
    </div>
  );
}
