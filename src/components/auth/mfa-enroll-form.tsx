"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mfaEnrollComplete, mfaEnrollInitiate } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  code: z
    .string()
    .length(6, "Code must be exactly 6 digits")
    .regex(/^\d+$/, "Code must contain only digits"),
});

type FormData = z.infer<typeof schema>;

type Phase = "loading" | "display" | "error";

interface MFAEnrollFormProps {
  sessionId: string;
  onBack: () => void;
  onSuccess: (role: UserRole) => void;
}

/**
 * MFAEnrollForm handles first-login TOTP enrollment for users who are required
 * to configure an authenticator app — both admin accounts (mandatory) and
 * org_user accounts when the org MFA policy is "required". It fetches the
 * provisioning data on mount, displays a QR code and the raw secret as a
 * fallback, then verifies the code the user enters.
 *
 * SECURITY: secret and otpauthUrl are kept only in component state —
 * they are never written to localStorage, sessionStorage, or the URL.
 */
export function MFAEnrollForm({ sessionId, onBack, onSuccess }: MFAEnrollFormProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  // SECURITY: kept exclusively in component state — never persisted.
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    let cancelled = false;
    mfaEnrollInitiate(sessionId)
      .then((data) => {
        if (cancelled) return;
        setSecret(data.secret);
        setOtpauthUrl(data.otpauthUrl);
        setPhase("display");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const result = await mfaEnrollComplete(sessionId, data.code);
      onSuccess(result.role);
    } catch (err) {
      if (err instanceof ApiError && err.message === "SESSION_EXPIRED") {
        window.location.href = "/login?reason=session_expired";
        return;
      }
      setServerError("Invalid verification code. Try again.");
    }
  };

  if (phase === "loading") {
    return (
      <div className="space-y-5">
        <p className="text-sm text-slate-500 text-center">Setting up two-factor authentication…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-5">
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Setup session expired. Please{" "}
          <a href="/login" className="underline hover:text-red-900">
            sign in again
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sign in
      </button>

      <div>
        <h3 className="text-sm font-semibold text-slate-700">Set up two-factor authentication</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Your organization requires two-factor authentication before you can continue.
        </p>
      </div>

      {/* QR code — primary enrollment method */}
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <QRCodeSVG value={otpauthUrl} size={192} />
        </div>
        <p className="text-sm text-slate-600 text-center">
          Scan this QR code with your authenticator app.
        </p>
      </div>

      {/* Manual fallback — visually secondary */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500 text-center">
          Can&apos;t scan it? Enter the key manually.
        </p>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Secret key</p>
          <code className="block w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 break-all select-all">
            {secret}
          </code>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-600 select-none">
            Show provisioning URL
          </summary>
          <div className="mt-1.5 space-y-1">
            <textarea
              readOnly
              value={otpauthUrl}
              rows={3}
              className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 resize-none focus:outline-none"
            />
            <p className="text-slate-400">
              Paste this URL into an app that supports otpauth:// URIs.
            </p>
          </div>
        </details>
      </div>

      {/* Verification */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          id="enroll-code"
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          autoFocus
          className="tracking-[0.4em] font-mono text-center text-base"
          error={errors.code?.message}
          {...register("code")}
        />

        {serverError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Verify and sign in
        </Button>
      </form>
    </div>
  );
}
