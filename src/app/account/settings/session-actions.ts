"use server";

/**
 * Server actions for revoking sessions from /account/settings.
 *
 * Security:
 *   - Session is re-validated beyond the layout guard.
 *   - The /me endpoints derive user/session identity from the authenticated
 *     principal only. No user or session identifiers are accepted from the browser.
 *   - Destructive actions require a short type-to-confirm value.
 *   - Current/all-session revocation signs out the browser session; the client
 *     component redirects to /login after the action succeeds.
 */

import {
  revokeAllSessions,
  revokeCurrentSession,
  revokeOtherSessions,
} from "@/lib/idp-account-client";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const confirmByAction = {
  revoke_current: "CURRENT",
  revoke_others: "OTHERS",
  revoke_all: "ALL",
} as const;

const schema = z.object({
  action: z.enum(["revoke_current", "revoke_others", "revoke_all"]),
  confirm: z.string(),
});

const HUMAN_ROLES = new Set(["site_admin", "org_admin", "org_user"]);

export interface RevokeSessionState {
  error?: string;
  success?: boolean;
  signedOut?: boolean;
}

export async function revokeSessionAction(
  _prev: RevokeSessionState,
  formData: FormData
): Promise<RevokeSessionState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (!HUMAN_ROLES.has(role as string)) redirect("/login?reason=session_expired");

  const raw = {
    action: ((formData.get("action") as string | null) ?? "").trim(),
    confirm: ((formData.get("confirm") as string | null) ?? "").trim(),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: "Invalid session action." };

  const expected = confirmByAction[parsed.data.action];
  if (parsed.data.confirm !== expected) {
    return { error: `Type ${expected} to confirm.` };
  }

  const result =
    parsed.data.action === "revoke_current"
      ? await revokeCurrentSession()
      : parsed.data.action === "revoke_others"
        ? await revokeOtherSessions()
        : await revokeAllSessions();

  if (!result.ok) {
    if (result.unavailable) {
      return { error: "Session management is not available from this IDP runtime." };
    }
    if (result.unauthorized) {
      return { error: "Your session has expired. Sign in again." };
    }
    if (result.forbidden) {
      return { error: "Session management is not available for this account type." };
    }
    return { error: "Could not revoke sessions. Try again." };
  }

  revalidatePath("/account/settings");
  return {
    success: true,
    signedOut: parsed.data.action === "revoke_current" || parsed.data.action === "revoke_all",
  };
}
