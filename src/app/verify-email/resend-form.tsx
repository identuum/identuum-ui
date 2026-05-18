"use client";

import { useActionState } from "react";
import { type ResendState, resendVerificationAction } from "./actions";

const initialState: ResendState = { phase: "idle" };

/**
 * Resend-verification form rendered inside the invalid/error states of /verify-email.
 *
 * Security:
 *   - Submission always shows the same generic message regardless of whether the
 *     email exists — preserves the anti-enumeration property of the backend.
 *   - No token or link is shown in the UI.
 *   - No email address is stored beyond the form field lifetime.
 */
export function ResendVerificationForm() {
  const [state, action, isPending] = useActionState(resendVerificationAction, initialState);

  if (state.phase === "sent") {
    return (
      <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
        <p className="text-sm text-sky-700 leading-relaxed">
          If that email is eligible, we sent a new verification link. Check your inbox.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <label htmlFor="resend-email" className="block text-sm font-medium text-stone-600">
        Request a new link
      </label>
      <input
        id="resend-email"
        type="email"
        name="email"
        required
        placeholder="your@email.com"
        autoComplete="email"
        className={
          "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm " +
          "text-sky-950 font-medium placeholder:text-stone-400 " +
          "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
        }
      />
      <button
        type="submit"
        disabled={isPending}
        className={
          "w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white " +
          "bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        }
      >
        {isPending ? "Sending…" : "Send new link"}
      </button>
    </form>
  );
}
