/**
 * Public user invitation setup page.
 *
 * Accessed via the one-time URL: /invitation?token=...
 *
 * This page is NOT behind any auth guard. It is intended for the person
 * who received an invitation link from their org_admin.
 *
 * Flow:
 *   1. Server reads ?token from query params (read-once, not stored anywhere).
 *   2. If no token: renders a safe "missing link" message.
 *   3. If token present: calls the backend validate endpoint server-side.
 *   4. If valid: renders the setup form (email pre-filled when email-bound).
 *   5. User sets password (and email if not bound).
 *   6. On success: shows a branded success state with a link to /login.
 *
 * Backend notes:
 *   - validate: GET  /api/v1/auth/users/setup/:token → 200 { success, email, name, email_bound }
 *   - consume:  POST /api/v1/auth/users/setup → { token, email, password }
 *   - Token is one-time use and expires in 24 hours.
 *   - No session is created; the user must sign in via /login after setup.
 *
 * Security:
 *   - Token is read server-side only and never stored in browser state.
 *   - Generic 422 responses from the backend are shown as "link invalid or expired".
 */

import type { Metadata } from "next";
import { validateInvitationToken } from "./actions";
import { InvitationFormClient } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account Setup — Identuum" };

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawParam = params.token;
  const rawToken = typeof rawParam === "string" ? rawParam.trim() : "";

  if (!rawToken) {
    return (
      <InvitationLayout>
        <InvalidLink reason="missing" />
      </InvitationLayout>
    );
  }

  const validation = await validateInvitationToken(rawToken);

  if (!validation.valid) {
    return (
      <InvitationLayout>
        <InvalidLink reason="invalid" />
      </InvitationLayout>
    );
  }

  return (
    <InvitationLayout>
      <InvitationFormClient
        rawToken={rawToken}
        targetEmail={validation.email ?? ""}
        targetName={validation.name ?? ""}
        emailBound={validation.emailBound}
      />
    </InvitationLayout>
  );
}

function InvitationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6">{children}</div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          identuum — self-hosted identity platform
        </p>
      </div>
    </div>
  );
}

function InvalidLink({ reason }: { reason: "missing" | "invalid" }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-sky-950 tracking-tight">
        {reason === "missing" ? "No invitation link provided" : "Link invalid or expired"}
      </h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        {reason === "missing"
          ? "This page requires a one-time invitation link. Check your email for an invitation from your administrator."
          : "This invitation link is invalid, has already been used, or has expired. Invitation links are valid for 24 hours and can only be used once."}
      </p>
      <p className="text-sm text-stone-500 leading-relaxed">
        If you believe this is an error, contact your administrator and ask them to generate a new
        invitation link.
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
