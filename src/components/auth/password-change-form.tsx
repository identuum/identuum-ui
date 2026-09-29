"use client";

/**
 * OSS-FIN-1 (owner ruling D-017): the first sign-in of a user whose password
 * an administrator set. The password was proven; the user chooses their own
 * before anything else. On success the sign-in continues exactly as a
 * password sign-in would: MFA enrolment or verification when the
 * organization's policy asks, else the dashboard. No session exists before.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPasswordChange } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";

const schema = z
  .object({
    new_password: z.string().min(1, "Enter a new password"),
    confirm_password: z.string().min(1, "Confirm the new password"),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "The two passwords do not match",
    path: ["confirm_password"],
  });

type FormData = z.infer<typeof schema>;

interface PasswordChangeFormProps {
  sessionId: string;
  onMfaRequired: (sessionId: string) => void;
  onMfaEnrollmentRequired: (sessionId: string) => void;
  onSuccess: (role: UserRole) => void;
  onExpired: () => void;
}

export function PasswordChangeForm({
  sessionId,
  onMfaRequired,
  onMfaEnrollmentRequired,
  onSuccess,
  onExpired,
}: PasswordChangeFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const outcome = await loginPasswordChange(sessionId, data.new_password);
      if (outcome.kind === "mfa_enrollment_required" && outcome.sessionId) {
        onMfaEnrollmentRequired(outcome.sessionId);
      } else if (outcome.kind === "mfa_required") {
        onMfaRequired(outcome.sessionId);
      } else if (outcome.kind === "success") {
        onSuccess(outcome.role);
      } else {
        setServerError("Sign-in failed. Try again.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setServerError(err.message);
      } else if (err instanceof ApiError && err.message === "SESSION_EXPIRED") {
        onExpired();
      } else {
        setServerError("Could not change the password. Try again.");
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      data-testid="password-change-form"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-800">Choose a new password</p>
        <p className="text-xs text-slate-500">
          Your administrator set your password. Choose your own to continue.
        </p>
      </div>
      <Input
        id="new_password"
        label="New password"
        type="password"
        autoComplete="new-password"
        autoFocus
        error={errors.new_password?.message}
        {...register("new_password")}
      />
      <Input
        id="confirm_password"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm_password?.message}
        {...register("confirm_password")}
      />
      {serverError && (
        <div
          role="alert"
          data-testid="login-error"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Change password and continue
      </Button>
    </form>
  );
}
