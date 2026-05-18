/**
 * Deactivate confirmation page — site_admin only.
 * Fetches org details server-side. Requires explicit checkbox confirmation.
 * Only active, non-deleted organizations can be deactivated.
 * Mutations are handled by the server action in actions.ts.
 */
import { getOrganization } from "@/lib/idp-admin-client";
import type { Metadata } from "next";
import { DeactivateOrgForm } from "./form-client";

export const metadata: Metadata = { title: "Deactivate Organization — Identuum Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DeactivateOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <NotFoundPanel />;
  }

  const org = await getOrganization(id);

  if (!org) {
    return <NotFoundPanel />;
  }

  if (org.deleted) {
    return (
      <div className="max-w-lg space-y-4">
        <Breadcrumb orgName={org.name} />
        <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-4 shadow-sm">
          <p className="text-sm font-semibold text-stone-700">Organization is deleted</p>
          <p className="text-xs text-stone-400 mt-1">
            Deleted organizations cannot be deactivated. Restore the organization first.
          </p>
        </div>
        <a
          href="/site-admin/organizations?deleted=true"
          className="inline-block text-sm text-sky-600 hover:text-sky-700 underline"
        >
          View deleted organizations
        </a>
      </div>
    );
  }

  if (!org.active) {
    return (
      <div className="max-w-lg space-y-4">
        <Breadcrumb orgName={org.name} />
        <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-4 shadow-sm">
          <p className="text-sm font-semibold text-stone-700">Already inactive</p>
          <p className="text-xs text-stone-400 mt-1">
            This organization is already deactivated. Use the Reactivate action to re-enable it.
          </p>
        </div>
        <a
          href="/site-admin/organizations"
          className="inline-block text-sm text-sky-600 hover:text-sky-700 underline"
        >
          Back to organizations
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Breadcrumb orgName={org.name} />

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Deactivate organization
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Deactivated organizations remain in the system but users cannot log in.
        </p>
      </div>

      <div className="bg-white border border-amber-200 rounded-[1.5rem] px-5 py-4 shadow-sm space-y-1.5">
        <p className="text-sm font-semibold text-sky-950">{org.name}</p>
        <p className="text-xs text-stone-400 font-mono">{org.domain || "no domain"}</p>
        <p className="text-xs text-stone-400 mt-1">
          Status: <span className="text-emerald-600 font-medium">Active</span>
          {org.has_admin && (
            <span className="ml-2 text-sky-600 font-medium">· Has active admin</span>
          )}
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-6 shadow-sm">
        <DeactivateOrgForm orgId={org.id} orgName={org.name} />
      </div>
    </div>
  );
}

function Breadcrumb({ orgName }: { orgName: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-stone-400">
      <a href="/site-admin/organizations" className="hover:text-sky-950 transition-colors">
        Organizations
      </a>
      <span>/</span>
      <span className="text-stone-500 truncate max-w-xs">{orgName}</span>
      <span>/</span>
      <span>Deactivate</span>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-bold text-sky-950 mb-2 tracking-tight">Organization not found</h1>
      <p className="text-sm text-stone-500 leading-relaxed">
        The organization does not exist or you do not have permission to view it.
      </p>
      <a
        href="/site-admin/organizations"
        className="mt-4 inline-block text-sm text-sky-600 hover:text-sky-700 underline"
      >
        Back to organizations
      </a>
    </div>
  );
}
