/**
 * PolicyPacks settings — AG operator management page.
 *
 * Fetches current PolicyPacks settings from the AG backend and renders
 * the interactive PolicyPackSettingsPanel.
 *
 * Security:
 *   - agRequest() attaches the bearer token server-side; the token value
 *     is never exposed to browser code.
 *   - On auth error, redirects to /ag-admin/login.
 *   - On AG unavailable, passes initialSettings=null to the panel; the
 *     panel degrades gracefully without crashing.
 *   - No credential material is passed to client components.
 */
import { getAgPolicyPackSettings } from "@/lib/ag-policy-pack-client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PolicyPackSettingsPanel } from "./policy-pack-settings-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PolicyPacks Settings — Identuum AG" };

export default async function PolicyPacksPage() {
  const result = await getAgPolicyPackSettings();

  if (result === "auth_error") {
    redirect("/ag-admin/login");
  }

  const settings = result === "unavailable" ? null : result;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">PolicyPacks</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Manage PolicyPacks enforcement settings for your organization on the Agentic Governor.
        </p>
        <p className="text-xs text-stone-400 mt-1">
          This setting applies to the organization associated with your current AG operator session.
        </p>
      </div>

      <PolicyPackSettingsPanel initialSettings={settings} />

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pt-2">
        <QuickLink href="/ag-admin/agents">Agent Registry</QuickLink>
        <QuickLink href="/ag-admin/sessions">Agent Sessions</QuickLink>
        <QuickLink href="/ag-admin/hitl">HITL / CBAA</QuickLink>
        <QuickLink href="/ag-admin">Dashboard</QuickLink>
      </div>
    </div>
  );
}

function QuickLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 font-medium transition-colors"
    >
      {children}
    </a>
  );
}
