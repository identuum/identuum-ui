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

// ── Invite policy ────────────────────────────────────────────────────────────

const VALID_INVITE_POLICY_MODES = [
  "invite-only",
  "public-with-approval",
  "public-immediate",
] as const;
export type InvitePolicyMode = (typeof VALID_INVITE_POLICY_MODES)[number];

export type UpdateInvitePolicyState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; mode: InvitePolicyMode };

/**
 * Persists the org-admin Invite policy mode by converting the mode to its
 * canonical `(allow_public_registration, require_registration_approval)`
 * pair and forwarding to the IDP via `updateOrganization`.
 *
 * Security:
 *   - Session re-validated.
 *   - Role gated to org_admin.
 *   - Org ID derived from the session-scoped getOwnOrganization endpoint;
 *     never from form data.
 *   - The mode enum is the only operator-visible input. The flag pair is
 *     derived locally so the invalid `(false, true)` combination cannot
 *     reach the wire even if a malicious client tampered with the form.
 */
export async function updateInvitePolicyAction(
  _prev: UpdateInvitePolicyState,
  formData: FormData
): Promise<UpdateInvitePolicyState> {
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

  const rawMode = ((formData.get("invite_policy_mode") as string | null) ?? "").trim();
  if (!VALID_INVITE_POLICY_MODES.includes(rawMode as InvitePolicyMode)) {
    return {
      phase: "error",
      error: "Invalid invite policy mode.",
    };
  }
  const mode = rawMode as InvitePolicyMode;

  // Derive the persisted flag pair from the mode. This is the only place the
  // booleans cross the wire — the form NEVER submits the booleans directly.
  const allow_public_registration = mode !== "invite-only";
  const require_registration_approval = mode === "public-with-approval";

  const result = await updateOrganization(org.id, {
    allow_public_registration,
    require_registration_approval,
  });

  if (result.ok) {
    revalidatePath("/org-admin/settings");
    return { phase: "success", mode };
  }

  if (result.notFound) {
    return { phase: "error", error: "Organization not found." };
  }

  return { phase: "error", error: "Failed to update invite policy. Please try again." };
}
