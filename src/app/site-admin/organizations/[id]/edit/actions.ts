"use server";

/**
 * Server action for the edit-organization form.
 *
 * Independently revalidates site_admin session (layout guard is not enough
 * because server actions can be invoked outside the normal render path).
 * Validates form data, calls updateOrganization() server-side via the IdP
 * proxy using internal_base_url. Never exposes internal URLs, cookies, or
 * tokens to browser-side code.
 */

import { updateOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { z } from "zod";

const AUTH_POLICIES = ["local_only", "idp_only", "mixed"] as const;
const MFA_POLICIES = ["optional", "required"] as const;

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
  auth_policy: z.enum(AUTH_POLICIES).optional().or(z.literal("")),
  mfa_policy: z.enum(MFA_POLICIES).optional().or(z.literal("")),
});

export interface UpdateOrgActionState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "active" | "auth_policy" | "mfa_policy", string>>;
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
    auth_policy: ((formData.get("auth_policy") as string | null) ?? "").trim(),
    mfa_policy: ((formData.get("mfa_policy") as string | null) ?? "").trim(),
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        name: flat.name?.[0],
        active: flat.active?.[0],
        auth_policy: flat.auth_policy?.[0],
        mfa_policy: flat.mfa_policy?.[0],
      },
    };
  }

  const result = await updateOrganization(parsed.data.org_id, {
    name: parsed.data.name,
    active: parsed.data.active,
    auth_policy: parsed.data.auth_policy || undefined,
    mfa_policy: parsed.data.mfa_policy || undefined,
  });

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Organization not found. It may have been deleted." };
    }
    if (result.conflict) {
      return { error: "Another organization already uses that domain or slug." };
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
