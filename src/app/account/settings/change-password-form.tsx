"use client";

/**
 * Password-change form for the personal account settings page.
 * Available to site_admin, org_admin, and org_user.
 *
 * Security:
 *   - Passwords are in type="password" fields — never stored in state, URL, or localStorage.
 *   - On success, all sessions are revoked by the backend (including the current one).
 *     useEffect triggers a redirect to /login so the user re-authenticates.
 */

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { type ChangePasswordState, changePasswordAction } from "./actions";

const initialState: ChangePasswordState = { phase: "idle" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function ChangePasswordForm() {
  const [state, action, isPending] = useActionState(changePasswordAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.phase === "success") {
      const t = setTimeout(() => router.replace("/login"), 2500);
      return () => clearTimeout(t);
    }
  }, [state.phase, router]);

  if (state.phase === "success") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-700">Password changed successfully.</p>
          <p className="text-xs text-stone-500 mt-1">
            {/* R2 (session revocation on password change) is an OPEN backend
                decision — the OSS IdP does not revoke sessions here, so this
                copy must not claim it does. */}
            Use your new password the next time you sign in. Redirecting…
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex items-center text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Sign in now →
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5 max-w-md">
      {state.phase === "error" && state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="current_password" className="block text-sm font-semibold text-stone-700">
          Current password <span className="text-red-500">*</span>
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="new_password" className="block text-sm font-semibold text-stone-700">
          New password <span className="text-red-500">*</span>
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm_password" className="block text-sm font-semibold text-stone-700">
          Confirm new password <span className="text-red-500">*</span>
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
        {state.phase === "error" && state.fieldErrors?.confirmPassword && (
          <p className="text-xs text-red-600">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>

      <Button type="submit" loading={isPending} size="md">
        {isPending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
