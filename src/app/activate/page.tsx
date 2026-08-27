/**
 * Public organization-activation page.
 *
 * Accessed via the one-time URL the ACTIVATION EMAIL builds:
 * /activate?token=... (idp-oss smtp_notifier.go linkBaseURL + "/activate").
 * THE-DEAD-ACTIVATE-LINK (2026-08-27): this page did not exist — the
 * pending org_admin's emailed link 404'd on the UI.
 *
 * This page is public (the recipient has no account password yet). It is
 * the ACTIVATION-token ceremony (users.activation_token_hash), distinct
 * from /claim's organization_claims ceremony:
 *   1. Server reads ?token once (never stored client-side).
 *   2. Validates via GET /api/v1/auth/organizations/activate/:token.
 *   3. Renders the set-password form with the admin email read-only.
 *   4. Consume POSTs /api/v1/auth/organizations/activate — sets the real
 *      password AND flips the organization active in one transaction.
 *   5. Chains into mandatory MFA enrollment via a pending login session
 *      (org_admins are always MFA-required), mirroring /claim.
 */

import type { Metadata } from "next";
import { validateActivationToken } from "./actions";
import { ActivateFormClient } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activate your Organization — Identuum" };

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawParam = params.token;
  const rawToken = typeof rawParam === "string" ? rawParam.trim() : "";

  if (!rawToken) {
    return (
      <ActivateLayout>
        <InvalidLink reason="missing" />
      </ActivateLayout>
    );
  }

  const validation = await validateActivationToken(rawToken);

  if (!validation.valid) {
    return (
      <ActivateLayout>
        <InvalidLink reason={validation.alreadyActive ? "already-active" : "invalid"} />
      </ActivateLayout>
    );
  }

  return (
    <ActivateLayout>
      <ActivateFormClient rawToken={rawToken} adminEmail={validation.email ?? ""} />
    </ActivateLayout>
  );
}

// ── Shared layout wrapper (brand visual language, matches /claim) ────────────

function ActivateLayout({ children }: { children: React.ReactNode }) {
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
          identuum — identitas tua, in potestate tua
        </p>
      </div>
    </div>
  );
}

// ── Invalid / expired / already-active link states ───────────────────────────

function InvalidLink({ reason }: { reason: "missing" | "invalid" | "already-active" }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-sky-950 tracking-tight">
        {reason === "missing"
          ? "No activation link provided"
          : reason === "already-active"
            ? "Organization already activated"
            : "Link invalid or expired"}
      </h2>
      <p className="text-sm text-stone-500 leading-relaxed">
        {reason === "missing"
          ? "This page requires a one-time activation link. Check your email for the activation message, or ask your site administrator to re-issue the token."
          : reason === "already-active"
            ? "This organization has already been activated — its administrator account is ready. Sign in with your credentials instead."
            : "This activation link is invalid, has already been used, or has expired. Ask your site administrator to re-issue the activation token."}
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
