/**
 * AG governance authenticated route group layout.
 *
 * Enforces AG operator session: redirects to /ag-admin/login when the
 * ag_access_token cookie is absent. The /ag-admin/login page sits OUTSIDE
 * this route group and is therefore reachable without a session.
 *
 * This layout also renders the AG Governance sidebar so that authenticated
 * pages have navigation while the login page does not.
 *
 * Token presence is checked here; validity is enforced by the AG backend
 * on each API call (401 = expired/revoked; caller redirects to login).
 *
 * Security: no token value or credential is passed to client components.
 * The sidebar exposes only public route paths.
 */
import { AgAdminNav } from "@/components/ag-admin/ag-admin-nav";
import { hasAgSession } from "@/lib/ag-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgAdminAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = await hasAgSession();
  if (!authenticated) {
    redirect("/ag-admin/login");
  }

  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* Sidebar — shown only to authenticated operators */}
      <aside className="hidden lg:flex lg:flex-col w-56 bg-sky-950 flex-shrink-0">
        <div className="px-5 py-5 border-b border-sky-900">
          <p className="text-xs font-bold uppercase tracking-widest text-sky-400">AG Governance</p>
          <p className="text-[10px] text-sky-700 mt-0.5">Agentic Governor</p>
        </div>
        <AgAdminNav />
        <div className="px-3 py-3 border-t border-sky-900/60">
          <a
            href="/platform-status"
            className="flex items-center rounded-lg px-3 py-2 text-xs text-sky-800 hover:text-sky-400 transition-colors"
          >
            Platform status
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
