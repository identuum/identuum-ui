"use client";

/**
 * /activate — set-password form + MFA-enrollment chaining.
 *
 * Phases (mirrors /claim's shape):
 *   form       — password + confirm; token travels in a hidden field only.
 *   mfa_setup  — activation consumed; a pending login session was opened
 *                server-side and MFAEnrollForm finishes the mandatory
 *                enrollment (org_admins are always MFA-required).
 *   success    — fallback when the pending session could not be opened;
 *                the admin signs in manually and the login flow forces
 *                the same enrollment.
 *
 * The password is posted to the server action once and never held in
 * client state; the activation token is never placed in storage.
 */

import { useActionState, useState } from "react";
import { MFAEnrollForm } from "@/components/auth/mfa-enroll-form";
import { Button } from "@/components/ui/button";
import { type ActivateState, completeActivationAction } from "./actions";

const initialState: ActivateState = { phase: "form" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function ActivateFormClient({
  rawToken,
  adminEmail,
}: {
  rawToken: string;
  adminEmail: string;
}) {
  const [state, action, isPending] = useActionState(completeActivationAction, initialState);
  const [mfaCompleted, setMfaCompleted] = useState(false);

  if (mfaCompleted) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">You&apos;re all set</h2>
        <p className="text-sm text-stone-500 leading-relaxed">
          Your organization is active and two-factor authentication is enrolled. Sign in to open
          your admin console.
        </p>
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Sign in
        </a>
      </div>
    );
  }

  if (state.phase === "mfa_setup") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-sm font-semibold text-sky-900">Organization activated</p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed">
            Two-factor authentication is required before administrator access. Set up an
            authenticator app now to finish.
          </p>
        </div>
        <MFAEnrollForm
          sessionId={state.sessionId}
          // The activation is already consumed; "back" cannot rewind it.
          // /login resumes the same enrollment via the regular login flow.
          onBack={() => {
            window.location.href = "/login?reason=mfa_setup_required";
          }}
          onSuccess={() => {
            setMfaCompleted(true);
          }}
        />
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">Organization activated</h2>
        <p className="text-sm text-stone-500 leading-relaxed">
          Your password is set and your organization is active. Sign in to continue — you will be
          guided through two-factor enrollment on your first login.
        </p>
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  if (state.phase === "invalid") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">
          {state.alreadyActive ? "Organization already activated" : "Link invalid or expired"}
        </h2>
        <p className="text-sm text-stone-500 leading-relaxed">
          {state.alreadyActive
            ? "This organization has already been activated. Sign in with your credentials instead."
            : "This activation link is invalid, has already been used, or has expired. Ask your site administrator to re-issue the activation token."}
        </p>
        <a
          href="/login"
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in →
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={rawToken} />

      <div className="space-y-1">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">
          Activate your organization
        </h2>
        <p className="text-sm text-stone-500 leading-relaxed">
          Set the administrator password to activate your organization.
        </p>
      </div>

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="activate-email" className="block text-sm font-semibold text-stone-700">
          Administrator email
        </label>
        <input
          id="activate-email"
          type="email"
          value={adminEmail}
          readOnly
          disabled
          className={`${inputClass} opacity-70 cursor-not-allowed`}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="activate-password" className="block text-sm font-semibold text-stone-700">
          Password
        </label>
        <input
          id="activate-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="activate-confirm" className="block text-sm font-semibold text-stone-700">
          Confirm password
        </label>
        <input
          id="activate-confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <Button type="submit" loading={isPending} disabled={isPending} className="w-full">
        {isPending ? "Activating…" : "Set password and activate"}
      </Button>
    </form>
  );
}
