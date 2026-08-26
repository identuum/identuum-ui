"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnOrganization, updateOrgProtocolSettings } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import type { OrgProtocolSettings } from "@/lib/types";
import { protocolSettingsSaveErrorMessage } from "./protocol-settings-helpers";

// site_admin submits the target org_id as a form field (they operate on any org).
const siteAdminSchema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  dynamic_client_registration_enabled: z.enum(["true", "false"]),
  scim_enabled: z.enum(["true", "false"]),
});

// org_admin: org_id is NOT trusted from form data — derived server-side via
// getOwnOrganization(). Only the two boolean strings are read from form data.
const orgAdminSchema = z.object({
  dynamic_client_registration_enabled: z.enum(["true", "false"]),
  scim_enabled: z.enum(["true", "false"]),
});

export interface UpdateProtocolSettingsActionState {
  ok?: true;
  /** Updated settings returned by the backend on success. */
  settings?: OrgProtocolSettings;
  error?: string;
}

/**
 * Server action: saves per-organization DCR + SCIM protocol settings.
 *
 * Authority:
 *   - site_admin: uses the form-submitted org_id to target any active org.
 *   - org_admin: derives org_id from getOwnOrganization() (session-scoped
 *     backend call) — form-submitted org_id is NEVER used for this role.
 *     This mirrors the existing pattern in /org-admin/settings/actions.ts.
 *
 * Cross-org attempts by org_admin cannot occur through this action because
 * the org_id is derived from the session, not from user input. The backend
 * enforces the same-org invariant as a second gate.
 *
 * FormData fields:
 *   - org_id                              UUID (used only for site_admin)
 *   - dynamic_client_registration_enabled "true" | "false"
 *   - scim_enabled                        "true" | "false"
 *
 * On success, revalidates the relevant page so the panel reflects the
 * freshly saved values on the next paint.
 */
export async function updateProtocolSettingsAction(
  _prev: UpdateProtocolSettingsActionState,
  formData: FormData
): Promise<UpdateProtocolSettingsActionState> {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }
  const role = session.user?.role ?? session.role;

  if (role === "site_admin") {
    return handleSiteAdminSave(formData);
  }
  if (role === "org_admin") {
    return handleOrgAdminSave(formData);
  }
  redirect(roleToPath(role));
}

async function handleSiteAdminSave(formData: FormData): Promise<UpdateProtocolSettingsActionState> {
  const raw = {
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
    dynamic_client_registration_enabled: (
      (formData.get("dynamic_client_registration_enabled") as string | null) ?? ""
    ).trim(),
    scim_enabled: ((formData.get("scim_enabled") as string | null) ?? "").trim(),
  };

  const parsed = siteAdminSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid request. Refresh the page and try again." };
  }

  const result = await updateOrgProtocolSettings(parsed.data.org_id, {
    dynamic_client_registration_enabled: parsed.data.dynamic_client_registration_enabled === "true",
    scim_enabled: parsed.data.scim_enabled === "true",
  });

  if (!result.ok) {
    return {
      error: protocolSettingsSaveErrorMessage({
        notFound: result.notFound,
        forbidden: result.forbidden,
        unavailable: result.unavailable,
        notLicensed: result.notLicensed,
        status: result.status,
      }),
    };
  }

  revalidatePath(`/site-admin/organizations/${parsed.data.org_id}`);
  return { ok: true, settings: result.settings };
}

async function handleOrgAdminSave(formData: FormData): Promise<UpdateProtocolSettingsActionState> {
  // Derive org_id from the session-scoped backend call.
  // NEVER use form-submitted org_id for org_admin — cross-org is blocked
  // by always using the authenticated org_admin's own organization.
  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const raw = {
    dynamic_client_registration_enabled: (
      (formData.get("dynamic_client_registration_enabled") as string | null) ?? ""
    ).trim(),
    scim_enabled: ((formData.get("scim_enabled") as string | null) ?? "").trim(),
  };

  const parsed = orgAdminSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid request. Refresh the page and try again." };
  }

  const result = await updateOrgProtocolSettings(org.id, {
    dynamic_client_registration_enabled: parsed.data.dynamic_client_registration_enabled === "true",
    scim_enabled: parsed.data.scim_enabled === "true",
  });

  if (!result.ok) {
    return {
      error: protocolSettingsSaveErrorMessage({
        notFound: result.notFound,
        forbidden: result.forbidden,
        unavailable: result.unavailable,
        notLicensed: result.notLicensed,
        status: result.status,
      }),
    };
  }

  revalidatePath("/org-admin/settings");
  return { ok: true, settings: result.settings };
}
