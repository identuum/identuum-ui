/**
 * /reset-password?token=... — landing page for the IDP-issued reset link.
 *
 * Public, unauthenticated route. The IDP builds this URL as
 * `<HumanFacingBaseURL>/reset-password?token=<raw>` so it always lands
 * here on the UI origin.
 *
 * The token is read from the URL on the server, passed to the client form
 * as a hidden input, and consumed on submit. If the URL is missing the
 * token the page renders the "invalid link" surface so the operator goes
 * to /forgot-password instead of trying a blank submit.
 *
 * No IDP call is made at page-load time — the token is only spent when
 * the user submits the new password.
 */
import type { Metadata } from "next";
import { ResetPasswordFormClient } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password — Identuum" };

function pickToken(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = pickToken(params.token);

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

        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-100">
            <h1 className="text-lg font-bold tracking-tight text-sky-950">Reset password</h1>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
              Choose a new password for your account.
            </p>
          </div>
          <div className="px-6 py-5">
            {token === "" ? (
              <MissingTokenPanel />
            ) : (
              <ResetPasswordFormClient rawToken={token} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MissingTokenPanel() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
        <p className="text-sm font-semibold text-amber-800">No reset token in this URL</p>
        <p className="text-xs text-amber-700 mt-1 leading-relaxed">
          Open the reset link from the email we sent. If you cannot find the email, request a new
          reset link.
        </p>
      </div>
      <a
        href="/forgot-password"
        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
      >
        Request a reset link
      </a>
    </div>
  );
}
