/**
 * AG governance segment layout.
 *
 * This layout:
 *   1. Loads runtime config; shows "not enabled" guard when ag.enabled is false.
 *   2. Renders the AG shell (sidebar + content) for all AG routes.
 *
 * Session guard is handled by the (authed) route group layout which covers
 * /ag-admin and other protected pages. /ag-admin/login sits outside the
 * (authed) group and is reachable without a session.
 *
 * Security: no tokens, credentials, or internal URLs are passed to client
 * components. The sidebar only exposes public route paths.
 */
import { AgAdminNav } from "@/components/ag-admin/ag-admin-nav";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "AG Governance — Identuum" };

export default function AgAdminLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  // AG not enabled — show a clear unavailable state.
  if (!cfg || !cfg.ag.enabled) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <AgNotEnabledMessage configured={!!cfg} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-56 bg-sky-950 flex-shrink-0">
        <div className="px-5 py-5 border-b border-sky-900">
          <p className="text-xs font-bold uppercase tracking-widest text-sky-400">AG Governance</p>
          <p className="text-[10px] text-sky-700 mt-0.5">Agentic Governor</p>
        </div>
        <AgAdminNav />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}

function AgNotEnabledMessage({ configured }: { configured: boolean }) {
  return (
    <div className="max-w-sm text-center space-y-3">
      <div className="h-10 w-10 rounded-xl bg-stone-200 flex items-center justify-center mx-auto">
        <span className="text-stone-400 text-sm font-bold">AG</span>
      </div>
      <p className="text-sm font-semibold text-sky-950">AG governance unavailable</p>
      <p className="text-xs text-stone-500 leading-relaxed">
        {configured
          ? "Identuum-AG is not enabled in the current runtime configuration."
          : "The UI is not yet configured. Complete setup before accessing AG governance."}
      </p>
    </div>
  );
}
