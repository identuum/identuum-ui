"use server";

/**
 * Server actions for /org-admin/identity-provider: the organization's ONE
 * upstream OIDC provider (docs/guides/oidc-upstream-login.md in
 * identuum-idp-oss).
 *
 *   - Session and role re-validated on every action (org_admin only; the IdP
 *     refuses site_admin as well).
 *   - The organization is the caller's own, read on the server; no form field
 *     names it.
 *   - client_secret is write-only: forwarded when typed, never returned, never
 *     logged; an empty one on update keeps the stored secret.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteOrgOidcProvider,
  getOwnOrganization,
  type OrgOidcProviderInput,
  saveOrgOidcProvider,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

export type ProviderFormState =
  | { phase: "idle"; error?: string; fieldErrors?: Partial<Record<string, string>> }
  | { phase: "saved"; message: string }
  | { phase: "deleted" };

/** Splits a list typed with spaces, commas or new lines. */
function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function requireOrgAdmin(): Promise<void> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));
}

export async function saveOidcProviderAction(
  _prev: ProviderFormState,
  formData: FormData
): Promise<ProviderFormState> {
  await requireOrgAdmin();
  const field = (k: string) => ((formData.get(k) as string | null) ?? "").trim();
  const mode = field("mode") === "update" ? "update" : "create";
  const input: OrgOidcProviderInput = {
    name: field("name"),
    slug: field("slug"),
    issuer_url: field("issuer_url"),
    client_id: field("client_id"),
    client_secret: (formData.get("client_secret") as string | null) ?? "",
    scopes: splitList(field("scopes")),
    email_domains: splitList(field("email_domains")),
    allow_external_domains: formData.get("allow_external_domains") === "on",
  };
  const fieldErrors: Partial<Record<string, string>> = {};
  if (!input.name) fieldErrors.name = "Enter a name.";
  if (!input.slug) fieldErrors.slug = "Enter a short identifier.";
  if (!input.issuer_url) fieldErrors.issuer_url = "Enter the provider's issuer URL.";
  if (!input.client_id) fieldErrors.client_id = "Enter the client ID registered with the provider.";
  if (mode === "create" && !input.client_secret)
    fieldErrors.client_secret = "Enter the client secret registered with the provider.";
  if (!input.allow_external_domains && input.email_domains.length === 0)
    fieldErrors.email_domains =
      "List at least one email domain, or allow every domain. Without either, nobody can sign in.";
  if (Object.keys(fieldErrors).length > 0) {
    return { phase: "idle", error: "Check the fields below.", fieldErrors };
  }

  const org = await getOwnOrganization();
  if (!org?.id) return { phase: "idle", error: "Your organization could not be read. Try again." };
  const result = await saveOrgOidcProvider(org.id, input, mode);
  if (!result.ok) {
    if (result.status === 401) redirect("/login?reason=session_expired");
    return { phase: "idle", error: result.error };
  }
  revalidatePath("/org-admin/identity-provider");
  revalidatePath("/org-admin/settings");
  return { phase: "saved", message: mode === "create" ? "Provider saved." : "Provider updated." };
}

export async function deleteOidcProviderAction(
  _prev: ProviderFormState,
  _formData: FormData
): Promise<ProviderFormState> {
  await requireOrgAdmin();
  const org = await getOwnOrganization();
  if (!org?.id) return { phase: "idle", error: "Your organization could not be read. Try again." };
  const result = await deleteOrgOidcProvider(org.id);
  if (!result.ok) {
    if (result.status === 401) redirect("/login?reason=session_expired");
    return { phase: "idle", error: result.error };
  }
  revalidatePath("/org-admin/identity-provider");
  revalidatePath("/org-admin/settings");
  return { phase: "deleted" };
}
