/**
 * Org-admin Service Accounts page.
 *
 * Read-only list of M2M service accounts in the calling org_admin's
 * organization. Auth + role are enforced by the parent /org-admin
 * layout.
 *
 * Backend (gograph-verified):
 *   GET /api/v1/organizations/:id/service-accounts → list.
 *   Response: {service_accounts: [types.ServiceAccount]} — id, organization_id,
 *   name, description, role, created_at, updated_at. NO credential,
 *   NO secret, NO hash, NO private-key field appears anywhere on the
 *   service-account wire surface.
 *
 * SECURITY:
 *   - Wire helper projects an EXPLICIT safe field allowlist; no raw
 *     backend object is spread into React props.
 *   - The page renders ONLY operator-safe public configuration. There
 *     is no credential, secret, key, or token surface on this slice —
 *     the IDP backend currently has no route that mints, lists, or
 *     rotates service-account credentials. Operators who need a
 *     usable client_credentials grant must link the service account
 *     to an OAuth client via a separate (future) backend slice.
 */
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { getOwnOrganization, listServiceAccounts } from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { OrgServiceAccountItem } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Service accounts — Identuum Org Admin",
};

export default async function OrgAdminServiceAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ deleted?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const deletedName =
    typeof params.deleted === "string" && params.deleted.length > 0 ? params.deleted : null;

  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "service_accounts",
  });
  const org = capabilityBoundary ? null : await getOwnOrganization();
  const result = !capabilityBoundary && org?.id ? await listServiceAccounts(org.id) : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Service accounts</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Machine-to-machine identities for your organization. No usable credential is issued here
            — link a service account to an OAuth client (a future feature) to obtain a
            client_credentials grant.
          </p>
        </div>
        <a
          href="/org-admin/service-accounts/new"
          className="shrink-0 inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Create service account
        </a>
      </div>

      {deletedName && <DeletedNotice name={deletedName} />}

      {capabilityBoundary && <CapabilityUnavailablePanel copy={capabilityBoundary} />}
      {!capabilityBoundary && !org?.id && <OrgUnknownPanel />}
      {result && !result.ok && result.featureUnavailable && <FeatureUnavailablePanel />}
      {result && !result.ok && result.forbidden && <ForbiddenPanel />}
      {result && !result.ok && !result.featureUnavailable && !result.forbidden && <ErrorPanel />}

      {result?.ok && result.serviceAccounts.length === 0 && <EmptyPanel />}

      {result?.ok && result.serviceAccounts.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">
              {result.serviceAccounts.length === 1
                ? "1 service account"
                : `${result.serviceAccounts.length} service accounts`}
            </p>
            <p className="text-xs text-stone-400 mt-0.5">
              These identities can be granted roles inside this organization but cannot authenticate
              until linked to an OAuth client.
            </p>
          </div>
          <ul className="divide-y divide-stone-100">
            {result.serviceAccounts.map((sa) => (
              <ServiceAccountRow key={sa.id} sa={sa} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ServiceAccountRow({ sa }: { sa: OrgServiceAccountItem }) {
  return (
    <li className="px-6 py-4 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-sky-950 truncate">{sa.name}</p>
          {sa.description && <p className="text-xs text-stone-500 truncate">{sa.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Badge tone={sa.role === "org_admin" ? "sky" : "stone"} label={sa.role || "—"} />
          <a
            href={`/org-admin/service-accounts/${encodeURIComponent(sa.id)}`}
            aria-label={`View service account ${sa.name}`}
            className="text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
          >
            View details →
          </a>
        </div>
      </div>
    </li>
  );
}

function Badge({ tone, label }: { tone: "sky" | "stone"; label: string }) {
  const cls = tone === "sky" ? "text-sky-700 bg-sky-100" : "text-stone-600 bg-stone-100";
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function DeletedNotice({ name }: { name: string }) {
  return (
    <output
      aria-live="polite"
      className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
    >
      Deleted {name}.
    </output>
  );
}

function EmptyPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No service accounts yet</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        Your organization hasn{"'"}t registered any service accounts. Click "Create service account"
        above to add one.
      </p>
    </div>
  );
}

function OrgUnknownPanel() {
  return (
    <div className="bg-white border border-amber-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-amber-800">Organization not resolved</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Could not resolve your organization. Reload the page or contact your platform administrator.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        You do not have permission to view service accounts for this organization.
      </p>
    </div>
  );
}

function FeatureUnavailablePanel() {
  return (
    <div className="bg-white border border-amber-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-amber-800">Service accounts are not available</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Service accounts are an IDP machine-to-machine surface when the backend exposes it. This IDP
        backend did not make the endpoint available.
      </p>
    </div>
  );
}

function CapabilityUnavailablePanel({ copy }: { copy: AuthorizationServerPageBoundary }) {
  return (
    <div className="bg-white border border-amber-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-amber-800">{copy.title}</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">{copy.body}</p>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load service accounts</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}
