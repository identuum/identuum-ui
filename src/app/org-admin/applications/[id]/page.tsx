/**
 * Org-admin Application detail page (read-only).
 *
 * Server-rendered. Auth + role are enforced by the parent /org-admin
 * layout guard. The page itself does NOT call getServerSession (the
 * IDP backend re-enforces tenant scope on every GET).
 *
 * Behaviour:
 *   - Calls getOrganizationClientById(id). Tenant scope is enforced
 *     server-side: an org_admin requesting a client outside their
 *     own organization gets 403 — never a leak.
 *   - Renders four error branches: invalid UUID (400), forbidden /
 *     cross-org (403), not-found (404), generic backend failure.
 *   - On success, renders the same operator-safe public configuration
 *     fields the list page surfaces: name, client_id, type, auth
 *     method, redirect URIs, post-logout redirect URIs, allowed
 *     audiences, default scope, JWKS URI, signing alg, created_at.
 *
 * Security:
 *   - No mutation controls (no Edit, Delete, Regenerate, Rotate).
 *   - No `<form>`, no `useActionState`, no client component.
 *   - No client_secret / private_key / inline JWKS / access_token /
 *     refresh_token / authorization_code rendered.
 *   - No raw `metadata` JSON dumped.
 *   - Breadcrumb back link to /org-admin/applications so the
 *     operator can navigate out without using the browser back
 *     button.
 */

import type { Metadata } from "next";
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import {
  type AuditEventItem,
  getOrganizationClientById,
  type ListAuditEventsResult,
  listAuditEvents,
} from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { OrgClientItem } from "@/lib/types";
import {
  APPLICATION_RECENT_ACTIVITY_COPY,
  buildOrgAdminApplicationAuditHref,
  getApplicationAuditEventLabel,
} from "./application-detail-audit";
import { DangerZone } from "./danger-zone";
import { SecuritySection } from "./security-section";

export const metadata: Metadata = {
  title: "Application — Identuum Org Admin",
};

// Narrow UUID-shape gate. The IDP would also return 400 for an
// invalid UUID, but pre-filtering avoids a wire round-trip for an
// obviously bad path segment.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function OrgAdminApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return (
      <ShellWithBack>
        <NotFoundPanel />
      </ShellWithBack>
    );
  }

  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "oauth_clients",
  });

  if (capabilityBoundary) {
    return (
      <ShellWithBack>
        <CapabilityUnavailablePanel copy={capabilityBoundary} />
      </ShellWithBack>
    );
  }

  // Fetch the client + the resource-scoped audit feed in parallel.
  // The audit list filters by subject_id = client UUID AND
  // subject_type = "oauth_client" per the IDP backend slice
  // identuum-20260530-client-audit-resource-subjects — this returns
  // ONLY events for THIS specific client (created / updated /
  // secret_rotated / deleted / linked_service_account). Tenant
  // scoping continues to flow through actor_organization_id on the
  // audit row, independently of subject_id, so an org_admin viewing
  // their own org's application can never see another org's
  // (impossible per the IDP guard, but defence-in-depth in the API
  // contract). A network or feature-gate failure on the audit fetch
  // is caught into a null sentinel so the detail page still renders
  // — the card simply surfaces the error-state copy.
  const [result, recentAuditResult] = await Promise.all([
    getOrganizationClientById(id),
    listAuditEvents({
      subjectId: id,
      subjectType: "oauth_client",
      pageSize: 5,
    }).catch((): ListAuditEventsResult | null => null),
  ]);

  if (!result.ok) {
    if (result.notFound)
      return (
        <ShellWithBack>
          <NotFoundPanel />
        </ShellWithBack>
      );
    if (result.forbidden)
      return (
        <ShellWithBack>
          <ForbiddenPanel />
        </ShellWithBack>
      );
    if (result.invalid)
      return (
        <ShellWithBack>
          <NotFoundPanel />
        </ShellWithBack>
      );
    return (
      <ShellWithBack>
        <ErrorPanel />
      </ShellWithBack>
    );
  }

  return (
    <ShellWithBack>
      <DetailHeader client={result.data} />
      <DetailCard client={result.data} />
      <ApplicationRecentActivity applicationID={result.data.id} result={recentAuditResult} />
      <SecuritySection
        clientId={result.data.id}
        clientName={result.data.name}
        clientID={result.data.client_id}
        isPublic={result.data.is_public}
      />
      <DangerZone
        clientId={result.data.id}
        clientName={result.data.name}
        clientID={result.data.client_id}
      />
    </ShellWithBack>
  );
}

function ShellWithBack({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href="/org-admin/applications"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to Applications
      </a>
      {children}
    </div>
  );
}

function DetailHeader({ client }: { client: OrgClientItem }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 truncate">
          {client.name}
        </h1>
        <p className="text-xs font-mono text-stone-500 mt-1 break-all">{client.client_id}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Badge
          tone={client.is_public ? "amber" : "sky"}
          label={client.is_public ? "Public" : "Confidential"}
        />
        {client.token_endpoint_auth_method && (
          <Badge tone="stone" label={client.token_endpoint_auth_method} />
        )}
        <a
          href={`/org-admin/applications/${encodeURIComponent(client.id)}/edit`}
          aria-label={`Edit application ${client.name}`}
          className="inline-flex items-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Edit application
        </a>
      </div>
    </div>
  );
}

function DetailCard({ client }: { client: OrgClientItem }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Configuration</p>
        <p className="text-xs text-stone-400 mt-0.5">
          Operator-safe public configuration for this OAuth client. Use Edit application to change
          the safe fields.
        </p>
      </div>
      <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-xs">
        <Row label="Name" value={client.name} />
        <Row label="Client ID" value={client.client_id} mono />
        <Row label="Type" value={client.is_public ? "Public" : "Confidential"} />
        {client.token_endpoint_auth_method && (
          <Row label="Token endpoint auth method" value={client.token_endpoint_auth_method} mono />
        )}
        {client.token_endpoint_auth_signing_alg && (
          <Row label="Signing algorithm" value={client.token_endpoint_auth_signing_alg} mono />
        )}
        <UriListRow label="Redirect URIs" values={client.redirect_uris} />
        <UriListRow label="Post-logout redirect URIs" values={client.post_logout_redirect_uris} />
        <UriListRow label="Allowed audiences" values={client.allowed_audiences} />
        {client.scope && <Row label="Default scope" value={client.scope} mono />}
        {client.jwks_uri && <Row label="JWKS URI" value={client.jwks_uri} mono />}
        {client.created_at && <Row label="Created at" value={client.created_at} mono />}
      </dl>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="font-medium text-stone-500">{label}</dt>
      <dd className={`text-sky-950 break-all ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}

function UriListRow({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <dt className="font-medium text-stone-500">{label}</dt>
      <dd className="text-sky-950">
        {values.length === 0 ? (
          <span className="text-stone-400 italic">None</span>
        ) : (
          <ul className="space-y-0.5 font-mono break-all">
            {values.map((v, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: URI list has no stable key
              <li key={i}>{v}</li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
}

function Badge({ tone, label }: { tone: "sky" | "amber" | "stone"; label: string }) {
  const cls =
    tone === "sky"
      ? "text-sky-700 bg-sky-100"
      : tone === "amber"
        ? "text-amber-800 bg-amber-100"
        : "text-stone-600 bg-stone-100";
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function NotFoundPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Application not found</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The application you requested does not exist or has been removed. Use the back link above to
        return to your application list.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        You do not have permission to view this application. Only applications registered in your
        organization are visible here.
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
      <p className="text-sm font-semibold text-red-700">Could not load application</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
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

/**
 * ApplicationRecentActivity — compact audit-feed card on the
 * application detail page. Server-rendered. Each row links to the
 * /org-admin/audit page filtered to this application + the row's
 * event_type so the operator can drill into the full audit envelope
 * (which lives on the dedicated audit page and is the only surface
 * allowed to render raw metadata / IP / user-agent).
 *
 * SECURITY (LOAD-BEARING — pinned by Vitest):
 *   - The compact card renders ONLY: the safe event label
 *     (mapped via getApplicationAuditEventLabel), the raw event_type
 *     in a smaller mono token (operator identification), the optional
 *     server-computed `summary` (a safe short string), an "Actor:
 *     <email or type>" line when an actor is present, and the
 *     formatted timestamp.
 *   - NO ip_address, NO user_agent, NO raw metadata, NO
 *     JSON.stringify, NO client_secret, NO secret_hash, NO
 *     private_key, NO inline jwks, NO access_token, NO refresh_token,
 *     NO authorization_code, NO bearer, NO Set-Cookie, NO session_id
 *     is rendered. AuditIPAddressCell is NOT imported on this
 *     surface — that component lives on the dedicated audit page.
 *   - The row's accessible name explicitly states the destination so
 *     screen-reader users know clicking the row takes them to the
 *     audit page.
 */
function ApplicationRecentActivity({
  applicationID,
  result,
}: {
  applicationID: string;
  result: ListAuditEventsResult | null;
}) {
  if (result === null) {
    return (
      <section
        aria-labelledby="application-recent-activity-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-stone-100">
          <h2
            id="application-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {APPLICATION_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {APPLICATION_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {APPLICATION_RECENT_ACTIVITY_COPY.errorBody}
          </p>
        </div>
      </section>
    );
  }
  if (!result.ok) {
    return (
      <section
        aria-labelledby="application-recent-activity-heading"
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-stone-100">
          <h2
            id="application-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {APPLICATION_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {APPLICATION_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {APPLICATION_RECENT_ACTIVITY_COPY.errorBody}
          </p>
        </div>
      </section>
    );
  }
  const events = result.events;
  return (
    <section
      aria-labelledby="application-recent-activity-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4">
        <div>
          <h2
            id="application-recent-activity-heading"
            className="text-sm font-semibold text-sky-950"
          >
            {APPLICATION_RECENT_ACTIVITY_COPY.title}
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {APPLICATION_RECENT_ACTIVITY_COPY.subtitle}
          </p>
        </div>
        <a
          href={buildOrgAdminApplicationAuditHref(applicationID)}
          className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
        >
          {APPLICATION_RECENT_ACTIVITY_COPY.viewAllLabel}
        </a>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500 leading-relaxed">
            {APPLICATION_RECENT_ACTIVITY_COPY.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {events.map((e, i) => (
            <ApplicationRecentActivityRow
              // biome-ignore lint/suspicious/noArrayIndexKey: audit rows have no stable client key
              key={i}
              applicationID={applicationID}
              event={e}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationRecentActivityRow({
  applicationID,
  event,
}: {
  applicationID: string;
  event: AuditEventItem;
}) {
  const label = getApplicationAuditEventLabel(event.event_type);
  const rowHref = buildOrgAdminApplicationAuditHref(applicationID, event.event_type);
  const actorLabel = event.actor_email ?? event.actor_type ?? null;
  const ariaLabel = `View audit event ${event.event_type} for this application`;
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
