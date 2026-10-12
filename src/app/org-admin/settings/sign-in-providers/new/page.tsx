/**
 * Org-admin: add the organization's sign-in provider (UI-0912-B). Saving
 * returns to the Settings card, which lists it with its redirect URI.
 *
 * Auth and role are enforced by the parent /org-admin layout; the save action
 * re-validates them. Both editions serve ONE provider per organization (the
 * singular /api/v1/organizations/:id/identity-provider route), so when one
 * exists this page says so instead of offering a form the IdP would refuse.
 *
 * Security: the client secret is write-only (see ../provider-form.tsx).
 */

import type { Metadata } from "next";
import { getOrgOidcProvider, getOwnOrganization } from "@/lib/idp-admin-client";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { ProviderForm } from "../provider-form";
import { SIGN_IN_PROVIDERS_HREF } from "../result-flash";

export const metadata: Metadata = { title: "Add sign-in provider — Identuum Org Admin" };

export default async function NewSignInProviderPage() {
  const org = await getOwnOrganization();
  const result = org?.id ? await getOrgOidcProvider(org.id) : null;
  const publicBase = loadRuntimeConfig()?.idp.public_base_url ?? "";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <a
          href={SIGN_IN_PROVIDERS_HREF}
          className="text-xs font-semibold text-sky-700 hover:text-sky-900"
        >
          ← Settings
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-sky-950">
          Add sign-in provider
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Let your users sign in with an external OpenID Connect provider (Google, Microsoft Entra
          ID, or any provider with a discovery document). First-time users are created on sign-in
          when their verified email domain is listed below.
        </p>
      </div>
      {(!result || (!result.ok && !result.forbidden)) && (
        <p role="alert" className="text-sm text-red-600">
          The sign-in providers could not be read. Try again in a moment.
        </p>
      )}
      {result && !result.ok && result.forbidden && (
        <p role="alert" className="text-sm text-red-600">
          You do not have permission to see sign-in providers.
        </p>
      )}
      {result?.ok && result.provider && (
        <p role="alert" className="text-sm text-red-600">
          This organization already has a sign-in provider. Edit or remove it first.
        </p>
      )}
      {result?.ok && !result.provider && <ProviderForm provider={null} publicBase={publicBase} />}
    </div>
  );
}
