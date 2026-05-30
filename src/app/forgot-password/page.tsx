/**
 * /forgot-password — request password reset email.
 *
 * Public, unauthenticated route. Linked from the password step on
 * /login. The IDP returns a generic 200 OK on every request shape (the
 * no-enumeration invariant — see actions.ts), and constructs the email
 * link as `<HumanFacingBaseURL>/reset-password?token=<raw>` so the
 * recipient lands on the matching /reset-password page in this UI.
 *
 * No session is required, no IDP call happens at page-load time — the
 * server action is invoked only on form submit. This keeps an
 * unauthenticated /forgot-password browse cheap and free of side effects.
 */
import type { Metadata } from "next";
import { ForgotPasswordFormClient } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgot password — Identuum" };

export default function ForgotPasswordPage() {
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
            <h1 className="text-lg font-bold tracking-tight text-sky-950">Forgot password</h1>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
              Enter your email and we&apos;ll send password reset instructions if the address
              matches an account on this deployment.
            </p>
          </div>
          <div className="px-6 py-5">
            <ForgotPasswordFormClient />
          </div>
        </div>
      </div>
    </div>
  );
}
