"use client";

/**
 * UI-0912-A4 (OSS v0.9.12 C2): "Send verification email" on the member
 * Overview, shown only while the mailbox is not proven and the server can
 * send email. The address is display text only; the action never sends it.
 * "not_configured" hides the button: this server cannot send email.
 *
 * UI-0913-A (U3): one live region carries every answer, so the "cannot send"
 * line is announced too; it does not repeat the "Not verified yet" badge, and
 * focus moves to it because the button it replaces is gone.
 */

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CANNOT_SEND_TEXT, sendVerificationMessage } from "@/lib/email-verification";
import { type SendVerificationState, sendVerificationEmailAction } from "./email-actions";

export function SendVerificationEmail({ address }: { address: string }) {
  const [state, formAction, isPending] = useActionState<SendVerificationState, FormData>(
    sendVerificationEmailAction,
    {}
  );
  const statusRef = useRef<HTMLParagraphElement>(null);
  const notConfigured = state.outcome === "not_configured";

  useEffect(() => {
    if (notConfigured) statusRef.current?.focus();
  }, [notConfigured]);

  const failed = state.outcome !== undefined && state.outcome !== "sent";
  return (
    <form action={formAction} className="space-y-1.5">
      {!notConfigured && (
        <>
          {/* 44 px touch target (UI-0912-A4 Q2, judge ruling b). */}
          <Button type="submit" variant="secondary" size="lg" loading={isPending}>
            Send verification email
          </Button>
          <p className="text-xs text-stone-500">
            We will send a link to {address}. Open it to confirm this mailbox is yours.
          </p>
        </>
      )}
      <p
        ref={statusRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className={`text-xs focus:outline-none ${
          notConfigured ? "text-stone-500" : failed ? "text-amber-700" : "text-sky-700"
        }`}
      >
        {notConfigured
          ? CANNOT_SEND_TEXT
          : state.outcome
            ? sendVerificationMessage(state.outcome, address)
            : null}
      </p>
    </form>
  );
}
