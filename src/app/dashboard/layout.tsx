/**
 * Dashboard route segment boundary guard.
 *
 * This layout is an async Server Component that enforces:
 *   1. Runtime config must exist and IdP must be enabled.
 *   2. A valid IdP session must be present.
 *   3. The session role must be "org_user" (admins redirect to their own shells).
 *
 * Because Next.js evaluates the nearest layout before rendering any child
 * page or layout, every route under /dashboard/* inherits these checks
 * automatically. Future child pages do NOT need to repeat the guard.
 *
 * Rendering paths:
 *   - Not configured / IdP disabled → DashboardUnavailableMessage (no shell, no children)
 *   - Unauthenticated              → redirect to /login?reason=session_expired
 *   - org_admin                    → redirect to /org-admin
 *   - site_admin                   → redirect to /site-admin
 *   - Authenticated org_user       → render shell + children
 */

import { AccountMenu } from "@/components/shared/account-menu";
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerSession } from "@/lib/server-session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

// force-dynamic propagates to every child route within this segment.
// Session state must never be statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard — Identuum" };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  if (!cfg || !cfg.idp.enabled) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <DashboardUnavailableMessage configured={!!cfg} />
      </div>
    );
  }

  // Server-side session validation. getServerSession() is cached per-request,
  // so the page calling it again does not incur a second IdP network request.
  const session = await getServerSession();

  if (!session) {
    redirect("/login?reason=session_expired");
  }

  const role = session.user?.role ?? session.role;

  // Admin users belong in their own shells.
  if (role === "org_admin" || role === "site_admin") {
    redirect(roleToPath(role));
  }

  const userEmail = session.user?.email ?? null;

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-sky-950 border-r border-sky-900/60">
        {/* Product name */}
        <div className="px-5 py-5 border-b border-sky-900/60 flex items-center gap-2.5">
          <div className="h-7 w-7 bg-sky-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <span className="font-black text-white text-[11px] tracking-tight leading-none">
              Id
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Identuum</p>
            <p className="text-sm font-semibold text-white leading-tight">Member</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem href="/dashboard" label="Overview" />
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-sky-900/60">
          <form method="POST" action="/api/auth/logout">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 flex items-center justify-between px-6 border-b border-stone-200 bg-white/90 backdrop-blur-md shrink-0">
          <span className="text-xs text-stone-400 font-mono">org_user</span>
          {userEmail && <AccountMenu email={userEmail} />}
        </header>
        <main className="flex-1 overflow-auto bg-stone-50 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
    >
      {label}
    </a>
  );
}

function DashboardUnavailableMessage({ configured }: { configured: boolean }) {
  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-bold text-sky-950 mb-2 tracking-tight">Dashboard unavailable</h1>
      <p className="text-sm text-stone-500 leading-relaxed">
        {configured
          ? "This deployment is configured without an IdP backend (AG-only mode). The member dashboard requires identuum-idp to be enabled."
          : "identuum-ui has not been configured yet. Run identuum-ui-setup to write the runtime configuration."}
      </p>
      <a
        href="/login"
        className="mt-4 inline-block text-sm text-sky-600 hover:text-sky-700 underline"
      >
        Return to login
      </a>
    </div>
  );
}
