/**
 * /site-admin/org-link
 *
 * Organization-only AG↔IDP link planning and action page.
 *
 * SCOPE: organizations only.
 * NOT IN SCOPE — never shown, never imported, never linked:
 *   - Users, org admins, or site admins
 *   - Passwords or MFA state
 *   - Role bindings or permission grants
 *   - Reviewers, auditors, or approval state
 *   - Credentials of any kind
 *
 * Security: no internal backend URLs, no tokens, no credentials are rendered.
 */
import { BackendNotConfiguredNotice } from "@/components/shared/backend-not-configured-notice";
import { hasAgSession } from "@/lib/ag-client";
import { fetchAGOrgLinkPlan } from "@/lib/ag-org-client";
import { listOrganizations } from "@/lib/idp-admin-client";
import type { IDPOrgSummaryForLink } from "@/lib/org-link-types";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { Metadata } from "next";
import { IDPImportSection, OrgLinkActions } from "./org-link-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organization Link — Identuum" };

export default async function OrgLinkPlanPage() {
  const cfg = loadRuntimeConfig();
  const idpEnabled = Boolean(cfg?.idp.enabled);
  const agEnabled = Boolean(cfg?.ag.enabled);

  // ABSENCE IS NOT FAILURE (THE-ABSENT-BACKEND): org linking needs BOTH
  // backends. When either is not enabled in the runtime config this page does
  // not render the console with that backend framed as unreachable — it
  // states the not-configured fact plainly (AG copy matches the /ag-admin
  // route guard; the rule is symmetric for the IdP). BOTH absent is an
  // ERROR — an invalid runtime config — and presents in the error style.
  if (!agEnabled || !idpEnabled) {
    const missing = !agEnabled && !idpEnabled ? "both" : !agEnabled ? "ag" : "idp";
    return <BackendNotConfiguredNotice title="Organization Link" missing={missing} />;
  }

  let idpOrgs: IDPOrgSummaryForLink[] = [];
  let idpAvailable = false;
  if (idpEnabled) {
    try {
      const result = await listOrganizations({ limit: 100 });
      if (result) {
        idpAvailable = true;
        idpOrgs = result.organizations.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          domain: o.domain,
          active: o.active,
          deleted: o.deleted,
          has_admin: o.has_admin,
        }));
      }
    } catch {
      // IDP unreachable
    }
  }

  const agUrl = agEnabled && cfg ? agBaseUrl(cfg) : null;
  const agPlan = await fetchAGOrgLinkPlan(agUrl);
  const agAvailable = agPlan !== null;
  const agSession = await hasAgSession();

  // Set of IDP org IDs already linked to an AG org, used to filter import candidates.
  const linkedIDPOrgIds = new Set<string>(
    (agPlan?.organizations ?? [])
      .filter((o) => o.linked_idp_org_id)
      .map((o) => o.linked_idp_org_id as string)
  );

  // Actions are only available when both backends are reachable, an AG operator
  // session exists, and AG reports the write path as available.
  const canAct =
    idpAvailable &&
    agAvailable &&
    agSession &&
    Boolean(agPlan?.import_available) &&
    idpOrgs.filter((o) => o.active && !o.deleted).length > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-sky-950 tracking-tight">Organization Link</h1>
        <p className="text-sm text-stone-500 mt-1">
          Link AG organizations to IDP organizations. Organization scope only.
        </p>
      </div>

      <RelatedReadOnlyViews />

      <ScopeWarning />

      {!idpAvailable && !agAvailable && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">
            Neither IDP nor AG backends are currently reachable.
          </p>
        </div>
      )}

      {agAvailable && !agPlan?.import_available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">Link actions unavailable</p>
          <p className="text-xs text-amber-700 mt-0.5">
            {agPlan?.unavailable_reason === "not_configured"
              ? "AG org-link write path is not configured."
              : "AG reports link operations are not available."}
          </p>
        </div>
      )}

      {agAvailable && agSession === false && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs text-stone-500">
            AG operator session required for link/unlink actions.{" "}
            <a href="/ag-admin/login" className="text-sky-600 hover:underline">
              Sign in to AG
            </a>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <IDPOrgCard orgs={idpOrgs} available={idpAvailable} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-sky-950 mb-3">
          AG Organizations
          {agAvailable && (
            <span className="ml-2 text-[10px] font-normal text-stone-400 uppercase tracking-wide">
              {agPlan?.import_available ? "actions available" : "read-only"}
            </span>
          )}
        </h2>
        {/* THE-ABSENT-BACKEND made the not-configured half of this copy
            dead: this page short-circuits when AG is not enabled, so an
            unavailable AG here is always an enabled-but-unreachable one. */}
        {!agAvailable ? (
          <p className="text-xs text-stone-400">AG is not reachable.</p>
        ) : (
          <OrgLinkActions agOrgs={agPlan?.organizations ?? []} idpOrgs={idpOrgs} canAct={canAct} />
        )}
      </div>

      {idpAvailable && agAvailable && Boolean(agPlan?.import_available) && (
        <div>
          <h2 className="text-sm font-semibold text-sky-950 mb-1">
            Import IDP Organizations into AG
          </h2>
          <p className="text-xs text-stone-500 mb-3">
            IDP organizations not yet linked to an AG organization. Import creates a new AG
            organization and links it. Organizations only — no users, admins, or credentials are
            imported.
          </p>
          <IDPImportSection idpOrgs={idpOrgs} linkedIDPOrgIds={linkedIDPOrgIds} canAct={canAct} />
        </div>
      )}
    </div>
  );
}

// RelatedReadOnlyViews surfaces sibling pages that present the same
// org-link data in a strictly read-only view, distinct from the link /
// unlink / import controls on this page. Added 2026-06-11 to make the
// AG OSS plan page reachable from the existing org-link landing surface.
// This component is read-only: it renders <a> anchors only — no
// <button>, no onClick handler, no form, no server action.
function RelatedReadOnlyViews() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-2">
        Related read-only views
      </p>
      <ul className="space-y-1.5">
        <li>
          <a
            href="/site-admin/org-link/ag-plan"
            className="text-sm text-sky-600 hover:text-sky-700 underline"
          >
            AG OSS org-link plan (read-only)
          </a>
          <span className="text-xs text-stone-500 ml-2">
            Summary of AG organizations and their IDP link status. No write actions.
          </span>
        </li>
      </ul>
    </div>
  );
}

function ScopeWarning() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
      <p className="text-xs font-semibold text-amber-800">Organization scope only</p>
      <p className="text-xs text-amber-700 leading-relaxed">
        This page links organizations only. Users, org admins, passwords, MFA state, role bindings,
        and all credential or identity data are never imported or linked here. Admin assignment is a
        separate explicit workflow performed after organizations are linked.
      </p>
    </div>
  );
}

function IDPOrgCard({ orgs, available }: { orgs: IDPOrgSummaryForLink[]; available: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-950">IDP Organizations</p>
        <span
          className={`text-xs font-medium ${available ? "text-emerald-600" : "text-stone-400"}`}
        >
          {available ? `${orgs.length} found` : "Unavailable"}
        </span>
      </div>
      {/* Same dead-half cut: the page requires idp.enabled, so an
          unavailable IdP here is always enabled-but-unreachable. */}
      {!available && <p className="text-xs text-stone-400">IDP is not reachable.</p>}
      {available && orgs.length === 0 && (
        <p className="text-xs text-stone-400">No IDP organizations found.</p>
      )}
      {orgs.length > 0 && (
        <ul className="space-y-1">
          {orgs.slice(0, 10).map((o) => (
            <li key={o.id} className="flex items-center gap-2 text-xs">
              <span
                className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  o.active && !o.deleted ? "bg-emerald-500" : "bg-stone-300"
                }`}
              />
              <span className="font-medium text-stone-700">{o.name}</span>
              {o.domain && <span className="text-stone-400">{o.domain}</span>}
              {!o.has_admin && <span className="text-amber-600 text-[10px]">no admin</span>}
            </li>
          ))}
          {orgs.length > 10 && (
            <li className="text-xs text-stone-400">…and {orgs.length - 10} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
