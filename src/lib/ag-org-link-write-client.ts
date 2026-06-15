/**
 * ag-org-link-write-client.ts
 *
 * Server-only client for AG org-link write operations.
 * Calls AG's authenticated management surface endpoints for linking and unlinking.
 *
 * Security:
 *   - Server-only: never exposes internal AG backend URLs, bearer tokens, or raw
 *     AG errors to browser-side code.
 *   - Organization-only: never writes users, admins, credentials, MFA, or roles.
 *   - Sanitizes AG responses before returning; strips any unexpected fields.
 *
 * Auth semantics:
 *   - Missing AG session cookie before a write → ag_auth_required.
 *   - AG returns 401 (expired/invalid token) → ag_auth_required.
 *   - AG returns 403 system_org_not_allowed → system_org_not_allowed.
 *   - AG returns 403 other reason → ag_forbidden.
 *   - Network failure reaching AG → ag_unavailable.
 *   - AG not configured in runtime config → not_configured.
 */
import "server-only";

import { agRequest, getAgOperatorToken } from "./ag-client";
import type {
  AGOrgSummaryWithLink,
  OrgLinkWriteErrorCode,
  OrgLinkWriteResult,
} from "./org-link-types";
import { isValidUUID } from "./org-link-utils";
import { loadRuntimeConfig } from "./runtime-config";

export { isValidUUID } from "./org-link-utils";

/**
 * Pre-flight check: verify AG is configured and an operator session exists before
 * making any write request. Returns an error code if the request should not proceed,
 * or null if the request can go ahead.
 *
 * This separates "AG not configured" from "no session" so callers receive the
 * correct error code without ambiguity.
 */
async function writePreflightCheck(): Promise<OrgLinkWriteErrorCode | null> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return "not_configured";
  const token = await getAgOperatorToken();
  if (!token) return "ag_auth_required";
  return null;
}

/**
 * Maps an AG HTTP status + error code to a safe UI-side error code.
 * Never leaks raw AG error messages, SQL detail, or stack traces.
 */
function mapAGErrorCode(status: number, agCode: string | null): OrgLinkWriteErrorCode {
  if (status === 401) return "ag_auth_required";
  if (status === 400) return "invalid_request";
  if (status === 403) {
    return agCode === "system_org_not_allowed" ? "system_org_not_allowed" : "ag_forbidden";
  }
  if (status === 404) return "org_not_found";
  if (status === 409) {
    if (agCode === "org_name_already_exists") return "org_name_already_exists";
    return "idp_org_already_linked";
  }
  if (status === 503) return "not_configured";
  return "write_failed";
}

/**
 * Sanitizes an AG OrgLinkWriteResponse organization field into a safe
 * AGOrgSummaryWithLink. Returns null if the shape is unexpected.
 */
function sanitizeWriteOrg(raw: unknown): AGOrgSummaryWithLink | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const linkedIDPOrgID = typeof o.linked_idp_org_id === "string" ? o.linked_idp_org_id : null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : "",
    display_name: typeof o.display_name === "string" ? o.display_name : "",
    status: typeof o.status === "string" ? o.status : "",
    created_at: typeof o.created_at === "string" ? o.created_at : "",
    linked_idp_org_id: linkedIDPOrgID,
    link_status: (linkedIDPOrgID ? "linked" : "unlinked") as "linked" | "unlinked",
  };
}

/**
 * Links an AG organization to an IDP organization ID.
 * Organization-only: no users, admins, credentials, or roles are written.
 */
export async function linkAGOrganizationToIDPOrg(
  agOrgId: string,
  idpOrgId: string
): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(agOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid AG org ID format." };
  }
  if (!isValidUUID(idpOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid IDP org ID format." };
  }

  const preflightError = await writePreflightCheck();
  if (preflightError) {
    return { ok: false, error_code: preflightError, message: safeMessageForCode(preflightError) };
  }

  let res: Response | null;
  try {
    res = await agRequest(`/api/v1/org-link/organizations/${encodeURIComponent(agOrgId)}/link`, {
      method: "PUT",
      body: JSON.stringify({ idp_org_id: idpOrgId }),
    });
  } catch {
    return {
      ok: false,
      error_code: "ag_unavailable",
      message: safeMessageForCode("ag_unavailable"),
    };
  }

  // agRequest returns null only when AG is not configured or no token, but preflight
  // already covered those cases. Treat null here as not_configured defensively.
  if (!res) {
    return {
      ok: false,
      error_code: "not_configured",
      message: safeMessageForCode("not_configured"),
    };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const org = sanitizeWriteOrg(body.organization);
      return { ok: true, ...(org ? { organization: org } : {}) };
    } catch {
      return { ok: true };
    }
  }

  let agCode: string | null = null;
  try {
    const errBody = (await res.json()) as Record<string, unknown>;
    if (typeof errBody.code === "string") agCode = errBody.code;
  } catch {
    // ignore parse error on error body
  }

  const errorCode = mapAGErrorCode(res.status, agCode);
  return { ok: false, error_code: errorCode, message: safeMessageForCode(errorCode) };
}

/**
 * Unlinks an AG organization from its current IDP organization link.
 * Sets idp_org_id = NULL on the AG organizations table.
 * No user/admin/role data is written.
 */
export async function unlinkAGOrganizationFromIDPOrg(agOrgId: string): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(agOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid AG org ID format." };
  }

  const preflightError = await writePreflightCheck();
  if (preflightError) {
    return { ok: false, error_code: preflightError, message: safeMessageForCode(preflightError) };
  }

  let res: Response | null;
  try {
    res = await agRequest(`/api/v1/org-link/organizations/${encodeURIComponent(agOrgId)}/link`, {
      method: "DELETE",
    });
  } catch {
    return {
      ok: false,
      error_code: "ag_unavailable",
      message: safeMessageForCode("ag_unavailable"),
    };
  }

  if (!res) {
    return {
      ok: false,
      error_code: "not_configured",
      message: safeMessageForCode("not_configured"),
    };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const org = sanitizeWriteOrg(body.organization);
      return { ok: true, ...(org ? { organization: org } : {}) };
    } catch {
      return { ok: true };
    }
  }

  let agCode: string | null = null;
  try {
    const errBody = (await res.json()) as Record<string, unknown>;
    if (typeof errBody.code === "string") agCode = errBody.code;
  } catch {
    // ignore
  }

  const errorCode = mapAGErrorCode(res.status, agCode);
  return { ok: false, error_code: errorCode, message: safeMessageForCode(errorCode) };
}

/**
 * Imports (creates + links) a new AG organization from IDP org metadata.
 * Calls POST /api/v1/org-link/import on the AG management surface.
 * Organization-only: no users, admins, credentials, roles, or MFA are written.
 */
export async function importAGOrganization(
  idpOrgId: string,
  name: string,
  displayName?: string
): Promise<OrgLinkWriteResult> {
  if (!isValidUUID(idpOrgId)) {
    return { ok: false, error_code: "invalid_request", message: "Invalid IDP org ID format." };
  }
  if (!name.trim()) {
    return {
      ok: false,
      error_code: "invalid_request",
      message: "Organization name must not be empty.",
    };
  }

  const preflightError = await writePreflightCheck();
  if (preflightError) {
    return { ok: false, error_code: preflightError, message: safeMessageForCode(preflightError) };
  }

  let res: Response | null;
  try {
    const body: Record<string, string> = { idp_org_id: idpOrgId, name: name.trim() };
    if (displayName?.trim()) body.display_name = displayName.trim();
    res = await agRequest("/api/v1/org-link/import", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error_code: "ag_unavailable",
      message: safeMessageForCode("ag_unavailable"),
    };
  }

  if (!res) {
    return {
      ok: false,
      error_code: "not_configured",
      message: safeMessageForCode("not_configured"),
    };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const org = sanitizeWriteOrg(body.organization);
      return { ok: true, ...(org ? { organization: org } : {}) };
    } catch {
      return { ok: true };
    }
  }

  let agCode: string | null = null;
  try {
    const errBody = (await res.json()) as Record<string, unknown>;
    if (typeof errBody.code === "string") agCode = errBody.code;
  } catch {
    // ignore
  }

  const errorCode = mapAGErrorCode(res.status, agCode);
  return { ok: false, error_code: errorCode, message: safeMessageForCode(errorCode) };
}

function safeMessageForCode(code: OrgLinkWriteErrorCode): string {
  switch (code) {
    case "invalid_request":
      return "The request was invalid. Check the organization IDs.";
    case "ag_auth_required":
      return "AG operator login is required. Please sign in to AG.";
    case "ag_forbidden":
      return "AG access denied. Check your AG operator permissions.";
    case "system_org_not_allowed":
      return "The system organization cannot be linked or unlinked.";
    case "org_not_found":
      return "Organization not found.";
    case "idp_org_already_linked":
      return "This IDP organization is already linked to another AG organization.";
    case "org_name_already_exists":
      return "An AG organization with this name already exists. Choose a different name.";
    case "not_configured":
      return "AG org-link write path is not configured.";
    case "ag_unavailable":
      return "AG backend is unavailable. Try again later.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
}
