"use server";

/**
 * OSS-FINAL (D-016): "Re-issue activation link" on a pending organization's
 * page. Calls POST /api/v1/organizations/:id/resend-activation (assignOrgAdmin),
 * which retires the earlier link, and returns the new one once, in memory.
 * Independently revalidates site_admin before calling the IdP.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import type { IssuedActivation } from "@/components/shared/activation-issued-panel";
import { assignOrgAdmin } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({ org_id: z.string().uuid("Invalid organization ID") });

export type ReissueActivationState =
  | { phase: "idle"; error?: string }
  | { phase: "issued"; activation: IssuedActivation };

export async function reissueActivationAction(
  _prev: ReissueActivationState,
  formData: FormData
): Promise<ReissueActivationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") redirect(roleToPath(role));

  const parsed = schema.safeParse({
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
  });
  if (!parsed.success) return { phase: "idle", error: "Invalid organization ID." };

  const result = await assignOrgAdmin({ orgId: parsed.data.org_id });
  if (!result.ok) {
    if (result.alreadyHasAdmin)
      return {
        phase: "idle",
        error:
          "This organization is already active: its administrator has activated it. There is no activation to re-issue.",
      };
    if (result.notFound)
      return {
        phase: "idle",
        error: "This organization has no pending administrator, or it no longer exists.",
      };
    if (result.status === 403) redirect("/login?reason=unauthorized");
    return { phase: "idle", error: "Could not re-issue the activation link. Try again." };
  }

  const { ok: _ok, ...activation } = result;
  return { phase: "issued", activation };
}
