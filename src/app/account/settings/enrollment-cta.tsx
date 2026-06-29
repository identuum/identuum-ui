"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountMFAEnrollForm } from "./account-mfa-enroll-form";

/**
 * EnrollmentCTA — client-side wrapper around the in-place TOTP
 * enrollment form for /account/settings?tab=mfa.
 *
 * Fixes the contradictory-state bug landed by
 * agent-a-20260740-idp-ui-mfa-enrollment-state-done-button: prior to
 * this component, the parent MfaSection unconditionally rendered the
 * "Authenticator app not enrolled" warning whenever the server-side
 * mfa_enabled prop was false, while the child AccountMFAEnrollForm
 * could independently flip into its own "success" phase showing
 * "Authenticator app enrolled" + recovery codes. The result was two
 * mutually-contradictory status banners visible at the same time.
 *
 * State machine — exactly one primary surface visible at a time:
 *
 *   - enrollmentJustCompleted === false → render the not-enrolled
 *     warning + the enrollment form (loading / display / error /
 *     already_enrolled / success sub-phases the form owns internally).
 *   - enrollmentJustCompleted === true  → suppress the not-enrolled
 *     warning. The form is in its "success" sub-phase showing the
 *     enrolled banner + recovery codes + Done button. Clicking Done
 *     calls router.refresh() to re-fetch the server tree; the page
 *     re-renders with mfa_enabled=true, which switches MfaSection to
 *     the EnrolledStatus branch and this component unmounts.
 *
 * Security:
 *   - This component holds NO secret material. The TOTP secret +
 *     otpauth URI + recovery codes live inside AccountMFAEnrollForm's
 *     component state only.
 *   - The local enrollmentJustCompleted flag is a boolean only; it
 *     leaks no enrollment-state information beyond what the server
 *     would re-project on the next router.refresh().
 *   - router.refresh() goes through the standard Next.js App Router
 *     pipeline, which re-runs the authenticated server fetch for
 *     /api/v1/me/mfa/status. No client-side caching of MFA state is
 *     introduced.
 */
export function EnrollmentCTA() {
  const [enrollmentJustCompleted, setEnrollmentJustCompleted] = useState(false);
  const router = useRouter();

  return (
    <div className="space-y-3">
      {!enrollmentJustCompleted && <NotEnrolledNotice />}

      <div className="pt-2">
        <AccountMFAEnrollForm
          onSuccess={() => setEnrollmentJustCompleted(true)}
          onDone={() => router.refresh()}
        />
      </div>
    </div>
  );
}

function NotEnrolledNotice() {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold"
      >
        !
      </span>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-amber-700">Authenticator app not enrolled</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          Your account requires two-factor authentication. Follow the steps below to enroll an
          authenticator app without signing out.
        </p>
        <p className="text-xs text-stone-400 leading-relaxed">
          Changing your password on the Password tab will not enroll an authenticator.
        </p>
      </div>
    </div>
  );
}
