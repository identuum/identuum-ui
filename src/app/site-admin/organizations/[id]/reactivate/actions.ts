"use server";

/**
 * Server action for the reactivate confirmation form.
 * Independently revalidates site_admin before calling the IdP.
 * Uses PUT /api/v1/organizations/:id with { active: true }.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { updateOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
});

export interface ReactivateOrgActionState {
  error?: string;
}

export async function reactivateOrgAction(
  _prev: ReactivateOrgActionState,
  formData: FormData
): Promise<ReactivateOrgActionState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") redirect(roleToPath(role));

  const raw = { org_id: ((formData.get("org_id") as string | null) ?? "").trim() };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: "Invalid organization ID." };

  const result = await updateOrganization(parsed.data.org_id, { active: true });

  if (!result.ok) {
    if (result.notFound) return { error: "Organization not found." };
    if (result.status === 403) redirect("/login?reason=unauthorized");
    return { error: "Could not reactivate the organization. Try again." };
  }

  redirect("/site-admin/organizations");
}
