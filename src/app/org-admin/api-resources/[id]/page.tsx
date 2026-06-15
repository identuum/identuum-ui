/**
 * Org-admin API Resource detail page.
 *
 * Read-only view of an API resource's safe configuration plus the
 * DangerZone delete affordance. Auth + role are enforced by the parent
 * /org-admin layout.
 *
 * Excluded from this slice:
 *   - Rotate/regenerate secret affordance.
 *   - Recent activity card (audit events use subject_type=organization
 *     today; a backend resource-subject migration would be required to
 *     mirror the OAuth client recent-activity pattern).
 */
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import {
  type AuditEventItem,
  type ListAuditEventsResult,
  getApiResource,
  listAuditEvents,
} from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { Metadata } from "next";
import {
  API_RESOURCE_RECENT_ACTIVITY_COPY,
  buildOrgAdminApiResourceAuditHref,
  getApiResourceAuditEventLabel,
} from "./api-resource-detail-audit";
import { DangerZone } from "./danger-zone";
import { SecuritySection } from "./security-section";

export const metadata: Metadata = {
  title: "API resource — Identuum Org Admin",
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

export default async function OrgAdminAPIResourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return (
      <Shell id={id}>
        <NotFoundPanel />
      </Shell>
    );
  }

  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "api_resources",
  });
  if (capabilityBoundary) {
    return (
      <Shell id={id}>
        <CapabilityUnavailablePanel copy={capabilityBoundary} />
      </Shell>
    );
  }

  // Fetch the API resource + the resource-scoped audit feed in parallel.
  // The audit list filters by subject_id=<resource UUID> AND
  // subject_type="api_resource" per the IDP backend slice
  // identuum-20260530-api-resource-audit-subjects-backend — this returns
  // ONLY events for THIS specific API resource (created / updated /
  // deleted / secret_rotated). Tenant scoping continues to flow through
  // actor_organization_id on the audit row independently of subject_id,
  // so an org_admin can never see another org's events here. A network
  // or feature-gate failure on the audit fetch is caught into a null
  // sentinel so the detail page still renders — the card surfaces the
  // error-state copy instead of failing the whole page.
  const [result, recentAuditResult] = await Promise.all([
    getApiResource(id),
    listAuditEvents({
      subjectId: id,
      subjectType: "api_resource",
      pageSize: 5,
    }).catch((): ListAuditEventsResult | null => null),
  ]);
  if (!result.ok) {
    if (result.featureUnavailable)
      return (
        <Shell id={id}>
          <FeatureUnavailablePanel />
        </Shell>
      );
    if (result.notFound)
      return (
        <Shell id={id}>
          <NotFoundPanel />
        </Shell>
      );
    if (result.forbidden)
      return (
        <Shell id={id}>
          <ForbiddenPanel />
        </Shell>
      );
    if (result.invalid)
      return (
        <Shell id={id}>
          <NotFoundPanel />
        </Shell>
      );
    return (
      <Shell id={id}>
        <ErrorPanel />
      </Shell>
    );
  }

  const r = result.resource;

  return (
    <Shell id={id}>
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 break-all">{r.name}</h1>
        <p className="text-sm text-stone-500 break-all font-mono">{r.audience}</p>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              r.active
                ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : "text-stone-600 bg-stone-100 border-stone-200"
            }`}
          >
            {r.active ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Configuration</p>
        </div>
        <dl className="divide-y divide-stone-100">
          <DetailRow label="Name">
            <span className="text-xs text-sky-950">{r.name}</span>
          </DetailRow>
          <DetailRow label="Audience">
            <span className="font-mono text-xs text-sky-950 break-all">{r.audience}</span>
          </DetailRow>
          <DetailRow label="Status">
            <span className="text-xs text-sky-950">{r.active ? "Active" : "Inactive"}</span>
          </DetailRow>
          <DetailRow label="Token TTL">
            <span className="text-xs text-sky-950">
              {r.token_ttl_secs > 0 ? `${r.token_ttl_secs} seconds` : "—"}
            </span>
          </DetailRow>
          <DetailRow label="Created">
            <span className="text-xs text-stone-500">{formatDate(r.created_at)}</span>
          </DetailRow>
          <DetailRow label="Updated">
            <span className="text-xs text-stone-500">{formatDate(r.updated_at)}</span>
          </DetailRow>
        </dl>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-sky-950">Scopes</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Independently-assignable OAuth scopes for this audience.
            </p>
          </div>
          <a
            href={`/org-admin/api-resources/${encodeURIComponent(id)}/edit`}
            className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors"
          >
            Edit →
          </a>
        </div>
        {r.scopes.length === 0 ? (
          <div className="px-6 py-5">
            <p className="text-xs text-stone-400 italic">No scopes defined.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {r.scopes.map((s) => (
              <li key={s.id} className="px-6 py-3 space-y-0.5">
                <p className="text-sm font-mono text-sky-950">{s.name}</p>
                {s.description && (
                  <p className="text-xs text-stone-500 leading-relaxed">{s.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SecuritySection resourceId={r.id} resourceName={r.name} resourceAudience={r.audience} />

      <APIResourceRecentActivity resourceID={r.id} result={recentAuditResult} />

      <DangerZone resourceId={r.id} resourceName={r.name} resourceAudience={r.audience} />
    </Shell>
  );
}

function Shell({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <a
          href="/org-admin/api-resources"
          className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
        >
          ← Back to API resources
        </a>
        {UUID_RE.test(id) && (
          <a
            href={`/org-admin/api-resources/${encodeURIComponent(id)}/edit`}
            className="inline-flex items-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 transition-colors"
          >
            Edit
          </a>
        )}
      </div>
      {children}
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
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">API resource not found</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The API resource you tried to view does not exist or has been removed.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        You do not have permission to view this API resource. Only resources registered in your
        organization can be viewed here.
      </p>
    </div>
  );
}

function FeatureUnavailablePanel() {
  return (
    <div className="bg-white border border-amber-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-amber-800">API resources are not enabled</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        API resources are part of the OSS/Starter Authorization Server surface when the backend
        exposes it. This IDP backend did not make the endpoint available.
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

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load API resource</p>
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
 * APIResourceRecentActivity — compact audit-feed card on the API
 * resource detail page. Server-rendered. Each row links to the
 * /org-admin/audit page filtered to this resource + the row's
 * event_type so the operator can drill into the full audit envelope
 * (which lives on the dedicated audit page and is the only surface
 * allowed to render raw metadata / IP / user-agent).
 *
 * SECURITY (LOAD-BEARING — pinned by Vitest):
 *   - The compact card renders ONLY: the safe event label (mapped via
 *     getApiResourceAuditEventLabel), the raw event_type in a smaller
 *     mono token (operator identification), the optional server-
 *     computed `summary` (a safe short string), an "Actor: <email or
 *     type>" line when an actor is present, and the formatted
 *     timestamp.
 *   - NO ip_address, NO user_agent, NO raw metadata, NO JSON.stringify,
 *     NO resource_secret, NO resource_secret_hash, NO secret_hash, NO
 *     private_key, NO inline jwks, NO signing_key, NO access_token, NO
 *     refresh_token, NO authorization_code, NO bearer, NO Set-Cookie,
 *     NO session_id is rendered. AuditIPAddressCell is NOT imported on
 *     this surface — that component lives on the dedicated audit page.
 *   - The row's accessible name explicitly states the destination so
 *     screen-reader users know clicking the row takes them to the
 *     audit page.
 *   - The error-state branch (audit fetch threw OR returned ok=false)
 *     surfaces a non-technical body string; the rest of the detail
 *     page continues to render.
 */
function APIResourceRecentActivity({
  resourceID,
  result,
}: {
  resourceID: string;
  result: ListAuditEventsResult | null;
}) {
  if (result === null || !result.ok) {
    return (
      <section
        aria-labelledby="api-resource-recent-activity-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-stone-100">
          <h2
            id="api-resource-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {API_RESOURCE_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {API_RESOURCE_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {API_RESOURCE_RECENT_ACTIVITY_COPY.errorBody}
          </p>
        </div>
      </section>
    );
  }
  const events = result.events;
  return (
    <section
      aria-labelledby="api-resource-recent-activity-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
        <div>
          <h2
            id="api-resource-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {API_RESOURCE_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {API_RESOURCE_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <a
          href={buildOrgAdminApiResourceAuditHref(resourceID)}
          className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
        >
          {API_RESOURCE_RECENT_ACTIVITY_COPY.viewAllLabel}
        </a>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {API_RESOURCE_RECENT_ACTIVITY_COPY.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {events.map((e, i) => (
            <APIResourceRecentActivityRow
              // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
              key={i}
              resourceID={resourceID}
              event={e}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function APIResourceRecentActivityRow({
  resourceID,
  event,
}: {
  resourceID: string;
  event: AuditEventItem;
}) {
  const label = getApiResourceAuditEventLabel(event.event_type);
  const rowHref = buildOrgAdminApiResourceAuditHref(resourceID, event.event_type);
  const actorLabel = event.actor_email ?? event.actor_type ?? null;
  const ariaLabel = `View audit event ${event.event_type} for this API resource`;
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
          {event.summary && (
            <p className="text-[10px] text-stone-400 leading-tight">{event.summary}</p>
          )}
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
