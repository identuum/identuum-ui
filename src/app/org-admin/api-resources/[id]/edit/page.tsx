/**
 * Org-admin Edit API Resource page.
 *
 * Server-rendered. Auth + role are enforced by the parent /org-admin
 * layout guard. The `updateApiResourceAction` server action
 * re-validates the session on every submission as belt-and-suspenders.
 *
 * Behaviour:
 *   - Pre-flight UUID-shape regex avoids a wire round-trip on
 *     obviously bad path segments.
 *   - Calls getApiResource(id) to fetch the current safe values.
 *   - Renders error branches: invalid UUID + result.invalid →
 *     NotFoundPanel; result.notFound → NotFoundPanel; result.forbidden
 *     → ForbiddenPanel; result.featureUnavailable →
 *     FeatureUnavailablePanel; fallthrough → ErrorPanel.
 *   - On success mounts EditApiResourceForm pre-filled with the
 *     fetched values.
 *
 * SECURITY:
 *   - Audience is rendered as a read-only display (it is immutable
 *     server-side). The form does not POST audience.
 *   - No secret/hash/JWKS/private-key field is rendered or accepted.
 */
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { getApiResource } from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { Metadata } from "next";
import { EditApiResourceForm } from "./edit-api-resource-form";

export const metadata: Metadata = {
  title: "Edit API resource — Identuum Org Admin",
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function OrgAdminAPIResourceEditPage({
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

  const result = await getApiResource(id);
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
      <Header name={r.name} audience={r.audience} />
      <EditApiResourceForm
        resourceId={r.id}
        initialName={r.name}
        initialAudience={r.audience}
        initialActive={r.active}
        initialTokenTTLSecs={r.token_ttl_secs}
        initialScopes={r.scopes}
      />
    </Shell>
  );
}

function Shell({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href={`/org-admin/api-resources/${encodeURIComponent(id)}`}
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to API resource details
      </a>
      {children}
    </div>
  );
}

function Header({ name, audience }: { name: string; audience: string }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-sky-950 break-all">Edit {name}</h1>
      <p className="text-sm text-stone-500 mt-0.5 font-mono break-all">{audience}</p>
      <p className="text-xs text-stone-400 mt-1">
        Update the name, status, TTL, and scope catalog. Audience cannot be changed. Secret rotation
        is not available from this page.
      </p>
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">API resource not found</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The API resource you tried to edit does not exist or has been removed.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        You do not have permission to edit this API resource.
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
        Reload the page or try again later.
      </p>
    </div>
  );
}
