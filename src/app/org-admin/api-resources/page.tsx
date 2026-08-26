/**
 * Org-admin API Resources page.
 *
 * Read-only list of registered API resources (audience-scoped OAuth
 * resource servers) in the calling org_admin's organization. Auth +
 * role are enforced by the parent /org-admin layout.
 *
 * Backend (gograph-verified):
 *   GET /api/v1/api-resources — list (page=1 size=100 hardcoded).
 *   Response: APIResourceResponse[] (safe — no resource_secret_hash).
 *   Availability: OSS/Starter Authorization Server surface when the backend exposes it.
 *
 * SECURITY:
 *   - Wire helper projects an explicit safe field allowlist (see
 *     projectAPIResource in idp-admin-client.ts).
 *   - The page renders ONLY operator-safe public configuration. There
 *     is no client_secret, no resource_secret, no hash, no token, no
 *     private key, no JWKS material anywhere on this surface.
 *   - The Create page surfaces the one-time secret returned by the
 *     create endpoint; rotation is intentionally NOT on this slice.
 */

import type { Metadata } from "next";
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { listApiResources } from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { OrgAPIResourceItem } from "@/lib/types";

export const metadata: Metadata = {
  title: "API resources — Identuum Org Admin",
};

export default async function OrgAdminAPIResourcesPage({
  searchParams,
}: {
  searchParams?: Promise<{ deleted?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const deletedName =
    typeof params.deleted === "string" && params.deleted.length > 0 ? params.deleted : null;
  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "api_resources",
  });
  const result = capabilityBoundary ? null : await listApiResources();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">API resources</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Audience-scoped resource servers your organization protects with OAuth tokens. Secret
            rotation is not available on this page.
          </p>
        </div>
        <a
          href="/org-admin/api-resources/new"
          className="shrink-0 inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Create API resource
        </a>
      </div>

      {deletedName && <DeletedNotice name={deletedName} />}

      {capabilityBoundary && <CapabilityUnavailablePanel copy={capabilityBoundary} />}
      {result && !result.ok && result.featureUnavailable && <FeatureUnavailablePanel />}
      {result && !result.ok && result.forbidden && <ForbiddenPanel />}
      {result && !result.ok && !result.featureUnavailable && !result.forbidden && <ErrorPanel />}

      {result?.ok && result.resources.length === 0 && <EmptyPanel />}

      {result?.ok && result.resources.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">
              {result.resources.length === 1
                ? "1 API resource"
                : `${result.resources.length} API resources`}
            </p>
            <p className="text-xs text-stone-400 mt-0.5">
              Each resource is identified by an immutable audience string. Tokens minted for an
              audience are scoped to that resource's scope catalog.
            </p>
          </div>
          <ul className="divide-y divide-stone-100">
            {result.resources.map((r) => (
              <APIResourceRow key={r.id} resource={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function APIResourceRow({ resource }: { resource: OrgAPIResourceItem }) {
  return (
    <li className="px-6 py-4 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-sky-950 truncate">{resource.name}</p>
          <p className="text-xs font-mono text-stone-500 truncate">{resource.audience}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Badge
            tone={resource.active ? "emerald" : "stone"}
            label={resource.active ? "Active" : "Inactive"}
          />
          {resource.token_ttl_secs > 0 && (
            <Badge tone="sky" label={`${resource.token_ttl_secs}s TTL`} />
          )}
          <a
            href={`/org-admin/api-resources/${encodeURIComponent(resource.id)}`}
            aria-label={`View API resource ${resource.name}`}
            className="text-xs font-semibold text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
          >
            View details →
          </a>
        </div>
      </div>

      {resource.scopes.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
            Scopes
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {resource.scopes.map((s) => (
              <li
                key={s.id}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700"
              >
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function Badge({ tone, label }: { tone: "sky" | "emerald" | "stone"; label: string }) {
  const cls =
    tone === "sky"
      ? "text-sky-700 bg-sky-100"
      : tone === "emerald"
        ? "text-emerald-700 bg-emerald-100"
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
      <p className="text-sm font-semibold text-sky-950">No API resources yet</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        Your organization hasn{"'"}t registered any resource servers. Click "Create API resource"
        above to add one.
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

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        You do not have permission to view API resources for this organization.
      </p>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load API resources</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}
