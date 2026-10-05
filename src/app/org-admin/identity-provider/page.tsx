/**
 * Org-admin: the organization's upstream OIDC sign-in provider.
 *
 * Auth and role are enforced by the parent /org-admin layout.
 *
 * Backend (docs/guides/oidc-upstream-login.md in identuum-idp-oss):
 *   GET / POST / PUT / DELETE /api/v1/organizations/:id/identity-provider —
 *   one OIDC provider per organization, org_admin own-org only.
 *
 * Security: the client secret is write-only. No response carries it, the
 * projection has no field for it, and the form never pre-fills it.
 */

import type { Metadata } from "next";
import { getOrgOidcProvider, getOwnOrganization } from "@/lib/idp-admin-client";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { ProviderForm } from "./provider-form";

export const metadata: Metadata = { title: "Sign-in provider — Identuum Org Admin" };

export default async function OrgIdentityProviderPage() {
  const org = await getOwnOrganization();
  const result = org?.id ? await getOrgOidcProvider(org.id) : null;
  // The callback is on the IdP's public address; the console falls back to
  // its own origin, which is the IdP's when the IdP serves the console.
  const publicBase = loadRuntimeConfig()?.idp.public_base_url ?? "";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Sign-in provider</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Let your users sign in with an external OpenID Connect provider (Google, Microsoft Entra
          ID, or any provider with a discovery document). Your organization has at most one.
          First-time users are created on sign-in when their verified email domain is listed below.
        </p>
      </div>

      {!result && (
        <p role="alert" className="text-sm text-red-600">
          Your organization could not be read. Reload the page to try again.
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm text-red-600">
          {result.forbidden
            ? "Your session does not have permission to manage the sign-in provider."
            : "The sign-in provider could not be read. Reload the page to try again."}
        </p>
      )}
      {result?.ok && <ProviderForm provider={result.provider} publicBase={publicBase} />}
    </div>
  );
}
