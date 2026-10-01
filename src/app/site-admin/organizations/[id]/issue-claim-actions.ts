"use server";

/**
 * OSS-CLAIM-UI (D-022): "Issue claim link" on an active organization with no
 * administrator. Calls POST /api/v1/organizations/:id/claim, which retires
 * every earlier link of the organization, and returns the new one once, in
 * this action's state only. Independently revalidates site_admin.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { type IssuedClaim, issueOrganizationClaim } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  email: z.union([
    z.literal(""),
    z.string().email("Enter a valid email address, or leave it empty"),
  ]),
});

export type IssueClaimState =
  | { phase: "idle"; error?: string }
  | { phase: "issued"; claim: IssuedClaim };

export async function issueClaimAction(
  _prev: IssueClaimState,
  formData: FormData
): Promise<IssueClaimState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") redirect(roleToPath(role));

  const parsed = schema.safeParse({
    org_id: ((formData.get("org_id") as string | null) ?? "").trim(),
    email: ((formData.get("email") as string | null) ?? "").trim(),
  });
  if (!parsed.success) {
    return { phase: "idle", error: parsed.error.issues[0]?.message ?? "Check the email address." };
  }
  const result = await issueOrganizationClaim({
    orgId: parsed.data.org_id,
    email: parsed.data.email,
  });
  if (!result.ok) {
    if (result.status === 403) redirect("/login?reason=unauthorized");
    return { phase: "idle", error: result.message };
  }
  return { phase: "issued", claim: result.claim };
}
