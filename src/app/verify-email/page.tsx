/**
 * Public email verification page.
 *
 * Accessed via the one-time URL: /verify-email?token=...
 *
 * This page is NOT behind the site-admin auth guard. It is intended for the
 * user who received an email verification link after registration.
 *
 * Flow:
 *   1. Server reads ?token from query params (read-once, not stored anywhere).
 *   2. If no token: renders a safe "missing link" message.
 *   3. If token present: calls the backend verify endpoint server-side (one-time use).
 *   4. On success: shows a branded success state with a link to /login.
 *   5. On invalid/expired: shows a safe generic error state with a resend form.
 *   6. On unexpected error: shows a generic error state with a resend form.
 *
 * Backend notes:
 *   - verify:  GET  /api/v1/auth/verify-email?token=... → 200 on success, 400 on failure
 *   - resend:  POST /api/v1/auth/resend-verification { email } → always 200 (oracle-hardened)
 *   - Token is one-time use and expires in 24 hours.
 *   - No session is created; the user must sign in via /login after verification.
 *
 * Security:
 *   - Token is read server-side only and never stored in browser state.
 *   - The backend preserves generic 400 responses regardless of failure reason
 *     (oracle-hardened), so this page shows a single "invalid or expired" message.
 *   - The resend action always shows the same generic sent message regardless of
 *     whether the email address is registered (anti-enumeration).
 */

import type { Metadata } from "next";
import { MailCeremonyUnavailable } from "@/components/auth/mail-ceremony-unavailable";
import { mailCeremoniesAvailable } from "@/lib/mail-capabilities";
import { verifyEmailToken } from "./actions";
import { ResendVerificationForm } from "./resend-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email Verification — Identuum" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // CE-UI-2b: no mail, no verification mail; the token is never sent.
  if (!(await mailCeremoniesAvailable())) {
    return <MailCeremonyUnavailable title="Verify email" />;
  }
  const params = await searchParams;
  const rawParam = params.token;
  const rawToken = typeof rawParam === "string" ? rawParam.trim() : "";

  if (!rawToken) {
    return (
      <VerifyEmailLayout>
        <MissingToken />
      </VerifyEmailLayout>
    );
  }

  const result = await verifyEmailToken(rawToken);

  return (
    <VerifyEmailLayout>
      {result.status === "success" ? (
        <Verified />
      ) : result.status === "invalid" ? (
        <InvalidToken />
      ) : (
        <UnexpectedError />
      )}
    </VerifyEmailLayout>
  );
}

// ── Shared layout wrapper (brand visual language) ─────────────────────────────

function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient blobs — matches login/claim page style */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>

        {/* Card */}
        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6">{children}</div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          identuum — identitas tua, in potestate tua
        </p>
      </div>
    </div>
  );
}

// ── Verification states ───────────────────────────────────────────────────────

function Verified() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold">
          ✓
        </span>
        <h2 className="text-lg font-bold text-sky-950 tracking-tight">Email verified</h2>
      </div>
      <p className="text-sm text-stone-500 leading-relaxed">
        Your email address has been verified. You can now sign in to your account.
      </p>
      <div className="pt-2">
        <a
          href="/login"
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in →
        </a>
      </div>
    </div>
  );
}

function MissingToken() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-sky-950 tracking-tight">
        No verification link provided
      </h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        This page requires a one-time verification link. Check your email for a verification message
        from your administrator or the sign-up flow.
      </p>
      <p className="text-sm text-stone-500 leading-relaxed">
        If you believe this is an error, try signing in and requesting a new verification email.
      </p>
      <div className="pt-2">
        <a
          href="/login"
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in →
        </a>
      </div>
    </div>
  );
}

function InvalidToken() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-amber-700 tracking-tight">Link invalid or expired</h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        This verification link is invalid, has already been used, or has expired. Verification links
        are valid for 24 hours and can only be used once.
      </p>
      <ResendVerificationForm />
      <p className="text-sm text-stone-400">
        Already verified?{" "}
        <a href="/login" className="font-semibold text-sky-600 hover:text-sky-700 underline">
          Sign in →
        </a>
      </p>
    </div>
  );
}

function UnexpectedError() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-red-700 tracking-tight">Something went wrong</h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        An unexpected error occurred while verifying your email. You can request a new link below.
      </p>
      <ResendVerificationForm />
      <p className="text-sm text-stone-400">
        <a href="/login" className="font-semibold text-sky-600 hover:text-sky-700 underline">
          Go to sign in →
        </a>
      </p>
    </div>
  );
}
