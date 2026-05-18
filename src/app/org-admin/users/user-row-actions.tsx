"use client";

import { useActionState, useState } from "react";

/**
 * UserRowActions — per-row lifecycle actions for the org-admin Users table.
 *
 * - Active/Disabled users: Disable / Enable toggle.
 * - Pending (unclaimed invitation) users: "Regenerate setup link" button.
 *   On success, shows a one-time copyable setup URL inline in the row.
 *
 * Security: userId is included in the form POST body. The backend verifies
 * org scope, last-admin guard, and invitation_pending state on every call.
 * Setup URLs are never stored or logged by this component.
 */

import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import {
  type RegenerateInviteState,
  type ResetMFAState,
  type SetUserActiveState,
  regenerateInviteAction,
  resetMFAAction,
  setUserActiveAction,
} from "./actions";

// ── Disable / Enable ──────────────────────────────────────────────────────────

interface UserRowActionsProps {
  userId: string;
  active: boolean;
  disableDisable?: boolean;
}

const initialActiveState: SetUserActiveState = { phase: "idle" };

export function UserRowActions({ userId, active, disableDisable = false }: UserRowActionsProps) {
  const [state, formAction, isPending] = useActionState(setUserActiveAction, initialActiveState);
  const isThisRow = state.userId === userId || state.userId === undefined;

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={String(!active)} />
        <button
          type="submit"
          disabled={isPending || (active && disableDisable)}
          title={active && disableDisable ? "Cannot disable the last active admin" : undefined}
          className={[
            "text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
            active
              ? "text-stone-400 hover:text-amber-600"
              : "text-stone-400 hover:text-emerald-600",
          ].join(" ")}
        >
          {isPending ? "…" : active ? "Disable" : "Enable"}
        </button>
      </form>

      {state.phase === "error" && isThisRow && state.error && (
        <p className="text-[10px] text-red-500 leading-tight max-w-[120px]">{state.error}</p>
      )}
    </div>
  );
}

// ── Regenerate setup link (pending users only) ────────────────────────────────

interface RegenerateInviteLinkProps {
  userId: string;
}

const initialRegenState: RegenerateInviteState = { phase: "idle" };

export function RegenerateInviteLink({ userId }: RegenerateInviteLinkProps) {
  const [state, formAction, isPending] = useActionState(regenerateInviteAction, initialRegenState);

  if (state.phase === "success" && state.setupUrl) {
    return (
      <SetupLinkPanel
        link={state.setupUrl}
        title="New setup link"
        description="Previous link is now invalid. This link expires in 24 hours."
        compact
      />
    );
  }

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs font-medium text-stone-400 hover:text-sky-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? "…" : "Regenerate link"}
        </button>
      </form>

      {state.phase === "error" && state.error && (
        <p className="text-[10px] text-red-500 leading-tight max-w-[140px]">{state.error}</p>
      )}
    </div>
  );
}

// ── Reset MFA enrollment (org_admin → same-org org_user) ─────────────────────

interface ResetMFAButtonProps {
  userId: string;
}

const initialResetMFAState: ResetMFAState = { phase: "idle" };

export function ResetMFAButton({ userId }: ResetMFAButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, isPending] = useActionState(resetMFAAction, initialResetMFAState);

  if (state.phase === "success") {
    return (
      <p className="text-xs text-emerald-600 font-medium leading-tight max-w-[280px]">
        MFA enrollment cleared. Active sessions revoked. The user must re-enroll on next
        sign-in.
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 max-w-[300px]">
          <p className="text-xs font-semibold text-amber-700">Confirm MFA reset</p>
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
            This will clear the user{"'"}s TOTP authenticator and revoke all active
            sessions. The user will need to re-enroll MFA on next sign-in.
          </p>
        </div>
        {state.phase === "error" && state.error && (
          <p className="text-[10px] text-red-500 leading-tight max-w-[280px]">{state.error}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <form action={formAction}>
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={isPending}
              className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              {isPending ? "Resetting…" : "Confirm reset"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs font-medium text-stone-400 hover:text-amber-600 transition-colors"
    >
      Reset MFA enrollment
    </button>
  );
}
