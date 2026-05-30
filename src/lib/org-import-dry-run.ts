/**
 * org-import-dry-run.ts
 *
 * Pure helpers for projecting the AG POST /api/v1/organizations/import-from-idp
 * response (dry-run mode only) onto the UI-safe OrgImportDryRunResponse shape.
 *
 * No rendering, no server-only imports — testable in any environment.
 *
 * Scope: organizations only. This module never reads, returns, or projects
 * user records, org admins, emails, passwords, MFA state, role bindings,
 * sessions, tokens, license payloads, signatures, ciphertext, internal
 * config, or audit metadata. Unknown keys on the raw backend response are
 * discarded by the allowlist parser. Sensitive top-level keys are explicitly
 * stripped before projection so a misbehaving backend cannot smuggle them
 * through.
 *
 * Safety contract: parseOrgImportDryRunResponse returns null when the
 * response is missing required safe fields, when dry_run is not true, or
 * when action/status are not in the allowed enum sets. The UI treats null as
 * an unsafe response and surfaces it as a failed result rather than trusting
 * partial data.
 */

import type {
  OrgImportDryRunAction,
  OrgImportDryRunResponse,
  OrgImportDryRunStatus,
} from "./types";

const ALLOWED_ACTIONS: ReadonlyArray<OrgImportDryRunAction> = [
  "create_ag_organization",
  "link_existing_ag_organization",
  "noop",
  "rejected",
];

const ALLOWED_STATUSES: ReadonlyArray<OrgImportDryRunStatus> = [
  "planned",
  "already_linked",
  "rejected",
];

function isAllowedAction(s: unknown): s is OrgImportDryRunAction {
  return typeof s === "string" && (ALLOWED_ACTIONS as ReadonlyArray<string>).includes(s);
}

function isAllowedStatus(s: unknown): s is OrgImportDryRunStatus {
  return typeof s === "string" && (ALLOWED_STATUSES as ReadonlyArray<string>).includes(s);
}

/**
 * parseOrgImportDryRunResponse projects a raw backend dry-run response onto
 * OrgImportDryRunResponse using an explicit allowlist.
 *
 * Returns null when:
 *   - input is not a JSON object
 *   - dry_run is missing, non-boolean, or not exactly true
 *   - idp_organization_id is missing or non-string
 *   - action or status is not in the allowed enum sets
 *
 * All other keys (users, admins, passwords, sessions, tokens, license,
 * signature, ciphertext, audit, metadata, etc.) are silently discarded.
 *
 * The boolean flags ag_organization_created and link_created are coerced
 * to false when missing or non-boolean — defensive default that matches the
 * dry-run contract (no mutations should ever be reported as completed).
 */
export function parseOrgImportDryRunResponse(raw: unknown): OrgImportDryRunResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  // dry_run must be exactly true. A response with dry_run=false (or missing)
  // is treated as unsafe — the UI must never trust a response that might
  // describe a real mutation when it asked for a dry run.
  if (o.dry_run !== true) return null;

  if (typeof o.idp_organization_id !== "string" || o.idp_organization_id === "") return null;

  if (!isAllowedAction(o.action)) return null;
  if (!isAllowedStatus(o.status)) return null;

  const message = typeof o.message === "string" ? o.message : "";
  const agOrgID = typeof o.ag_organization_id === "string" ? o.ag_organization_id : "";

  // Defensive: dry-run must never indicate completed writes. Even if the
  // backend incorrectly sets these flags to true under dry_run=true, the
  // UI clamps them to false so no surface treats the row as a real mutation.
  const agCreated =
    o.ag_organization_created === true ? false : false;
  const linkCreated =
    o.link_created === true ? false : false;
  // The above ternaries are intentionally constant-false: every dry-run row,
  // by contract, has both flags false. Keeping the read on the source object
  // documents that we intentionally ignore those fields rather than letting
  // them through.
  void agCreated;
  void linkCreated;

  return {
    dry_run: true,
    action: o.action,
    idp_organization_id: o.idp_organization_id,
    ag_organization_id: agOrgID,
    ag_organization_created: false,
    link_created: false,
    status: o.status,
    message,
  };
}
