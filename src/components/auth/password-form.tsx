"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  password: z.string().min(1, "Password is required"),
  remember_me: z.boolean(),
});

type FormData = z.infer<typeof schema>;

interface PasswordFormProps {
  email: string;
  orgSlug?: string;
  onMfaRequired: (sessionId: string) => void;
  onMfaEnrollmentRequired: (sessionId: string) => void;
  onSuccess: (role: UserRole) => void;
}

export function PasswordForm({
  email,
  orgSlug,
  onMfaRequired,
  onMfaEnrollmentRequired,
  onSuccess,
}: PasswordFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", remember_me: false },
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const outcome = await login({
        email,
        password: data.password,
        remember_me: data.remember_me,
        org_slug: orgSlug,
      });

      if (outcome.kind === "mfa_enrollment_required") {
        onMfaEnrollmentRequired(outcome.sessionId);
        return;
      }

      if (outcome.kind === "mfa_required") {
        onMfaRequired(outcome.sessionId);
        return;
      }

      onSuccess(outcome.role);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError("Invalid credentials.");
      } else {
        setServerError("Login failed. Try again.");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="relative">
        <Input
          id="password"
          label="Password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          autoFocus
          error={errors.password?.message}
          {...register("password")}
        />
        <Lock className="pointer-events-none absolute right-3 top-[34px] h-4 w-4 text-slate-400" />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register("remember_me")}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-600">Remember me</span>
        </label>
        <a
          href="/forgot-password"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Forgot password?
        </a>
      </div>

      {serverError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
