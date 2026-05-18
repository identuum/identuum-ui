"use server";

/**
 * Server actions for /org-admin/users.
 *
 * Security:
 *   - Session re-validated on every action.
 *   - Role checked: only org_admin may invoke these actions.
 *   - Organization scope enforced by the backend, not the browser.
 *   - User ID comes from the form (safe: backend checks target belongs to actor's org).
 *   - No setup links, tokens, cookies, or credentials are logged.
 */

import { inviteOrgUser, regenerateInvitation, resetUserMFA, setUserActive } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ── Invite user ───────────────────────────────────────────────────────────────

export interface InviteUserState {
  phase: "form" | "success" | "error";
  setupUrl?: string;
  /** true when the invite was created without an email (manual delivery required) */
  noEmail?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"email", string>>;
}

export async function inviteOrgUserAction(
  _prev: InviteUserState,
  formData: FormData
): Promise<InviteUserState> {
  const rawEmail = (formData.get("email") as string | null)?.trim() ?? "";
  const rawName = (formData.get("name") as string | null)?.trim() ?? "";

  // Basic email format check when provided
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return {
      phase: "form",
      fieldErrors: { email: "Enter a valid email address or leave it blank." },
    };
  }

  const result = await inviteOrgUser({
    email: rawEmail || undefined,
    name: rawName || undefined,
    role: "org_user",
  });

  if (result.ok) {
    revalidatePath("/org-admin/users");
    return {
      phase: "success",
      setupUrl: result.setupUrl || undefined,
      noEmail: !rawEmail,
    };
  }

  // Surface conflict (409) or other errors
  return { phase: "error", error: result.message };
}

// ── Enable / Disable user ─────────────────────────────────────────────────────

export interface SetUserActiveState {
  phase: "idle" | "error";
  userId?: string;
  error?: string;
}

export async function setUserActiveAction(
  _prev: SetUserActiveState,
  formData: FormData
): Promise<SetUserActiveState> {
  // Re-validate session and role.
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  const activeStr = ((formData.get("active") as string | null) ?? "").trim();

  if (!userId) return { phase: "error", userId: "", error: "Missing user ID." };

  const active = activeStr === "true";

  const result = await setUserActive(userId, active);

  if (result.ok) {
    revalidatePath("/org-admin/users");
    revalidatePath(`/org-admin/users/${userId}`);
    return { phase: "idle" };
  }

  return { phase: "error", userId, error: result.message };
}

// ── Regenerate invitation setup link ─────────────────────────────────────────

export interface RegenerateInviteState {
  phase: "idle" | "success" | "error";
  userId?: string;
  setupUrl?: string;
  error?: string;
}

export async function regenerateInviteAction(
  _prev: RegenerateInviteState,
  formData: FormData
): Promise<RegenerateInviteState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", userId: "", error: "Missing user ID." };

  const result = await regenerateInvitation(userId);

  if (result.ok) {
    // Do not revalidatePath here — the page should keep showing the copied URL.
    // The caller can reload after the operator copies the link.
    return { phase: "success", userId, setupUrl: result.setupUrl };
  }

  return { phase: "error", userId, error: result.message };
}

// ── Reset MFA enrollment ──────────────────────────────────────────────────────

export interface ResetMFAState {
  phase: "idle" | "success" | "error";
  error?: string;
}

export async function resetMFAAction(
  _prev: ResetMFAState,
  formData: FormData
): Promise<ResetMFAState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", error: "Missing user ID." };

  const result = await resetUserMFA(userId);

  if (result.ok) {
    revalidatePath("/org-admin/users");
    revalidatePath(`/org-admin/users/${userId}`);
    return { phase: "success" };
  }

  return { phase: "error", error: result.message };
}
