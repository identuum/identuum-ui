/**
 * ag-org-client.ts
 *
 * Server-side client for AG org-link plan discovery.
 * Calls AG's GET /api/v1/org-link/plan on the management surface.
 *
 * No server-only restriction: module uses only fetch so it can be unit-tested
 * directly with mocked fetch.
 *
 * Security: never exposes internal AG backend URLs, raw AG errors, tokens,
 * or secrets in the returned value.
 *
 * Org scope only: this module never fetches users, admins, credentials,
 * MFA state, role bindings, or permissions.
 */

import type { AGOrgLinkPlanResponse, AGOrgSummaryWithLink } from "./org-link-types";

const TIMEOUT_MS = 5000;
const EXPECTED_COMPONENT = "identuum-ag";

/**
 * Fetches the AG org-link planning state from the AG management surface.
 * Returns null when AG is not configured or not reachable.
 * Returns a safe sanitized response — no internal URLs or raw errors.
 * Organizations include linked_idp_org_id and link_status from AG migration 0028.
 */
export async function fetchAGOrgLinkPlan(
  agManagementBaseUrl: string | null
): Promise<{
  organizations: AGOrgSummaryWithLink[];
  import_available: boolean;
  unavailable_reason: string | null;
} | null> {
  if (!agManagementBaseUrl) return null;

  const url = `${agManagementBaseUrl.replace(/\/$/, "")}/api/v1/org-link/plan`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const body = raw as Partial<AGOrgLinkPlanResponse>;
  if (body.component !== EXPECTED_COMPONENT) return null;

  const rawOrgs = Array.isArray(body.organizations) ? body.organizations : [];
  const organizations: AGOrgSummaryWithLink[] = rawOrgs
    .filter((o): o is AGOrgSummaryWithLink => {
      if (!o || typeof o !== "object" || Array.isArray(o)) return false;
      const org = o as unknown as Record<string, unknown>;
      return (
        typeof org.id === "string" &&
        typeof org.name === "string" &&
        typeof org.display_name === "string" &&
        typeof org.status === "string"
      );
    })
    .map((o) => {
      const org = o as unknown as Record<string, unknown>;
      const linkedIDPOrgID =
        typeof org.linked_idp_org_id === "string" ? org.linked_idp_org_id : null;
      return {
        id: org.id as string,
        name: org.name as string,
        display_name: org.display_name as string,
        status: org.status as string,
        created_at: typeof org.created_at === "string" ? (org.created_at as string) : "",
        linked_idp_org_id: linkedIDPOrgID,
        link_status: (linkedIDPOrgID ? "linked" : "unlinked") as "linked" | "unlinked",
      };
    });

  return {
    organizations,
    import_available: Boolean(body.import_available),
    unavailable_reason:
      typeof body.import_unavailable_reason === "string" ? body.import_unavailable_reason : null,
  };
}
