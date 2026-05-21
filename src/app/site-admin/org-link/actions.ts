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
  importAGOrganization,
  isValidUUID,
} from "@/lib/ag-org-link-write-client";
import { fetchAGOrgLinkPlan } from "@/lib/ag-org-client";
import { listOrganizations } from "@/lib/idp-admin-client";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { ImportAllBatchResult, OrgLinkWriteResult } from "@/lib/org-link-types";

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

/**
 * Imports all unlinked IDP organizations into AG sequentially.
 *
 * Import candidates are derived entirely server-side by re-fetching the
 * current org-link plan. The client supplies no candidate list; any
 * client-supplied data is ignored. This prevents a tampered client
 * from importing arbitrary organizations.
 *
 * Candidate filter (server-derived):
 *   - IDP organization is active and not deleted
 *   - IDP organization is not already linked to any AG organization
 *   - IDP organization has a valid UUID id and non-empty name
 *
 * Already-linked conflicts (idp_org_already_linked) are skipped, not failed.
 * Name conflicts (org_name_already_exists) count as failed.
 * Auth/session failures abort the whole batch immediately.
 *
 * Organization-only: never writes users, org_admins, passwords, MFA,
 * role bindings, or identity data.
 */
export async function importAllOrgsAction(): Promise<ImportAllBatchResult> {
  // Re-fetch the org-link plan server-side to derive import candidates.
  // Candidate data is never taken from the client.
  const cfg = loadRuntimeConfig();

  if (!cfg?.ag.enabled) {
    return { ok: false, imported: 0, skipped: 0, failed: 0, message: "AG is not configured.", error_code: "not_configured" };
  }

  const agUrl = agBaseUrl(cfg);
  const agPlan = await fetchAGOrgLinkPlan(agUrl);
  if (!agPlan) {
    return { ok: false, imported: 0, skipped: 0, failed: 0, message: "AG is not reachable. Try again later.", error_code: "ag_unavailable" };
  }
  if (!agPlan.import_available) {
    return { ok: false, imported: 0, skipped: 0, failed: 0, message: "AG org-link import path is not available.", error_code: "not_configured" };
  }

  // Fetch IDP organizations using the server-side session cookie.
  let idpOrgs: Array<{ id: string; name: string; active: boolean; deleted: boolean }> = [];
  if (cfg.idp.enabled) {
    try {
      const result = await listOrganizations({ limit: 100 });
      if (result) {
        idpOrgs = result.organizations.map((o) => ({
          id: o.id,
          name: o.name,
          active: o.active,
          deleted: o.deleted,
        }));
      }
    } catch {
      // IDP unreachable
    }
  }

  if (idpOrgs.length === 0) {
    return { ok: true, imported: 0, skipped: 0, failed: 0, message: "No IDP organizations available to import." };
  }

  // Build the set of IDP org IDs already linked to an AG organization.
  const linkedIDPOrgIds = new Set<string>(
    agPlan.organizations
      .filter((o) => o.linked_idp_org_id)
      .map((o) => o.linked_idp_org_id as string)
  );

  // Derive candidates server-side: active, not deleted, not already linked, valid UUID.
  const candidates = idpOrgs.filter(
    (o) => o.active && !o.deleted && !linkedIDPOrgIds.has(o.id) && isValidUUID(o.id) && o.name.trim() !== ""
  );

  if (candidates.length === 0) {
    return { ok: true, imported: 0, skipped: 0, failed: 0, message: "No organizations to import." };
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of candidates) {
    const result = await importAGOrganization(org.id, org.name);

    if (result.ok) {
      imported++;
    } else if (
      result.error_code === "ag_auth_required" ||
      result.error_code === "not_configured" ||
      result.error_code === "ag_unavailable"
    ) {
      const remaining = candidates.length - imported - skipped - failed - 1;
      return {
        ok: false,
        imported,
        skipped,
        failed: failed + 1 + remaining,
        message: result.message ?? "Import stopped: AG session or connectivity issue.",
        error_code: result.error_code,
      };
    } else if (result.error_code === "idp_org_already_linked") {
      skipped++;
    } else {
      failed++;
    }
  }

  revalidatePath("/site-admin/org-link");

  const parts: string[] = [];
  if (imported > 0) parts.push(`${imported} imported`);
  if (skipped > 0) parts.push(`${skipped} already linked`);
  if (failed > 0) parts.push(`${failed} failed`);
  const message = parts.length > 0 ? parts.join(", ") + "." : "Done.";

  return { ok: failed === 0, imported, skipped, failed, message };
}

export async function importOrgAction(
  idpOrgId: string,
  name: string,
  displayName?: string
): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(idpOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid IDP organization ID." };
  }
  if (!name.trim()) {
    return { ok: false, error_code: "invalid_request", message: "Organization name must not be empty." };
  }

  const result = await importAGOrganization(idpOrgId, name, displayName);

  if (result.ok) {
    revalidatePath("/site-admin/org-link");
  }

  return result;
}
