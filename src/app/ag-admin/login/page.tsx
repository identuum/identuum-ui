import type { Metadata } from "next";
/**
 * AG operator login page.
 *
 * Accessible without an existing AG session — renders the login form.
 * On success, /api/ag/login sets the ag_access_token HttpOnly cookie and
 * redirects to /ag-admin.
 *
 * Security:
 *   - Credentials are sent to /api/ag/login (same-origin). The API route
 *     proxies them server-to-server to the AG identity surface.
 *   - The bearer token is never returned to browser code.
 *   - Error messages are generic; AG internal errors are not surfaced.
 */
import { AgAdminLoginForm } from "./form-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AG Operator Login — Identuum" };

export default function AgAdminLoginPage() {
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
          <div className="h-10 w-10 bg-sky-700 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-[11px] tracking-tight leading-none">
              AG
            </span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">AG Governance</span>
        </div>

        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6">
            <h2 className="text-lg font-bold text-sky-950 mb-1 tracking-tight">Operator sign in</h2>
            <p className="text-sm text-stone-500 mb-6 leading-relaxed">
              Sign in with your AG operator credentials.
            </p>
            <AgAdminLoginForm />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">identuum-ag — agentic governor</p>
      </div>
    </div>
  );
}
