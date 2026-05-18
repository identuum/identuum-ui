/**
 * Assign first org_admin page — site_admin only.
 *
 * Only valid for organizations that:
 *   - exist and are not soft-deleted
 *   - have no active org_admin (has_admin === false)
 *
 * Auth is enforced by the parent /site-admin layout guard.
 * The server action in actions.ts independently revalidates site_admin.
 */
import { getOrganization } from "@/lib/idp-admin-client";
import type { Metadata } from "next";
import { AssignAdminForm } from "./form-client";

export const metadata: Metadata = { title: "Assign Admin — Identuum Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssignAdminPage({
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
            Admin assignment is not available for deleted organizations. Restore the organization
            first.
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

  if (!org.can_assign_admin) {
    return (
      <div className="max-w-lg space-y-4">
        <Breadcrumb orgName={org.name} />
        <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-4 shadow-sm">
          <p className="text-sm font-semibold text-stone-700">
            Recovery delegation not available
          </p>
          <p className="text-xs text-stone-400 mt-1">
            <span className="font-medium text-sky-950">{org.name}</span> has an active administrator
            account or a pending setup link that has not yet expired. Recovery delegation is only
            available when neither condition applies.
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
    <div className="space-y-6 max-w-2xl">
      <Breadcrumb orgName={org.name} />

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Assign administrator
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Generate a one-time setup link to delegate the first org_admin for this organization.
          This action is available when no active administrator account or valid pending invitation
          exists.
        </p>
      </div>

      {/* Org summary */}
      <div className="bg-white border border-amber-200 rounded-[1.5rem] px-5 py-3.5 shadow-sm text-xs space-y-0.5">
        <p className="text-sm font-semibold text-sky-950">{org.name}</p>
        <p className="text-stone-400 font-mono">{org.domain || "no domain"}</p>
        <p className="text-amber-600 font-medium mt-1">Recovery delegation available</p>
        {!org.active && (
          <p className="text-stone-400 mt-0.5">
            This organization is currently <span className="font-medium text-stone-500">inactive</span>.
            Users will not be able to log in until it is reactivated.
          </p>
        )}
      </div>

      {/* Inactive org notice */}
      {!org.active && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs font-semibold text-stone-600">Organization is inactive</p>
          <p className="text-xs text-stone-400 mt-1 leading-relaxed">
            You can still assign an administrator to an inactive organization. Once the admin
            claims their account, they can reactivate the organization from the site-admin
            Organizations page.
          </p>
        </div>
      )}

      {/* Form */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-6 shadow-sm">
        <AssignAdminForm orgId={org.id} orgName={org.name} />
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
      <span>Assign admin</span>
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
