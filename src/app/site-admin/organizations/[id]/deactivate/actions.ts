"use server";

/**
 * Server action for the deactivate confirmation form.
 * Independently revalidates site_admin before calling the IdP.
 * Uses PUT /api/v1/organizations/:id with { active: false }.
 */

import { updateOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  confirmed: z.literal("yes", { message: "Confirmation is required" }),
});

export interface DeactivateOrgActionState {
  error?: string;
  fieldErrors?: Partial<Record<"confirmed", string>>;
}

export async function deactivateOrgAction(
  _prev: DeactivateOrgActionState,
  formData: FormData
): Promise<DeactivateOrgActionState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") redirect(roleToPath(role));

  const raw = {
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
    confirmed: formData.get("confirmed") as string,
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return { fieldErrors: { confirmed: flat.confirmed?.[0] } };
  }

  const result = await updateOrganization(parsed.data.org_id, { active: false });

  if (!result.ok) {
    if (result.notFound) return { error: "Organization not found." };
    if (result.status === 403) redirect("/login?reason=unauthorized");
    return { error: "Could not deactivate the organization. Try again." };
  }

  redirect("/site-admin/organizations");
}
