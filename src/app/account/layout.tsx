import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgAdminNav } from "@/components/org-admin/org-admin-nav";
/**
 * Account route segment guard.
 *
 * Accessible to all authenticated human users (site_admin, org_admin, org_user).
 * Unauthenticated visitors are redirected to /login (session-guard.ts says
 * when the expiry reason is added).
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
 *   - org_user   → <MemberNav /> (shared with /dashboard/layout.tsx since
 *     UI-0912-A: Overview, Profile, Security, Sessions).
 *
 * The role-shell layouts themselves are NOT touched. This file simply re-uses
 * the same composable seams (AccountMenu + role-specific Nav + getServerRuntimeState
 * for capabilities) the role shells already use, so any future change to a
 * role's sidebar shape propagates here automatically.
 */
import { MemberNav } from "@/components/shared/member-nav";
import { ServiceUnavailable } from "@/components/shared/service-unavailable";
import { ShellFrame } from "@/components/shared/shell-frame";
import { SiteAdminNav } from "@/components/site-admin/site-admin-nav";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSessionState } from "@/lib/server-session";
import { decideSessionGuard } from "@/lib/session-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account Settings — Identuum" };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const cfg = loadRuntimeConfig();

  if (!cfg || !cfg.idp.enabled) {
    redirect("/login");
  }

  // THE-UNAVAILABLE-IS-NOT-EXPIRED: three states — a VERDICT redirects to
  // /login; an OUTAGE renders in place with the correlation id, no cookie touched.
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
  const userEmail = session.user?.email ?? null;

  // Capabilities are needed by Site/Org-Admin Nav components to gate
  // sidebar items by feature availability. The role shells call the same
  // helper; we mirror it here so the sidebar item set matches what the user
  // sees when they navigate back to /site-admin or /org-admin.
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components?.idp?.capabilities ?? null;

  // The role-aware sidebar, header and phone menu are the shared ShellFrame
  // (UI-0913-C), so navigating into /account/settings keeps the operator's
  // normal sidebar.
  return (
    <ShellFrame
      area={role === "site_admin" ? "Admin" : role === "org_admin" ? "Workspace" : "Member"}
      roleLabel={role ?? "account"}
      email={userEmail}
      nav={
        <>
          {role === "site_admin" && <SiteAdminNav capabilities={idpCapabilities} />}
          {role === "org_admin" && <OrgAdminNav capabilities={idpCapabilities} />}
          {role === "org_user" && <MemberNav />}
          {role !== "site_admin" && role !== "org_admin" && role !== "org_user" && (
            <nav className="flex-1 px-3 py-4 space-y-1" aria-hidden="true" />
          )}
        </>
      }
    >
      {children}
    </ShellFrame>
  );
}
