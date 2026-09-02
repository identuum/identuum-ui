"use server";

/**
 * Server action for the account settings / profile form (THE-PROFILE-CLAIMS).
 *
 * Security:
 *   - Session is re-validated; any authenticated human role may edit their
 *     OWN profile. The target is the session's user — no id in the form.
 *   - Only the display name and the twelve OIDC §5.1 profile fields are
 *     forwarded; email, role and status are not reachable from here.
 *   - An empty input clears the field on the IdP ("" = clear); the IdP
 *     validates formats and answers 400 with a field-level message.
 *
 * Backend endpoint: PUT /api/v1/profile
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type OwnProfilePatch, updateOwnProfile } from "@/lib/idp-profile-client";
import { getServerSession } from "@/lib/server-session";
import { PROFILE_FIELD_KEYS } from "@/lib/types";

export type ProfileFormState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success" };

const HUMAN_ROLES = new Set(["site_admin", "org_admin", "org_user"]);

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (!HUMAN_ROLES.has(role as string)) redirect("/login?reason=session_expired");

  const patch: OwnProfilePatch = {};
  const name = formData.get("name");
  if (typeof name === "string") patch.name = name.trim();
  for (const key of PROFILE_FIELD_KEYS) {
    const v = formData.get(key);
    if (typeof v === "string") patch[key] = v.trim();
  }

  const result = await updateOwnProfile(patch);
  if (result.ok) {
    revalidatePath("/account/settings");
    return { phase: "success" };
  }
  if (result.unavailable) {
    return { phase: "error", error: "Profile editing is not available on this backend." };
  }
  return { phase: "error", error: result.message };
}
