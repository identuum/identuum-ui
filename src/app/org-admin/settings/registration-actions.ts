"use server";

/** D-021: an org_admin sets its own organization's self-registration policy. */

import { redirect } from "next/navigation";
import { type OrgRegistrationSettings, setOrgRegistration } from "@/lib/idp-registration-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

export interface OrgRegistrationState {
  settings: OrgRegistrationSettings;
  error?: string;
  /** The IdP said the instance switch is off: the form turns read-only. */
  instanceOff?: boolean;
  saved?: boolean;
}

export async function setOrgRegistrationAction(
  prev: OrgRegistrationState,
  formData: FormData
): Promise<OrgRegistrationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));
  const orgId = String(formData.get("org_id") ?? "");
  const next: OrgRegistrationSettings = {
    allow_public_registration: formData.get("allow") === "on",
    require_registration_approval: formData.get("approval") === "on",
    verify_email: formData.get("verify") === "on",
    email_domains: String(formData.get("domains") ?? "")
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
  const r = await setOrgRegistration(orgId, next);
  if (!r.ok) {
    return {
      settings: prev.settings,
      error: r.message,
      instanceOff: r.status === 409 || prev.instanceOff,
    };
  }
  return { settings: r.value, saved: true };
}
