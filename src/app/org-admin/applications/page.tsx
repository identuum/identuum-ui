/**
 * Org-admin Applications page.
 *
 * Read-only list of OAuth clients (applications) registered in the
 * calling org_admin's organization. Auth + role are enforced by the
 * parent /org-admin layout; this page does NOT repeat the guard.
 *
 * The page is intentionally read-only in this first slice:
 *   - no create
 *   - no edit
 *   - no delete
 *   - no client_secret display
 *   - no client_secret regeneration
 *   - no scope mutation
 * Each of those is a separate (more sensitive) slice with its own
 * authorisation review.
 *
 * SECURITY:
 *   - Tenant scope is enforced server-side by ClientService.ListClients
 *     in identuum-idp (RoleOrgAdmin → filter by actor.OrganizationID).
 *     The UI never sends an `organization_id` filter; the IDP scopes
 *     automatically from the session cookie.
 *   - The wire client (idp-admin-client.listOwnOrganizationClients)
 *     sanitises the response and does NOT surface `client_secret`,
 *     inline JWKS keys, or any signing material into the page props.
 *   - Per-row display is limited to operator-safe public configuration
 *     fields (name, client_id, public/confidential flag, redirect
 *     URIs, allowed audiences, scope, JWKS URI). No token, no
 *     credential.
 */
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { listOwnOrganizationClients } from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { OrgClientItem } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications — Identuum Org Admin",
};

export default async function OrgAdminApplicationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ deleted?: string }>;
}) {
  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "oauth_clients",
  });
  const result = capabilityBoundary ? null : await listOwnOrganizationClients();
  const params = (await searchParams) ?? {};
  // The `deleted` query string carries ONLY the operator-chosen
  // application display name surfaced by the delete server action's
  // post-redirect. We render it as a transient banner; nothing about
  // this string is secret. The redirect helper URI-encodes it, so we
  // just consume it as a plain string and never echo it back into a
  // form value or storage primitive.
  const deletedName =
    typeof params.deleted === "string" && params.deleted.length > 0 ? params.deleted : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Applications</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            OAuth clients registered in your organization. Read-only.
          </p>
        </div>
        <a
          href="/org-admin/applications/new"
          className="shrink-0 inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Create application
        </a>
      </div>

      {deletedName && <DeletedNotice name={deletedName} />}

      {capabilityBoundary && <CapabilityUnavailablePanel copy={capabilityBoundary} />}
      {result && !result.ok && <ErrorPanel />}

      {result?.ok && result.data.clients.length === 0 && <EmptyPanel />}

      {result?.ok && result.data.clients.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">
              {result.data.total === 1 ? "1 application" : `${result.data.total} applications`}
            </p>
            <p className="text-xs text-stone-400 mt-0.5">
              These are the OAuth clients other systems use to obtain tokens for your organization.
            </p>
          </div>
          <ul className="divide-y divide-stone-100">
            {result.data.clients.map((c) => (
              <ApplicationRow key={c.id} client={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ApplicationRow({ client }: { client: OrgClientItem }) {
  return (
    <li className="px-6 py-4 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-sky-950 truncate">{client.name}</p>
          <p className="text-xs font-mono text-stone-500 truncate">{client.client_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Badge
            tone={client.is_public ? "amber" : "sky"}
            label={client.is_public ? "Public" : "Confidential"}
          />
          {client.token_endpoint_auth_method && (
            <Badge tone="stone" label={client.token_endpoint_auth_method} />
          )}
          <a
            href={`/org-admin/applications/${encodeURIComponent(client.id)}`}
            aria-label={`View application ${client.name}`}
            className="text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
          >
            View details →
          </a>
        </div>
      </div>

      {client.redirect_uris.length > 0 && (
        <DetailRow label="Redirect URIs">
          <UriList values={client.redirect_uris} />
        </DetailRow>
      )}
      {client.post_logout_redirect_uris.length > 0 && (
        <DetailRow label="Post-logout redirect URIs">
          <UriList values={client.post_logout_redirect_uris} />
        </DetailRow>
      )}
      {client.allowed_audiences.length > 0 && (
        <DetailRow label="Allowed audiences">
          <UriList values={client.allowed_audiences} />
        </DetailRow>
      )}
      {client.scope && (
        <DetailRow label="Default scope">
          <span className="text-xs font-mono text-stone-600">{client.scope}</span>
        </DetailRow>
      )}
      {client.jwks_uri && (
        <DetailRow label="JWKS URI">
          <span className="text-xs font-mono text-stone-600 break-all">{client.jwks_uri}</span>
        </DetailRow>
      )}
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function UriList({ values }: { values: string[] }) {
  return (
    <ul className="space-y-0.5">
      {values.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: URI list has no stable key
        <li key={i} className="text-xs font-mono text-stone-600 break-all">
          {v}
        </li>
      ))}
    </ul>
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

function DeletedNotice({ name }: { name: string }) {
  return (
    <output
      aria-live="polite"
      className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
    >
      Deleted {name}.
    </output>
  );
}

function EmptyPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No applications yet</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        Your organization hasn{"'"}t registered any OAuth clients. Application registration is not
        yet available from this page; contact your platform administrator to add one.
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
      <p className="text-sm font-semibold text-red-700">Could not load applications</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}
