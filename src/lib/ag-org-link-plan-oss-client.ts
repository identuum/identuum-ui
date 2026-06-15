/**
 * ag-org-link-plan-oss-client.ts
 *
 * Server-only client for the AG OSS read-only org-link plan summary.
 * Calls AG's GET /api/v1/org-link/plan on the management surface.
 *
 * Distinct from the monolith-shape client (`ag-org-client.ts:fetchAGOrgLinkPlan`)
 * which expects component/status/created_at/import_available fields that the
 * AG OSS route deliberately does not emit. Both clients coexist during the
 * AG OSS / monolith split; this one consumes the post-AG-31 AG OSS shape.
 *
 * Security:
 *   - Server-only: client components may not import this module.
 *   - Operator session cookie is forwarded server-side as Bearer; the browser
 *     never sees it.
 *   - Internal AG backend URLs are never exposed to the response.
 *   - Raw AG error messages and unknown response fields are never forwarded.
 *
 * Scope:
 *   - Read-only. No link/unlink/import behavior — those live in
 *     `ag-org-link-write-client.ts` and are NOT extended by this slice.
 *   - Organization-only. Never reads users, admins, credentials, MFA,
 *     role bindings, or any IDP-side metadata not already on the AG row.
 */
import "server-only";

import { agRequest } from "./ag-client";
import { loadRuntimeConfig } from "./runtime-config";

/** Single AG organization entry on GET /api/v1/org-link/plan. */
export interface AGOrgLinkPlanItem {
  id: string;
  name: string;
  display_name: string;
  /** Absent when unlinked. AG OSS emits `omitempty`. */
  linked_idp_org_id?: string | null;
  link_status: "linked" | "unlinked";
}

/** AG OSS response body for GET /api/v1/org-link/plan (AG-31). */
export interface AGOrgLinkPlanOSS {
  organizations: AGOrgLinkPlanItem[];
  total: number;
  linked_count: number;
  unlinked_count: number;
}

/**
 * Classified client result. Discriminated by `status` so callers can branch
 * cleanly without re-deriving auth/availability state.
 *
 * Variants:
 *   ok                 — 2xx with valid plan body. `plan` is non-null.
 *   not_configured     — runtime config has ag.enabled=false.
 *   ag_auth_required   — no operator cookie OR AG returned 401.
 *   ag_forbidden       — AG returned 403.
 *   ag_unavailable     — network/timeout/non-2xx-non-auth failure.
 *   error              — 2xx body whose shape does not match AGOrgLinkPlanOSS.
 */
export type AGOrgLinkPlanOSSResult =
  | { status: "ok"; plan: AGOrgLinkPlanOSS }
  | { status: "not_configured" }
  | { status: "ag_auth_required" }
  | { status: "ag_forbidden" }
  | { status: "ag_unavailable" }
  | { status: "error" };

/**
 * Fetches the AG OSS org-link plan summary using the operator-cookie auth
 * path (RequireOperator on the backend). Never throws — every failure
 * mode maps to a discriminated variant of AGOrgLinkPlanOSSResult.
 */
export async function fetchAGOrgLinkPlanOSS(): Promise<AGOrgLinkPlanOSSResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return { status: "not_configured" };

  let res: Response | null;
  try {
    res = await agRequest("/api/v1/org-link/plan", { method: "GET" });
  } catch {
    return { status: "ag_unavailable" };
  }
  // agRequest returns null when ag is not enabled or no operator cookie is
  // present. We've already checked ag.enabled, so a null here is the
  // missing-session case.
  if (res === null) return { status: "ag_auth_required" };

  if (res.status === 401) return { status: "ag_auth_required" };
  if (res.status === 403) return { status: "ag_forbidden" };
  if (!res.ok) return { status: "ag_unavailable" };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { status: "error" };
  }

  const sanitized = sanitizePlan(raw);
  if (!sanitized) return { status: "error" };
  return { status: "ok", plan: sanitized };
}

/**
 * Validates and projects a raw JSON body to AGOrgLinkPlanOSS. Returns null
 * if the shape does not match. Unknown fields are dropped; sensitive-looking
 * keys (status, description, created_at, updated_at, password, secret, etc.)
 * are never read or copied through.
 */
function sanitizePlan(raw: unknown): AGOrgLinkPlanOSS | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  if (!Array.isArray(body.organizations)) return null;
  if (typeof body.total !== "number") return null;
  if (typeof body.linked_count !== "number") return null;
  if (typeof body.unlinked_count !== "number") return null;

  const orgs: AGOrgLinkPlanItem[] = [];
  for (const o of body.organizations) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const row = o as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.display_name !== "string"
    ) {
      return null;
    }
    const linkStatus = row.link_status === "linked" ? "linked" : "unlinked";
    const linkedIDPOrgID = typeof row.linked_idp_org_id === "string" ? row.linked_idp_org_id : null;
    orgs.push({
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      linked_idp_org_id: linkedIDPOrgID,
      link_status: linkStatus,
    });
  }

  return {
    organizations: orgs,
    total: body.total,
    linked_count: body.linked_count,
    unlinked_count: body.unlinked_count,
  };
}
