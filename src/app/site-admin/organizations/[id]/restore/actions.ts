"use server";

/**
 * Server action for the restore confirmation form.
 * Independently revalidates site_admin before calling the IdP.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { restoreOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
});

export interface RestoreOrgActionState {
  error?: string;
}

export async function restoreOrgAction(
  _prev: RestoreOrgActionState,
  formData: FormData
): Promise<RestoreOrgActionState> {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") {
    redirect(roleToPath(role));
  }

  const raw = { org_id: ((formData.get("org_id") as string | null) ?? "").trim() };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid organization ID." };
  }

  const result = await restoreOrganization(parsed.data.org_id);

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Organization not found. It may not be deleted or may not exist." };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not restore the organization. The backend returned an error. Try again.",
    };
  }

  // Redirect to active view so the user can confirm the org is visible again.
  redirect("/site-admin/organizations?deleted=false");
}
