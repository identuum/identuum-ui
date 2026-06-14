"use client";

/**
 * Client form for /forgot-password. Calls the requestPasswordResetAction
 * server action and renders one of three states:
 *
 *   - form     → email input + submit.
 *   - sent     → generic confirmation copy. Same text whether or not the
 *                email matched an account — see the action header for the
 *                no-enumeration invariant this enforces.
 *   - disabled → IDP not enabled in this deployment.
 *
 * The email field value is held only in the form's submission lifecycle;
 * no localStorage / sessionStorage / URL persistence.
 */

import { useActionState } from "react";
import { type ForgotPasswordState, requestPasswordResetAction } from "./actions";

const initialState: ForgotPasswordState = { phase: "form" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-xl border border-red-300 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function ForgotPasswordFormClient() {
  const [state, action, isPending] = useActionState(requestPasswordResetAction, initialState);

  if (state.phase === "disabled") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-4">
        <p className="text-sm font-semibold text-sky-950">Password reset unavailable</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          This deployment is not configured with an identity provider that supports email-based
          password reset. Contact your administrator.
        </p>
        <a
          href="/login"
          className="mt-3 inline-block text-xs text-sky-600 hover:text-sky-700 underline"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  if (state.phase === "sent") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">Check your inbox</p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed">
            If an account exists for that email address, password reset instructions have been sent.
            The link expires in one hour.
          </p>
          <p className="text-xs text-stone-500 mt-2 leading-relaxed">
            Don&apos;t see it? Check your spam folder, or wait a minute and resubmit the form.
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5 max-w-sm">
      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="forgot-email" className="block text-sm font-semibold text-stone-700">
          Email
        </label>
        <input
          id="forgot-email"
          name="email"
          type="email"
          required
          maxLength={255}
          autoComplete="email"
          placeholder="you@example.com"
          className={state.fieldErrors?.email ? inputErrorClass : inputClass}
        />
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-600">{state.fieldErrors.email}</p>
        )}
        <p className="text-xs text-stone-400 leading-relaxed">
          We&apos;ll send password reset instructions to this email if it matches an account on this
          deployment.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Sending…" : "Send reset link"}
        </button>
        <a href="/login" className="text-sm text-stone-500 hover:text-sky-950 transition-colors">
          Back to sign in
        </a>
      </div>
    </form>
  );
}
