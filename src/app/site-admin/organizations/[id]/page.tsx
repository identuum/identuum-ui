/**
 * Organization detail page — site_admin only, read-only.
 *
 * Auth and role are enforced by the parent /site-admin layout.
 * This page does NOT repeat the guard.
 *
 * Data: GET /api/v1/organizations/:id via getOrganization().
 * Sanitized to OrgDetail — no secrets, internal URLs, or credential material.
 */
import { getOrganization, listAuditEvents } from "@/lib/idp-admin-client";
import type { AuditEventItem } from "@/lib/idp-admin-client";
import { AuditIdentityCell } from "@/components/shared/audit-identity-cell";
import type { OrgDetail } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Organization — Identuum Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <NotFoundPanel />;
  }

  const [org, recentAuditResult] = await Promise.all([
    getOrganization(id),
    listAuditEvents({ subjectId: id, subjectType: "organization", pageSize: 8 }).catch(() => null),
  ]);

  if (!org) {
    return <NotFoundPanel />;
  }

  const statusLabel = org.deleted ? "Deleted" : org.active ? "Active" : "Inactive";

  const statusCls = org.deleted
    ? "text-red-600 bg-red-50 border-red-100"
    : org.active
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : "text-stone-500 bg-stone-100 border-stone-200";

  const authPolicyLabel: Record<string, string> = {
    local_only: "Local only",
    idp_only: "Identity provider only",
    mixed: "Mixed",
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <a href="/site-admin/organizations" className="hover:text-sky-950 transition-colors">
          Organizations
        </a>
        <span>/</span>
        <span className="text-stone-500 truncate max-w-xs">{org.name}</span>
      </div>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">{org.name}</h1>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusCls}`}
          >
            {statusLabel}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              org.has_admin
                ? "text-sky-700 bg-sky-50 border-sky-200"
                : "text-amber-700 bg-amber-50 border-amber-200"
            }`}
          >
            {org.has_admin ? "Has admin" : "No admin"}
          </span>
        </div>
      </div>

      {/* Operational status card */}
      <OperationalStatusCard org={org} id={id} />

      {/* Details card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Organization details</p>
        </div>
        <dl className="divide-y divide-stone-100">
          <DetailRow label="Name">
            <span className="text-xs text-sky-950">{org.name}</span>
          </DetailRow>
          <DetailRow label="Domain">
            <span className="text-xs font-mono text-sky-950">{org.domain || "—"}</span>
          </DetailRow>
          <DetailRow label="Slug">
            <span className="text-xs font-mono text-sky-950">{org.slug || "—"}</span>
          </DetailRow>
          <DetailRow label="Status">
            <span className={`text-xs font-medium ${statusCls.split(" ").slice(0, 2).join(" ")}`}>
              {statusLabel}
            </span>
          </DetailRow>
          <DetailRow label="Active admin">
            <span className="text-xs text-sky-950">{org.has_admin ? "Yes" : "No"}</span>
          </DetailRow>
          <DetailRow label="Auth policy">
            <span className="text-xs text-sky-950">
              {authPolicyLabel[org.auth_policy] ?? org.auth_policy}
            </span>
          </DetailRow>
          <DetailRow label="MFA policy">
            <span className="text-xs text-sky-950 capitalize">{org.mfa_policy}</span>
          </DetailRow>
          {org.created_at && (
            <DetailRow label="Created">
              <span className="text-xs text-stone-500">{formatDate(org.created_at)}</span>
            </DetailRow>
          )}
          {org.updated_at && (
            <DetailRow label="Updated">
              <span className="text-xs text-stone-500">{formatDate(org.updated_at)}</span>
            </DetailRow>
          )}
        </dl>
      </div>

      {/* Administrator status card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Administrator status</p>
        </div>
        <div className="px-6 py-5 space-y-3">
          {org.has_admin ? (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                  ✓
                </span>
                <div>
                  <p className="text-xs font-semibold text-sky-950">
                    Administrator account present
                  </p>
                  <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                    This organization has at least one organization administrator account. The
                    administrator may be newly invited and completing initial setup.
                  </p>
                </div>
              </div>
              {/* Recovery affordance when the only admin account has an expired invitation */}
              {org.can_assign_admin && !org.deleted && (
                <div className="border-t border-stone-100 pt-3 space-y-2">
                  <p className="text-xs text-amber-700 font-medium">Pending invitation expired</p>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    The administrator invitation has expired and was never claimed. As site
                    administrator you may delegate a recovery administrator.
                  </p>
                  <a
                    href={`/site-admin/organizations/${id}/assign-admin`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Assign administrator →
                  </a>
                </div>
              )}
              {!org.can_assign_admin && (
                <p className="text-xs text-stone-400 leading-relaxed border-t border-stone-100 pt-3">
                  Site administrators cannot view or list tenant organization members. This is
                  enforced by the sovereign bunker policy to preserve tenant privacy boundaries.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                  !
                </span>
                <div>
                  <p className="text-xs font-semibold text-amber-700">No active administrator</p>
                  <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                    This organization has no active organization administrator. Without an
                    administrator, tenant users cannot manage their organization settings.
                  </p>
                </div>
              </div>
              {!org.deleted && (
                <div className="border-t border-stone-100 pt-3">
                  <p className="text-xs text-stone-500 mb-2">
                    As site administrator you may delegate a recovery organization administrator.
                  </p>
                  <a
                    href={`/site-admin/organizations/${id}/assign-admin`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Assign administrator →
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Actions card */}
      {!org.deleted && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Actions</p>
            <p className="text-xs text-stone-400 mt-0.5">Manage this organization.</p>
          </div>
          <div className="px-6 py-5 flex flex-wrap gap-2">
            <a
              href={`/site-admin/organizations/${id}/edit`}
              className="text-xs font-semibold text-stone-500 hover:text-sky-700 bg-stone-100 hover:bg-sky-50 border border-stone-200 hover:border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit
            </a>
            {org.active ? (
              <a
                href={`/site-admin/organizations/${id}/deactivate`}
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Deactivate
              </a>
            ) : (
              <a
                href={`/site-admin/organizations/${id}/reactivate`}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Reactivate
              </a>
            )}
            {org.can_assign_admin && (
              <a
                href={`/site-admin/organizations/${id}/assign-admin`}
                className="text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Assign admin
              </a>
            )}
            <a
              href={`/site-admin/organizations/${id}/delete`}
              className="text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              Archive
            </a>
          </div>
        </div>
      )}

      {org.deleted && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Actions</p>
          </div>
          <div className="px-6 py-5">
            <a
              href={`/site-admin/organizations/${id}/restore`}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Restore
            </a>
          </div>
        </div>
      )}

      {/* Recent audit activity — only shown when feature is available and has results */}
      {recentAuditResult && recentAuditResult.ok && recentAuditResult.events.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-950">Recent activity</p>
              <p className="text-xs text-stone-400 mt-0.5">
                Latest audit events where this organization is the subject.
              </p>
            </div>
            <a
              href={`/site-admin/audit?subject_id=${encodeURIComponent(id)}&subject_type=organization`}
              className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors"
            >
              View all audit events →
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
                  {(e.actor_email || e.actor_type) && (
                    <div className="flex items-center gap-1 text-[10px] text-stone-400">
                      <span>by</span>
                      <AuditIdentityCell value={e.actor_email} fallback={e.actor_type} />
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-stone-400 whitespace-nowrap">
                    {formatDate(e.created_at)}
                  </span>
                  <a
                    href={`/site-admin/audit?subject_id=${encodeURIComponent(id)}&subject_type=organization&event_type=${encodeURIComponent(e.event_type)}`}
                    className="text-[10px] text-sky-600 hover:text-sky-800 transition-colors whitespace-nowrap"
                  >
                    View in audit →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Back link */}
      <a
        href="/site-admin/organizations"
        className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-sky-950 transition-colors"
      >
        ← Back to Organizations
      </a>
    </div>
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

// ── Operational status card ──────────────────────────────────────────────────

type LifecycleState = "active" | "inactive" | "deleted";
type AdminState = "operational" | "expired-pending" | "no-admin" | "suspended";
type NextAction = "restore" | "reactivate" | "assign-admin" | "reactivate-and-assign" | "none";

function OperationalStatusCard({ org, id }: { org: OrgDetail; id: string }) {
  const lifecycle: LifecycleState = org.deleted ? "deleted" : org.active ? "active" : "inactive";

  const adminState: AdminState = org.deleted
    ? "suspended"
    : org.has_admin && !org.can_assign_admin
      ? "operational"
      : org.has_admin && org.can_assign_admin
        ? "expired-pending"
        : "no-admin";

  const nextAction: NextAction = org.deleted
    ? "restore"
    : !org.active && org.can_assign_admin
      ? "reactivate-and-assign"
      : !org.active
        ? "reactivate"
        : org.can_assign_admin
          ? "assign-admin"
          : "none";

  const lifecycleCfg: Record<LifecycleState, { dot: string; label: string; body: string }> = {
    active: {
      dot: "bg-emerald-500",
      label: "Active",
      body: "User logins are permitted.",
    },
    inactive: {
      dot: "bg-stone-400",
      label: "Inactive",
      body: "User logins are blocked. Reactivate to allow users to sign in.",
    },
    deleted: {
      dot: "bg-red-500",
      label: "Archived",
      body: "Organization is soft-deleted. All user logins are blocked. Restore to resume operations.",
    },
  };

  const adminCfg: Record<AdminState, { dot: string; label: string; body: string }> = {
    operational: {
      dot: "bg-emerald-500",
      label: "Administrator account active",
      body: "An active administrator account or a valid pending setup invitation is present. No recovery action is needed.",
    },
    "expired-pending": {
      dot: "bg-amber-400",
      label: "Pending invitation expired",
      body: "An administrator account exists but the setup invitation was never claimed. Recovery delegation is available.",
    },
    "no-admin": {
      dot: "bg-amber-400",
      label: "No administrator",
      body: "No active administrator account is present. Tenant users cannot manage organization settings without one. Recovery delegation is available.",
    },
    suspended: {
      dot: "bg-stone-300",
      label: "Admin management suspended",
      body: "Restore the organization to resume administrator management.",
    },
  };

  const lc = lifecycleCfg[lifecycle];
  const ac = adminCfg[adminState];

  const actionLinkCls =
    "inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 " +
    "bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors";

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Operational status</p>
        <p className="text-xs text-stone-400 mt-0.5">
          Lifecycle and administrator recovery state at a glance.
        </p>
      </div>
      <div className="px-6 py-4 space-y-3.5">
        {/* Lifecycle row */}
        <div className="flex items-start gap-3">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${lc.dot}`} aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-sky-950">{lc.label}</p>
            <p className="text-xs text-stone-500 leading-relaxed">{lc.body}</p>
          </div>
        </div>

        {/* Administrator row */}
        <div className="flex items-start gap-3">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${ac.dot}`} aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-sky-950">{ac.label}</p>
            <p className="text-xs text-stone-500 leading-relaxed">{ac.body}</p>
          </div>
        </div>

        {/* Next-action guidance — at most two links */}
        {nextAction !== "none" && (
          <div className="pt-2.5 border-t border-stone-100 flex flex-wrap gap-2">
            {nextAction === "restore" && (
              <a href={`/site-admin/organizations/${id}/restore`} className={actionLinkCls}>
                Restore organization →
              </a>
            )}
            {nextAction === "reactivate" && (
              <a href={`/site-admin/organizations/${id}/reactivate`} className={actionLinkCls}>
                Reactivate →
              </a>
            )}
            {nextAction === "reactivate-and-assign" && (
              <>
                <a href={`/site-admin/organizations/${id}/reactivate`} className={actionLinkCls}>
                  Reactivate →
                </a>
                <a href={`/site-admin/organizations/${id}/assign-admin`} className={actionLinkCls}>
                  Assign administrator →
                </a>
              </>
            )}
            {nextAction === "assign-admin" && (
              <a href={`/site-admin/organizations/${id}/assign-admin`} className={actionLinkCls}>
                Assign administrator →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
