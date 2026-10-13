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
 *   - Unauthenticated              → redirect to /login (session-guard.ts adds
 *                                     ?reason=session_expired for a refused credential)
 *   - Wrong role                   → redirect to roleToPath(role)
 *   - Authenticated site_admin     → render shell + children
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlatformLicenseWarnings } from "@/components/shared/platform-license-warnings";
import { ServiceUnavailable } from "@/components/shared/service-unavailable";
import { ShellFrame } from "@/components/shared/shell-frame";
import { SiteAdminNav } from "@/components/site-admin/site-admin-nav";
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSessionState } from "@/lib/server-session";
import { decideSessionGuard } from "@/lib/session-guard";

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

  // Server-side session validation. getServerSessionState() is cached
  // per-request, so the page calling getServerSession() again does not incur
  // a second IdP network request. THE-UNAVAILABLE-IS-NOT-EXPIRED: three
  // states — a VERDICT redirects to /login; an OUTAGE renders in place with
  // the correlation id and touches no cookie.
  const guard = decideSessionGuard(await getServerSessionState());
  if (guard.action === "render-unavailable") {
    return (
      <ServiceUnavailable
        correlationId={guard.state.correlationId}
        retryAfterSeconds={guard.state.retryAfterSeconds}
        status={guard.state.status}
      />
    );
  }
  if (guard.action === "redirect") {
    redirect(guard.to);
  }
  const session = guard.session;

  const role = session.user?.role ?? session.role;

  if (role !== "site_admin") {
    redirect(roleToPath(role));
  }

  const userEmail = session.user?.email ?? null;
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components.idp.capabilities ?? null;

  // Auth and role confirmed. Render the shell.
  // The sidebar, header and phone menu are the shared ShellFrame (UI-0913-C).
  // SiteAdminNav is a client component that uses usePathname() to determine
  // which item is active. The license warnings are rendered here and handed
  // over as a node: ShellFrame is a client component.
  return (
    <ShellFrame
      area="Admin"
      roleLabel="site_admin"
      email={userEmail}
      nav={<SiteAdminNav capabilities={idpCapabilities} />}
      navFooter={
        <div className="px-3 py-1">
          <a
            href="/platform-status"
            className="flex items-center rounded-lg px-3 py-2 text-xs text-sky-800 hover:text-sky-400 transition-colors"
          >
            Platform status
          </a>
        </div>
      }
      notice={await PlatformLicenseWarnings()}
    >
      {children}
    </ShellFrame>
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
