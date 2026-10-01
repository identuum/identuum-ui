/**
 * Self-registration (D-021, identuum-idp-oss 120ec7f): the console's calls.
 *
 *   GET|PUT /api/v1/settings/self-registration            site_admin: {enabled}
 *   GET|PUT /api/v1/organizations/:id/registration         org_admin: the policy
 *   GET     /api/v1/organizations/:id/registrations        org_admin: pending
 *   POST    /api/v1/users/:id/reject                       org_admin (approve: idp-admin-client)
 *   GET|POST /api/v1/auth/register/:org_slug               public
 *
 * A refusal maps to one plain sentence; the IdP's codes are read, never shown.
 */
import { idpAuthHeaders, idpFetch } from "./idp-transport";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";

export interface OrgRegistrationSettings {
  allow_public_registration: boolean;
  require_registration_approval: boolean;
  verify_email: boolean;
  email_domains: string[];
}

export interface PendingRegistration {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface RegistrationInfo {
  open: boolean;
  verify_email?: boolean;
  approval_required?: boolean;
  password_policy?: { min_length: number; complexity: boolean };
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

const MESSAGES: Record<string, string> = {
  instance_registration_disabled:
    "Self-registration is off for this installation. A site administrator must turn it on first.",
  smtp_not_configured:
    "Email delivery is not configured on the identity provider, so email verification cannot be required.",
  invalid_email_domain: "One of the email domains is not a valid domain name.",
};
const GENERIC = "The request could not be completed. Try again.";

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  authed = true
): Promise<Result<T>> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) return { ok: false, status: 503, message: GENERIC };
  try {
    const res = await idpFetch(`${idpBaseUrl(cfg)}${path}`, {
      method,
      headers: {
        ...(authed ? await idpAuthHeaders() : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw API response, read by field below
    const data: any = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, value: data as T };
    const code = typeof data?.error === "string" ? data.error : "";
    const message =
      code === "weak_password" && typeof data?.message === "string"
        ? data.message
        : (MESSAGES[code] ?? GENERIC);
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: GENERIC };
  }
}

const org = (id: string) => `/api/v1/organizations/${encodeURIComponent(id)}`;

export const getInstanceRegistration = () =>
  call<{ enabled: boolean }>("GET", "/api/v1/settings/self-registration");
export const setInstanceRegistration = (enabled: boolean) =>
  call<{ enabled: boolean }>("PUT", "/api/v1/settings/self-registration", { enabled });
export const getOrgRegistration = (orgId: string) =>
  call<OrgRegistrationSettings>("GET", `${org(orgId)}/registration`);
export const setOrgRegistration = (orgId: string, s: OrgRegistrationSettings) =>
  call<OrgRegistrationSettings>("PUT", `${org(orgId)}/registration`, s);
export const listPendingRegistrations = (orgId: string) =>
  call<{ registrations: PendingRegistration[] }>("GET", `${org(orgId)}/registrations`);
export const rejectRegistration = (userId: string) =>
  call<Record<string, never>>("POST", `/api/v1/users/${encodeURIComponent(userId)}/reject`);

const register = (slug: string) => `/api/v1/auth/register/${encodeURIComponent(slug)}`;
export const getRegistrationInfo = (slug: string) =>
  call<RegistrationInfo>("GET", register(slug), undefined, false);
export const submitRegistration = (
  slug: string,
  body: { email: string; name: string; password: string }
) => call<{ accepted: boolean }>("POST", register(slug), body, false);
