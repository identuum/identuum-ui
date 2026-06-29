"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AccountMFAAlreadyEnrolledError,
  accountMfaSetupComplete,
  accountMfaSetupInitiate,
} from "@/lib/idp-client";
import { ApiError } from "@/lib/ui-api";
import { zodResolver } from "@hookform/resolvers/zod";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

/**
 * AccountMFAEnrollForm — authenticated, in-place TOTP enrollment surface
 * for /account/settings. Drives the /mfa/setup/{initiate,complete}
 * endpoints. Distinct from the login-flow's MFAEnrollForm, which targets
 * the pending-session /auth/login/mfa/enroll/* endpoints.
 *
 * SECURITY:
 *   - The TOTP secret + otpauth URI returned by `accountMfaSetupInitiate`
 *     are held exclusively in component state. They are never persisted
 *     to localStorage / sessionStorage / URL.
 *   - On a successful page reload the secret cannot be recovered — the
 *     operator must restart enrollment. This is intentional.
 *   - The recovery codes returned by `accountMfaSetupComplete` are also
 *     held only in component state. The operator is responsible for
 *     copying them out-of-band; no copy / no second display path exists.
 *   - When the IdP returns HTTP 409 ErrMFAAlreadyEnrolled, the form
 *     refuses to re-issue a secret and instructs the operator to use
 *     `/mfa/disable` first.
 */

const schema = z.object({
  code: z
    .string()
    .length(6, "Code must be exactly 6 digits")
    .regex(/^\d+$/, "Code must contain only digits"),
});

type FormData = z.infer<typeof schema>;

type Phase = "loading" | "display" | "error" | "already_enrolled" | "success";

export function AccountMFAEnrollForm({
  onSuccess,
  onDone,
}: {
  onSuccess?: () => void;
  /**
   * Invoked when the operator clicks "Done" on the post-enrollment
   * recovery-code panel. The form clears recoveryCodes from component
   * state BEFORE invoking the callback, so the callback can transition
   * the parent into the canonical enrolled state (typically by calling
   * router.refresh()) without re-rendering the codes one last time.
   */
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  // SECURITY: secret, otpauthUrl, recoveryCodes kept ONLY in component state.
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset: resetForm,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  // Fetch a fresh enrollment secret on mount. The effect runs once per
  // mount; reloading the page produces a new ceremony (and overwrites the
  // server-side secret, which is acceptable because the previous one was
  // not yet verified).
  useEffect(() => {
    let cancelled = false;
    accountMfaSetupInitiate()
      .then((data) => {
        if (cancelled) return;
        setSecret(data.secret);
        setOtpauthUrl(data.otpauthUrl);
        setPhase("display");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AccountMFAAlreadyEnrolledError) {
          setPhase("already_enrolled");
          return;
        }
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const { recoveryCodes: codes } = await accountMfaSetupComplete(data.code);
      setRecoveryCodes(codes);
      // Clear secret + otpauthUrl as soon as enrollment succeeds — there
      // is no further use for them, and continuing to hold them in state
      // is needless exposure.
      setSecret("");
      setOtpauthUrl("");
      resetForm();
      setPhase("success");
      onSuccess?.();
    } catch (err) {
      if (err instanceof AccountMFAAlreadyEnrolledError) {
        setPhase("already_enrolled");
        return;
      }
      if (err instanceof ApiError) {
        setServerError("Invalid verification code. Try again.");
        return;
      }
      setServerError("MFA enrollment failed. Try again.");
    }
  };

  if (phase === "loading") {
    return <p className="text-xs text-stone-500">Setting up two-factor authentication…</p>;
  }

  if (phase === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
        <p className="font-semibold">Could not start MFA enrollment.</p>
        <p className="mt-1">
          Reload the page to try again. If the problem persists, contact your administrator.
        </p>
      </div>
    );
  }

  if (phase === "already_enrolled") {
    // Race or stale state: the server reports MFA is already enabled.
    // Direct the operator to the disable path (only valid for org_user;
    // admin roles are blocked by ErrMFARequiredByAdminRole, in which case
    // they must contact site_admin for a reset).
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <p className="font-semibold">MFA is already enrolled on this account.</p>
        <p className="mt-1 text-amber-700">
          To replace your current authenticator, disable MFA from a privileged surface first.
          Administrator accounts cannot disable MFA themselves — contact your site administrator for
          an MFA reset.
        </p>
      </div>
    );
  }

  if (phase === "success") {
    const handleDone = () => {
      // Clear codes from component state FIRST so any synchronous re-
      // render triggered by onDone never sees them again. The parent
      // typically calls router.refresh() in onDone to re-fetch the
      // server state (mfa_enabled=true now) and unmount this form.
      setRecoveryCodes([]);
      onDone?.();
    };
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-700">Authenticator app enrolled</p>
          <p className="text-xs text-emerald-700 mt-1">
            Future sign-ins will require a code from your authenticator app.
          </p>
        </div>

        {recoveryCodes.length > 0 && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-stone-700">Save your recovery codes</p>
            <p className="text-xs text-stone-500 leading-relaxed">
              Each code can be used once if you lose access to your authenticator app. Store them
              somewhere only you can access. They will NOT be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-1 text-xs font-mono text-stone-800 select-all">
              {recoveryCodes.map((c) => (
                <li key={c} className="rounded bg-white border border-stone-200 px-2 py-1">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-1">
          <Button type="button" onClick={handleDone}>
            Done
          </Button>
          <p className="text-xs text-stone-400 mt-2">
            Clicking Done hides the recovery codes and returns to the normal MFA settings view. Make
            sure you have saved the codes above — they will not be shown again.
          </p>
        </div>
      </div>
    );
  }

  // phase === "display" — the ceremony is in progress.
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-sky-950">Step 1 — Scan the QR code</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          Open your authenticator app (e.g. 1Password, Authy, Google Authenticator) and scan the QR
          code below to add this account.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
          <QRCodeSVG value={otpauthUrl} size={168} />
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-stone-500 hover:text-stone-700 select-none">
          Can&apos;t scan? Enter the key manually.
        </summary>
        <div className="mt-2 space-y-1">
          <p className="text-xs font-medium text-stone-600">Secret key</p>
          <code className="block w-full rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-mono text-stone-800 break-all select-all">
            {secret}
          </code>
        </div>
      </details>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 pt-1">
        <div>
          <p className="text-xs font-semibold text-sky-950">Step 2 — Enter the 6-digit code</p>
          <p className="text-xs text-stone-500 mt-1">
            Type the current code from your authenticator app to confirm enrollment.
          </p>
        </div>

        <Input
          id="account-enroll-code"
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="tracking-[0.4em] font-mono text-center text-base"
          error={errors.code?.message}
          {...register("code")}
        />

        {serverError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {serverError}
          </div>
        )}

        <Button type="submit" loading={isSubmitting}>
          Verify and enable MFA
        </Button>
      </form>
    </div>
  );
}
