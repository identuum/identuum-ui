"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  type ResetAdminMFAActionState,
  resetAdminMFAAction,
} from "./reset-admin-mfa-actions";

interface ResetAdminMFAButtonProps {
  orgId: string;
  userId: string;
  email: string;
  /**
   * Disabled when the row represents a deleted/banned admin or when the
   * row's MFA is already cleared. We still render the row but suppress
   * the button so the operator does not generate a no-op audit event.
   */
  disabled?: boolean;
  /** Override tooltip when disabled, surfaced via aria-label. */
  disabledReason?: string;
}

const initialState: ResetAdminMFAActionState = {};

/**
 * Renders the "Reset MFA" button + confirmation dialog for a single
 * org_admin row on the site-admin organization detail page.
 *
 * The dialog is intentionally minimal: clear destructive copy, an
 * inline error region, and a single primary confirm action. The
 * underlying server action handles authentication, calls the IDP, and
 * revalidates the page on success so the row's MFA badge re-renders
 * as "Disabled".
 *
 * Surface contract: never display the new TOTP secret, recovery URL,
 * cookies, or any other credential material. Success state simply
 * confirms that the reset landed.
 */
export function ResetAdminMFAButton({
  orgId,
  userId,
  email,
  disabled,
  disabledReason,
}: ResetAdminMFAButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(resetAdminMFAAction, initialState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Focus the confirm button when the dialog opens — keyboard users
  // should not have to tab past the modal scrim to reach the action.
  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  // When the action succeeds, surface a short-lived success banner and
  // close the modal. We do not auto-clear the banner; the page is
  // refreshed by the server action via revalidatePath so the next
  // navigation/full reload will reset the inline state cleanly.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setShowSuccess(true);
    }
  }, [state.ok]);

  // Esc closes the dialog (but only when no submission is in-flight, so
  // we don't strand the operator mid-request).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={disabled ? (disabledReason ?? "Reset MFA disabled") : `Reset MFA for ${email}`}
        title={disabled ? disabledReason : undefined}
        className="text-xs font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-amber-700 disabled:hover:bg-amber-50"
      >
        Reset MFA
      </button>

      {showSuccess && (
        <p
          role="status"
          className="ml-2 inline-flex items-center text-[10px] font-semibold text-emerald-700"
        >
          MFA reset
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          // Click-outside-to-close, but not while a reset is in-flight.
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) {
              setOpen(false);
            }
          }}
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handler lives on window via useEffect
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-mfa-dialog-title"
            className="bg-white rounded-[1.5rem] shadow-xl border border-stone-200 max-w-md w-full p-6 space-y-4"
          >
            <h2
              id="reset-mfa-dialog-title"
              className="text-base font-bold text-sky-950 tracking-tight"
            >
              Reset MFA
            </h2>

            <p className="text-sm text-stone-600 leading-relaxed">
              Reset MFA for{" "}
              <span className="font-mono font-semibold text-sky-950">{email}</span>? This will
              revoke active sessions. The administrator must sign in again and enroll a new
              authenticator.
            </p>

            <p className="text-xs text-stone-400 leading-relaxed">
              This action is logged in the audit trail. It cannot be undone — but the administrator
              can immediately re-enroll a new authenticator from the login flow.
            </p>

            {state.error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                {state.error}
              </div>
            )}

            <form action={action} className="flex items-center justify-end gap-2 pt-1">
              <input type="hidden" name="user_id" value={userId} />
              <input type="hidden" name="org_id" value={orgId} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="text-sm font-medium text-stone-500 hover:text-sky-950 transition-colors px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl h-8 px-3 text-xs font-semibold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending && (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                {isPending ? "Resetting…" : "Reset MFA"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
