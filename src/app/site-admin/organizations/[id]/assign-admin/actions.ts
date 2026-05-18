"use server";

import { assignOrgAdmin } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  recipient_email: z
    .string()
    .max(255, "Email must be 255 characters or fewer")
    .transform((e) => e.toLowerCase().trim())
    .refine((e) => e === "" || z.string().email().safeParse(e).success, {
      message: "Enter a valid email address",
    }),
});

export interface AssignAdminSuccess {
  orgId: string;
  recipientEmail: string;
  /**
   * One-time claim URL for the prospective org_admin.
   * Kept in server-action state only — not placed in URL, localStorage, or sessionStorage.
   * Do NOT log this value.
   */
  claimUrl: string;
  expiresAt: string;
  emailSent: boolean;
}

export interface AssignAdminActionState {
  error?: string;
  fieldErrors?: Partial<Record<"recipient_email", string>>;
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
    recipient_email: ((formData.get("recipient_email") as string | null) ?? "").trim(),
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        recipient_email: flat.recipient_email?.[0],
      },
    };
  }

  const result = await assignOrgAdmin({
    orgId: parsed.data.org_id,
    recipientEmail: parsed.data.recipient_email, // may be empty string (no-email mode)
  });

  if (!result.ok) {
    if (result.notFound) {
      return { error: "Organization not found. It may have been deleted." };
    }
    if (result.alreadyHasAdmin) {
      return {
        error:
          "This organization already has at least one active administrator. Claim links can only be issued to organizations with no active admin.",
      };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not generate the admin setup link. The backend returned an error. Try again.",
    };
  }

  // Do NOT redirect — the claim URL is one-time state that must be shown immediately.
  return {
    success: {
      orgId: parsed.data.org_id,
      recipientEmail: parsed.data.recipient_email, // may be "" for no-email mode
      claimUrl: result.claimUrl,
      expiresAt: result.expiresAt,
      emailSent: result.emailSent,
    },
  };
}
