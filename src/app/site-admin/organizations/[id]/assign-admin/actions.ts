"use server";

import { assignOrgAdmin } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
});

export interface AssignAdminSuccess {
  orgId: string;
  /** The pending org_admin the token re-activates (backend-resolved). */
  adminEmail: string;
  /**
   * One-time activation token for the pending org_admin.
   * Kept in server-action state only — not placed in URL, localStorage, or sessionStorage.
   * Do NOT log this value.
   */
  activationToken: string;
  expiresAt: string;
}

export interface AssignAdminActionState {
  error?: string;
  success?: AssignAdminSuccess;
}

export async function assignAdminAction(
  _prev: AssignAdminActionState,
  formData: FormData
): Promise<AssignAdminActionState> {
  // Belt-and-suspenders: revalidate session independently of layout guard.
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") {
    redirect(roleToPath(role));
  }

  const raw = {
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid organization ID." };
  }

  const result = await assignOrgAdmin({ orgId: parsed.data.org_id });

  if (!result.ok) {
    if (result.notFound) {
      return {
        error:
          "No pending administrator to activate. The organization may have been deleted, or it was created without an admin email — recreate it with one, or it has no activation to re-issue.",
      };
    }
    if (result.alreadyHasAdmin) {
      return {
        error:
          "This organization is already active — its administrator has completed activation. Nothing to re-issue.",
      };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not re-issue the activation token. The backend returned an error. Try again.",
    };
  }

  // Do NOT redirect — the activation token is one-time state that must be shown immediately.
  return {
    success: {
      orgId: parsed.data.org_id,
      adminEmail: result.adminEmail,
      activationToken: result.activationToken,
      expiresAt: result.expiresAt,
    },
  };
}
