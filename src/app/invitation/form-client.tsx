"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type ConsumeInvitationState, consumeInvitationAction } from "./actions";

interface InvitationFormClientProps {
  rawToken: string;
  /** Pre-set email when emailBound=true. Empty string when no email was bound. */
  targetEmail: string;
  /** Pre-set display name if the org_admin specified one. */
  targetName: string;
  /**
   * true  → email was bound at invitation time; field is read-only.
   * false → no email; user must enter their own.
   */
  emailBound: boolean;
}

const initialState: ConsumeInvitationState = { phase: "form" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-xl border border-red-300 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function InvitationFormClient({
  rawToken,
  targetEmail,
  emailBound,
}: InvitationFormClientProps) {
  const [state, action, isPending] = useActionState(consumeInvitationAction, initialState);

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">Account set up successfully</p>
          <p className="text-xs text-stone-500 mt-1">
            Your account is ready. The setup link has been used and cannot be reused.
          </p>
        </div>
        <p className="text-sm text-stone-500 leading-relaxed">
          You can now sign in with your email and the password you just set.
        </p>
        <div className="pt-1">
          <a
            href="/login"
            className="inline-flex items-center justify-center w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
          >
            Sign in →
          </a>
        </div>
      </div>
    );
  }

  if (state.phase === "invalid") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-semibold text-amber-700">Setup link no longer valid</p>
          <p className="text-xs text-stone-500 mt-1">
            {state.error ??
              "This link is invalid, expired, or has already been used. Please request a new one."}
          </p>
        </div>
        <div className="pt-1">
          <a
            href="/login"
            className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
          >
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={rawToken} />

      <div className="space-y-1">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">Set up your account</h2>
        <p className="text-sm text-stone-500">Choose a password to activate your account.</p>
      </div>

      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="inv-email" className="block text-sm font-semibold text-stone-700">
          Email address {!emailBound && <span className="text-red-500">*</span>}
        </label>
        {emailBound ? (
          <input
            id="inv-email"
            name="email"
            type="email"
            defaultValue={targetEmail}
            readOnly
            className={`${inputClass} cursor-default opacity-75`}
          />
        ) : (
          <input
            id="inv-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={state.fieldErrors?.email ? inputErrorClass : inputClass}
          />
        )}
        {emailBound && (
          <p className="text-xs text-stone-400">
            This email is bound to your invitation link and cannot be changed.
          </p>
        )}
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-600">{state.fieldErrors.email}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label htmlFor="inv-password" className="block text-sm font-semibold text-stone-700">
          Password <span className="text-red-500">*</span>
        </label>
        <input
          id="inv-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Choose a strong password"
          className={state.fieldErrors?.password ? inputErrorClass : inputClass}
        />
        <p className="text-xs text-stone-400">
          Must meet your organization&apos;s password policy.
        </p>
        {state.fieldErrors?.password && (
          <p className="text-xs text-red-600">{state.fieldErrors.password}</p>
        )}
      </div>

      {/* Confirm password */}
      <div className="space-y-1.5">
        <label htmlFor="inv-confirm" className="block text-sm font-semibold text-stone-700">
          Confirm password <span className="text-red-500">*</span>
        </label>
        <input
          id="inv-confirm"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Re-enter your password"
          className={state.fieldErrors?.confirmPassword ? inputErrorClass : inputClass}
        />
        {state.fieldErrors?.confirmPassword && (
          <p className="text-xs text-red-600">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>

      <div className="pt-1">
        <Button type="submit" className="w-full" size="lg" loading={isPending} disabled={isPending}>
          {isPending ? "Setting up…" : "Set up account"}
        </Button>
      </div>

      <p className="text-xs text-stone-400 text-center leading-relaxed">
        This link can only be used once. After setup you can sign in at{" "}
        <a href="/login" className="underline">
          /login
        </a>
        .
      </p>
    </form>
  );
}
