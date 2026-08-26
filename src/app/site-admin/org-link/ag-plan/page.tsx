/**
 * /site-admin/org-link/ag-plan
 *
 * Read-only AG OSS org-link plan summary (AG-31). Surfaces the new
 * GET /api/v1/org-link/plan response: every AG organization with link
 * status plus total/linked/unlinked counts. The system org is excluded
 * server-side; this page never displays the system sentinel.
 *
 * Auth: inherits the site-admin guard from `/site-admin/layout.tsx`.
 * AG operator session is checked through fetchAGOrgLinkPlanOSS; missing
 * cookie renders the AG-auth-required state, NOT a redirect.
 *
 * SCOPE: organizations only. No users, admins, credentials, MFA, or
 * IDP-side metadata. No link/unlink/import buttons in this slice.
 *
 * Security: no internal backend URLs, tokens, or raw AG error messages
 * are rendered.
 */

import type { Metadata } from "next";
import {
  type AGOrgLinkPlanOSS,
  type AGOrgLinkPlanOSSResult,
  fetchAGOrgLinkPlanOSS,
} from "@/lib/ag-org-link-plan-oss-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AG Org-Link Plan — Identuum" };

export default async function AGOrgLinkPlanPage() {
  const result = await fetchAGOrgLinkPlanOSS();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-sky-950 tracking-tight">AG Org-Link Plan</h1>
        <p className="text-sm text-stone-500 mt-1">
          Read-only summary of AG organizations and their IDP link status. Source:{" "}
          <span className="font-mono">GET /api/v1/org-link/plan</span> on the AG management surface.
        </p>
      </div>

      <PlanCard result={result} />

      <div className="border-t border-stone-200 pt-4 flex flex-wrap gap-6">
        <a
          href="/site-admin/org-link"
          className="text-sm text-sky-600 hover:text-sky-700 underline"
        >
          Back to Organization Link
        </a>
        <a
          href="/platform-status"
          className="text-sm text-stone-500 hover:text-stone-700 underline"
        >
          Platform status
        </a>
      </div>
    </div>
  );
}

function PlanCard({ result }: { result: AGOrgLinkPlanOSSResult }) {
  switch (result.status) {
    case "ok":
      return <PlanContent plan={result.plan} />;
    case "not_configured":
      return (
        <StateCard
          tone="stone"
          title="AG not configured"
          body="The runtime config has ag.enabled=false. Configure the AG management URL in config/ui-runtime.json to consume the AG OSS org-link plan."
        />
      );
    case "ag_auth_required":
      return (
        <StateCard
          tone="amber"
          title="AG operator session required"
          body="The AG OSS org-link plan endpoint requires an operator session. Log in to the AG management surface and reload this page."
        />
      );
    case "ag_forbidden":
      return (
        <StateCard
          tone="amber"
          title="Forbidden"
          body="The AG management surface returned 403 for this operator session. Confirm the operator role allows the org-link plan view."
        />
      );
    case "ag_unavailable":
      return (
        <StateCard
          tone="amber"
          title="AG backend unavailable"
          body="The AG management surface did not respond. The backend may be down, unreachable, or returning an unexpected error."
        />
      );
    case "error":
      return (
        <StateCard
          tone="red"
          title="Unexpected response"
          body="The AG management surface returned a body that did not match the expected AG OSS org-link plan shape."
        />
      );
  }
}

function PlanContent({ plan }: { plan: AGOrgLinkPlanOSS }) {
  if (plan.total === 0) {
    return (
      <StateCard
        tone="stone"
        title="No AG organizations"
        body="The AG backend has no organizations to plan against (the system organization is always excluded)."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Counts plan={plan} />
      <OrgTable plan={plan} />
    </div>
  );
}

function Counts({ plan }: { plan: AGOrgLinkPlanOSS }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <CountTile label="Total" value={plan.total} tone="stone" />
      <CountTile label="Linked" value={plan.linked_count} tone="emerald" />
      <CountTile label="Unlinked" value={plan.unlinked_count} tone="amber" />
    </div>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "stone" | "emerald" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-white text-stone-700";
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function OrgTable({ plan }: { plan: AGOrgLinkPlanOSS }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Display name</th>
            <th className="text-left px-4 py-2 font-medium">Slug</th>
            <th className="text-left px-4 py-2 font-medium">Link status</th>
            <th className="text-left px-4 py-2 font-medium">Linked IDP org id</th>
          </tr>
        </thead>
        <tbody>
          {plan.organizations.map((o) => (
            <tr key={o.id} className="border-t border-stone-100">
              <td className="px-4 py-2 text-sky-950 font-medium">{o.display_name}</td>
              <td className="px-4 py-2 text-stone-500 font-mono text-xs">{o.name}</td>
              <td className="px-4 py-2">
                {o.link_status === "linked" ? (
                  <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Linked
                  </span>
                ) : (
                  <span className="rounded-md bg-stone-100 border border-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500">
                    Unlinked
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-stone-500 font-mono text-xs">
                {o.linked_idp_org_id ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateCard({
  tone,
  title,
  body,
}: {
  tone: "stone" | "amber" | "red";
  title: string;
  body: string;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-stone-200 bg-white text-stone-700";
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs mt-1 opacity-80">{body}</p>
    </div>
  );
}
