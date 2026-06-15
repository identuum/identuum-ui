/**
 * Org-admin route segment boundary guard.
 *
 * This layout is an async Server Component that enforces:
 *   1. Runtime config must exist and IdP must be enabled.
 *   2. A valid IdP session must be present.
 *   3. The session role must be "org_admin".
 *
 * Because Next.js evaluates the nearest layout before rendering any child
 * page or layout, every route under /org-admin/* inherits these checks
 * automatically. Future child pages do NOT need to repeat the guard.
 *
 * Rendering paths:
 *   - Not configured / IdP disabled → IdpRequiredMessage (no shell, no children)
 *   - Unauthenticated              → redirect to /login?reason=session_expired
 *   - Wrong role                   → redirect to roleToPath(role)
 *   - Authenticated org_admin      → render shell + children
 */
import { OrgAdminNav } from "@/components/org-admin/org-admin-nav";
import { AccountMenu } from "@/components/shared/account-menu";
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSession } from "@/lib/server-session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

// force-dynamic propagates to every child route within this segment.
// Session state must never be statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Identuum Org Admin" };

export default async function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  // Not configured or IdP disabled — org-admin is an IdP-local concept.
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

  if (role !== "org_admin") {
    redirect(roleToPath(role));
  }

  // MFA setup gate. Admin roles MUST have MFA enrolled before they can
  // access privileged surfaces. The IdP enforces this at login time
  // (resolveMFARequirement returns true for any admin without MFA, so
  // no JWT is issued until enrollment completes), but a pre-deploy
  // session that pre-dates the gate may still carry a valid token.
  // We re-check the IdP-authoritative mfa_enabled value here and route
  // such users into /account/settings (the existing MFA enrollment
  // surface) before any org-admin pages render.
  //
  // Older IdP builds may omit the mfa_enabled field; we only block when
  // the field is explicitly `false` so an unknown value does not lock
  // working operators out during a rolling upgrade. The IdP login-side
  // gate is the load-bearing defence; this is belt-and-suspenders.
  if (session.user?.mfa_enabled === false) {
    redirect("/account/settings?reason=mfa_required");
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
            <p className="text-sm font-semibold text-white leading-tight">Organization</p>
          </div>
        </div>

        {/* Navigation — OrgAdminNav is a client component that uses
            usePathname() to determine which item is active. */}
        <OrgAdminNav capabilities={idpCapabilities} />

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
          <span className="text-xs text-stone-400 font-mono">org_admin</span>
          {userEmail && <AccountMenu email={userEmail} />}
        </header>
        <main className="flex-1 overflow-auto bg-stone-50 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

function IdpRequiredMessage({ configured }: { configured: boolean }) {
  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-bold text-sky-950 mb-2 tracking-tight">
        Organization administration unavailable
      </h1>
      <p className="text-sm text-stone-500 leading-relaxed">
        {configured
          ? "This deployment is configured without an IdP backend (AG-only mode). Organization administration requires identuum-idp to be enabled."
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
