"use server";

/**
 * Server action for revoking a session from /account/settings.
 *
 * Security:
 *   - Session is re-validated beyond the layout guard.
 *   - The session_id to revoke comes from formData and is UUID-validated.
 *   - Ownership is enforced at the backend service layer; the actor cannot
 *     revoke sessions belonging to other users.
 *   - site_admin receives a 403 from the backend by design (cross-tenant
 *     isolation). The action returns an appropriate UI message.
 *   - Revoking the current session is treated as a sign-out at the backend;
 *     the UI prevents submitting it (current session has no revoke form).
 */

import { revokeOwnSession } from "@/lib/idp-admin-client";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  session_id: z.string().uuid("Invalid session ID"),
});

const HUMAN_ROLES = new Set(["site_admin", "org_admin", "org_user"]);

export interface RevokeSessionState {
  error?: string;
  success?: boolean;
}

export async function revokeSessionAction(
  _prev: RevokeSessionState,
  formData: FormData
): Promise<RevokeSessionState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (!HUMAN_ROLES.has(role as string)) redirect("/login?reason=session_expired");

  const raw = { session_id: ((formData.get("session_id") as string | null) ?? "").trim() };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: "Invalid session." };

  const result = await revokeOwnSession(parsed.data.session_id);

  if (!result.ok) {
    if (result.forbidden) {
      return { error: "Session management is not available for this account type." };
    }
    if (result.notFound) {
      revalidatePath("/account/settings");
      return { error: "Session not found or already signed out." };
    }
    return { error: "Could not sign out that session. Try again." };
  }

  revalidatePath("/account/settings");
  return { success: true };
}
