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

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveUserRegistration,
  assignUserRole,
  createPasswordResetLink,
  removeUserRole,
  resetUserMFA,
  setUserActive,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

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

// ── Create a one-time password reset link (CE-UI-2b) ──────────────────────────

export interface CreateResetLinkState {
  phase: "idle" | "success" | "error";
  /** Shown once to the org_admin and never stored. */
  resetUrl?: string;
  expiresAt?: string;
  error?: string;
}

export async function createResetLinkAction(
  _prev: CreateResetLinkState,
  formData: FormData
): Promise<CreateResetLinkState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", error: "Missing user ID." };

  const result = await createPasswordResetLink(userId);
  if (result.ok) {
    return { phase: "success", resetUrl: result.resetUrl, expiresAt: result.expiresAt };
  }
  return { phase: "error", error: result.message };
}

// ── Approve pending registration (POST /api/v1/users/:id/approve) ────────────

export interface ApproveRegistrationState {
  phase: "idle" | "success" | "error";
  activationUrl?: string | null;
  error?: string;
}

export async function approveRegistrationAction(
  _prev: ApproveRegistrationState,
  formData: FormData
): Promise<ApproveRegistrationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", error: "Missing user ID." };

  const result = await approveUserRegistration(userId);
  if (result.ok) {
    revalidatePath("/org-admin/users");
    revalidatePath(`/org-admin/users/${userId}`);
    return { phase: "success", activationUrl: result.activationUrl };
  }
  return { phase: "error", error: result.message };
}

// ── Assign role to user (POST /api/v1/users/:id/roles) ───────────────────────

export interface AssignUserRoleState {
  phase: "idle" | "success" | "error";
  error?: string;
}

export async function assignUserRoleAction(
  _prev: AssignUserRoleState,
  formData: FormData
): Promise<AssignUserRoleState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  const roleId = ((formData.get("roleId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", error: "Missing user ID." };
  if (!roleId) return { phase: "error", error: "Select a role to assign." };

  const result = await assignUserRole(userId, roleId);
  if (result.ok) {
    revalidatePath("/org-admin/users");
    revalidatePath(`/org-admin/users/${userId}`);
    return { phase: "success" };
  }
  return { phase: "error", error: result.message };
}

// ── Remove role from user (DELETE /api/v1/users/:id/roles/:role_id) ──────────

export interface RemoveUserRoleState {
  phase: "idle" | "success" | "error";
  roleId?: string;
  error?: string;
}

export async function removeUserRoleAction(
  _prev: RemoveUserRoleState,
  formData: FormData
): Promise<RemoveUserRoleState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const userId = ((formData.get("userId") as string | null) ?? "").trim();
  const roleId = ((formData.get("roleId") as string | null) ?? "").trim();
  if (!userId) return { phase: "error", roleId, error: "Missing user ID." };
  if (!roleId) return { phase: "error", error: "Missing role ID." };

  const result = await removeUserRole(userId, roleId);
  if (result.ok) {
    revalidatePath("/org-admin/users");
    revalidatePath(`/org-admin/users/${userId}`);
    return { phase: "success", roleId };
  }
  return { phase: "error", roleId, error: result.message };
}
