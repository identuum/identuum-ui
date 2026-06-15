/**
 * Org-admin Create API Resource page.
 *
 * Server-rendered shell that hosts the CreateApiResourceForm client
 * component. Auth + role are enforced by the parent /org-admin layout
 * guard.
 *
 * SECURITY:
 *   - The IDP's POST /api/v1/api-resources returns a one-time plaintext
 *     `secret` at the top-level envelope { resource, secret }. The form
 *     surfaces it once in a copy-once panel. The page itself does not
 *     render any secret.
 *   - Tenant scope is server-injected from the actor's session.
 *   - The form does NOT carry organization_id, secret, or any field
 *     outside the documented Create input shape.
 */
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { Metadata } from "next";
import { CreateApiResourceForm } from "./create-api-resource-form";

export const metadata: Metadata = {
  title: "Create API resource — Identuum Org Admin",
};

export default async function CreateApiResourcePage() {
  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "api_resources",
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href="/org-admin/api-resources"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to API resources
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Create API resource</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Register a new audience-scoped resource server. The resource secret is shown only once
          after create.
        </p>
      </div>
      {capabilityBoundary ? (
        <CapabilityUnavailablePanel copy={capabilityBoundary} />
      ) : (
        <CreateApiResourceForm />
      )}
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
