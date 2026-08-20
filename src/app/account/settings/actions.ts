"use server";

/**
 * Server action for the account settings / change-password form.
 *
 * Security:
 *   - Session is re-validated (belt-and-suspenders beyond the layout guard).
 *   - Accepts any authenticated human role: site_admin, org_admin, org_user.
 *   - M2M/agent tokens are rejected by DenyM2MClients() on the backend endpoint;
 *     those sessions would not have a valid UI session anyway.
 *   - The target user is derived from the authenticated session cookie, not from
 *     form data — no user ID spoofing is possible.
 *   - Passwords are never logged, returned in state, or included in error messages.
 *   - R2 (session revocation on password change) is an OPEN backend decision —
 *     the OSS IdP does NOT revoke sessions on this path today. The client
 *     component still redirects to /login as a UX convention.
 *
 * Backend endpoint: POST /api/v1/auth/change-password
 * Role check at backend: any authenticated non-M2M user (DenyM2MClients middleware).
 */

import { changeOwnPassword } from "@/lib/idp-admin-client";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";

export type ChangePasswordState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { confirmPassword?: string } }
  | { phase: "success" };

const HUMAN_ROLES = new Set(["site_admin", "org_admin", "org_user"]);

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (!HUMAN_ROLES.has(role as string)) redirect("/login?reason=session_expired");

  const currentPassword = ((formData.get("current_password") as string | null) ?? "").trim();
  const newPassword = (formData.get("new_password") as string | null) ?? "";
  const confirmPassword = (formData.get("confirm_password") as string | null) ?? "";

  if (!currentPassword || !newPassword) {
    return { phase: "error", error: "All password fields are required." };
  }

  if (newPassword !== confirmPassword) {
    return {
      phase: "error",
      error: "",
      fieldErrors: { confirmPassword: "Passwords do not match." },
    };
  }

  const result = await changeOwnPassword(currentPassword, newPassword);

  if (result.ok) return { phase: "success" };

  // 400: password policy violation — the backend message is safe to display.
  if (result.status === 400) {
    return { phase: "error", error: result.message };
  }

  return {
    phase: "error",
    error: "Could not change password. Check your current password and try again.",
  };
}
