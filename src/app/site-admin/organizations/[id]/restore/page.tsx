/**
 * Restore confirmation page — site_admin only.
 * Fetches org details server-side. Shows a simple confirm button.
 * Only soft-deleted organizations can be restored here.
 */

import type { Metadata } from "next";
import { getOrganization, listOrganizations } from "@/lib/idp-admin-client";
import { RestoreOrgForm } from "./form-client";

export const metadata: Metadata = { title: "Restore Organization — Identuum Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RestoreOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <NotFoundPanel />;
  }

  // OSS answers GET /organizations/:id with 404 for a soft-deleted
  // organization (RULE-FLOOR ORG-RESTORE-1), so a miss is looked up among
  // the deleted rows of the list.
  const org = (await getOrganization(id)) ?? (await findDeletedOrganization(id));

  if (!org) {
    return <NotFoundPanel />;
  }

  if (!org.deleted) {
    return (
      <div className="max-w-lg space-y-4">
        <Breadcrumb orgName={org.name} />
        <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-4 shadow-sm">
          <p className="text-sm font-semibold text-stone-700">Not deleted</p>
          <p className="text-xs text-stone-400 mt-1">
            This organization is not deleted and does not need to be restored.
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
          Restore organization
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Restore this organization and make it accessible again.
        </p>
      </div>

      {/* Org details */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] px-5 py-4 shadow-sm space-y-1.5">
        <p className="text-sm font-semibold text-sky-950">{org.name}</p>
        <p className="text-xs text-stone-400 font-mono">{org.domain || "no domain"}</p>
        <p className="text-xs text-stone-400 mt-1">
          Status: <span className="text-red-600 font-medium">Deleted</span>
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] p-6 shadow-sm">
        <RestoreOrgForm orgId={org.id} orgName={org.name} />
      </div>
    </div>
  );
}

const DELETED_PAGE_SIZE = 100; // listOrganizations caps the page size at 100
const DELETED_PAGES_MAX = 20; // at most 2,000 deleted organizations are searched

async function findDeletedOrganization(id: string) {
  for (let page = 0; page < DELETED_PAGES_MAX; page++) {
    const res = await listOrganizations({
      offset: page * DELETED_PAGE_SIZE,
      limit: DELETED_PAGE_SIZE,
      deleted: "true",
      active: "all",
    });
    if (!res) return null;
    const hit = res.organizations.find((o) => o.id === id);
    if (hit) return hit;
    if (
      res.organizations.length < DELETED_PAGE_SIZE ||
      (page + 1) * DELETED_PAGE_SIZE >= res.total_count
    ) {
      return null;
    }
  }
  return null;
}

function Breadcrumb({ orgName }: { orgName: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-stone-400">
      <a
        href="/site-admin/organizations?deleted=true"
        className="hover:text-sky-950 transition-colors"
      >
        Organizations
      </a>
      <span>/</span>
      <span className="text-stone-500 truncate max-w-xs">{orgName}</span>
      <span>/</span>
      <span>Restore</span>
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
        href="/site-admin/organizations?deleted=true"
        className="mt-4 inline-block text-sm text-sky-600 hover:text-sky-700 underline"
      >
        View deleted organizations
      </a>
    </div>
  );
}
