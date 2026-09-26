"use client";

import { useActionState } from "react";
import { type RedeemResetLinkState, redeemResetLinkAction } from "./actions";

const initialState: RedeemResetLinkState = { phase: "form" };

const inputCls =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function ResetLinkFormClient({ rawToken }: { rawToken: string }) {
  const [state, formAction, isPending] = useActionState(redeemResetLinkAction, initialState);

  if (state.phase === "success") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-700 font-semibold">Your password was changed.</p>
        <p className="text-sm text-stone-600 leading-relaxed">
          You were signed out everywhere. Sign in with your new password and your authenticator.
        </p>
        <a
          href="/login"
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in
        </a>
      </div>
    );
  }
  if (state.phase === "invalid") {
    return <ResetLinkInvalid />;
  }
  return (
    <form action={formAction} className="space-y-5 max-w-sm">
      <input type="hidden" name="token" value={rawToken} />
      <div className="space-y-1.5">
        <label htmlFor="rl-new" className="block text-sm font-semibold text-stone-700">
          New password
        </label>
        <input
          id="rl-new"
          name="new_password"
          type="password"
          required
          minLength={12}
          maxLength={72}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rl-confirm" className="block text-sm font-semibold text-stone-700">
          Confirm new password
        </label>
        <input
          id="rl-confirm"
          name="confirm_password"
          type="password"
          required
          minLength={12}
          maxLength={72}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export function ResetLinkInvalid() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600 leading-relaxed">
        This reset link is no longer valid: it was used, it expired, or a newer one replaced it.
      </p>
      <p className="text-sm text-stone-600 leading-relaxed">
        Ask your administrator for a new one.
      </p>
      <a href="/login" className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline">
        Back to sign in
      </a>
    </div>
  );
}
