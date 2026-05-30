"use client";

import type { OrgListItem, OrgListResult } from "@/lib/types";

type DeletedFilter = "false" | "true" | "all";

interface OrganizationsClientProps {
  initialData: OrgListResult | null;
  /** Current 1-based page number (validated server-side). */
  page: number;
  /** Validated server-side deleted filter: "false" | "true" | "all". */
  deletedFilter: DeletedFilter;
}

export function OrganizationsClient({
  initialData,
  page,
  deletedFilter,
}: OrganizationsClientProps) {
  const hasPrev = page > 1;
  const hasNext =
    initialData !== null && initialData.offset + initialData.count < initialData.total_count;

  function pageHref(p: number) {
    return `/site-admin/organizations?page=${p}&deleted=${deletedFilter}`;
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Organizations</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            All tenant organizations. Manage lifecycle and admin assignment.
          </p>
        </div>
        <a
          href="/site-admin/organizations/new"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
        >
          + New organization
        </a>
      </div>

      {/* Filter tabs */}
      <FilterTabs current={deletedFilter} />

      {/* Count summary */}
      <p className="text-xs text-stone-400">{countSummary(initialData)}</p>

      {/* Content area */}
      {initialData === null ? (
        <ErrorState />
      ) : initialData.organizations.length === 0 ? (
        <EmptyState deletedFilter={deletedFilter} />
      ) : (
        <OrgTable orgs={initialData.organizations} />
      )}

      {/* Pagination controls */}
      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between pt-2">
          <PaginationLink
            href={hasPrev ? pageHref(page - 1) : undefined}
            label="← Previous"
            disabled={!hasPrev}
          />
          <span className="text-xs text-stone-400">Page {page}</span>
          <PaginationLink
            href={hasNext ? pageHref(page + 1) : undefined}
            label="Next →"
            disabled={!hasNext}
          />
        </div>
      )}
    </div>
  );
}

function FilterTabs({ current }: { current: DeletedFilter }) {
  const tabs: Array<{ label: string; value: DeletedFilter }> = [
    { label: "Current", value: "false" },
    { label: "Deleted", value: "true" },
    { label: "All", value: "all" },
  ];
  return (
    <div className="flex gap-1">
      {tabs.map(({ label, value }) => {
        const isActive = current === value;
        return (
          <a
            key={value}
            href={`/site-admin/organizations?deleted=${value}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              isActive
                ? "bg-sky-50 text-sky-700 border border-sky-200"
                : "text-stone-500 hover:bg-stone-100 hover:text-sky-950"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {label}
          </a>
        );
      })}
    </div>
  );
}

function countSummary(data: OrgListResult | null): string {
  if (data === null) return "";
  const { total_count, count, offset } = data;
  if (total_count === 0) return "No organizations found.";
  if (total_count <= count && offset === 0) {
    return `Showing all ${total_count} organization${total_count === 1 ? "" : "s"}`;
  }
  const first = offset + 1;
  const last = offset + count;
  return `Showing ${first}–${last} of ${total_count} organizations`;
}

function PaginationLink({
  href,
  label,
  disabled,
}: {
  href: string | undefined;
  label: string;
  disabled: boolean;
}) {
  if (disabled || !href) {
    return (
      <span className="text-xs text-stone-300 px-3 py-1.5 rounded-lg cursor-not-allowed select-none">
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="text-xs text-stone-500 hover:text-sky-950 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-stone-300 transition-colors"
    >
      {label}
    </a>
  );
}

function OrgTable({ orgs }: { orgs: OrgListItem[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 bg-white">
            <Th>Name</Th>
            <Th>Domain</Th>
            <Th>Status</Th>
            <Th>Admin</Th>
            <Th>Created</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {orgs.map((org) => (
            <tr key={org.id} className="hover:bg-stone-50/60 transition-colors">
              <td className="px-5 py-3.5">
                <p className={`font-medium ${org.deleted ? "text-stone-400" : "text-sky-950"}`}>
                  {org.name}
                </p>
                {org.slug && <p className="text-xs text-stone-400 font-mono mt-0.5">{org.slug}</p>}
              </td>
              <td className="px-5 py-3.5 text-stone-500 font-mono text-xs">
                {org.domain || <span className="text-stone-300">—</span>}
              </td>
              <td className="px-5 py-3.5">
                <StatusBadge active={org.active} deleted={org.deleted} />
              </td>
              <td className="px-5 py-3.5">
                <AdminStateBadge org={org} />
              </td>
              <td className="px-5 py-3.5 text-stone-400 text-xs">{formatDate(org.created_at)}</td>
              <td className="px-5 py-3.5">
                <OrgActions org={org} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgActions({ org }: { org: OrgListItem }) {
  if (org.deleted) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`/site-admin/organizations/${org.id}`}
          className="text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Details
        </a>
        <a
          href={`/site-admin/organizations/${org.id}/restore`}
          className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Restore
        </a>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`/site-admin/organizations/${org.id}`}
        className="text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
      >
        Details
      </a>
      <a
        href={`/site-admin/organizations/${org.id}/edit`}
        className="text-xs font-semibold text-stone-500 hover:text-sky-700 bg-stone-100 hover:bg-sky-50 border border-stone-200 hover:border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
      >
        Edit
      </a>
      {/* Deactivate for active orgs; Reactivate for inactive orgs */}
      {org.active ? (
        <a
          href={`/site-admin/organizations/${org.id}/deactivate`}
          className="text-xs font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Deactivate
        </a>
      ) : (
        <a
          href={`/site-admin/organizations/${org.id}/reactivate`}
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Reactivate
        </a>
      )}
      {/* Show "Assign admin" when no blocking admin exists: either no admin at all
          (!has_admin) or admins exist but none are verified (can_assign_admin recovery). */}
      {(!org.has_admin || org.can_assign_admin) && (
        <a
          href={`/site-admin/organizations/${org.id}/assign-admin`}
          className="text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Assign admin
        </a>
      )}
      <a
        href={`/site-admin/organizations/${org.id}/delete`}
        className="text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-100 px-3 py-1.5 rounded-lg transition-colors"
      >
        Archive
      </a>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">
      {children}
    </th>
  );
}

function StatusBadge({ active, deleted }: { active: boolean; deleted: boolean }) {
  if (deleted) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
        Deleted
      </span>
    );
  }
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 border border-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-500">
      Inactive
    </span>
  );
}

function AdminStateBadge({ org }: { org: OrgListItem }) {
  // Derive the three-state admin signal mirroring the detail page Operational status card.
  // Labels are shortened for table rows; detail page copy is more explanatory.
  const state: "active" | "expired-pending" | "no-admin" =
    org.has_admin && !org.can_assign_admin
      ? "active"
      : org.has_admin && org.can_assign_admin
        ? "expired-pending"
        : "no-admin";

  const label =
    state === "active"
      ? "Admin active"
      : state === "expired-pending"
        ? "Invitation expired"
        : "No admin";

  // Deleted orgs: show state in muted style — admin management is suspended
  if (org.deleted) {
    return (
      <span className="inline-flex items-center rounded-full bg-stone-50 border border-stone-200 px-2 py-0.5 text-xs font-medium text-stone-400">
        {label}
      </span>
    );
  }

  if (state === "active") {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-xs font-semibold text-sky-700">
        {label}
      </span>
    );
  }

  // expired-pending or no-admin: amber warning signal, recovery available
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-700">
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function EmptyState({ deletedFilter }: { deletedFilter: DeletedFilter }) {
  const message =
    deletedFilter === "true"
      ? "No deleted organizations."
      : deletedFilter === "all"
        ? "No organizations found."
        : "No active organizations found.";
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] px-6 py-12 text-center shadow-sm">
      <p className="text-sm font-medium text-stone-400">{message}</p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] px-6 py-8 shadow-sm">
      <p className="text-sm font-medium text-red-600">Could not load organizations</p>
      <p className="text-xs text-stone-500 mt-1">
        The IdP backend returned an error or is temporarily unavailable. Reload the page to retry.
      </p>
    </div>
  );
}
