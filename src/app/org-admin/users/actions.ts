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
  type BulkJobStatus,
  bulkCreateUsers,
  getBulkJobStatus,
  regenerateInvitation,
  removeUserRole,
  resetUserMFA,
  setUserActive,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { parseBulkInviteEntries } from "./bulk-invite-parser";

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

// ── Bulk invite (POST /api/v1/users/bulk) ────────────────────────────────────
//
// Delegates to parseBulkInviteEntries (in ./bulk-invite-parser) to validate
// the operator textarea before issuing the wire call. The parser lives in
// its own module because a "use server" actions file is allowed to export
// only async functions, while the parser is sync + pure for testability.
//
// On success returns a job id the operator can poll with refreshBulkJobAction.
// Activation tokens never reach this action — they come back later via the
// polled job status, where the wire helper projects them into one-time
// setup URLs.

export interface BulkInviteState {
  phase: "form" | "queued" | "error";
  entries?: number;
  jobId?: string;
  error?: string;
  fieldErrors?: Partial<Record<"entries", string>>;
}

export async function bulkInviteUsersAction(
  _prev: BulkInviteState,
  formData: FormData
): Promise<BulkInviteState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const raw = (formData.get("entries") as string | null) ?? "";
  const parsed = parseBulkInviteEntries(raw);
  if (!parsed.ok) {
    return {
      phase: "form",
      fieldErrors: { entries: parsed.reason },
    };
  }
  const result = await bulkCreateUsers(parsed.entries);
  if (result.ok) {
    revalidatePath("/org-admin/users");
    return { phase: "queued", jobId: result.jobId, entries: parsed.entries.length };
  }
  return { phase: "error", error: result.message };
}

// ── Refresh bulk job status (GET /api/v1/jobs/:id) ───────────────────────────
//
// Read-only polling action. The wire helper redacts raw activation tokens and
// projects them into server-built setup URLs; this action passes that
// already-projected job snapshot straight through.

export interface RefreshBulkJobState {
  phase: "idle" | "loaded" | "error";
  job?: BulkJobStatus;
  warning?: string | null;
  error?: string;
}

export async function refreshBulkJobAction(
  _prev: RefreshBulkJobState,
  formData: FormData
): Promise<RefreshBulkJobState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const jobId = ((formData.get("jobId") as string | null) ?? "").trim();
  if (!jobId) return { phase: "error", error: "Missing job id." };

  const result = await getBulkJobStatus(jobId);
  if (result.ok) {
    return { phase: "loaded", job: result.job, warning: result.warning };
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
