/**
 * /reset-link?token=… — redeem an admin-issued one-time password reset link
 * (CE-UI-2b; identuum-idp-ce sends no mail, so an org_admin creates the link
 * on the user detail page and hands it over).
 *
 * Public page, like /claim: the server reads the token once, validates it,
 * and the form posts it back with the new password. The URL carries the
 * token, so Referrer-Policy is no-referrer (here, and from CE's server).
 */
import type { Metadata } from "next";
import { validateResetLinkToken } from "./actions";
import { ResetLinkFormClient, ResetLinkInvalid } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password — Identuum", referrer: "no-referrer" };

export default async function ResetLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawParam = params.token;
  const rawToken = typeof rawParam === "string" ? rawParam.trim() : "";
  const valid = rawToken ? await validateResetLinkToken(rawToken) : false;
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-100">
            <h1 className="text-lg font-bold tracking-tight text-sky-950">Reset password</h1>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
              Choose a new password. Your authenticator stays enrolled.
            </p>
          </div>
          <div className="px-6 py-5">
            {valid ? <ResetLinkFormClient rawToken={rawToken} /> : <ResetLinkInvalid />}
          </div>
        </div>
      </div>
    </div>
  );
}
