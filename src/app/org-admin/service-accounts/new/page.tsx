/**
 * Org-admin Create Service Account page.
 *
 * Server-rendered shell that hosts the CreateServiceAccountForm client
 * component. Auth + role are enforced by the parent /org-admin layout.
 *
 * IMPORTANT: the IDP's POST /api/v1/organizations/:id/service-accounts
 * endpoint does NOT return a credential / secret / hash / private-key
 * field. The response is the same 7-field types.ServiceAccount as the
 * list endpoint. This page therefore does NOT render a copy-once
 * credential panel — there is no one-time credential to show.
 */

import type { Metadata } from "next";
import {
  type AuthorizationServerPageBoundary,
  getAuthorizationServerPageBoundary,
} from "@/lib/capability-affordances";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { CreateServiceAccountForm } from "./create-service-account-form";

export const metadata: Metadata = {
  title: "Create service account — Identuum Org Admin",
};

export default async function CreateServiceAccountPage() {
  const runtimeState = await getServerRuntimeState();
  const capabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: runtimeState?.components.idp.capabilities,
    surface: "service_accounts",
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href="/org-admin/service-accounts"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to service accounts
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Create service account
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Register a machine-to-machine identity. No credential is issued here — a future feature
          will let you link a service account to an OAuth client to obtain a usable
          client_credentials grant.
        </p>
      </div>
      {capabilityBoundary ? (
        <CapabilityUnavailablePanel copy={capabilityBoundary} />
      ) : (
        <CreateServiceAccountForm />
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
