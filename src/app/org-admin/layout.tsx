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
 *   - Unauthenticated              → redirect to /login (session-guard.ts adds
 *                                     ?reason=session_expired for a refused credential)
 *   - Wrong role                   → redirect to roleToPath(role)
 *   - Authenticated org_admin      → render shell + children
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgAdminNav } from "@/components/org-admin/org-admin-nav";
import { ServiceUnavailable } from "@/components/shared/service-unavailable";
import { ShellFrame } from "@/components/shared/shell-frame";
import { roleToPath } from "@/lib/role-routing";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSessionState } from "@/lib/server-session";
import { decideSessionGuard } from "@/lib/session-guard";

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
  // The sidebar, header and phone menu are the shared ShellFrame (UI-0913-C).
  // OrgAdminNav is a client component that uses usePathname() to determine
  // which item is active.
  return (
    <ShellFrame
      area="Organization"
      roleLabel="org_admin"
      email={userEmail}
      nav={<OrgAdminNav capabilities={idpCapabilities} />}
    >
      {children}
    </ShellFrame>
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
