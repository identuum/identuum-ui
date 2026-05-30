/**
 * org-import-execute.ts
 *
 * Pure helpers for projecting an AG POST /api/v1/organizations/import-from-idp
 * EXECUTE-mode (dry_run=false) response onto the UI-safe OrgImportExecuteResponse
 * shape.
 *
 * No rendering, no server-only imports — testable in any environment.
 *
 * Scope: organizations only. This module never reads, returns, or projects
 * user records, org admins, emails, passwords, MFA state, role bindings,
 * sessions, tokens, license payloads, signatures, ciphertext, internal
 * config, or audit metadata. Unknown keys on the raw backend response are
 * discarded.
 *
 * Safety contract: parseOrgImportExecuteResponse returns null when the
 * response is missing required safe fields, when dry_run is true (the
 * server may have flipped the flag on a misrouted endpoint), or when
 * action/status are not in the allowed enum sets. The server action treats
 * null as an unsafe response and surfaces it as a failed result rather
 * than trusting partial or ambiguous data.
 */

import type {
  OrgImportDryRunAction,
  OrgImportExecuteResponse,
  OrgImportExecuteStatus,
} from "./types";

const ALLOWED_ACTIONS: ReadonlyArray<OrgImportDryRunAction> = [
  "create_ag_organization",
  "link_existing_ag_organization",
  "noop",
  "rejected",
];

const ALLOWED_EXECUTE_STATUSES: ReadonlyArray<OrgImportExecuteStatus> = [
  "created",
  "linked",
  "already_linked",
  "rejected",
];

function isAllowedAction(s: unknown): s is OrgImportDryRunAction {
  return typeof s === "string" && (ALLOWED_ACTIONS as ReadonlyArray<string>).includes(s);
}

function isAllowedExecuteStatus(s: unknown): s is OrgImportExecuteStatus {
  return (
    typeof s === "string" &&
    (ALLOWED_EXECUTE_STATUSES as ReadonlyArray<string>).includes(s)
  );
}

/**
 * parseOrgImportExecuteResponse projects a raw backend execute-mode response
 * onto OrgImportExecuteResponse using an explicit allowlist.
 *
 * Returns null when:
 *   - input is not a JSON object
 *   - dry_run is missing, non-boolean, or not exactly false
 *   - idp_organization_id is missing or non-string/empty
 *   - action is not in the allowed enum set
 *   - status is not in the execute-mode allowed set (planned is rejected)
 *
 * Unknown top-level keys (users, admins, passwords, sessions, tokens, license,
 * signature, ciphertext, audit, metadata, error, raw_response, etc.) are
 * silently discarded.
 *
 * ag_organization_created and link_created are passed through as booleans
 * (with non-boolean values coerced to false). Unlike the dry-run parser
 * these flags carry meaningful information here — they indicate whether
 * the backend actually created the AG org and/or wrote the link row.
 */
export function parseOrgImportExecuteResponse(
  raw: unknown
): OrgImportExecuteResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  // dry_run must be exactly false. A response with dry_run=true (or missing,
  // or any other value) is treated as unsafe — the UI must never present a
  // "planned" preview as a confirmed mutation.
  if (o.dry_run !== false) return null;

  if (typeof o.idp_organization_id !== "string" || o.idp_organization_id === "") return null;

  if (!isAllowedAction(o.action)) return null;
  if (!isAllowedExecuteStatus(o.status)) return null;

  const message = typeof o.message === "string" ? o.message : "";
  const agOrgID = typeof o.ag_organization_id === "string" ? o.ag_organization_id : "";
  const agCreated = o.ag_organization_created === true;
  const linkCreated = o.link_created === true;

  return {
    dry_run: false,
    action: o.action,
    idp_organization_id: o.idp_organization_id,
    ag_organization_id: agOrgID,
    ag_organization_created: agCreated,
    link_created: linkCreated,
    status: o.status,
    message,
  };
}
