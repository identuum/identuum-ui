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

import { getOrgUserById, listAuditEvents, listOrgUsers } from "@/lib/idp-admin-client";
import type { AuditEventItem } from "@/lib/idp-admin-client";
import { AuditIdentityCell } from "@/components/shared/audit-identity-cell";
import type { OrgUserItem } from "@/lib/types";
import type { Metadata } from "next";
import { RegenerateInviteLink, ResetMFAButton, UserRowActions } from "../user-row-actions";

export const metadata: Metadata = { title: "User — Identuum Org Admin" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNoEmailSentinel(email: string): boolean {
  return email.startsWith("noemail+") && email.endsWith("@no-email.internal");
}

function computeStatus(u: OrgUserItem): "active" | "pending" | "disabled" | "deleted" {
  if (u.deleted) return "deleted";
  if (u.invitation_pending) return "pending";
  if (isNoEmailSentinel(u.email) && !u.email_verified) return "pending";
  if (!u.active) return "disabled";
  return "active";
}

function formatAuditDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDate(iso: string | null | undefined): string {
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

export default async function OrgAdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <NotFoundPanel />;
  }

  const [user, allUsers, recentAuditResult] = await Promise.all([
    getOrgUserById(id),
    listOrgUsers(),
    listAuditEvents({ subjectId: id, pageSize: 8 }).catch(() => null),
  ]);

  if (!user) {
    return <NotFoundPanel />;
  }

  const status = computeStatus(user);

  // Count active, non-deleted org_admins to determine last-admin protection.
  // If listOrgUsers fails (null), default isSoleActiveAdmin=false — the backend
  // will enforce the guard if the action is attempted.
  const activeAdminCount =
    allUsers?.filter((u) => u.role === "org_admin" && u.active && !u.deleted).length ?? 0;
  const isSoleActiveAdmin =
    user.role === "org_admin" && user.active && activeAdminCount <= 1;
  const isManualInvite =
    (user.invitation_pending && !user.invitation_email_bound) ||
    (!user.invitation_email_bound && isNoEmailSentinel(user.email));
  const displayEmail = isNoEmailSentinel(user.email) ? null : user.email || null;

  const headingName = user.name ?? displayEmail ?? "Pending user";

  const statusConfig = {
    active: { label: "Active", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    pending: { label: "Pending", cls: "text-amber-700 bg-amber-50 border-amber-200" },
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

  const showLifecycleActions =
    !user.deleted && user.role !== "site_admin" && status !== "pending";
  const showRegenerate =
    status === "pending" && !user.deleted && user.role !== "site_admin";
  // MFA reset: only for active org_user targets with MFA enabled.
  const showMFAReset =
    user.role === "org_user" && user.mfa_enabled && !user.deleted && status !== "pending";

  return (
    <div className="space-y-6 max-w-2xl">
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
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 break-all">
            {isManualInvite ? (
              <span className="text-amber-700">{user.name ?? "Manual invite pending"}</span>
            ) : (
              displayEmail ?? <span className="text-stone-400 italic">No email</span>
            )}
          </h1>
        </div>
        {user.name && displayEmail && (
          <p className="text-sm text-stone-500">{user.name}</p>
        )}
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
            <span className="text-xs text-sky-950">{user.mfa_enabled ? "Enabled" : "Disabled"}</span>
          </DetailRow>
          <DetailRow label="Joined">
            <span className="text-xs text-stone-500">{formatDate(user.created_at)}</span>
          </DetailRow>
          <DetailRow label="Last login">
            <span className="text-xs text-stone-500">{formatDate(user.last_login_at)}</span>
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
      {(showLifecycleActions || showRegenerate || showMFAReset) && (
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
                 Show an explanatory message instead of a silently blocked button. */
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-stone-600">Suspend access</p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 max-w-[340px] space-y-1">
                  <p className="text-xs font-semibold text-amber-700">
                    Cannot disable the last active organization admin
                  </p>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Assign another administrator before suspending this account.{" "}
                    This organization must always have at least one active admin.
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
            {showRegenerate && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-600">Setup link</p>
                <p className="text-xs text-stone-400 leading-relaxed max-w-[280px]">
                  Regenerate a new one-time setup link for this invitation.
                  The previous link will be invalidated.
                </p>
                <div className="pt-1">
                  <RegenerateInviteLink userId={user.id} />
                </div>
              </div>
            )}
            {showMFAReset && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-600">MFA enrollment</p>
                <p className="text-xs text-stone-400 leading-relaxed max-w-[280px]">
                  Clear this user{"'"}s TOTP authenticator. Their active sessions will be
                  revoked and they will be prompted to re-enroll on next sign-in.
                </p>
                <div className="pt-1">
                  <ResetMFAButton userId={user.id} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent audit activity — only shown when feature is available */}
      {recentAuditResult && recentAuditResult.ok && recentAuditResult.events.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-950">Recent activity</p>
              <p className="text-xs text-stone-400 mt-0.5">
                Latest audit events where this user is the subject.
              </p>
            </div>
            <a
              href={`/org-admin/audit?subject_id=${encodeURIComponent(id)}`}
              className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors"
            >
              View all →
            </a>
          </div>
          <div className="divide-y divide-stone-100">
            {recentAuditResult.events.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
              <div key={i} className="px-6 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-0.5">
                  <span className="text-xs font-mono text-sky-950">{e.event_type}</span>
                  {e.summary && (
                    <p className="text-[10px] text-stone-400 leading-tight">{e.summary}</p>
                  )}
                  {e.actor_email || e.actor_type ? (
                    <div className="flex items-center gap-1 text-[10px] text-stone-400">
                      <span>by</span>
                      <AuditIdentityCell value={e.actor_email} fallback={e.actor_type} />
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] text-stone-400 whitespace-nowrap">
                  {formatAuditDate(e.created_at)}
                </span>
              </div>
            ))}
          </div>
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

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-3 flex items-start justify-between gap-4">
      <dt className="text-xs font-medium text-stone-500 shrink-0 w-32">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="max-w-lg space-y-4">
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
