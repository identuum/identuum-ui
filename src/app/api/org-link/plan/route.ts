/**
 * GET /api/org-link/plan
 *
 * UI-owned org-link planning endpoint. Fetches safe organization metadata
 * from IDP and AG, returning a combined planning state for the UI.
 *
 * Scope: organizations only. Never returns users, org_admins, passwords,
 * MFA state, role bindings, reviewers, auditors, or credential data.
 *
 * Security:
 *   - Internal backend URLs are never included in the response.
 *   - IDP session cookie is forwarded server-side; the browser never
 *     receives auth headers or tokens.
 *   - AG discovery is unauthenticated (the AG org-link plan endpoint
 *     is public and returns only non-sensitive org metadata).
 *   - Raw backend errors are never forwarded; safe error codes only.
 */

import { NextResponse } from "next/server";
import { fetchAGOrgLinkPlan } from "@/lib/ag-org-client";
import { listOrganizations } from "@/lib/idp-admin-client";
import type { IDPOrgSummaryForLink, OrgLinkPlanState } from "@/lib/org-link-types";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cfg = loadRuntimeConfig();

  const idpEnabled = Boolean(cfg?.idp.enabled);
  const agEnabled = Boolean(cfg?.ag.enabled);

  // Fetch IDP organizations if IDP is configured.
  // listOrganizations() uses the authenticated IDP session cookie (HttpOnly,
  // forwarded server-side) — the session is never exposed to the browser.
  let idpOrgs: IDPOrgSummaryForLink[] = [];
  let idpAvailable = false;
  if (idpEnabled) {
    try {
      const result = await listOrganizations({ limit: 100 });
      if (result) {
        idpAvailable = true;
        idpOrgs = result.organizations.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          domain: o.domain,
          active: o.active,
          deleted: o.deleted,
          has_admin: o.has_admin,
        }));
      }
    } catch {
      // IDP unreachable — idpAvailable stays false
    }
  }

  // Fetch AG org-link plan if AG is configured.
  // This is an unauthenticated call to the AG management surface.
  const agUrl = agEnabled && cfg ? agBaseUrl(cfg) : null;
  const agPlan = await fetchAGOrgLinkPlan(agUrl);
  const agAvailable = agPlan !== null;

  const state: OrgLinkPlanState = {
    idp_available: idpAvailable,
    ag_available: agAvailable,
    idp_organizations: idpOrgs,
    ag_organizations: agPlan?.organizations ?? [],
    import_available: agPlan?.import_available ?? false,
    import_unavailable_reason: agPlan?.unavailable_reason ?? null,
    error_code: null,
  };

  return NextResponse.json(state, { status: 200 });
}
