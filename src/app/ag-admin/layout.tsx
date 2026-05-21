/**
 * AG governance segment layout — configuration guard only.
 *
 * This layout checks whether AG is configured in the runtime config and shows
 * an appropriate message when it is not. It does NOT render the sidebar; the
 * sidebar is rendered by the (authed) route group layout so that the login
 * page (/ag-admin/login) can render without navigation.
 *
 * Security: no tokens, credentials, or internal URLs are passed to client
 * components.
 */
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

  return <>{children}</>;
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
