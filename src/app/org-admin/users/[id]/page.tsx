/**
 * Org-admin user detail page.
 *
 * Auth and role are enforced by the parent /org-admin layout.
 * This page does NOT repeat the guard.
 *
 * Backend: GET /api/v1/users/:id
 *   - Org scoping enforced at service layer (ErrForbidden for cross-org IDs).
 *   - Returns 404 for non-existent users; this page shows a safe error state.
 *
 * Security:
 *   - User ID is UUID-validated server-side before fetching.
 *   - Sentinel emails are never rendered as user-visible email addresses.
 *   - No passwords, tokens, MFA secrets, session IDs, or WebAuthn data are shown.
 */

import type { Metadata } from "next";
import { AuditIdentityCell } from "@/components/shared/audit-identity-cell";
import { UserUnavailable } from "@/components/shared/user-unavailable";
import { LocalTime } from "@/components/ui/local-time";
import type { OrgRoleItem } from "@/lib/idp-admin-client";
import {
  getOrgUserById,
  getOwnOrganization,
  listAuditEvents,
  listOrgRoles,
  listOrgUsers,
  listUserRoles,
  UserDetailUnavailable,
} from "@/lib/idp-admin-client";
import { ResetMFAButton, UserRowActions } from "../user-row-actions";
import { ApproveButton } from "./approve-button";
import {
  APPROVE_REGISTRATION_COPY,
  BANNED_AMBIGUOUS_STATUS_LABEL,
  buildOrgAdminUserAuditHref,
  computeOrgUserStatus,
  deriveOrgAdminUserActions,
  isNoEmailSentinel,
  RECENT_ACTIVITY_COPY,
  SOLE_ACTIVE_ADMIN_COPY,
} from "./user-detail-actions";
import { UserRolesCard } from "./user-roles-card";

export const metadata: Metadata = { title: "User — Identuum Org Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrgAdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <NotFoundPanel />;
  }

  // Fetch user identity, org context (for the role-assignment dropdown source),
  // org-wide user list (for sole-active-admin count), the per-user role list,
  // and the per-subject audit feed. listOrgRoles is only useful for the
  // dropdown — if there is no org id available we surface that as the
  // available-roles-load error inside the roles card.
  const [user, org, allUsers, assignedRolesResult, recentAuditResult] = await Promise.all([
    getOrgUserById(id).catch((error: unknown) => {
      if (error instanceof UserDetailUnavailable) return error;
      throw error;
    }),
    getOwnOrganization(),
    listOrgUsers(),
    listUserRoles(id).catch(() => null),
    listAuditEvents({ subjectId: id, pageSize: 8 }).catch(() => null),
  ]);

  if (user instanceof UserDetailUnavailable)
    return <UserUnavailable retryHref={`/org-admin/users/${encodeURIComponent(id)}`} />;
  if (!user) {
    return <NotFoundPanel />;
  }

  // Fetch the dropdown source only when the org id is available.
  const availableRolesResult = org?.id ? await listOrgRoles(org.id).catch(() => null) : null;
  const assignedRoles: OrgRoleItem[] = assignedRolesResult?.ok ? assignedRolesResult.roles : [];
  const availableRoles: OrgRoleItem[] = availableRolesResult?.ok ? availableRolesResult.roles : [];
  const assignedLoadError = !!(assignedRolesResult && !assignedRolesResult.ok);
  const availableLoadError = !!(availableRolesResult && !availableRolesResult.ok) || !org?.id;

  // Count active, non-deleted org_admins to determine last-admin protection.
  // If listOrgUsers fails (null), default activeAdminCount=0 — the helper's
  // soleActiveAdmin guard then fires only when user.role === "org_admin"
  // && user.active, which still surfaces the explanatory copy and lets the
  // backend enforce the final guard on submission.
  const activeAdminCount =
    allUsers?.users.filter((u) => u.role === "org_admin" && u.active && !u.deleted).length ?? 0;
  // The registration policy decides whether a banned org_user can be a
  // self-registrant awaiting approval (null when the org could not be read).
  const registrationPolicy = org
    ? {
        allow_public_registration: org.allow_public_registration,
        require_registration_approval: org.require_registration_approval,
      }
    : null;
  const status = computeOrgUserStatus(user, registrationPolicy);
  const { actions, soleActiveAdmin: isSoleActiveAdmin } = deriveOrgAdminUserActions(
    user,
    activeAdminCount,
    registrationPolicy
  );
  const isManualInvite =
    (user.invitation_pending && !user.invitation_email_bound) ||
    (!user.invitation_email_bound && isNoEmailSentinel(user.email));
  const displayEmail = isNoEmailSentinel(user.email) ? null : user.email || null;

  const headingName = user.name ?? displayEmail ?? "Pending user";

  const statusConfig = {
    active: { label: "Active", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    pending: { label: "Pending", cls: "text-amber-700 bg-amber-50 border-amber-200" },
    pending_approval: {
      label: BANNED_AMBIGUOUS_STATUS_LABEL,
      cls: "text-violet-700 bg-violet-50 border-violet-200",
    },
    disabled: { label: "Disabled", cls: "text-stone-500 bg-stone-100 border-stone-200" },
    deleted: { label: "Deleted", cls: "text-red-600 bg-red-50 border-red-100" },
  } as const;

  const roleConfig: Record<string, { label: string; cls: string }> = {
    org_admin: { label: "Admin", cls: "text-sky-700 bg-sky-50 border-sky-200" },
    org_user: { label: "Member", cls: "text-stone-600 bg-stone-100 border-stone-200" },
    site_admin: { label: "System", cls: "text-violet-700 bg-violet-50 border-violet-200" },
  };

  const sBadge = statusConfig[status];
  const rBadge = roleConfig[user.role] ?? {
    label: user.role,
    cls: "text-stone-500 bg-stone-100 border-stone-200",
  };

  // Action visibility is derived by deriveOrgAdminUserActions(). The
  // local booleans below are kept as thin aliases so the JSX below
  // remains byte-identical; tests pin the underlying matrix.
  const showLifecycleActions = actions.includes("disable") || actions.includes("enable");
  const showMFAReset = actions.includes("reset-mfa");
  const showApproveRegistration = actions.includes("approve-registration");
  // The Assigned-roles card is only meaningful for tenant users. site_admin
  // identities cannot be modified from the /org-admin surface (authority
  // boundary), and deleted users have no actionable roles to show.
  const showRolesCard = !user.deleted && user.role !== "site_admin";

  return (
    <div data-testid="user-detail" data-id={id} className="space-y-6 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <a href="/org-admin/users" className="hover:text-sky-950 transition-colors">
          Users
        </a>
        <span>/</span>
        <span className="text-stone-500 truncate max-w-[260px]">{headingName}</span>
      </div>

      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-start gap-3 flex-wrap">
          <h1
            data-testid="user-email"
            className="text-2xl font-extrabold tracking-tight text-sky-950 break-all"
          >
            {isManualInvite ? (
              <span className="text-amber-700">{user.name ?? "Manual invite pending"}</span>
            ) : (
              (displayEmail ?? <span className="text-stone-400 italic">No email</span>)
            )}
          </h1>
        </div>
        {user.name && displayEmail && <p className="text-sm text-stone-500">{user.name}</p>}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${sBadge.cls}`}
          >
            {sBadge.label}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${rBadge.cls}`}
          >
            {rBadge.label}
          </span>
          {user.mfa_enabled && (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
              MFA on
            </span>
          )}
        </div>
      </div>

      {/* Details card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Account details</p>
        </div>
        <dl className="divide-y divide-stone-100">
          {isManualInvite ? (
            <DetailRow label="Email">
              <span className="text-stone-400 italic text-xs">
                No email — manual invite pending claim
              </span>
            </DetailRow>
          ) : (
            <DetailRow label="Email">
              <span className="font-mono text-xs text-sky-950 break-all">
                {displayEmail ?? "—"}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Display name">
            {user.name ? (
              <span className="text-xs text-sky-950">{user.name}</span>
            ) : (
              <span className="text-xs text-stone-300">—</span>
            )}
          </DetailRow>
          <DetailRow label="Role">
            <span className="text-xs text-sky-950">{rBadge.label}</span>
          </DetailRow>
          <DetailRow label="Status">
            <span className={`text-xs font-medium ${sBadge.cls.split(" ").slice(0, 2).join(" ")}`}>
              {sBadge.label}
            </span>
          </DetailRow>
          <DetailRow label="Email verified">
            <span className="text-xs text-sky-950">{user.email_verified ? "Yes" : "No"}</span>
          </DetailRow>
          <DetailRow label="MFA">
            <span className="text-xs text-sky-950">
              {user.mfa_enabled ? "Enabled" : "Disabled"}
            </span>
          </DetailRow>
          <DetailRow label="Joined">
            <span className="text-xs text-stone-500">
              <LocalTime value={user.created_at} />
            </span>
          </DetailRow>
          <DetailRow label="Last login">
            <span className="text-xs text-stone-500">
              <LocalTime value={user.last_login_at} />
            </span>
          </DetailRow>
          {user.invitation_pending && (
            <DetailRow label="Invitation">
              <span className="text-xs text-amber-600 font-medium">
                {isManualInvite ? "Awaiting manual claim" : "Email-bound — not yet claimed"}
              </span>
            </DetailRow>
          )}
        </dl>
      </div>

      {/* Actions card */}
      {(showLifecycleActions || showMFAReset || showApproveRegistration) && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Actions</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Manage this user's access to your organization.
            </p>
          </div>
          <div className="px-6 py-5 flex items-start gap-4 flex-wrap">
            {showLifecycleActions && isSoleActiveAdmin ? (
              /* Last active org_admin — disabling would leave the org without an admin.
                 Backend enforces ErrForbidden for org_admin actors in this state.
                 Render the explanatory panel from SOLE_ACTIVE_ADMIN_COPY instead
                 of a silently-blocked button. */
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-stone-600">
                  {SOLE_ACTIVE_ADMIN_COPY.sectionHeading}
                </p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 max-w-[340px] space-y-1">
                  <p className="text-xs font-semibold text-amber-700">
                    {SOLE_ACTIVE_ADMIN_COPY.title}
                  </p>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    {SOLE_ACTIVE_ADMIN_COPY.body}
                  </p>
                </div>
              </div>
            ) : showLifecycleActions ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-600">
                  {user.active ? "Suspend access" : "Restore access"}
                </p>
                <p className="text-xs text-stone-400 leading-relaxed max-w-[280px]">
                  {user.active
                    ? "Prevent this user from signing in. All active sessions will be immediately revoked."
                    : "Allow this user to sign in again."}
                </p>
                <div className="pt-1">
                  <UserRowActions userId={user.id} active={user.active} />
                </div>
              </div>
            ) : null}
            {showMFAReset && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-600">MFA enrollment</p>
                <p className="text-xs text-stone-400 leading-relaxed max-w-[280px]">
                  Clear this user{"'"}s TOTP authenticator. Their active sessions will be revoked
                  and they will be prompted to re-enroll on next sign-in.
                </p>
                <div className="pt-1">
                  <ResetMFAButton userId={user.id} />
                </div>
              </div>
            )}
            {showApproveRegistration && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-600">
                  {APPROVE_REGISTRATION_COPY.sectionHeading}
                </p>
                <p className="text-xs text-stone-400 leading-relaxed max-w-[280px]">
                  {APPROVE_REGISTRATION_COPY.description}
                </p>
                <div className="pt-1">
                  <ApproveButton userId={user.id} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assigned roles card */}
      {showRolesCard && (
        <UserRolesCard
          userId={user.id}
          assignedRoles={assignedRoles}
          availableRoles={availableRoles}
          assignedLoadError={assignedLoadError}
          availableLoadError={availableLoadError}
        />
      )}

      {/* Recent audit activity — only shown when feature is available */}
      {recentAuditResult?.ok && recentAuditResult.events.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-950">{RECENT_ACTIVITY_COPY.title}</p>
              <p className="text-xs text-stone-400 mt-0.5">{RECENT_ACTIVITY_COPY.subtitle}</p>
            </div>
            <a
              href={buildOrgAdminUserAuditHref(id)}
              className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors"
            >
              {RECENT_ACTIVITY_COPY.viewAllLabel}
            </a>
          </div>
          {/* Per-row "View in audit" links: each row is wrapped in an
              <a> that navigates to the subject-filtered audit page
              with the row's event_type appended. The accessible name
              ("View audit event <event_type> for this user") tells a
              screen-reader user where the click goes. Visible focus
              ring is provided so keyboard users can see focus. The
              compact row intentionally renders ONLY event_type / safe
              summary / actor display name / formatted timestamp — no
              raw metadata, no IP, no user agent, no session id, no
              cookies, no token, no clientDataJSON, no attestation. */}
          <ul className="divide-y divide-stone-100">
            {recentAuditResult.events.map((e, i) => {
              const rowHref = buildOrgAdminUserAuditHref(id, e.event_type);
              const actorLabel = e.actor_email ?? e.actor_type ?? null;
              const ariaLabel = `View audit event ${e.event_type} for this user`;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
                <li key={i}>
                  <a
                    href={rowHref}
                    aria-label={ariaLabel}
                    className="px-6 py-3 flex items-start justify-between gap-4 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40 transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <span className="text-xs font-mono text-sky-950">{e.event_type}</span>
                      {actorLabel && (
                        <div className="flex items-center gap-1 text-[10px] text-stone-400">
                          <span>Actor:</span>
                          <AuditIdentityCell value={e.actor_email} fallback={e.actor_type} />
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-stone-400 whitespace-nowrap">
                      <LocalTime value={e.created_at} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Back link */}
      <a
        href="/org-admin/users"
        className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-sky-950 transition-colors"
      >
        ← Back to Users
      </a>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-3 flex items-start justify-between gap-4">
      <dt className="text-xs font-medium text-stone-500 shrink-0 w-32">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div data-testid="user-not-found" className="max-w-lg space-y-4">
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <a href="/org-admin/users" className="hover:text-sky-950 transition-colors">
          Users
        </a>
        <span>/</span>
        <span>Not found</span>
      </div>
      <h1 className="text-lg font-bold text-sky-950 tracking-tight">User not found</h1>
      <p className="text-sm text-stone-500 leading-relaxed">
        This user does not exist in your organization, or you do not have permission to view them.
      </p>
      <a
        href="/org-admin/users"
        className="inline-block text-sm text-sky-600 hover:text-sky-700 underline"
      >
        Back to Users
      </a>
    </div>
  );
}
