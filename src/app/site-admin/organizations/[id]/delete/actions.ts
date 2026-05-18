"use server";

/**
 * Server action for the soft-delete confirmation form.
 * Independently revalidates site_admin before calling the IdP.
 * Backend soft-delete is idempotent: already-deleted orgs return ok:true.
 */

import { deleteOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  confirmed: z.literal("yes", { message: "Confirmation is required" }),
});

export interface DeleteOrgActionState {
  error?: string;
  fieldErrors?: Partial<Record<"confirmed", string>>;
}

export async function deleteOrgAction(
  _prev: DeleteOrgActionState,
  formData: FormData
): Promise<DeleteOrgActionState> {
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
    confirmed: formData.get("confirmed") as string,
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return { fieldErrors: { confirmed: flat.confirmed?.[0] } };
  }

  const result = await deleteOrganization(parsed.data.org_id);

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Organization not found. It may have already been deleted." };
    }
    if (result.hasSiteAdmins) {
      return {
        error:
          "Cannot delete this organization. It may have site administrators that must be removed first, or you do not have permission.",
      };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not delete the organization. The backend returned an error. Try again.",
    };
  }

  // Redirect to deleted view so the user can confirm the org is no longer active.
  redirect("/site-admin/organizations?deleted=true");
}
