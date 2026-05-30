"use client";

/**
 * Client form for /reset-password.
 *
 * The token is passed in via a hidden input from the server component
 * (which reads it from the URL query param). It is NEVER stored in
 * localStorage / sessionStorage / any persistent UI state. After submit
 * the action consumes the token and the field is not preserved on the
 * resulting state object.
 *
 * Surfaces:
 *   - form     → new-password + confirm fields.
 *   - success  → terminal "your password has been reset" copy + /login link.
 *   - invalid  → token rejected (expired, used, malformed) → /forgot-password.
 *   - disabled → IDP is not enabled in this deployment.
 */

import { useActionState } from "react";
import { type ResetPasswordState, consumeResetTokenAction } from "./actions";

const initialState: ResetPasswordState = { phase: "form" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-xl border border-red-300 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export interface ResetPasswordFormClientProps {
  /**
   * Raw reset token from the URL query string. Held as a hidden input only;
   * never echoed into rendered text or state.
   */
  rawToken: string;
}

export function ResetPasswordFormClient({ rawToken }: ResetPasswordFormClientProps) {
  const [state, action, isPending] = useActionState(consumeResetTokenAction, initialState);

  if (state.phase === "disabled") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-4">
        <p className="text-sm font-semibold text-sky-950">Password reset unavailable</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          This deployment is not configured with an identity provider that supports email-based
          password reset. Contact your administrator.
        </p>
        <a href="/login" className="mt-3 inline-block text-xs text-sky-600 hover:text-sky-700 underline">
          Back to sign in
        </a>
      </div>
    );
  }

  if (state.phase === "invalid") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-semibold text-amber-800">This reset link is no longer valid</p>
          <p className="text-xs text-amber-700 mt-1 leading-relaxed">
            Reset links expire one hour after they are generated, and each link can be used only
            once. Request a new one to continue.
          </p>
        </div>
        <a
          href="/forgot-password"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Request a new reset link
        </a>
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">Password reset</p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed">
            Your password has been updated. Sign in with your new password to continue. All other
            active sessions for your account were revoked as part of the reset.
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5 max-w-sm">
      {/* Hidden token — server action consumes and never echoes back. */}
      <input type="hidden" name="token" value={rawToken} />

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="new-password" className="block text-sm font-semibold text-stone-700">
          New password
        </label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          required
          minLength={8}
          maxLength={255}
          autoComplete="new-password"
          className={state.fieldErrors?.newPassword ? inputErrorClass : inputClass}
        />
        {state.fieldErrors?.newPassword && (
          <p className="text-xs text-red-600">{state.fieldErrors.newPassword}</p>
        )}
        <p className="text-xs text-stone-400 leading-relaxed">
          Choose a password you have not used on this account before. Minimum 8 characters; mixed
          character types are recommended.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm-password" className="block text-sm font-semibold text-stone-700">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          maxLength={255}
          autoComplete="new-password"
          className={state.fieldErrors?.confirmPassword ? inputErrorClass : inputClass}
        />
        {state.fieldErrors?.confirmPassword && (
          <p className="text-xs text-red-600">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Updating…" : "Update password"}
        </button>
        <a
          href="/login"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Back to sign in
        </a>
      </div>
    </form>
  );
}
