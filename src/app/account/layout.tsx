/**
 * Account route segment guard.
 *
 * Accessible to all authenticated human users (site_admin, org_admin, org_user).
 * Unauthenticated visitors are redirected to /login?reason=session_expired.
 *
 * This layout does NOT check role — any valid session is allowed. Role-specific
 * access control lives in the role shells (/site-admin, /org-admin, /dashboard).
 */
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerSession } from "@/lib/server-session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account Settings — Identuum" };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  if (!cfg || !cfg.idp.enabled) {
    redirect("/login");
  }

  const session = await getServerSession();

  if (!session) {
    redirect("/login?reason=session_expired");
  }

  const role = session.user?.role ?? session.role;
  const userEmail = session.user?.email ?? null;
  const backPath = roleToPath(role);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Minimal top bar — back navigation + email display */}
      <header className="h-12 flex items-center justify-between px-6 border-b border-stone-200 bg-white/90 backdrop-blur-md shrink-0">
        <a
          href={backPath}
          className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 transition-colors"
        >
          {/* chevron-left */}
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
          Back
        </a>
        {userEmail && <span className="text-xs text-stone-400 truncate max-w-xs">{userEmail}</span>}
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
