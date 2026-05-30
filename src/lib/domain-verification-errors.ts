/**
 * Pure classifier for the IDP's organization-domain verify error_kind.
 *
 * The IDP returns a structured `error_kind` field on every non-2xx
 * response to POST /api/v1/organizations/:id/domains/:domain_id/verify.
 * Four wire strings are stable protocol constants:
 *
 *   "verifier_unavailable" — default fail-closed verifier (no real DNS
 *                            resolver wired up). Operator action is
 *                            identical to lookup_failed.
 *   "lookup_failed"        — transient resolver / network failure.
 *   "record_not_found"     — operator must publish the TXT record.
 *   "mismatch"             — operator must re-publish the correct value.
 *
 * Anything else (missing field, non-string, unknown future kind) is
 * mapped to "generic" so the UI renders the safe-fallback operator copy
 * without forwarding any backend prose. The classifier NEVER inspects
 * the human-facing `message` field — substring matching is the
 * regression the slice-3 refactor removed.
 *
 * SECURITY:
 *   - Pure function. No I/O, no network, no logging.
 *   - Input is `unknown` so callers can safely pass `body?.error_kind`
 *     after a `JSON.parse` without first narrowing the type.
 *   - The four wire strings are duplicated as the source of truth here;
 *     the IDP-side declaration lives in error_mapper.go and is pinned
 *     by handler tests there. Treat any change to this allow-list as a
 *     coordinated cross-repo wire-shape change.
 */

/**
 * Wire-stable kinds the IDP can return on the verify path. Exported so
 * other UI code can refer to the discriminator without re-declaring the
 * literals.
 */
export type DomainVerifyErrorKind =
  | "verifier_unavailable"
  | "lookup_failed"
  | "record_not_found"
  | "mismatch";

/**
 * The classifier's output. `generic` is the safe-fallback bucket for
 * any input the classifier does not recognise — including missing
 * fields, non-string types, and future kinds the UI does not yet
 * understand.
 *
 * Note: `verifier_unavailable` is intentionally collapsed onto
 * `lookup_failed` because the operator action is identical for both;
 * see [[project_verify_error_helper]] for the rationale.
 */
export type DomainVerifyFailureClassification =
  | { kind: "lookup_failed" }
  | { kind: "record_not_found" }
  | { kind: "mismatch" }
  | { kind: "generic" };

/** Internal: the wire allow-list. */
const KNOWN_KINDS: ReadonlyArray<DomainVerifyErrorKind> = [
  "verifier_unavailable",
  "lookup_failed",
  "record_not_found",
  "mismatch",
];

function isKnownKind(v: unknown): v is DomainVerifyErrorKind {
  return typeof v === "string" && (KNOWN_KINDS as ReadonlyArray<string>).includes(v);
}

/**
 * Maps the IDP's `error_kind` field onto the UI's discriminated
 * failure classification. See module doc for the mapping table.
 */
export function classifyDomainVerifyErrorKind(
  errorKind: unknown
): DomainVerifyFailureClassification {
  if (!isKnownKind(errorKind)) {
    return { kind: "generic" };
  }
  switch (errorKind) {
    case "verifier_unavailable":
    case "lookup_failed":
      return { kind: "lookup_failed" };
    case "record_not_found":
      return { kind: "record_not_found" };
    case "mismatch":
      return { kind: "mismatch" };
  }
}
