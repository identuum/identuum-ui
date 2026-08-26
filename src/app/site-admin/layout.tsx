/**
 * Site-admin route segment boundary guard.
 *
 * This layout is an async Server Component that enforces:
 *   1. Runtime config must exist and IdP must be enabled.
 *   2. A valid IdP session must be present.
 *   3. The session role must be "site_admin".
 *
 * Because Next.js evaluates the nearest layout before rendering any child
 * page or layout, every route under /site-admin/* inherits these checks
 * automatically. Future child pages do NOT need to repeat the guard.
 *
 * Rendering paths:
 *   - Not configured / IdP disabled → IdpRequiredMessage (no shell, no children)
 *   - Unauthenticated              → redirect to /login?reason=session_expired
 *   - Wrong role                   → redirect to roleToPath(role)
 *   - Authenticated site_admin     → render shell + children
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/shared/account-menu";
import { PlatformLicenseWarnings } from "@/components/shared/platform-license-warnings";
import { SiteAdminNav } from "@/components/site-admin/site-admin-nav";
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSession } from "@/lib/server-session";

// force-dynamic propagates to every child route within this segment.
// Session state must never be statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Identuum Admin" };

export default async function SiteAdminLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  // Not configured or IdP disabled — site-admin is an IdP-local concept.
  // Show a clear unavailable state. Do not render the shell or children.
  if (!cfg || !cfg.idp.enabled) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <IdpRequiredMessage configured={!!cfg} />
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

  if (role !== "site_admin") {
    redirect(roleToPath(role));
  }

  const userEmail = session.user?.email ?? null;
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components.idp.capabilities ?? null;

  // Auth and role confirmed. Render the shell.
  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar — intentionally dark navy for admin shell contrast */}
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
            <p className="text-sm font-semibold text-white leading-tight">Admin</p>
          </div>
        </div>

        {/* Navigation — SiteAdminNav is a client component that uses
            usePathname() to determine which item is active. */}
        <SiteAdminNav capabilities={idpCapabilities} />

        {/* Platform status link */}
        <div className="px-3 py-1">
          <a
            href="/platform-status"
            className="flex items-center rounded-lg px-3 py-2 text-xs text-sky-800 hover:text-sky-400 transition-colors"
          >
            Platform status
          </a>
        </div>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-sky-900/60">
          {/* Logout: POST to the UI-side logout handler which proxies to IdP
              and redirects to /login. Using /api/auth/logout instead of the
              raw IdP proxy path so the browser receives a redirect, not JSON. */}
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
        {/* Top bar — light glass strip above content */}
        <header className="h-12 flex items-center justify-between px-6 border-b border-stone-200 bg-white/90 backdrop-blur-md shrink-0">
          <span className="text-xs text-stone-400 font-mono">site_admin</span>
          {userEmail && <AccountMenu email={userEmail} />}
        </header>
        <PlatformLicenseWarnings />
        <main className="flex-1 overflow-auto bg-stone-50 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

function IdpRequiredMessage({ configured }: { configured: boolean }) {
  return (
    <div className="max-w-lg space-y-3">
      <h1 className="text-lg font-bold text-sky-950 tracking-tight">
        Identity administration unavailable
      </h1>
      <p className="text-sm text-stone-500 leading-relaxed">
        {configured
          ? "identuum-idp is not enabled in the current runtime configuration. Site administration requires identuum-idp to be enabled."
          : "identuum-ui has not been configured yet. Run identuum-ui-setup to write the runtime configuration."}
      </p>
      <div className="flex gap-4">
        <a href="/" className="text-sm text-sky-600 hover:text-sky-700 underline">
          Return to home
        </a>
        {configured && (
          <a
            href="/platform-status"
            className="text-sm text-stone-400 hover:text-stone-500 underline"
          >
            View platform status
          </a>
        )}
      </div>
    </div>
  );
}
