/**
 * Edit organization page — site_admin only.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * This page fetches current org data server-side for form prefill, then
 * renders the client-side edit form. Internal URLs and cookies are never
 * included in props passed to the client component.
 *
 * Mutations use the server action in actions.ts, which independently
 * revalidates site_admin before calling the IdP.
 *
 * Delete, restore, and assign-admin are intentionally not implemented here.
 */

import type { Metadata } from "next";
import { getOrganization } from "@/lib/idp-admin-client";
import { EditOrgForm } from "./form-client";

export const metadata: Metadata = { title: "Edit Organization — Identuum Admin" };

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Basic format check before making a backend call.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
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
        <div className="bg-white border border-amber-200 rounded-[1.5rem] px-5 py-4 shadow-sm">
          <p className="text-sm font-semibold text-amber-600">Organization is deleted</p>
          <p className="text-xs text-stone-500 mt-1">
            This organization has been soft-deleted. Restore it before editing.
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
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Edit organization</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Update name, status, and policy settings. Domain changes and advanced settings are not
          available from this form.
        </p>
      </div>

      {/* Current org summary */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-3.5 shadow-sm text-xs text-stone-400 space-y-0.5">
        <p>
          <span className="text-stone-500">ID:</span>{" "}
          <span className="font-mono text-sky-950">{org.id}</span>
        </p>
        <p>
          <span className="text-stone-500">Domain:</span>{" "}
          <span className="font-mono">{org.domain || "—"}</span>
        </p>
        <p>
          <span className="text-stone-500">Slug:</span>{" "}
          <span className="font-mono">{org.slug || "—"}</span>
        </p>
      </div>

      {/* Edit form */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-6 shadow-sm">
        <EditOrgForm org={org} />
      </div>

      {/* Deferred actions note */}
      <p className="text-xs text-stone-400">
        Delete, restore, and admin assignment are not available from this form.
      </p>
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
      <span>Edit</span>
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
