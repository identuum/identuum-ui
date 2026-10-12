"use client";

/**
 * UI-0912-A4 (OSS v0.9.12 C2): "Send verification email" on the member
 * Overview, shown only while the mailbox is not proven and the server can
 * send email. The address is display text only; the action never sends it.
 * "not_configured" hides the button: this server cannot send email.
 */

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { NOT_CONFIGURED_TEXT, sendVerificationMessage } from "@/lib/email-verification";
import { type SendVerificationState, sendVerificationEmailAction } from "./email-actions";

export function SendVerificationEmail({ address }: { address: string }) {
  const [state, formAction, isPending] = useActionState<SendVerificationState, FormData>(
    sendVerificationEmailAction,
    {}
  );

  if (state.outcome === "not_configured") {
    return (
      <p role="status" className="text-xs text-stone-500">
        {NOT_CONFIGURED_TEXT}
      </p>
    );
  }

  const failed = state.outcome !== undefined && state.outcome !== "sent";
  return (
    <form action={formAction} className="space-y-1.5">
      {/* 44 px touch target (UI-0912-A4 Q2, judge ruling b). */}
      <Button type="submit" variant="secondary" size="lg" loading={isPending}>
        Send verification email
      </Button>
      <p className="text-xs text-stone-500">
        We will send a link to {address}. Open it to confirm this mailbox is yours.
      </p>
      <p
        role="status"
        aria-live="polite"
        className={`text-xs ${failed ? "text-amber-700" : "text-sky-700"}`}
      >
        {state.outcome ? sendVerificationMessage(state.outcome, address) : null}
      </p>
    </form>
  );
}
