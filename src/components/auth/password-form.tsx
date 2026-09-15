"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/idp-client";
import type { UserRole } from "@/lib/types";
import { ApiError } from "@/lib/ui-api";

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
        if (outcome.sessionId) {
          onMfaEnrollmentRequired(outcome.sessionId);
        } else {
          // OSS path: MFA enrollment is required, but the backend did not open
          // a pending enrollment session. Show a distinct, accurate message —
          // not "Invalid credentials."
          setServerError(
            "Two-factor authentication enrollment is required before you can sign in. Please contact your administrator to set up an authenticator app."
          );
        }
        return;
      }

      if (outcome.kind === "mfa_required") {
        onMfaRequired(outcome.sessionId);
        return;
      }

      onSuccess(outcome.role);
    } catch (err) {
      if (err instanceof ApiError && err.message === "AUTH_POLICY_BLOCKS_LOCAL_LOGIN") {
        // D-1: the organization's auth_policy=idp_only blocks NON-admin local
        // login. The backend allows site_admin/org_admin credential flows
        // through (they never reach this branch), so this only fires for a
        // regular org_user. Mirror the IDP HTML surface's honest copy rather
        // than the misleading "Invalid credentials." — the password was fine,
        // local sign-in is simply unavailable for this org. The decision is
        // the backend's; the UI performs NO client-side role/policy logic.
        setServerError(
          "Local sign-in is not available for this organization. Please contact your administrator."
        );
      } else if (err instanceof ApiError && err.status === 401) {
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

      {/* THE-SIX-SMALL-ONES, UI 2 (2026-09-16): announced as an alert, so a
          screen reader hears the refusal and the e2e helpers can match the
          role scoped to this form rather than a styling class. */}
      {serverError && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
