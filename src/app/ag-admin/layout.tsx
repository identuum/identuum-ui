/**
 * AG governance segment layout.
 *
 * This layout:
 *   1. Loads runtime config; shows an appropriate guard when ag.enabled is false.
 *   2. Renders the AG shell (sidebar + content) for all AG routes.
 *
 * Runtime config is the fast static check. A link to /platform-status lets
 * operators see the live discovery state (reachability, license, error codes)
 * without adding backend calls to every page load in this shell.
 *
 * Session guard is handled by the (authed) route group layout which covers
 * /ag-admin protected pages. /ag-admin/login sits outside the (authed) group.
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

  if (!cfg) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <AgUnavailableMessage reason="not_configured" />
      </div>
    );
  }

  if (!cfg.ag.enabled) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <AgUnavailableMessage reason="not_enabled" />
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
        {/* Platform status link — lets operators check backend state */}
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

type AgUnavailableReason = "not_configured" | "not_enabled";

function AgUnavailableMessage({ reason }: { reason: AgUnavailableReason }) {
  const messages: Record<AgUnavailableReason, { heading: string; body: string }> = {
    not_configured: {
      heading: "UI not configured",
      body: "identuum-ui has not been configured yet. Run identuum-ui-setup to write the runtime configuration.",
    },
    not_enabled: {
      heading: "Agent Governance not configured",
      body: "identuum-ag is not enabled in the current runtime configuration. Add an AG backend to your runtime config to access governance features.",
    },
  };

  const { heading, body } = messages[reason];

  return (
    <div className="max-w-sm text-center space-y-3">
      <div className="h-10 w-10 rounded-xl bg-stone-200 flex items-center justify-center mx-auto">
        <span className="text-stone-400 text-sm font-bold">AG</span>
      </div>
      <p className="text-sm font-semibold text-sky-950">{heading}</p>
      <p className="text-xs text-stone-500 leading-relaxed">{body}</p>
      <div className="flex flex-col items-center gap-2">
        <a href="/" className="text-xs text-sky-600 hover:text-sky-700 underline">
          Return to home
        </a>
        {reason === "not_enabled" && (
          <a
            href="/platform-status"
            className="text-xs text-stone-400 hover:text-stone-500 underline"
          >
            View platform status
          </a>
        )}
      </div>
    </div>
  );
}
