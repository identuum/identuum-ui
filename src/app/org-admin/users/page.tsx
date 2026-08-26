/**
 * Org-admin Users page — lists and manages users in the org_admin's organization.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Status is derived from explicit backend-authoritative fields:
 *   deleted=true              → "Deleted"
 *   invitation_pending=true   → "Pending" (unclaimed invitation)
 *   active=false              → "Disabled" (admin-suspended account)
 *   (otherwise)               → "Active"
 *
 * The sentinel-email heuristic (noemail+...@no-email.internal) is kept as a
 * defensive fallback for any API response that pre-dates invitation_pending.
 */
import { listOrgUsers } from "@/lib/idp-admin-client";
import type { OrgUserItem } from "@/lib/types";
import type { Metadata } from "next";
import { BulkInviteSection } from "./bulk-invite-section";
import { InviteUserSection } from "./invite-section";
import { RegenerateInviteLink, UserRowActions } from "./user-row-actions";

export const metadata: Metadata = { title: "Users — Identuum Org Admin" };

type StatusFilter = "all" | "active" | "pending" | "pending_approval" | "disabled";

/**
 * Defensive fallback: detect sentinel emails from older API responses that
 * pre-date the invitation_pending field.
 */
function isNoEmailSentinel(email: string): boolean {
  return email.startsWith("noemail+") && email.endsWith("@no-email.internal");
}

function computeStatus(
  user: OrgUserItem
): "active" | "pending" | "pending_approval" | "disabled" | "deleted" {
  if (user.deleted) return "deleted";
  // Use the explicit backend field first.
  if (user.invitation_pending) return "pending";
  // Defensive fallback: sentinel email without the new field.
  if (isNoEmailSentinel(user.email) && !user.email_verified) return "pending";
  // IDP creates self-registered users with banned=true; only ApproveRegistration
  // flips it. The list-level computation mirrors deriveOrgAdminUserActions on
  // the detail page so both surfaces stay in lockstep.
  if (user.banned && user.role === "org_user") return "pending_approval";
  if (!user.active) return "disabled";
  return "active";
}

export default async function OrgAdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const rawFilter = params.status ?? "all";
  const filter: StatusFilter = [
    "all",
    "active",
    "pending",
    "pending_approval",
    "disabled",
  ].includes(rawFilter)
    ? (rawFilter as StatusFilter)
    : "all";

  const listResult = await listOrgUsers();
  const users = listResult?.users ?? null;
  // TRUNCATION IS VISIBLE, never silent: the client fetches one 200-row
  // window; when the backend's total exceeds what we hold, the page says so
  // instead of presenting a partial list as complete.
  const totalUsers = listResult?.total ?? 0;
  const truncated = users !== null && totalUsers > users.length;

  // Count active org_admins to know if the sole admin protection applies
  const activeAdminCount =
    users?.filter((u) => u.role === "org_admin" && u.active && !u.deleted).length ?? 0;

  const displayUsers =
    users === null
      ? null
      : filter === "all"
        ? users.filter((u) => !u.deleted) // hide deleted by default
        : users.filter((u) => computeStatus(u) === filter);

  const totalByStatus = users
    ? {
        all: users.filter((u) => !u.deleted).length,
        active: users.filter((u) => computeStatus(u) === "active").length,
        pending: users.filter((u) => computeStatus(u) === "pending").length,
        pending_approval: users.filter((u) => computeStatus(u) === "pending_approval").length,
        disabled: users.filter((u) => computeStatus(u) === "disabled").length,
      }
    : null;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Users</h1>
        <p className="text-sm text-stone-500 mt-0.5">Members of your organization.</p>
      </div>

      <div className="flex items-start gap-2 flex-wrap">
        <InviteUserSection />
        <BulkInviteSection />
      </div>

      {truncated && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            Showing the first {users?.length} of {totalUsers} users. The remaining users exist but
            are not displayed on this page — status counts below cover only the loaded window.
          </p>
        </div>
      )}

      {/* Filter tabs */}
      {totalByStatus && (
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              { key: "all", label: "All", count: totalByStatus.all },
              { key: "active", label: "Active", count: totalByStatus.active },
              { key: "pending", label: "Pending", count: totalByStatus.pending },
              {
                key: "pending_approval",
                label: "Pending approval",
                count: totalByStatus.pending_approval,
              },
              { key: "disabled", label: "Disabled", count: totalByStatus.disabled },
            ] as const
          ).map(({ key, label, count }) => (
            <a
              key={key}
              href={key === "all" ? "/org-admin/users" : `/org-admin/users?status=${key}`}
              className={[
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === key
                  ? "bg-sky-100 text-sky-800"
                  : "bg-stone-100 text-stone-500 hover:bg-stone-200",
              ].join(" ")}
            >
              {label}
              {count > 0 && (
                <span
                  className={[
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    filter === key ? "bg-sky-200 text-sky-900" : "bg-stone-200 text-stone-600",
                  ].join(" ")}
                >
                  {count}
                </span>
              )}
            </a>
          ))}
        </div>
      )}

      {displayUsers === null ? (
        <ErrorState />
      ) : displayUsers.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <UsersTable users={displayUsers} activeAdminCount={activeAdminCount} />
      )}
    </div>
  );
}

function UsersTable({
  users,
  activeAdminCount,
}: {
  users: OrgUserItem[];
  activeAdminCount: number;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          {users.length} {users.length === 1 ? "user" : "users"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50/60">
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>MFA</Th>
              <Th>Joined</Th>
              <Th>Last login</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((user) => (
              <UserRow key={user.id} user={user} activeAdminCount={activeAdminCount} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  user,
  activeAdminCount,
}: {
  user: OrgUserItem;
  activeAdminCount: number;
}) {
  const status = computeStatus(user);

  const statusBadge: Record<typeof status, { label: string; cls: string }> = {
    active: { label: "Active", cls: "text-emerald-700 bg-emerald-50" },
    pending: { label: "Pending", cls: "text-amber-700 bg-amber-50" },
    pending_approval: { label: "Pending approval", cls: "text-violet-700 bg-violet-50" },
    disabled: { label: "Disabled", cls: "text-stone-500 bg-stone-100" },
    deleted: { label: "Deleted", cls: "text-red-500 bg-red-50" },
  };

  const roleBadge: Record<string, { label: string; cls: string }> = {
    org_admin: { label: "Admin", cls: "text-sky-700 bg-sky-50" },
    org_user: { label: "Member", cls: "text-stone-600 bg-stone-100" },
    site_admin: { label: "System", cls: "text-violet-700 bg-violet-50" },
  };

  const badge = statusBadge[status];
  const role = roleBadge[user.role] ?? { label: user.role, cls: "text-stone-500 bg-stone-100" };

  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  const lastLogin = user.last_login_at
    ? new Date(user.last_login_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  // Disable the "Disable" button if this is the last active admin.
  const isSoleActiveAdmin = user.role === "org_admin" && user.active && activeAdminCount <= 1;

  // Show Disable/Enable only for fully active or admin-disabled users.
  // Pending invitations and pending-approval registrations are not yet
  // functional accounts; skip lifecycle actions for them to avoid confusing
  // the admin. Pending-approval rows direct the operator to the detail page
  // where the Approve affordance lives.
  const showActions =
    !user.deleted &&
    user.role !== "site_admin" &&
    status !== "pending" &&
    status !== "pending_approval";

  // Display label: use backend-authoritative invitation fields,
  // fall back to sentinel email detection for older API responses.
  const isManualInvite =
    (user.invitation_pending && !user.invitation_email_bound) ||
    (!user.invitation_email_bound && isNoEmailSentinel(user.email));
  const displayEmail = isNoEmailSentinel(user.email) ? null : user.email || null;

  return (
    <tr className="hover:bg-stone-50/40 transition-colors">
      {/* User identity — links to detail page */}
      <td className="px-5 py-3.5 min-w-[180px]">
        <a
          href={`/org-admin/users/${user.id}`}
          className="block group"
          aria-label={`View details for ${isManualInvite ? (user.name ?? "manual invite") : (displayEmail ?? "pending user")}`}
        >
          {isManualInvite ? (
            <>
              <p className="text-sm font-medium text-amber-700 group-hover:text-amber-800 truncate max-w-[220px] transition-colors">
                {user.name ?? "Manual invite pending"}
              </p>
              <p className="text-xs text-stone-400 italic mt-0.5">
                No email — link not yet claimed
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-sky-950 group-hover:text-sky-700 truncate max-w-[200px] transition-colors">
                {displayEmail ?? <span className="italic text-stone-400 text-xs">No email</span>}
              </p>
              {user.name && (
                <p className="text-xs text-stone-400 mt-0.5 truncate max-w-[200px]">{user.name}</p>
              )}
            </>
          )}
        </a>
      </td>

      {/* Role */}
      <td className="px-5 py-3.5">
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${role.cls}`}>
          {role.label}
        </span>
      </td>

      {/* Status */}
      <td className="px-5 py-3.5">
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${badge.cls}`}>
          {badge.label}
        </span>
      </td>

      {/* MFA */}
      <td className="px-5 py-3.5">
        {user.mfa_enabled ? (
          <span className="inline-block text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
            On
          </span>
        ) : (
          <span className="inline-block text-xs text-stone-300 px-2 py-0.5">—</span>
        )}
      </td>

      {/* Joined */}
      <td className="px-5 py-3.5 text-xs text-stone-400 whitespace-nowrap">{joinedDate}</td>

      {/* Last login */}
      <td className="px-5 py-3.5 text-xs text-stone-400 whitespace-nowrap">{lastLogin}</td>

      {/* Actions */}
      <td className="px-5 py-3.5 text-right">
        <div className="inline-flex flex-col items-end gap-1.5">
          <a
            href={`/org-admin/users/${user.id}`}
            className="text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap"
          >
            Details
          </a>
          {status === "pending" && !user.deleted && user.role !== "site_admin" ? (
            <RegenerateInviteLink userId={user.id} />
          ) : (
            showActions && (
              <UserRowActions
                userId={user.id}
                active={user.active}
                disableDisable={isSoleActiveAdmin}
              />
            )
          )}
        </div>
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
      {children}
    </th>
  );
}

function EmptyState({ filter }: { filter: StatusFilter }) {
  const messages: Record<StatusFilter, { title: string; sub: string }> = {
    all: {
      title: "No users yet",
      sub: "Invite a member to get started.",
    },
    active: {
      title: "No active users",
      sub: "No members are currently active in your organization.",
    },
    pending: {
      title: "No pending invitations",
      sub: "All invitations have been claimed or none have been sent.",
    },
    pending_approval: {
      title: "No pending registrations",
      sub: "No self-registered users are waiting for approval.",
    },
    disabled: {
      title: "No disabled users",
      sub: "No members have been disabled.",
    },
  };

  const { title, sub } = messages[filter];

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-8 py-12 text-center">
      <p className="text-sm font-semibold text-stone-500">{title}</p>
      <p className="text-xs text-stone-400 mt-1">{sub}</p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-8 py-12 text-center">
      <p className="text-sm font-semibold text-red-600">Could not load users</p>
      <p className="text-xs text-stone-400 mt-1">
        The identity service is unavailable. Please try again in a moment.
      </p>
    </div>
  );
}
