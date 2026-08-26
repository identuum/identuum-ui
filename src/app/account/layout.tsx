import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgAdminNav } from "@/components/org-admin/org-admin-nav";
/**
 * Account route segment guard.
 *
 * Accessible to all authenticated human users (site_admin, org_admin, org_user).
 * Unauthenticated visitors are redirected to /login?reason=session_expired.
 *
 * This layout does NOT check role — any valid session is allowed. Role-specific
 * access control lives in the role shells (/site-admin, /org-admin, /dashboard).
 *
 * 2026-06-24 sidebar restoration (agent-a-20260738-idp-ce-me-mfa-self-service-routes-and-settings-layout):
 *
 * Prior to this change /account/* rendered a "minimal top bar" layout without
 * any sidebar — operators visiting /account/settings?tab=mfa lost their normal
 * left navigation and felt context-switched out of the app. The new layout
 * mirrors the role-shell pattern used by /site-admin/layout.tsx,
 * /org-admin/layout.tsx, and /dashboard/layout.tsx: a left aside containing
 * the role-appropriate Nav + Sign out, and a main content area on the right
 * with a thin top bar carrying the user's email. The exact Nav rendered
 * depends on `session.role`:
 *
 *   - site_admin → <SiteAdminNav capabilities={…} /> (re-used verbatim from
 *     /site-admin/layout.tsx; no behavior change to that Nav component).
 *   - org_admin  → <OrgAdminNav  capabilities={…} /> (re-used verbatim from
 *     /org-admin/layout.tsx).
 *   - org_user   → an inline "Overview" link to /dashboard (matches the
 *     dashboard layout's single-NavItem shape; the dashboard sidebar does
 *     not expose a dedicated Nav component today).
 *
 * The role-shell layouts themselves are NOT touched. This file simply re-uses
 * the same composable seams (AccountMenu + role-specific Nav + getServerRuntimeState
 * for capabilities) the role shells already use, so any future change to a
 * role's sidebar shape propagates here automatically.
 */
import { AccountMenu } from "@/components/shared/account-menu";
import { SiteAdminNav } from "@/components/site-admin/site-admin-nav";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSession } from "@/lib/server-session";

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

  // Capabilities are needed by Site/Org-Admin Nav components to gate
  // sidebar items by feature availability. The role shells call the same
  // helper; we mirror it here so the sidebar item set matches what the user
  // sees when they navigate back to /site-admin or /org-admin.
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components?.idp?.capabilities ?? null;

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar — role-aware. Mirrors the role-shell pattern at
          /site-admin/layout.tsx + /org-admin/layout.tsx + /dashboard/layout.tsx
          so navigating into /account/settings does not strip the operator's
          normal sidebar. */}
      <aside className="w-60 shrink-0 flex flex-col bg-sky-950 border-r border-sky-900/60">
        {/* Product name — matches the role shells verbatim. */}
        <div className="px-5 py-5 border-b border-sky-900/60 flex items-center gap-2.5">
          <div className="h-7 w-7 bg-sky-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <span className="font-black text-white text-[11px] tracking-tight leading-none">
              Id
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Identuum</p>
            <p className="text-sm font-semibold text-white leading-tight">
              {role === "site_admin" ? "Admin" : role === "org_admin" ? "Workspace" : "Member"}
            </p>
          </div>
        </div>

        {/* Role-appropriate navigation. */}
        {role === "site_admin" && <SiteAdminNav capabilities={idpCapabilities} />}
        {role === "org_admin" && <OrgAdminNav capabilities={idpCapabilities} />}
        {role === "org_user" && (
          <nav className="flex-1 px-3 py-4 space-y-1">
            <a
              href="/dashboard"
              className="flex items-center rounded-lg px-3 py-2 text-sm text-sky-200 hover:bg-sky-900/60 hover:text-white transition-colors"
            >
              Overview
            </a>
          </nav>
        )}
        {role !== "site_admin" && role !== "org_admin" && role !== "org_user" && (
          <nav className="flex-1 px-3 py-4 space-y-1" aria-hidden="true" />
        )}

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

      {/* Main content area — mirrors the role-shell pattern. */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — role label + AccountMenu. The role-shell layouts show
            the role label as a font-mono tag; we do the same for visual
            consistency. */}
        <header className="h-12 flex items-center justify-between px-6 border-b border-stone-200 bg-white/90 backdrop-blur-md shrink-0">
          <span className="text-xs text-stone-400 font-mono">{role ?? "account"}</span>
          {userEmail && <AccountMenu email={userEmail} />}
        </header>
        <main className="flex-1 overflow-auto bg-stone-50 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
