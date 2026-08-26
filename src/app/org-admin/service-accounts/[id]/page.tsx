/**
 * Org-admin Service Account detail page.
 *
 * The IDP backend has no GET-by-id route for service accounts (only
 * list/create/delete). The detail page therefore fetches the org's
 * full service-account list and filters client-side to find the
 * requested id. The list response is the same safe DTO as the
 * detail surface needs.
 *
 * Excluded from this slice (no backend support):
 *   - Rotate / regenerate credential (no credential surface exists).
 *
 * Cards landed on this page (render order):
 *   - Configuration (read-only safe field grid).
 *   - Edit details (EditDetailsCard;
 *     identuum-20260530-service-account-edit-ui — name/description/role
 *     PATCH against /api/v1/organizations/:id/service-accounts/:sa_id).
 *   - Lifecycle (disable / enable toggle).
 *   - Link to OAuth client (LinkToOAuthClientCard;
 *     identuum-20260530-service-account-oauth-client-link-ui).
 *   - Recent activity (server-rendered audit feed scoped to this SA;
 *     identuum-20260530-org-admin-service-account-recent-activity-ui).
 *   - DangerZone (two-step expand + type-to-confirm delete).
 */

import type { Metadata } from "next";
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import {
  type AuditEventItem,
  getOwnOrganization,
  type LinkedOAuthClientForServiceAccount,
  type ListAuditEventsResult,
  type ListServiceAccountOAuthClientsResult,
  listAuditEvents,
  listOwnOrganizationClients,
  listServiceAccountOAuthClients,
  listServiceAccounts,
} from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { OrgClientItem } from "@/lib/types";
import { DangerZone } from "./danger-zone";
import { EditDetailsCard } from "./edit-details-card";
import { LifecycleCard } from "./lifecycle-card";
import { LinkToOAuthClientCard } from "./link-to-oauth-client-card";
import {
  buildOrgAdminServiceAccountAuditHref,
  getServiceAccountAuditEventLabel,
  SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY,
} from "./service-account-detail-audit";

export const metadata: Metadata = {
  title: "Service account — Identuum Org Admin",
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default async function OrgAdminServiceAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return (
      <Shell>
        <NotFoundPanel />
      </Shell>
    );
  }

  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "service_accounts",
  });
  if (capabilityBoundary) {
    return (
      <Shell>
        <CapabilityUnavailablePanel copy={capabilityBoundary} />
      </Shell>
    );
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return (
      <Shell>
        <OrgUnknownPanel />
      </Shell>
    );
  }

  // Fetch the org's service accounts, the org's OAuth client list,
  // AND the SA-scoped audit feed in parallel. The OAuth client list
  // powers the "Link to OAuth client" card's <select>; the audit feed
  // powers the Recent activity card (subject_id=sa.id +
  // subject_type="service_account" per the IDP backend slice
  // identuum-20260530-org-admin-service-account-recent-activity-backend).
  // A network or feature-gate failure on either secondary fetch is
  // caught into a null sentinel so the detail page still renders — the
  // affected card surfaces its own error-state copy instead of failing
  // the whole page. Tenant scoping continues to flow through
  // actor_organization_id on every audit row independently of
  // subject_id, so an org_admin can never see another org's events.
  const [result, oauthClientsResult, recentAuditResult, linkedClientsResult] = await Promise.all([
    listServiceAccounts(org.id),
    listOwnOrganizationClients().catch(() => null),
    listAuditEvents({
      subjectId: id,
      subjectType: "service_account",
      pageSize: 5,
    }).catch((): ListAuditEventsResult | null => null),
    // Persistent linked-OAuth-clients read (slice
    // identuum-20260530-service-account-linked-clients-read-model-ui).
    // Closes the prior-slice gap: on hard reload the card can now
    // render the persistent linked-state without depending on
    // useActionState. A network / feature-gate failure is caught into
    // a null sentinel so the rest of the detail page still renders;
    // the card surfaces its own load-error state in that branch and
    // NEVER faakes linked state from browser storage.
    listServiceAccountOAuthClients(org.id, id).catch(
      (): ListServiceAccountOAuthClientsResult | null => null
    ),
  ]);
  if (!result.ok) {
    if (result.featureUnavailable) {
      return (
        <Shell>
          <FeatureUnavailablePanel />
        </Shell>
      );
    }
    if (result.forbidden) {
      return (
        <Shell>
          <ForbiddenPanel />
        </Shell>
      );
    }
    return (
      <Shell>
        <ErrorPanel />
      </Shell>
    );
  }

  const sa = result.serviceAccounts.find((row) => row.id === id);
  if (!sa) {
    return (
      <Shell>
        <NotFoundPanel />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 break-all">{sa.name}</h1>
        {sa.description && <p className="text-sm text-stone-500 break-words">{sa.description}</p>}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              sa.role === "org_admin"
                ? "text-sky-700 bg-sky-50 border-sky-200"
                : "text-stone-600 bg-stone-100 border-stone-200"
            }`}
          >
            {sa.role || "—"}
          </span>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Configuration</p>
          <p className="text-xs text-stone-400 mt-0.5">
            No credential is issued here. Link this service account to an OAuth client (a future
            feature) to obtain a usable client_credentials grant.
          </p>
        </div>
        <dl className="divide-y divide-stone-100">
          <DetailRow label="Name">
            <span className="text-xs text-sky-950">{sa.name}</span>
          </DetailRow>
          <DetailRow label="Description">
            {sa.description ? (
              <span className="text-xs text-sky-950 break-words">{sa.description}</span>
            ) : (
              <span className="text-xs text-stone-300">—</span>
            )}
          </DetailRow>
          <DetailRow label="Role">
            <span className="text-xs text-sky-950">{sa.role || "—"}</span>
          </DetailRow>
          <DetailRow label="Service account ID">
            <span className="font-mono text-xs text-sky-950 break-all">{sa.id}</span>
          </DetailRow>
          <DetailRow label="Created">
            <span className="text-xs text-stone-500">{formatDate(sa.created_at)}</span>
          </DetailRow>
          <DetailRow label="Updated">
            <span className="text-xs text-stone-500">{formatDate(sa.updated_at)}</span>
          </DetailRow>
        </dl>
      </div>

      <EditDetailsCard
        serviceAccountId={sa.id}
        serviceAccountName={sa.name}
        serviceAccountDescription={sa.description ?? ""}
        serviceAccountRole={sa.role ?? ""}
      />

      <LifecycleCard serviceAccountId={sa.id} serviceAccountName={sa.name} active={sa.active} />

      <LinkToOAuthClientCard
        serviceAccountId={sa.id}
        serviceAccountName={sa.name}
        oauthClients={
          oauthClientsResult?.ok ? (oauthClientsResult.data.clients as OrgClientItem[]) : []
        }
        loadError={!oauthClientsResult || !oauthClientsResult.ok}
        initialLinkedClients={
          linkedClientsResult?.ok
            ? (linkedClientsResult.oauth_clients as LinkedOAuthClientForServiceAccount[])
            : []
        }
        linkedClientsLoadError={!linkedClientsResult || !linkedClientsResult.ok}
      />

      <ServiceAccountRecentActivity serviceAccountID={sa.id} result={recentAuditResult} />

      <DangerZone serviceAccountId={sa.id} serviceAccountName={sa.name} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href="/org-admin/service-accounts"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to service accounts
      </a>
      {children}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-3 flex items-start justify-between gap-4">
      <dt className="text-xs font-medium text-stone-500 shrink-0 w-32">{label}</dt>
      <dd className="text-right max-w-[60%]">{children}</dd>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Service account not found</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The service account you tried to view does not exist or has been removed.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        You do not have permission to view this service account. Only service accounts registered in
        your organization can be viewed here.
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

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load service account</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}

function formatAuditDate(iso: string | null | undefined): string {
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

/**
 * ServiceAccountRecentActivity — compact audit-feed card on the
 * service-account detail page. Server-rendered. Each row links to the
 * /org-admin/audit page filtered to this SA + the row's event_type so
 * the operator can drill into the full audit envelope (which lives on
 * the dedicated audit page and is the only surface allowed to render
 * raw metadata / IP / user-agent).
 *
 * SECURITY (LOAD-BEARING — pinned by Vitest):
 *   - The compact card renders ONLY: the safe event label (mapped via
 *     getServiceAccountAuditEventLabel), the raw event_type in a
 *     smaller mono token (operator identification), the optional
 *     server-computed `summary` (a safe short string), an "Actor:
 *     <email or type>" line when an actor is present, and the
 *     formatted timestamp.
 *   - NO ip_address, NO user_agent, NO raw metadata, NO JSON.stringify,
 *     NO client_secret, NO client_secret_hash, NO service_account_secret,
 *     NO secret_hash, NO private_key, NO inline jwks, NO signing_key,
 *     NO access_token, NO refresh_token, NO authorization_code, NO
 *     bearer, NO Set-Cookie, NO session_id is rendered. AuditIPAddressCell
 *     is NOT imported on this surface — that component lives only on
 *     the dedicated audit page.
 *   - The row's accessible name explicitly states the destination so
 *     screen-reader users know clicking the row takes them to the
 *     audit page.
 *   - The error-state branch (audit fetch threw OR returned ok=false)
 *     surfaces a non-technical body string; the rest of the detail
 *     page continues to render.
 */
function ServiceAccountRecentActivity({
  serviceAccountID,
  result,
}: {
  serviceAccountID: string;
  result: ListAuditEventsResult | null;
}) {
  if (result === null || !result.ok) {
    return (
      <section
        aria-labelledby="service-account-recent-activity-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-stone-100">
          <h2
            id="service-account-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.errorBody}
          </p>
        </div>
      </section>
    );
  }
  const events = result.events;
  return (
    <section
      aria-labelledby="service-account-recent-activity-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
        <div>
          <h2
            id="service-account-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <a
          href={buildOrgAdminServiceAccountAuditHref(serviceAccountID)}
          className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
        >
          {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.viewAllLabel}
        </a>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {SERVICE_ACCOUNT_RECENT_ACTIVITY_COPY.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {events.map((e, i) => (
            <ServiceAccountRecentActivityRow
              // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
              key={i}
              serviceAccountID={serviceAccountID}
              event={e}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ServiceAccountRecentActivityRow({
  serviceAccountID,
  event,
}: {
  serviceAccountID: string;
  event: AuditEventItem;
}) {
  const label = getServiceAccountAuditEventLabel(event.event_type);
  const rowHref = buildOrgAdminServiceAccountAuditHref(serviceAccountID, event.event_type);
  const actorLabel = event.actor_email ?? event.actor_type ?? null;
  const ariaLabel = `View audit event ${event.event_type} for this service account`;
  return (
    <li>
      <a
        href={rowHref}
        aria-label={ariaLabel}
        className="px-6 py-3 flex items-start justify-between gap-4 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40 transition-colors"
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium text-sky-950">{label}</p>
          <p className="text-[10px] font-mono text-stone-400 leading-tight">{event.event_type}</p>
          {actorLabel && (
            <p className="text-[10px] text-stone-400 leading-tight">
              <span>Actor:</span> <span>{actorLabel}</span>
            </p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-stone-400 whitespace-nowrap">
          {formatAuditDate(event.created_at)}
        </span>
      </a>
    </li>
  );
}
