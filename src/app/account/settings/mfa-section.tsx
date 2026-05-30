/**
 * MFA section for /account/settings — server component.
 *
 * Renders one of three states based on the authoritative `mfa_enabled` value
 * projected by the IDP `/api/v1/validate` response (see UI-FEATURES.md
 * Section 7). The section is shown when the operator either explicitly
 * requested the MFA tab (`?tab=mfa`) or was redirected here by an admin
 * gate (`?reason=mfa_required` — see UI-FEATURES.md Section 6).
 *
 * Enrollment is driven IN-PLACE for `mfa_enabled=false`. The
 * AccountMFAEnrollForm client component calls the authenticated
 * `/api/v1/mfa/setup/{initiate,complete}` endpoints. The IdP refuses to
 * re-issue a secret for an already-enrolled user (ErrMFAAlreadyEnrolled →
 * HTTP 409); the form surfaces that branch with operator-facing copy.
 *
 * The login-flow's `MFAEnrollForm` continues to drive enrollment for
 * pending-session ceremonies (Section 4). That code path is unchanged.
 *
 * Security:
 *   - The status surfaces (`mfa_enabled === true`, `mfa_enabled ===
 *     undefined`) never render secret material.
 *   - The enrollment surface (`mfa_enabled === false`) renders TOTP secret
 *     material only inside `AccountMFAEnrollForm`'s component state and
 *     only for the duration of the ceremony. The form clears the secret
 *     on success and never persists it.
 *   - The `mfa_enabled === undefined` branch preserves rolling-upgrade
 *     compatibility — older IDP builds omit the field and the section
 *     renders a neutral "status unavailable" panel rather than forcing the
 *     operator into an enrollment ceremony that may already be complete.
 */
import { AccountMFAEnrollForm } from "./account-mfa-enroll-form";
interface MfaSectionProps {
  /**
   * Authoritative MFA-enrolled flag from the IDP validate response. May be
   * undefined when the IDP build pre-dates the `mfa_enabled` projection
   * (UI-FEATURES.md Section 7) — treat as "unknown", NOT as false.
   */
  mfaEnabled: boolean | undefined;
  /** True when the operator arrived via `?reason=mfa_required` from a gate redirect. */
  reasonMfaRequired: boolean;
}

export function MfaSection({ mfaEnabled, reasonMfaRequired }: MfaSectionProps) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Two-factor authentication</p>
        <p className="text-xs text-stone-400 mt-0.5">
          Time-based one-time passcodes from your authenticator app. Adds a second factor on top
          of your password.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        {reasonMfaRequired && mfaEnabled !== true && (
          <ReasonMfaRequiredBanner />
        )}

        {mfaEnabled === true && <EnrolledStatus />}
        {mfaEnabled === false && <EnrollmentCTA />}
        {mfaEnabled === undefined && <UnknownStatus />}
      </div>
    </div>
  );
}

// ── State surfaces ────────────────────────────────────────────────────────────

function EnrolledStatus() {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold"
      >
        ✓
      </span>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-emerald-700">
          Authenticator app enrolled
        </p>
        <p className="text-xs text-stone-500 leading-relaxed">
          Sign-in requires a code from your authenticator app in addition to your password. No
          further action is needed.
        </p>
        <p className="text-xs text-stone-400 leading-relaxed">
          If you lose access to your authenticator, contact your site administrator. They can
          clear your MFA enrollment so you can register a new device on your next sign-in.
        </p>
      </div>
    </div>
  );
}

function EnrollmentCTA() {
  // The user is authenticated and has no MFA enrolled. Render the
  // in-place enrollment ceremony driven by the authenticated
  // /mfa/setup/{initiate,complete} endpoints. The client form holds the
  // TOTP secret only in component state and clears it as soon as
  // enrollment succeeds.
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold"
        >
          !
        </span>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-amber-700">
            Authenticator app not enrolled
          </p>
          <p className="text-xs text-stone-500 leading-relaxed">
            Your account requires two-factor authentication. Follow the steps below to enroll
            an authenticator app without signing out.
          </p>
          <p className="text-xs text-stone-400 leading-relaxed">
            Changing your password on the Password tab will not enroll an authenticator.
          </p>
        </div>
      </div>

      <div className="pt-2">
        <AccountMFAEnrollForm />
      </div>
    </div>
  );
}

function UnknownStatus() {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold"
      >
        ?
      </span>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-stone-600">
          Authenticator status unavailable
        </p>
        <p className="text-xs text-stone-500 leading-relaxed">
          The current IDP build did not report your MFA enrollment state. If you believe your
          account should already have an authenticator app enrolled, your existing setup is
          unaffected — continue using your authenticator at sign-in as normal.
        </p>
        <p className="text-xs text-stone-400 leading-relaxed">
          Reload the page after upgrading the IDP build to access the in-place enrollment flow.
        </p>
      </div>
    </div>
  );
}

function ReasonMfaRequiredBanner() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs font-semibold text-amber-800">
        Two-factor authentication is required for your role
      </p>
      <p className="text-xs text-amber-700 mt-1 leading-relaxed">
        You were redirected here because your administrator account does not yet have an
        authenticator app enrolled. Follow the instructions below to enroll. This is not a
        password problem — your password is fine.
      </p>
    </div>
  );
}
