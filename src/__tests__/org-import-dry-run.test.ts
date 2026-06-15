import { describe, expect, it } from "vitest";
import { parseOrgImportDryRunResponse } from "../lib/org-import-dry-run";

// ---------------------------------------------------------------------------
// parseOrgImportDryRunResponse
// ---------------------------------------------------------------------------

describe("parseOrgImportDryRunResponse", () => {
  function validRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      dry_run: true,
      action: "create_ag_organization",
      idp_organization_id: "00000000-0000-0000-0000-000000000001",
      ag_organization_id: "",
      ag_organization_created: false,
      link_created: false,
      status: "planned",
      message: "would create a new AG organization linked to this IDP organization",
      ...overrides,
    };
  }

  function withoutKey(
    source: Record<string, unknown>,
    omittedKey: string
  ): Record<string, unknown> {
    return Object.fromEntries(Object.entries(source).filter(([key]) => key !== omittedKey));
  }

  function expectNotNull<T>(
    value: T | null,
    message = "expected non-null value"
  ): asserts value is T {
    expect(value, message).not.toBeNull();
    if (value === null) {
      throw new Error(message);
    }
  }

  // ── Happy paths ─────────────────────────────────────────────────────────

  it("parses a valid create_ag_organization planned response", () => {
    const got = parseOrgImportDryRunResponse(validRaw());
    expectNotNull(got);
    expect(got.dry_run).toBe(true);
    expect(got.action).toBe("create_ag_organization");
    expect(got.status).toBe("planned");
    expect(got.idp_organization_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(got.ag_organization_id).toBe("");
    expect(got.ag_organization_created).toBe(false);
    expect(got.link_created).toBe(false);
  });

  it("parses a valid link_existing_ag_organization planned response", () => {
    const got = parseOrgImportDryRunResponse(
      validRaw({
        action: "link_existing_ag_organization",
        ag_organization_id: "11111111-1111-1111-1111-111111111111",
        message: "would link the existing AG organization to this IDP organization",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("link_existing_ag_organization");
    expect(got.ag_organization_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("parses a valid noop already_linked response", () => {
    const got = parseOrgImportDryRunResponse(
      validRaw({
        action: "noop",
        status: "already_linked",
        ag_organization_id: "11111111-1111-1111-1111-111111111111",
        message: "this IDP organization is already linked to an AG organization",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("noop");
    expect(got.status).toBe("already_linked");
  });

  it("parses a valid rejected response", () => {
    const got = parseOrgImportDryRunResponse(
      validRaw({
        action: "rejected",
        status: "rejected",
        message: "an AG organization with this name already exists",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("rejected");
    expect(got.status).toBe("rejected");
  });

  // ── Rejection paths ─────────────────────────────────────────────────────

  it("returns null for non-object input", () => {
    expect(parseOrgImportDryRunResponse(null)).toBeNull();
    expect(parseOrgImportDryRunResponse(undefined)).toBeNull();
    expect(parseOrgImportDryRunResponse("string")).toBeNull();
    expect(parseOrgImportDryRunResponse(42)).toBeNull();
    expect(parseOrgImportDryRunResponse([])).toBeNull();
  });

  it("returns null when dry_run is missing", () => {
    const raw = withoutKey(validRaw(), "dry_run");
    expect(parseOrgImportDryRunResponse(raw)).toBeNull();
  });

  it("returns null when dry_run is false (response is unsafe)", () => {
    expect(parseOrgImportDryRunResponse(validRaw({ dry_run: false }))).toBeNull();
  });

  it("returns null when dry_run is a truthy non-boolean", () => {
    expect(parseOrgImportDryRunResponse(validRaw({ dry_run: "true" }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ dry_run: 1 }))).toBeNull();
  });

  it("returns null when idp_organization_id is missing or non-string", () => {
    const raw = withoutKey(validRaw(), "idp_organization_id");
    expect(parseOrgImportDryRunResponse(raw)).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ idp_organization_id: 42 }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ idp_organization_id: "" }))).toBeNull();
  });

  it("returns null for unknown action values", () => {
    expect(parseOrgImportDryRunResponse(validRaw({ action: "delete_everything" }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ action: 42 }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ action: null }))).toBeNull();
  });

  it("returns null for status values outside the dry-run safe set", () => {
    // "created" and "linked" are never valid for dry-run output.
    expect(parseOrgImportDryRunResponse(validRaw({ status: "created" }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ status: "linked" }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ status: "unknown" }))).toBeNull();
    expect(parseOrgImportDryRunResponse(validRaw({ status: 1 }))).toBeNull();
  });

  // ── Allowlist / sensitive-field discard ─────────────────────────────────

  it("clamps ag_organization_created and link_created to false even if backend sends true", () => {
    const got = parseOrgImportDryRunResponse(
      validRaw({
        ag_organization_created: true,
        link_created: true,
      })
    );
    expectNotNull(got);
    // Defensive clamp: dry-run must never indicate completed mutations.
    expect(got.ag_organization_created).toBe(false);
    expect(got.link_created).toBe(false);
  });

  it("coerces missing/non-string message to empty string", () => {
    const raw = withoutKey(validRaw(), "message");
    const got = parseOrgImportDryRunResponse(raw);
    expectNotNull(got);
    expect(got.message).toBe("");

    const got2 = parseOrgImportDryRunResponse(validRaw({ message: 42 }));
    expectNotNull(got2);
    expect(got2.message).toBe("");
  });

  it("coerces missing/non-string ag_organization_id to empty string", () => {
    const raw = withoutKey(validRaw(), "ag_organization_id");
    const got = parseOrgImportDryRunResponse(raw);
    expectNotNull(got);
    expect(got.ag_organization_id).toBe("");
  });

  it("discards unknown and sensitive top-level keys silently", () => {
    const got = parseOrgImportDryRunResponse(
      validRaw({
        users: [{ email: "x@y.z", password: "secret" }],
        user_count: 999,
        admins: ["a"],
        org_admins: ["b"],
        emails: ["x@y.z"],
        passwords: ["p"],
        mfa: { enabled: true },
        mfa_secret: "TOTP_SECRET",
        role_bindings: [{}],
        reviewers: ["r"],
        auditors: ["a"],
        sessions: [{}],
        tokens: ["t"],
        license: { key: "L-1" },
        license_id: "L-1",
        signature: "deadbeef",
        ciphertext: "abc",
        private_key: "-----BEGIN",
        raw_payload: { anything: 1 },
        metadata: { secret: "value" },
        audit: [{ logged: true }],
      })
    );
    expectNotNull(got);
    const json = JSON.stringify(got);
    for (const forbidden of [
      "users",
      "user_count",
      "admins",
      "org_admins",
      "emails",
      "passwords",
      "mfa",
      "mfa_secret",
      "role_bindings",
      "reviewers",
      "auditors",
      "sessions",
      "tokens",
      "license",
      "license_id",
      "signature",
      "ciphertext",
      "private_key",
      "raw_payload",
      "metadata",
      "audit",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("does not surface raw backend error body via the message field clamp", () => {
    // Defense-in-depth: the message field on a valid dry-run response is a
    // safe human-readable string set by the AG handler. The parser does not
    // length-bound it (that is a UI concern), but it also does not propagate
    // any other field that could carry an error body.
    const got = parseOrgImportDryRunResponse(
      validRaw({
        // A backend that incorrectly stuffs an error body into "error" or
        // "raw_response" should still produce a clean parsed object.
        error: "raw stack trace: org_link_set: SQL error 23505 with details",
        raw_response: "ERROR: malformed UUID",
      })
    );
    expectNotNull(got);
    const json = JSON.stringify(got);
    expect(json).not.toContain("stack trace");
    expect(json).not.toContain("SQL error");
    expect(json).not.toContain("malformed UUID");
  });

  it("does not crash on deeply nested malformed input", () => {
    expect(() =>
      parseOrgImportDryRunResponse(
        validRaw({
          nested: { user: { mfa: "secret", sub: { license: { sig: "x" } } } },
        })
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Readiness page — dry-run section invariants
// ---------------------------------------------------------------------------

describe("readiness page — dry-run section invariants", () => {
  it("page source includes the dry-run section text and never enables mutation", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );

    expect(src).toContain("Import/link dry-run preview");
    expect(src).toContain("Dry-run only. Nothing is written.");
    expect(src).toContain("This does not create organizations or links.");
    expect(src).toContain("dryRunImportIDPOrganizationToAG");

    // Start linking remains disabled
    expect(src).toContain("Start linking");
    expect(src).toContain('aria-disabled="true"');
    expect(src).toContain("Wizard implementation is pending");
  });

  it("page source never sends dry_run=false from anywhere", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).not.toContain("dry_run: false");
    expect(src).not.toContain("dryRun: false");
    expect(src).not.toContain('"dry_run":false');
    expect(src).not.toContain("dry_run = false");
  });

  it("client source never allows dry_run=false in code", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../lib/org-import-dry-run-client.ts", import.meta.url).pathname,
      "utf-8"
    );
    // The dry_run field is always set to literal true.
    expect(src).toContain("dry_run: true");
    // Strip line/block comments before scanning for code patterns that would
    // actually send dry_run=false on the wire. Documentation comments
    // mentioning "dry_run=false" as forbidden are legitimate.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("dry_run: false");
    expect(codeOnly).not.toContain('"dry_run":false');
    expect(codeOnly).not.toContain("dry_run = false");
    // Server-only boundary in place.
    expect(src).toContain('import "server-only"');
  });

  it("client source only sends safe idp_organization fields", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../lib/org-import-dry-run-client.ts", import.meta.url).pathname,
      "utf-8"
    );
    // The whitelist is the only thing assembled into the wire payload.
    // No reads of forbidden field names on the candidate object.
    for (const forbidden of [
      "candidate.password",
      "candidate.mfa",
      "candidate.users",
      "candidate.org_admins",
      "candidate.role_bindings",
      "candidate.sessions",
      "candidate.tokens",
      "candidate.license",
      "candidate.signature",
      "candidate.private_key",
      "candidate.ciphertext",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });
});
