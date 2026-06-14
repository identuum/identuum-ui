"use client";

/**
 * Client-side form for the org-admin claim/setup flow.
 *
 * The token is passed as a hidden input from the server component.
 * It is NOT stored in localStorage/sessionStorage and NOT put into any URL.
 *
 * Backend behavior after successful consumption:
 *   - The user account exists and the organisation is active.
 *   - The server action opens a pending MFA-enrollment session and
 *     returns its session_id in state.sessionId. The component then
 *     renders the existing MFAEnrollForm to guide the user through
 *     TOTP setup before any session-bearing tokens are minted.
 *   - On successful MFA enrollment the IdP completes the login and
 *     sets the session cookie; the user is then routed into
 *     /org-admin.
 *   - If opening the pending MFA session failed (network blip), the
 *     component falls back to the legacy "go to /login" success
 *     state — the backend login gate still enforces MFA on the next
 *     login attempt.
 */

import { MFAEnrollForm } from "@/components/auth/mfa-enroll-form";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { type ConsumeClaimState, consumeClaimAction } from "./actions";

interface ClaimFormClientProps {
  /** Raw claim token from server — passed as hidden form field, never logged or stored. */
  rawToken: string;
  /**
   * Email address the claim is bound to. Non-empty only for email-bound tokens.
   * Empty string for no-email tokens — user must enter their email freely.
   */
  targetEmail: string;
  /** Organization name for display only. */
  organizationName: string;
  /**
   * True when the token was generated with a specific recipient email (email-bound).
   * False for out-of-band/no-email tokens — the user chooses their email at setup time.
   */
  emailBound: boolean;
}

const initialState: ConsumeClaimState = { phase: "form" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-xl border border-red-300 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function ClaimFormClient({
  rawToken,
  targetEmail,
  organizationName,
  emailBound,
}: ClaimFormClientProps) {
  const [state, action, isPending] = useActionState(consumeClaimAction, initialState);
  const router = useRouter();
  // mfaCompleted captures the post-enrollment terminal state. Once true,
  // the IdP has issued session-bearing tokens (HttpOnly cookie) and the
  // user can navigate into /org-admin; we render a clear "setup
  // complete" success card and a Continue button.
  const [mfaCompleted, setMfaCompleted] = useState(false);

  // ── MFA setup complete ────────────────────────────────────────────────────

  if (mfaCompleted) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">
            Setup complete — two-factor authentication enrolled
          </p>
          <p className="text-xs text-stone-500 mt-1">
            Your org_admin account{organizationName ? ` for ${organizationName}` : ""} is now fully
            operational. You are signed in.
          </p>
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              router.push("/org-admin");
              router.refresh();
            }}
            className="inline-flex items-center justify-center w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
          >
            Continue to org admin →
          </button>
        </div>
      </div>
    );
  }

  // ── MFA enrollment in-progress (mandatory next step after claim) ──────────

  if (state.phase === "mfa_setup" && state.sessionId) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-sm font-semibold text-sky-900">Account created</p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed">
            Two-factor authentication is required before administrator access. Set up an
            authenticator app now to finish.
          </p>
        </div>
        <MFAEnrollForm
          sessionId={state.sessionId}
          // The pending session is single-use and tied to this browser
          // tab. Routing "back" mid-enrollment cannot rewind the claim
          // (it is already consumed), so the back action sends the user
          // to /login with a clear reason — they can resume by signing
          // in with their new credentials, which will land them in the
          // same enrollment step via the regular login flow.
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

  // ── Legacy success state (post-claim login probe could not be opened) ────
  // Reached only when openPendingMFAEnrollmentSession failed after a
  // successful claim — the backend login gate will still force MFA on
  // the next sign-in attempt.

  if (state.phase === "success") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">Account set up successfully</p>
          <p className="text-xs text-stone-500 mt-1">
            Your org_admin account{organizationName ? ` for ${organizationName}` : ""} is ready.
            Sign in to finish — two-factor authentication setup will start automatically.
          </p>
        </div>
        <p className="text-xs text-stone-400 leading-relaxed">
          Administrator access requires two-factor authentication. The next sign-in step will guide
          you through TOTP setup.
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

  // ── Token exhausted (max attempts burned) ─────────────────────────────────

  if (state.phase === "exhausted") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-sm font-semibold text-red-700">Setup link expired</p>
          <p className="text-xs text-stone-500 mt-1">
            {state.error ??
              "Maximum password attempts reached. This setup link can no longer be used."}
          </p>
        </div>
        <p className="text-sm text-stone-500 leading-relaxed">
          Contact your administrator to request a new setup link.
        </p>
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

  // ── Invalid / consumed token (phase === "invalid") ────────────────────────

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

  // ── Setup form (phase === "form") ─────────────────────────────────────────

  return (
    <form action={action} className="space-y-5">
      {/* Token hidden — never put in URL or storage */}
      <input type="hidden" name="token" value={rawToken} />

      <div className="space-y-1">
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">Set up your account</h2>
        {organizationName && (
          <p className="text-sm text-stone-500">
            You are setting up org_admin access for{" "}
            <span className="font-semibold text-sky-950">{organizationName}</span>.
          </p>
        )}
      </div>

      {/* Global error / policy message */}
      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
          {typeof state.attemptsRemaining === "number" && state.attemptsRemaining > 0 && (
            <p className="text-xs text-red-500 mt-1">
              {state.attemptsRemaining} attempt{state.attemptsRemaining === 1 ? "" : "s"} remaining
              before this link is permanently invalidated.
            </p>
          )}
        </div>
      )}

      {/* Email — read-only when email-bound, editable for no-email tokens */}
      <div className="space-y-1.5">
        <label htmlFor="claim-email" className="block text-sm font-semibold text-stone-700">
          Email address {!emailBound && <span className="text-red-500">*</span>}
        </label>
        {emailBound ? (
          <input
            id="claim-email"
            name="email"
            type="email"
            defaultValue={targetEmail}
            readOnly
            className={`${inputClass} cursor-default opacity-75`}
            aria-describedby="claim-email-hint"
          />
        ) : (
          <input
            id="claim-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="admin@example.com"
            className={state.fieldErrors?.email ? inputErrorClass : inputClass}
            aria-describedby="claim-email-hint"
          />
        )}
        <p id="claim-email-hint" className="text-xs text-stone-400">
          {emailBound
            ? "This email is bound to your setup link and cannot be changed."
            : "Enter the email address for the organization admin account."}
        </p>
        {state.fieldErrors?.email && (
          <p className="text-xs text-red-600">{state.fieldErrors.email}</p>
        )}
      </div>

      {/* Display name (optional) */}
      <div className="space-y-1.5">
        <label htmlFor="claim-name" className="block text-sm font-semibold text-stone-700">
          Display name <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          id="claim-name"
          name="name"
          type="text"
          maxLength={255}
          placeholder="Your name"
          autoComplete="name"
          className={state.fieldErrors?.name ? inputErrorClass : inputClass}
        />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600">{state.fieldErrors.name}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label htmlFor="claim-password" className="block text-sm font-semibold text-stone-700">
          Password <span className="text-red-500">*</span>
        </label>
        <input
          id="claim-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Choose a strong password"
          className={state.fieldErrors?.password ? inputErrorClass : inputClass}
          aria-describedby="claim-password-hint"
        />
        <p id="claim-password-hint" className="text-xs text-stone-400">
          Must meet your organization&apos;s password policy (minimum 8 characters with mixed case,
          numbers, and special characters).
        </p>
        {state.fieldErrors?.password && (
          <p className="text-xs text-red-600">{state.fieldErrors.password}</p>
        )}
      </div>

      {/* Confirm password */}
      <div className="space-y-1.5">
        <label htmlFor="claim-confirm" className="block text-sm font-semibold text-stone-700">
          Confirm password <span className="text-red-500">*</span>
        </label>
        <input
          id="claim-confirm"
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

      {/* Submit */}
      <div className="pt-1">
        <Button type="submit" className="w-full" size="lg" loading={isPending} disabled={isPending}>
          {isPending ? "Setting up account…" : "Set up account"}
        </Button>
      </div>

      <p className="text-xs text-stone-400 text-center leading-relaxed">
        After password setup you will be guided through two-factor authentication enrollment.
        Administrator access requires TOTP. This link can only be used once.
      </p>
    </form>
  );
}
