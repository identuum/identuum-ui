/**
 * org-export-candidates.ts
 *
 * Pure helpers for parsing cross-system organization export-candidate
 * responses and deriving "possible match" pairs between IDP and AG
 * organization candidates.
 *
 * No rendering, no server-only imports — testable in any environment.
 *
 * Scope: organizations only. This module never reads, returns, or projects
 * user records, org admins, emails, passwords, MFA state, role bindings,
 * sessions, tokens, license payloads, signatures, ciphertext, internal
 * config, or audit metadata. Unknown keys on the raw backend response are
 * always discarded by the allowlist parser.
 */

import type { OrganizationExportCandidate, OrganizationExportCandidatesResponse } from "./types";

// ---------------------------------------------------------------------------
// Allowlist parser
// ---------------------------------------------------------------------------

/**
 * parseOrganizationExportCandidate projects a single raw backend organization
 * object onto OrganizationExportCandidate using an explicit allowlist.
 *
 * Required fields: id and name must both be non-empty strings. A row with
 * missing or non-string id/name is dropped (returns null) — never rendered.
 *
 * Optional safe fields: slug, status, created_at, updated_at, source_component.
 * Missing fields fall back to safe defaults: empty string for slug/status,
 * null for timestamps, fallbackSource for source_component.
 *
 * All other keys present on raw are silently ignored.
 */
export function parseOrganizationExportCandidate(
  raw: unknown,
  fallbackSource: string
): OrganizationExportCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.id !== "string" || o.id.trim() === "") return null;
  if (typeof o.name !== "string" || o.name.trim() === "") return null;

  const source =
    typeof o.source_component === "string" && o.source_component.trim() !== ""
      ? o.source_component
      : fallbackSource;

  // Link-state fields (AG-side only). Allowlist projection:
  //   - linked_idp_organization_id is preserved only when it is a non-empty
  //     string; otherwise "" (so callers don't have to coalesce undefined).
  //   - link_status is preserved only when it is a string; otherwise "".
  // Both fields are optional in the type; absent values stay absent on the
  // wire when the parser produces "" (the UI then renders them as unlinked).
  const linkedIDP =
    typeof o.linked_idp_organization_id === "string" && o.linked_idp_organization_id !== ""
      ? o.linked_idp_organization_id
      : "";
  const linkStatus = typeof o.link_status === "string" ? o.link_status : "";

  return {
    id: o.id,
    name: o.name,
    slug: typeof o.slug === "string" ? o.slug : "",
    status: typeof o.status === "string" ? o.status : "",
    created_at: typeof o.created_at === "string" ? o.created_at : null,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    source_component: source,
    linked_idp_organization_id: linkedIDP,
    link_status: linkStatus,
  };
}

/**
 * parseOrganizationExportCandidatesResponse projects a raw backend response
 * onto OrganizationExportCandidatesResponse.
 *
 * Returns an empty list when the response is not a JSON object, when the
 * organizations field is absent or not an array, or when every row fails the
 * allowlist parser. Malformed rows are dropped individually; one bad row
 * does not discard valid rows.
 *
 * fallbackSource is stamped on rows whose source_component is missing,
 * non-string, or empty — defensively guarantees the UI always knows where a
 * candidate came from even if the backend forgot to set the field.
 */
export function parseOrganizationExportCandidatesResponse(
  raw: unknown,
  fallbackSource: string
): OrganizationExportCandidatesResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { organizations: [] };
  }
  const body = raw as Record<string, unknown>;
  const arr = Array.isArray(body.organizations) ? body.organizations : [];

  const organizations: OrganizationExportCandidate[] = [];
  for (const item of arr) {
    const parsed = parseOrganizationExportCandidate(item, fallbackSource);
    if (parsed !== null) organizations.push(parsed);
  }
  return { organizations };
}

// ---------------------------------------------------------------------------
// Fetch result shape
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by the server-side fetch wrappers.
 *
 * Reasons (operator-safe, no backend error details leak):
 *   - not_configured: backend is not enabled in the UI runtime config
 *   - not_ready:      backend configured but discovery says it is not usable
 *   - unauthorized:   backend returned 401 or 403 (no session, expired session,
 *                     or insufficient role)
 *   - unreachable:    network failure, non-200, malformed body, or any other
 *                     condition where the candidate list could not be loaded
 */
export type OrgExportFetchResult =
  | { ok: true; organizations: OrganizationExportCandidate[] }
  | { ok: false; reason: "not_configured" | "not_ready" | "unauthorized" | "unreachable" };

// ---------------------------------------------------------------------------
// Match helper
// ---------------------------------------------------------------------------

/** A possible match pair between one IDP organization and one AG organization. */
export interface OrganizationCandidateMatch {
  idp: OrganizationExportCandidate;
  ag: OrganizationExportCandidate;
  /** "exact_slug" when matched on normalized slug; "exact_name" otherwise. */
  reason: "exact_slug" | "exact_name";
}

/** Normalize a string for case- and whitespace-insensitive matching. */
function normalizeMatchKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * deriveOrganizationCandidateMatches pairs IDP and AG organization candidates
 * by exact normalized slug first, then by exact normalized name.
 *
 * Rules:
 *   - Slug match: both sides have non-empty slug and they are equal after
 *     trim+lowercase. Tried first for specificity.
 *   - Name match: both sides have non-empty name and they are equal after
 *     trim+lowercase. Tried only if no slug match was produced for the AG row.
 *   - Each AG row contributes at most one match. The first match wins.
 *   - The IDP-side lookup map keeps the first occurrence per normalized key;
 *     duplicates are ignored to keep the pairing deterministic.
 *   - No mutation: inputs are read-only and never modified.
 *
 * This is a non-mutating preview. Pairs returned here are "possible matches" —
 * they are not real links and never trigger a write.
 */
export function deriveOrganizationCandidateMatches(
  idpOrgs: ReadonlyArray<OrganizationExportCandidate>,
  agOrgs: ReadonlyArray<OrganizationExportCandidate>
): OrganizationCandidateMatch[] {
  const idpBySlug = new Map<string, OrganizationExportCandidate>();
  const idpByName = new Map<string, OrganizationExportCandidate>();

  for (const idp of idpOrgs) {
    if (idp.slug.trim() !== "") {
      const key = normalizeMatchKey(idp.slug);
      if (!idpBySlug.has(key)) idpBySlug.set(key, idp);
    }
    if (idp.name.trim() !== "") {
      const key = normalizeMatchKey(idp.name);
      if (!idpByName.has(key)) idpByName.set(key, idp);
    }
  }

  const matches: OrganizationCandidateMatch[] = [];

  for (const ag of agOrgs) {
    let pairedIdp: OrganizationExportCandidate | undefined;
    let reason: "exact_slug" | "exact_name" | undefined;

    if (ag.slug.trim() !== "") {
      const slugMatch = idpBySlug.get(normalizeMatchKey(ag.slug));
      if (slugMatch) {
        pairedIdp = slugMatch;
        reason = "exact_slug";
      }
    }

    if (!pairedIdp && ag.name.trim() !== "") {
      const nameMatch = idpByName.get(normalizeMatchKey(ag.name));
      if (nameMatch) {
        pairedIdp = nameMatch;
        reason = "exact_name";
      }
    }

    if (pairedIdp && reason) {
      matches.push({ idp: pairedIdp, ag, reason });
    }
  }

  return matches;
}
