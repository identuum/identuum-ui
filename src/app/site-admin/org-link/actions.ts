"use server";

/**
 * Server actions for organization-only AG↔IDP link/unlink operations.
 *
 * SCOPE: organizations only. Never copies users, org_admins, passwords,
 * MFA state, role bindings, reviewers, auditors, or identity data.
 *
 * Security:
 *   - Server-only; never exposed to browser JavaScript.
 *   - Internal AG backend URLs are never returned to the browser.
 *   - Raw AG errors and stack traces are discarded; only safe codes are returned.
 *   - Session validation is handled by ag-client.ts (ag_access_token cookie).
 */

import { revalidatePath } from "next/cache";
import {
  linkAGOrganizationToIDPOrg,
  unlinkAGOrganizationFromIDPOrg,
  isValidUUID,
} from "@/lib/ag-org-link-write-client";
import type { OrgLinkWriteResult } from "@/lib/org-link-types";

export async function linkOrgAction(
  agOrgId: string,
  idpOrgId: string
): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(agOrgId) || !isValidUUID(idpOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid organization ID." };
  }

  const result = await linkAGOrganizationToIDPOrg(agOrgId, idpOrgId);

  if (result.ok) {
    revalidatePath("/site-admin/org-link");
  }

  return result;
}

export async function unlinkOrgAction(agOrgId: string): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(agOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid organization ID." };
  }

  const result = await unlinkAGOrganizationFromIDPOrg(agOrgId);

  if (result.ok) {
    revalidatePath("/site-admin/org-link");
  }

  return result;
}
