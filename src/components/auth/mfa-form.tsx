"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginWaitMessage, mfaLogin } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";

/**
 * The code the field takes: the 6 digits of the authenticator app, or one of
 * the recovery codes (16 characters of A-Z and 2-7), which sign in once each
 * (identuum-idp-oss v0.9.6, FUNC-H3). A recovery code is sent as shown on the
 * recovery-codes page: upper case, spaces and dashes removed.
 */
export function normalizeSignInCode(raw: string): string {
  const compact = raw.replace(/[\s-]/g, "");
  return /^\d+$/.test(compact) ? compact : compact.toUpperCase();
}

const schema = z.object({
  code: z
    .string()
    .transform(normalizeSignInCode)
    .refine(
      (c) => /^\d{6}$/.test(c) || /^[A-Z2-7]{16}$/.test(c),
      "Enter the 6-digit code or a 16-character recovery code"
    ),
});

type FormData = z.input<typeof schema>;

/**
 * The message a failed code submit shows. A 429 is a wait, not a wrong code:
 * saying "Invalid verification code" there sends the user to retype a correct
 * code into the same limit (SMALL-FIXES-2). login_throttled says how long
 * (FUNC-M3); the per-route request limit does not.
 */
export function mfaLoginErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.message === "LOGIN_THROTTLED") {
    return loginWaitMessage(err);
  }
  if (err instanceof ApiError && err.status === 429) {
    return "Too many attempts. Wait a minute, then enter a new code.";
  }
  return "Invalid verification code. Try again.";
}

interface MFAFormProps {
  sessionId: string;
  onBack: () => void;
  onSuccess: (role: UserRole) => void;
}

export function MFAForm({ sessionId, onBack, onSuccess }: MFAFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: z.output<typeof schema>) => {
    setServerError(null);
    try {
      const result = await mfaLogin(sessionId, data.code);
      onSuccess(result.role);
    } catch (err) {
      if (err instanceof ApiError && err.message === "SESSION_EXPIRED") {
        window.location.href = "/login?reason=session_expired";
        return;
      }
      setServerError(mfaLoginErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to password
      </button>

      <div>
        <h3 className="text-sm font-semibold text-slate-700">Two-factor authentication</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Enter the 6-digit code from your authenticator app. Without it, enter one of your recovery
          codes; each works once.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          id="mfa-code"
          label="Verification code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={24}
          placeholder="000000"
          autoFocus
          className="tracking-[0.4em] font-mono text-center text-base"
          error={errors.code?.message}
          {...register("code")}
        />

        {/* OSS-HARDEN (2026-10-01): announced as an alert, like the password
            step's, so the e2e helper reads the role scoped to this form. */}
        {serverError && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Verify
        </Button>
      </form>
    </div>
  );
}
