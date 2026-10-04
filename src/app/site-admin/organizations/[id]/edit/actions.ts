"use server";

/**
 * Server action for the edit-organization form.
 *
 * Independently revalidates site_admin session (layout guard is not enough
 * because server actions can be invoked outside the normal render path).
 * Validates form data, calls updateOrganization() server-side via the IdP
 * proxy using internal_base_url. Never exposes internal URLs, cookies, or
 * tokens to browser-side code.
 *
 * A site administrator changes only the lifecycle of a tenant organization —
 * its name and whether it is active (owner ruling, identuum-idp-oss v0.9.5).
 * The policy fields belong to the organization's administrator, and any that
 * reach this action are not sent.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { updateOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export interface UpdateOrgActionState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "active", string>>;
}

export async function updateOrgAction(
  _prev: UpdateOrgActionState,
  formData: FormData
): Promise<UpdateOrgActionState> {
  // Belt-and-suspenders: revalidate session independently of the layout guard.
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
    name: ((formData.get("name") as string | null) ?? "").trim(),
    active: formData.get("active") as string,
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        name: flat.name?.[0],
        active: flat.active?.[0],
      },
    };
  }

  const result = await updateOrganization(parsed.data.org_id, {
    name: parsed.data.name,
    active: parsed.data.active,
  });

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Organization not found. It may have been deleted." };
    }
    if (result.conflict) {
      // The route's 409: the organization is activated by its
      // administrator's activation link, so turning it on here is refused.
      return {
        error:
          "This organization is activated by its administrator's activation link. Re-issue the activation link from the organization's page.",
      };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not update the organization. The backend returned an error. Try again.",
    };
  }

  // Success: redirect to the updated organization's detail page.
  redirect(`/site-admin/organizations/${parsed.data.org_id}`);
}
