"use client";

/**
 * /invite — set-password form (OSS-ONBOARD-B, D-016). The token travels in a
 * hidden field only; the password is posted once and never held in state. On
 * success the browser goes to sign-in with the invite_accepted notice.
 */

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { type RedeemInviteState, redeemInviteAction } from "./actions";
import { INVITE_ACCEPTED_LOGIN, INVITE_INVALID_COPY } from "./invite-copy";

const initialState: RedeemInviteState = { phase: "form" };

const inputCls =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function InviteFormClient({ rawToken, email }: { rawToken: string; email: string }) {
  const [state, formAction, isPending] = useActionState(redeemInviteAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.phase === "success") router.replace(INVITE_ACCEPTED_LOGIN);
  }, [state.phase, router]);

  if (state.phase === "success") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-700 font-semibold">Your password is set.</p>
        <a
          href={INVITE_ACCEPTED_LOGIN}
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in
        </a>
      </div>
    );
  }
  if (state.phase === "invalid") return <InviteInvalid />;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={rawToken} />
      <div className="space-y-1.5">
        <label htmlFor="invite-email" className="block text-sm font-semibold text-stone-700">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          readOnly
          disabled
          className={`${inputCls} opacity-70 cursor-not-allowed`}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="invite-password" className="block text-sm font-semibold text-stone-700">
          Password
        </label>
        <input
          id="invite-password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="invite-confirm" className="block text-sm font-semibold text-stone-700">
          Confirm password
        </label>
        <input
          id="invite-confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      <ul className="text-xs text-stone-500 leading-relaxed list-disc pl-4 space-y-0.5">
        <li>At least 8 and at most 72 characters.</li>
        <li>
          Your organization may also require an upper-case letter, a lower-case letter, a digit and
          a symbol.
        </li>
      </ul>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={isPending} disabled={isPending} className="w-full">
        {isPending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

export function InviteInvalid() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600 leading-relaxed">{INVITE_INVALID_COPY}</p>
      <a href="/login" className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline">
        Back to sign in
      </a>
    </div>
  );
}
