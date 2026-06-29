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

import { listOwnSessions, revokeSessionById } from "@/lib/idp-account-client";
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

  // Resolve the caller's own sessions, then revoke the targeted subset via the
  // per-session Family-A route (works on BOTH IDP OSS and IDP CE). Bulk
  // semantics are derived here from the list + the `is_current` flag rather
  // than relying on the OSS-only /me/sessions/revoke-* routes (which 404 on
  // CE — the original "unavailable" regression).
  const list = await listOwnSessions();
  if (!list.ok) {
    if (list.unavailable) {
      return { error: "Session management is not available from this IDP runtime." };
    }
    if (list.status === 401) {
      return { error: "Your session has expired. Sign in again." };
    }
    if (list.status === 403) {
      return { error: "Session management is not available for this account type." };
    }
    return { error: "Could not load sessions. Try again." };
  }

  const action = parsed.data.action;
  let targetIds: string[];
  if (action === "revoke_current") {
    targetIds = list.sessions.filter((s) => s.is_current && s.id).map((s) => s.id);
  } else if (action === "revoke_others") {
    targetIds = list.sessions.filter((s) => !s.is_current && s.id).map((s) => s.id);
  } else {
    targetIds = list.sessions.filter((s) => s.id).map((s) => s.id);
  }

  if (targetIds.length === 0 && action === "revoke_current") {
    // No identifiable current session (e.g. a legacy session with no
    // external_sid). The account-menu Sign out remains the fallback.
    return { error: "Could not identify the current session. Use the account menu to sign out." };
  }

  let lastForbidden = false;
  let lastUnauthorized = false;
  let anyFailure = false;
  for (const id of targetIds) {
    const r = await revokeSessionById(id);
    if (!r.ok) {
      anyFailure = true;
      lastForbidden = lastForbidden || r.forbidden;
      lastUnauthorized = lastUnauthorized || r.unauthorized;
    }
  }

  if (anyFailure) {
    if (lastUnauthorized) {
      return { error: "Your session has expired. Sign in again." };
    }
    if (lastForbidden) {
      return { error: "Session management is not available for this account type." };
    }
    return { error: "Could not revoke sessions. Try again." };
  }

  revalidatePath("/account/settings");
  return {
    success: true,
    signedOut: action === "revoke_current" || action === "revoke_all",
  };
}
