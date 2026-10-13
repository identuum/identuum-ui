"use server";

/**
 * Server actions for the sign-in providers on /org-admin/settings and its Add
 * and Edit pages (UI-0912-B; until then /org-admin/identity-provider): the
 * organization's ONE upstream OIDC provider (docs/guides/oidc-upstream-login.md
 * in identuum-idp-oss).
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
  getOwnOrganizationResult,
  type OrgOidcProviderInput,
  saveOrgOidcProvider,
  updateOrganization,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { orgReadFailure } from "./org-read";
import {
  AUTH_POLICIES,
  type AuthPolicy,
  authPolicyRefused,
  LAST_PROVIDER_TEXT,
  saveRefused,
} from "./provider-words";
import type { ProviderResult } from "./result-flash";

/**
 * What the admin typed, handed back on a failed save so the form keeps it
 * (React 19 resets an uncontrolled form after every action). Never the
 * client secret.
 */
export type ProviderTypedValues = {
  name: string;
  slug: string;
  issuer_url: string;
  client_id: string;
  scopes: string;
  email_domains: string;
  allow_external_domains: boolean;
};

export type ProviderFormState =
  | {
      phase: "idle";
      error?: string;
      fieldErrors?: Partial<Record<string, string>>;
      values?: ProviderTypedValues;
    }
  | { phase: "saved"; result: ProviderResult }
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
  const values: ProviderTypedValues = {
    name: field("name"),
    slug: field("slug"),
    issuer_url: field("issuer_url"),
    client_id: field("client_id"),
    scopes: field("scopes"),
    email_domains: field("email_domains"),
    allow_external_domains: formData.get("allow_external_domains") === "on",
  };
  const input: OrgOidcProviderInput = {
    name: values.name,
    slug: values.slug,
    issuer_url: values.issuer_url,
    client_id: values.client_id,
    client_secret: (formData.get("client_secret") as string | null) ?? "",
    scopes: splitList(values.scopes),
    email_domains: splitList(values.email_domains),
    allow_external_domains: values.allow_external_domains,
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
    return { phase: "idle", error: "Check the fields below.", fieldErrors, values };
  }

  const org = await getOwnOrganizationResult();
  if (!org.ok || !org.org.id) {
    if (!org.ok && org.kind === "session") redirect("/login?reason=session_expired");
    return { phase: "idle", error: orgReadFailure(org.ok ? "other" : org.kind, "saved"), values };
  }
  const result = await saveOrgOidcProvider(org.org.id, input, mode);
  if (!result.ok) {
    if (result.status === 401) redirect("/login?reason=session_expired");
    return { phase: "idle", error: saveRefused(result.status, result.error), values };
  }
  // No revalidatePath here (UI-0912-AB-FIX F2): in Next it re-renders the
  // page that saved, and the Add page with a provider swaps the form for the
  // "already has a provider" alert before the form can open Settings. The
  // form opens Settings itself, which reads the list fresh.
  return { phase: "saved", result: mode === "create" ? "saved" : "updated" };
}

export async function deleteOidcProviderAction(
  _prev: ProviderFormState,
  _formData: FormData
): Promise<ProviderFormState> {
  await requireOrgAdmin();
  const org = await getOwnOrganizationResult();
  if (!org.ok || !org.org.id) {
    if (!org.ok && org.kind === "session") redirect("/login?reason=session_expired");
    return { phase: "idle", error: orgReadFailure(org.ok ? "other" : org.kind, "removed") };
  }
  const result = await deleteOrgOidcProvider(org.org.id);
  // The route's own 404: another tab already removed it, which is what was
  // asked (F4). A 404 from a server without the route is not a removal (U5).
  if (!result.ok && (result.status !== 404 || result.routeMissing)) {
    if (result.status === 401) redirect("/login?reason=session_expired");
    if (result.status === 409 && result.error === "last_active_identity_provider") {
      return { phase: "idle", error: LAST_PROVIDER_TEXT };
    }
    if (result.routeMissing) {
      return {
        phase: "idle",
        error: "The provider was not removed. This server does not offer sign-in providers.",
      };
    }
    // COPY B-31: the row stays, and the line says so plainly.
    return { phase: "idle", error: "The provider was not removed. Try again." };
  }
  revalidatePath("/org-admin/settings");
  return { phase: "deleted" };
}

export type AuthPolicyFormState =
  | { phase: "idle"; error?: string }
  | { phase: "saved"; policy: AuthPolicy };

/**
 * The organization's sign-in policy (D2): PUT /api/v1/organizations/:id with
 * auth_policy. The IdP refuses provider-only without an active provider
 * (owner Q1 a) and refuses a site_admin; the card disables the first and is
 * read-only for the second, so these refusals are the last line.
 */
export async function updateAuthPolicyAction(
  _prev: AuthPolicyFormState,
  formData: FormData
): Promise<AuthPolicyFormState> {
  await requireOrgAdmin();
  const raw = ((formData.get("auth_policy") as string | null) ?? "").trim();
  if (!AUTH_POLICIES.includes(raw as AuthPolicy)) {
    return { phase: "idle", error: "Choose how members sign in." };
  }
  const policy = raw as AuthPolicy;
  const org = await getOwnOrganizationResult();
  if (!org.ok || !org.org.id) {
    if (!org.ok && org.kind === "session") redirect("/login?reason=session_expired");
    return { phase: "idle", error: orgReadFailure(org.ok ? "other" : org.kind, "changed") };
  }
  const result = await updateOrganization(org.org.id, { auth_policy: policy });
  if (!result.ok) {
    if (result.status === 401) redirect("/login?reason=session_expired");
    return { phase: "idle", error: authPolicyRefused(result) };
  }
  revalidatePath("/org-admin/settings");
  return { phase: "saved", policy };
}
