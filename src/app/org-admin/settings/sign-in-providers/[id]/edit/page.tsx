/**
 * Org-admin: edit one of the organization's sign-in providers (UI-0912-B).
 * Saving returns to the Settings card, which shows "Provider updated." once.
 *
 * Auth and role are enforced by the parent /org-admin layout; the save action
 * re-validates them. The id in the address only selects the provider: the
 * organization is the caller's own, and a provider that is not (or no longer)
 * this organization's opens Settings instead.
 *
 * Security: the client secret is write-only (see ../../provider-form.tsx).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrgOidcProvider, getOwnOrganization } from "@/lib/idp-admin-client";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { ProviderForm } from "../../provider-form";
import { SIGN_IN_PROVIDERS_HREF } from "../../result-flash";

export const metadata: Metadata = { title: "Edit sign-in provider — Identuum Org Admin" };

export default async function EditSignInProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getOwnOrganization();
  const result = org?.id ? await getOrgOidcProvider(org.id) : null;
  if (result?.ok && result.provider?.id !== id) redirect(SIGN_IN_PROVIDERS_HREF);
  const provider = result?.ok ? result.provider : null;
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
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-sky-950 break-words">
          {provider ? `Edit ${provider.name}` : "Edit sign-in provider"}
        </h1>
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
      {provider && <ProviderForm provider={provider} publicBase={publicBase} />}
    </div>
  );
}
