/**
 * org-import-execute-client.ts
 *
 * Server-only client for the AG POST /api/v1/organizations/import-from-idp
 * endpoint in EXECUTE MODE (dry_run=false).
 *
 * This module is intentionally separated from org-import-dry-run-client.ts.
 * The dry-run client hard-codes dry_run=true and that contract is preserved.
 * This client hard-codes dry_run=false. The two cannot accidentally swap
 * because they live in different files with different exported function
 * names.
 *
 * Callers must come through the server action wrapper (actions.ts) so that
 * the per-row form's confirm_scope="organization_only" check runs before
 * any backend call. The client itself does not enforce the confirmation
 * field — that is the server action's responsibility.
 *
 * Security:
 *   - server-only: client components may not import this module
 *   - AG bearer token and internal_base_url never reach the browser
 *   - raw backend error bodies are never surfaced; callers receive a safe
 *     opaque reason string
 *   - organization-only: only the safe OrganizationExportCandidate subset
 *     (id, name, slug, status, created_at, updated_at, source_component)
 *     is ever sent; user, admin, MFA, role, session, token, license,
 *     signature, ciphertext, audit, and metadata fields are never read or
 *     sent
 */
import "server-only";

import { agRequest, getAgOperatorToken } from "./ag-client";
import { parseOrgImportExecuteResponse } from "./org-import-execute";
import { loadRuntimeConfig } from "./runtime-config";
import { getServerRuntimeState } from "./server-runtime-state";
import type { OrganizationExportCandidate, OrgImportExecuteResult } from "./types";

const AG_TIMEOUT_MS = 10_000;

/** Input to the execute client. dry_run is always forced to false downstream. */
export interface OrgImportExecuteInput {
  /** Safe IDP organization export candidate. Must have source_component="identuum-idp". */
  idpOrganization: OrganizationExportCandidate;
  /** Optional existing AG organization UUID for link-existing execution. */
  agOrganizationId?: string;
}

/**
 * executeImportIDPOrganizationToAG sends an EXECUTE-mode (dry_run=false)
 * request to the AG import-from-idp endpoint and returns a safe projected
 * result.
 *
 * Always sends dry_run=false. Never sends dry_run=true (that path is owned
 * by org-import-dry-run-client.ts). The request body only contains the safe
 * OrganizationExportCandidate subset; even if the input candidate carries
 * extra fields, only id/name/slug/status/created_at/updated_at/source_component
 * are serialized into the wire payload.
 *
 * Returns a safe discriminated result:
 *   - { ok: true, response: ... }                 — parsed safe execute response
 *   - { ok: false, reason: "not_configured" }     — AG disabled in runtime config
 *   - { ok: false, reason: "not_ready" }          — AG discovery not usable
 *   - { ok: false, reason: "unauthorized" }       — no operator session, 401, 403
 *   - { ok: false, reason: "unsafe_response" }    — 2xx but body did not parse to dry_run=false
 *   - { ok: false, reason: "failed" }             — non-2xx, network, timeout, parse error
 *
 * The raw backend body is never included in the result.
 */
export async function executeImportIDPOrganizationToAG(
  input: OrgImportExecuteInput
): Promise<OrgImportExecuteResult> {
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

  // Build the request body from the explicit allowlist. dry_run is ALWAYS false.
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
    // Hard-coded false. Not derived from the input. Not overridable.
    dry_run: false,
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
    // never want surfaced. The status alone marks the row failed.
    return { ok: false, reason: "failed" };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const parsed = parseOrgImportExecuteResponse(raw);
  if (!parsed) {
    // 2xx that did not parse to a dry_run=false safe shape is treated as
    // unsafe. Possible causes: a misconfigured proxy returning an unrelated
    // 200, or the backend echoing dry_run=true despite our explicit false.
    return { ok: false, reason: "unsafe_response" };
  }

  return { ok: true, response: parsed };
}
