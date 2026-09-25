/**
 * Public org-admin claim/setup page.
 *
 * Accessed via the one-time URL: /claim?token=...
 *
 * This page is NOT behind the site-admin auth guard. It is intended for the
 * prospective org_admin who received a claim link from their site_admin.
 *
 * Flow:
 *   1. Server reads ?token from query params (read-once, not stored anywhere).
 *   2. Server validates the token against the backend validate endpoint.
 *   3. If valid, renders the setup form with pre-filled email (read-only).
 *   4. User sets password (and optional display name).
 *   5. On submit, server action POSTs to IdP claim endpoint.
 *   6. On success the claim itself creates no session: the action signs in
 *      with the new password, and an org_admin without a factor enrols TOTP
 *      right here (the login enrolment pair), then lands on /org-admin.
 *
 * Backend notes (the same contract on identuum-idp-oss and, since CE-UI-2a,
 * identuum-idp-ce):
 *   - validate: GET /api/v1/auth/claim/validate?token=... → always HTTP 200
 *   - consume:  POST /api/v1/auth/claim → always HTTP 200 (oracle-hardened)
 *   - No session cookie is created by the claim.
 *   - Token is one-time-use, bound to target_email, expires in 48h.
 *   - The page's URL carries the token: Referrer-Policy no-referrer (below,
 *     and from CE's server) keeps it out of every Referer header.
 */

import type { Metadata } from "next";
import { validateClaimToken } from "./actions";
import { ClaimFormClient } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account Setup — Identuum", referrer: "no-referrer" };

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Read token once from query param; token stays in server-side only.
  const rawParam = params.token;
  const rawToken = typeof rawParam === "string" ? rawParam.trim() : "";

  // No token → show invalid link state immediately without calling backend.
  if (!rawToken) {
    return (
      <ClaimLayout>
        <InvalidLink reason="missing" />
      </ClaimLayout>
    );
  }

  // Validate token server-side before rendering the form.
  const validation = await validateClaimToken(rawToken);

  if (!validation.valid) {
    return (
      <ClaimLayout>
        <InvalidLink reason="invalid" />
      </ClaimLayout>
    );
  }

  return (
    <ClaimLayout>
      <ClaimFormClient
        rawToken={rawToken}
        targetEmail={validation.targetEmail ?? ""}
        organizationName={validation.organizationName ?? ""}
        emailBound={typeof validation.targetEmail === "string" && validation.targetEmail.length > 0}
      />
    </ClaimLayout>
  );
}

// ── Shared layout wrapper (brand visual language) ─────────────────────────────

function ClaimLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient blobs — matches login page style */}
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

// ── Invalid / expired link state ──────────────────────────────────────────────

function InvalidLink({ reason }: { reason: "missing" | "invalid" }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-sky-950 tracking-tight">
        {reason === "missing" ? "No setup link provided" : "Link invalid or expired"}
      </h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        {reason === "missing"
          ? "This page requires a one-time setup link. Check your email for an invitation from your administrator."
          : "This setup link is invalid, has already been used, or has expired. One-time links are valid for 48 hours."}
      </p>
      <p className="text-sm text-stone-500 leading-relaxed">
        If you believe this is an error, contact your administrator and ask them to generate a new
        setup link.
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
