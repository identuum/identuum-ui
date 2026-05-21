"use server";

/**
 * Server actions for /org-admin/settings.
 *
 * Security:
 *   - Session re-validated on every action (belt-and-suspenders beyond the layout guard).
 *   - Role checked: only org_admin may invoke these actions.
 *   - Organization ID derived from getOwnOrganization() (backend session-scoped) —
 *     never from the UI session cache (whose org field name differed from the backend)
 *     and never from form data.
 *   - mfa_policy validated server-side; values outside the allowed enum fail closed.
 */

import { getOwnOrganization, updateOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const VALID_MFA_POLICIES = ["optional", "required"] as const;
export type MFAPolicy = (typeof VALID_MFA_POLICIES)[number];

export type UpdateMFAPolicyState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; mfa_policy: MFAPolicy };

export async function updateMFAPolicyAction(
  _prev: UpdateMFAPolicyState,
  formData: FormData
): Promise<UpdateMFAPolicyState> {
  // Re-validate session — belt-and-suspenders beyond the /org-admin layout guard.
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") {
    redirect(roleToPath(role));
  }

  // Derive org ID from the backend-session-scoped organization endpoint.
  // This is safer than relying on the UI session cache shape, which may not
  // include the org ID field depending on how the validate response is mapped.
  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const rawPolicy = ((formData.get("mfa_policy") as string | null) ?? "").trim();

  // Fail closed: reject any value not in the exact enum.
  if (!VALID_MFA_POLICIES.includes(rawPolicy as MFAPolicy)) {
    return { phase: "error", error: "Invalid MFA policy. Must be 'optional' or 'required'." };
  }

  const policy = rawPolicy as MFAPolicy;

  const result = await updateOrganization(org.id, { mfa_policy: policy });

  if (result.ok) {
    return { phase: "success", mfa_policy: policy };
  }

  if (result.notFound) {
    return { phase: "error", error: "Organization not found." };
  }

  return { phase: "error", error: "Failed to update MFA policy. Please try again." };
}

// ── Organization profile ──────────────────────────────────────────────────────

export type UpdateOrgProfileState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: Partial<Record<"name", string>> }
  | { phase: "success"; name: string };

export async function updateOrgProfileAction(
  _prev: UpdateOrgProfileState,
  formData: FormData
): Promise<UpdateOrgProfileState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const rawName = ((formData.get("name") as string | null) ?? "").trim();
  if (!rawName) {
    return { phase: "error", error: "", fieldErrors: { name: "Organization name is required." } };
  }
  if (rawName.length > 100) {
    return {
      phase: "error",
      error: "",
      fieldErrors: { name: "Organization name must be 100 characters or fewer." },
    };
  }

  const result = await updateOrganization(org.id, { name: rawName });

  if (result.ok) {
    revalidatePath("/org-admin/settings");
    return { phase: "success", name: rawName };
  }

  if (result.notFound) {
    return { phase: "error", error: "Organization not found." };
  }

  return { phase: "error", error: "Failed to update organization profile. Please try again." };
}
