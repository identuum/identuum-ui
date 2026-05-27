"use server";

import { resetOrgAdminMFA } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

/**
 * Server action that wraps the site_admin → org_admin MFA-reset
 * recovery endpoint (POST /api/v1/users/:id/recovery/reset-mfa).
 *
 * The action is invoked from the confirmation dialog rendered by the
 * Organization administrators card on the site-admin organization
 * detail page. On success the IDP has cleared the target row's
 * MFAEnabled flag and revoked the target's active sessions; we then
 * revalidate the detail page so the freshly-zeroed MFA status renders
 * on the next paint.
 *
 * Belt-and-suspenders: the action re-validates that the caller is a
 * site_admin even though the page layout already gates this. The
 * backend remains the source of truth, but redirecting unauthenticated
 * or wrong-role callers here avoids generating misleading error
 * banners in the dialog.
 */

const schema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  org_id: z.string().uuid("Invalid organization ID"),
});

export interface ResetAdminMFAActionState {
  ok?: true;
  error?: string;
}

export async function resetAdminMFAAction(
  _prev: ResetAdminMFAActionState,
  formData: FormData
): Promise<ResetAdminMFAActionState> {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") {
    redirect(roleToPath(role));
  }

  const raw = {
    user_id: ((formData.get("user_id") as string | null) ?? "").trim(),
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid request. Refresh the page and try again." };
  }

  const result = await resetOrgAdminMFA(parsed.data.user_id);

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Administrator account not found. It may have been removed." };
    }
    if (result.status === 403) {
      return {
        error:
          "Only site_admin may reset an org_admin's MFA, and the target must still be an active org_admin.",
      };
    }
    return { error: "MFA reset failed. Try again, or check the IDP logs." };
  }

  // Refresh the detail page so the admin's MFA status renders as cleared
  // on the next paint. We do NOT revalidate the entire layout — only the
  // page that lists the admins.
  revalidatePath(`/site-admin/organizations/${parsed.data.org_id}`);
  return { ok: true };
}
