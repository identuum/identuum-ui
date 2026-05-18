"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mfaLogin } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  code: z
    .string()
    .length(6, "Code must be exactly 6 digits")
    .regex(/^\d+$/, "Code must contain only digits"),
});

type FormData = z.infer<typeof schema>;

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
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const result = await mfaLogin(sessionId, data.code);
      onSuccess(result.role);
    } catch (err) {
      if (err instanceof ApiError && err.message === "SESSION_EXPIRED") {
        window.location.href = "/login?reason=session_expired";
        return;
      }
      setServerError("Invalid verification code. Try again.");
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
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          id="mfa-code"
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
          Verify
        </Button>
      </form>
    </div>
  );
}
