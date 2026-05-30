/**
 * org-import-dry-run-client.ts
 *
 * Server-only client for the AG POST /api/v1/organizations/import-from-idp
 * endpoint in DRY-RUN MODE ONLY.
 *
 * Hard contract: every request this module sends has dry_run=true. There is
 * no path through this module that can call the AG backend with dry_run=false.
 * The request body builder ignores any "dry_run" field on the input shape and
 * always overrides it to true. Callers cannot disable the dry-run guard.
 *
 * Security:
 *   - server-only: client components may not import this module
 *   - AG bearer token and internal_base_url never reach the browser
 *   - raw backend error bodies are never surfaced; callers receive a safe
 *     opaque reason string
 *   - organization-only: only the safe OrganizationExportCandidate subset
 *     (id, name, slug, status, created_at, updated_at, source_component) is
 *     ever sent; user, admin, MFA, role, session, token, license, signature,
 *     ciphertext, audit, and metadata fields are never read or sent
 */
import "server-only";

import { agRequest, getAgOperatorToken } from "./ag-client";
import { parseOrgImportDryRunResponse } from "./org-import-dry-run";
import { loadRuntimeConfig } from "./runtime-config";
import { getServerRuntimeState } from "./server-runtime-state";
import type {
  OrganizationExportCandidate,
  OrgImportDryRunResult,
} from "./types";

const AG_TIMEOUT_MS = 5000;

/** Input to the dry-run client. dry_run is always forced to true downstream. */
export interface OrgImportDryRunInput {
  /** Safe IDP organization export candidate. Must have source_component="identuum-idp". */
  idpOrganization: OrganizationExportCandidate;
  /** Optional existing AG organization UUID for link-existing preview. */
  agOrganizationId?: string;
}

/**
 * dryRunImportIDPOrganizationToAG sends a dry-run preview request to the AG
 * import-from-idp endpoint and returns a safe projected result.
 *
 * Always sends dry_run=true. Never sends dry_run=false. The request body
 * only contains the safe OrganizationExportCandidate subset; even if the
 * input candidate carries extra fields, only id/name/slug/status/created_at/
 * updated_at/source_component are serialized into the wire payload.
 *
 * Returns a safe discriminated result:
 *   - { ok: true, response: ... }                 — parsed safe response
 *   - { ok: false, reason: "not_configured" }     — AG disabled in runtime config
 *   - { ok: false, reason: "not_ready" }          — AG discovery not usable
 *   - { ok: false, reason: "unauthorized" }       — no operator session, 401, 403
 *   - { ok: false, reason: "unsafe_response" }    — 2xx but body did not parse to dry_run=true
 *   - { ok: false, reason: "failed" }             — non-2xx, network, timeout, parse error
 *
 * The raw backend body is never included in the result.
 */
export async function dryRunImportIDPOrganizationToAG(
  input: OrgImportDryRunInput
): Promise<OrgImportDryRunResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return { ok: false, reason: "not_configured" };

  const state = await getServerRuntimeState();
  if (!state?.components.ag.usable) {
    return { ok: false, reason: "not_ready" };
  }

  const token = await getAgOperatorToken();
  if (!token) {
    return { ok: false, reason: "unauthorized" };
  }

  // Build the request body from the explicit allowlist. dry_run is ALWAYS true.
  // The candidate's source_component is preserved verbatim — the backend
  // requires "identuum-idp" and will reject anything else with 400.
  const candidate = input.idpOrganization;
  const idpOrgPayload: Record<string, string> = {
    id: typeof candidate.id === "string" ? candidate.id : "",
    name: typeof candidate.name === "string" ? candidate.name : "",
    slug: typeof candidate.slug === "string" ? candidate.slug : "",
    status: typeof candidate.status === "string" ? candidate.status : "",
    source_component:
      typeof candidate.source_component === "string" ? candidate.source_component : "",
  };
  if (typeof candidate.created_at === "string") {
    idpOrgPayload.created_at = candidate.created_at;
  }
  if (typeof candidate.updated_at === "string") {
    idpOrgPayload.updated_at = candidate.updated_at;
  }

  const body: Record<string, unknown> = {
    idp_organization: idpOrgPayload,
    // Hard-coded true. Not derived from the input. Not overridable by callers.
    dry_run: true,
  };
  if (typeof input.agOrganizationId === "string" && input.agOrganizationId.trim() !== "") {
    body.ag_organization_id = input.agOrganizationId.trim();
  }

  let res: Response | null;
  try {
    res = await agRequest("/api/v1/organizations/import-from-idp", {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AG_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (!res) {
    // agRequest returns null when AG is not configured or no token. Both
    // already covered above; treat as not_configured defensively.
    return { ok: false, reason: "not_configured" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok) {
    // Non-2xx including 400, 404, 409, 500, 503. We do not propagate the
    // body — the response could contain a backend-side error message we
    // never want surfaced. The status alone is enough to mark the row failed.
    return { ok: false, reason: "failed" };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const parsed = parseOrgImportDryRunResponse(raw);
  if (!parsed) {
    // Safety guard: any 2xx that did not parse to a dry_run=true safe shape
    // is treated as unsafe. Possible causes: backend regression, proxy
    // returning an unrelated 200, or the backend incorrectly setting
    // dry_run=false despite our request.
    return { ok: false, reason: "unsafe_response" };
  }

  return { ok: true, response: parsed };
}
