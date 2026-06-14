/**
 * Behavioral tests for classifyDomainVerifyErrorKind.
 *
 * The helper is pure and side-effect-free, so these tests EXECUTE the
 * function with a representative input matrix instead of asserting
 * source-text invariants. Source-text pins still exist in
 * org-admin-settings-domains.test.ts for the integration between the
 * helper and verifyOrganizationDomain — this file owns the helper's
 * own behaviour.
 *
 * The wire-stable kinds the helper recognises are duplicated in
 * idp-admin-client.ts via the helper import; the IDP-side allow-list
 * lives in identuum-idp/internal/handlers/error_mapper.go and is
 * pinned by handler tests there. A divergence between the two sides
 * would surface as a "generic" mapping here, which is the safe
 * fallback.
 */

import { describe, expect, it } from "vitest";
import {
  type DomainVerifyFailureClassification,
  classifyDomainVerifyErrorKind,
} from "../lib/domain-verification-errors";

// ── Happy-path mapping ──────────────────────────────────────────────────────

describe("classifyDomainVerifyErrorKind — known wire kinds", () => {
  it("maps verifier_unavailable to lookup_failed (operator action is identical)", () => {
    // Pinning the slice-3 collapse: the operator copy for "your DNS
    // resolver is not wired up" is the same as "the DNS lookup
    // failed transiently". Both surface as the lookup_failed banner.
    expect(
      classifyDomainVerifyErrorKind("verifier_unavailable")
    ).toEqual<DomainVerifyFailureClassification>({
      kind: "lookup_failed",
    });
  });

  it("maps lookup_failed to lookup_failed", () => {
    expect(
      classifyDomainVerifyErrorKind("lookup_failed")
    ).toEqual<DomainVerifyFailureClassification>({
      kind: "lookup_failed",
    });
  });

  it("maps record_not_found to record_not_found", () => {
    expect(
      classifyDomainVerifyErrorKind("record_not_found")
    ).toEqual<DomainVerifyFailureClassification>({
      kind: "record_not_found",
    });
  });

  it("maps mismatch to mismatch", () => {
    expect(classifyDomainVerifyErrorKind("mismatch")).toEqual<DomainVerifyFailureClassification>({
      kind: "mismatch",
    });
  });
});

// ── Unknown / missing / wrong-type input ───────────────────────────────────

describe("classifyDomainVerifyErrorKind — generic fallback", () => {
  it("treats an empty string as generic", () => {
    expect(classifyDomainVerifyErrorKind("")).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
  });

  it("treats an unknown future kind as generic (forward-compatible)", () => {
    // A future IDP version that introduces e.g. "rate_limited" must
    // not crash the UI. The safe-fallback behaviour is to render the
    // generic copy until the UI is updated.
    expect(
      classifyDomainVerifyErrorKind("rate_limited")
    ).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number 0", 0],
    ["number 1", 1],
    ["boolean true", true],
    ["boolean false", false],
    ["array", []],
    ["object", {}],
    ["nested object with matching value", { error_kind: "mismatch" }],
  ])("treats %s as generic (non-string input)", (_label, value) => {
    expect(classifyDomainVerifyErrorKind(value)).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
  });
});

// ── Negative-substring invariant ────────────────────────────────────────────

describe("classifyDomainVerifyErrorKind — substring parsing is gone", () => {
  it("does NOT classify human-facing message phrases as a known kind", () => {
    // These two phrases were the substring matches the slice-2
    // gap-report flagged. A regression that re-introduced substring
    // matching against the message text would classify these as the
    // matching kind — the helper must not.
    expect(
      classifyDomainVerifyErrorKind("DNS TXT record was not found")
    ).toEqual<DomainVerifyFailureClassification>({ kind: "generic" });
    expect(
      classifyDomainVerifyErrorKind(
        "Domain verification TXT record does not match the expected value"
      )
    ).toEqual<DomainVerifyFailureClassification>({ kind: "generic" });
    expect(
      classifyDomainVerifyErrorKind("Could not look up the domain verification record")
    ).toEqual<DomainVerifyFailureClassification>({ kind: "generic" });
  });

  it("does not partially match (e.g. 'lookup_failed_v2' is NOT lookup_failed)", () => {
    // The allow-list uses exact-string match. A protocol revision
    // that ships a versioned suffix must coordinate the UI update;
    // the safe behaviour until then is generic copy.
    expect(
      classifyDomainVerifyErrorKind("lookup_failed_v2")
    ).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
    expect(classifyDomainVerifyErrorKind("v2_mismatch")).toEqual<DomainVerifyFailureClassification>(
      {
        kind: "generic",
      }
    );
  });

  it("is case-sensitive: 'Mismatch' is not 'mismatch'", () => {
    // Wire constants are lowercase by IDP convention. Defensive: a
    // case-insensitive helper would silently mask a regression that
    // started uppercasing on the backend.
    expect(classifyDomainVerifyErrorKind("Mismatch")).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
    expect(classifyDomainVerifyErrorKind("MISMATCH")).toEqual<DomainVerifyFailureClassification>({
      kind: "generic",
    });
  });
});

// ── Purity / determinism ───────────────────────────────────────────────────

describe("classifyDomainVerifyErrorKind — purity", () => {
  it("returns a fresh object on each call (no shared state)", () => {
    const a = classifyDomainVerifyErrorKind("mismatch");
    const b = classifyDomainVerifyErrorKind("mismatch");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const input = { error_kind: "mismatch" };
    const snapshot = JSON.stringify(input);
    classifyDomainVerifyErrorKind(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
