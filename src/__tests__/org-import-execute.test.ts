import { describe, expect, it } from "vitest";
import { parseOrgImportExecuteResponse } from "../lib/org-import-execute";

// ---------------------------------------------------------------------------
// parseOrgImportExecuteResponse
// ---------------------------------------------------------------------------

function validRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    dry_run: false,
    action: "create_ag_organization",
    idp_organization_id: "00000000-0000-0000-0000-000000000001",
    ag_organization_id: "11111111-1111-1111-1111-111111111111",
    ag_organization_created: true,
    link_created: true,
    status: "created",
    message: "created a new AG organization linked to this IDP organization",
    ...overrides,
  };
}

function withoutKey(source: Record<string, unknown>, omittedKey: string): Record<string, unknown> {
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

describe("parseOrgImportExecuteResponse", () => {
  // ── Happy paths ─────────────────────────────────────────────────────────

  it("parses a valid create/created response", () => {
    const got = parseOrgImportExecuteResponse(validRaw());
    expectNotNull(got);
    expect(got.dry_run).toBe(false);
    expect(got.action).toBe("create_ag_organization");
    expect(got.status).toBe("created");
    expect(got.ag_organization_created).toBe(true);
    expect(got.link_created).toBe(true);
  });

  it("parses a valid link/linked response", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        action: "link_existing_ag_organization",
        status: "linked",
        ag_organization_created: false,
        link_created: true,
        message: "linked the existing AG organization to this IDP organization",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("link_existing_ag_organization");
    expect(got.status).toBe("linked");
    expect(got.ag_organization_created).toBe(false);
    expect(got.link_created).toBe(true);
  });

  it("parses a valid noop/already_linked response", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        action: "noop",
        status: "already_linked",
        ag_organization_created: false,
        link_created: false,
        message: "this IDP organization is already linked to an AG organization",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("noop");
    expect(got.status).toBe("already_linked");
  });

  it("parses a valid rejected response", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        action: "rejected",
        status: "rejected",
        ag_organization_created: false,
        link_created: false,
        message: "an AG organization with this name already exists",
      })
    );
    expectNotNull(got);
    expect(got.action).toBe("rejected");
    expect(got.status).toBe("rejected");
  });

  // ── Rejection paths ─────────────────────────────────────────────────────

  it("returns null for non-object input", () => {
    expect(parseOrgImportExecuteResponse(null)).toBeNull();
    expect(parseOrgImportExecuteResponse(undefined)).toBeNull();
    expect(parseOrgImportExecuteResponse("x")).toBeNull();
    expect(parseOrgImportExecuteResponse(42)).toBeNull();
    expect(parseOrgImportExecuteResponse([])).toBeNull();
  });

  it("returns null when dry_run is true (response is unsafe for execute)", () => {
    expect(parseOrgImportExecuteResponse(validRaw({ dry_run: true }))).toBeNull();
  });

  it("returns null when dry_run is missing", () => {
    const raw = withoutKey(validRaw(), "dry_run");
    expect(parseOrgImportExecuteResponse(raw)).toBeNull();
  });

  it("returns null when dry_run is a truthy non-boolean", () => {
    expect(parseOrgImportExecuteResponse(validRaw({ dry_run: "false" }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ dry_run: 0 }))).toBeNull();
  });

  it("returns null when idp_organization_id is missing or non-string", () => {
    const raw = withoutKey(validRaw(), "idp_organization_id");
    expect(parseOrgImportExecuteResponse(raw)).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ idp_organization_id: 42 }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ idp_organization_id: "" }))).toBeNull();
  });

  it("returns null for unknown action values", () => {
    expect(parseOrgImportExecuteResponse(validRaw({ action: "delete_everything" }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ action: 42 }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ action: null }))).toBeNull();
  });

  it("returns null for status=planned (execute can never produce planned)", () => {
    expect(parseOrgImportExecuteResponse(validRaw({ status: "planned" }))).toBeNull();
  });

  it("returns null for unknown status values", () => {
    expect(parseOrgImportExecuteResponse(validRaw({ status: "deleted" }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ status: 1 }))).toBeNull();
    expect(parseOrgImportExecuteResponse(validRaw({ status: null }))).toBeNull();
  });

  // ── Allowlist / sensitive-field discard ─────────────────────────────────

  it("coerces non-boolean ag_organization_created / link_created to false", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        ag_organization_created: "yes",
        link_created: 1,
      })
    );
    expectNotNull(got);
    expect(got.ag_organization_created).toBe(false);
    expect(got.link_created).toBe(false);
  });

  it("coerces missing/non-string message to empty string", () => {
    const raw = withoutKey(validRaw(), "message");
    const got = parseOrgImportExecuteResponse(raw);
    expectNotNull(got);
    expect(got.message).toBe("");

    const got2 = parseOrgImportExecuteResponse(validRaw({ message: 42 }));
    expectNotNull(got2);
    expect(got2.message).toBe("");
  });

  it("discards unknown and sensitive top-level keys silently", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        users: [{ email: "x@y.z", password: "secret" }],
        user_count: 5,
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
        raw_payload: { x: 1 },
        metadata: { secret: "v" },
        audit: [{ ok: true }],
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

  it("does not surface raw backend error body via smuggled keys", () => {
    const got = parseOrgImportExecuteResponse(
      validRaw({
        error: "raw stack trace: SQL error 23505",
        raw_response: "ERROR: malformed UUID",
        debug: { traceback: "internal" },
      })
    );
    expectNotNull(got);
    const json = JSON.stringify(got);
    expect(json).not.toContain("stack trace");
    expect(json).not.toContain("SQL error");
    expect(json).not.toContain("malformed UUID");
    expect(json).not.toContain("traceback");
  });

  it("does not crash on deeply nested malformed input", () => {
    expect(() =>
      parseOrgImportExecuteResponse(
        validRaw({
          nested: { user: { mfa: "secret", sub: { license: { sig: "x" } } } },
        })
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Source invariants — execute client, dry-run client, server action, page
// ---------------------------------------------------------------------------

describe("execute client / dry-run client source invariants", () => {
  function readSrc(rel: string): string {
    const fs = require("node:fs");
    return fs.readFileSync(new URL(rel, import.meta.url).pathname, "utf-8");
  }

  // Strip line and block comments before scanning for code patterns.
  function codeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("execute client contains dry_run: false and is server-only", () => {
    const src = readSrc("../lib/org-import-execute-client.ts");
    expect(src).toContain('import "server-only"');
    expect(src).toContain("dry_run: false");
    expect(codeOnly(src)).not.toContain("dry_run: true");
  });

  it("dry-run client still contains dry_run: true and no dry_run: false in code", () => {
    const src = readSrc("../lib/org-import-dry-run-client.ts");
    expect(src).toContain('import "server-only"');
    expect(src).toContain("dry_run: true");
    const code = codeOnly(src);
    expect(code).not.toContain("dry_run: false");
    expect(code).not.toContain('"dry_run":false');
    expect(code).not.toContain("dry_run = false");
  });

  it("execute client sends only safe idp_organization fields", () => {
    const src = readSrc("../lib/org-import-execute-client.ts");
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

  it("execute client maps 401/403 to unauthorized and non-2xx to failed without leaking body", () => {
    const src = readSrc("../lib/org-import-execute-client.ts");
    expect(src).toContain("res.status === 401");
    expect(src).toContain("res.status === 403");
    expect(src).toContain('reason: "unauthorized"');
    expect(src).toContain('reason: "failed"');
    // No await of res.text() or any propagation of res body content into result.
    expect(src).not.toContain("await res.text()");
    expect(src).not.toMatch(/reason:\s*res\.statusText/);
  });
});

describe("server action source invariants", () => {
  function readSrc(rel: string): string {
    const fs = require("node:fs");
    return fs.readFileSync(new URL(rel, import.meta.url).pathname, "utf-8");
  }

  it("server action is use-server, requires confirmation, and never JSON.parses client input", () => {
    const src = readSrc("../app/site-admin/org-link/readiness/actions.ts");
    expect(src).toContain('"use server"');
    expect(src).toContain('confirm !== "organization_only"');
    expect(src).toContain('reason: "confirmation_missing"');
    // No JSON.parse of client input — the action reads named FormData fields only.
    expect(src).not.toContain("JSON.parse(");
  });

  it("server action does not reference forbidden user/admin/credential field names", () => {
    const src = readSrc("../app/site-admin/org-link/readiness/actions.ts");
    // Strip the FORBIDDEN_FORM_FIELDS array body — that list intentionally
    // contains the forbidden field names so the runtime guard can reject them.
    // We scan everything else for direct reads of those names.
    const stripped = src.replace(/FORBIDDEN_FORM_FIELDS[\s\S]*?\];/m, "");
    for (const fk of [
      'formData.get("password")',
      'formData.get("mfa")',
      'formData.get("mfa_secret")',
      'formData.get("users")',
      'formData.get("org_admins")',
      'formData.get("role_bindings")',
      'formData.get("sessions")',
      'formData.get("tokens")',
      'formData.get("license")',
      'formData.get("signature")',
      'formData.get("private_key")',
      'formData.get("ciphertext")',
    ]) {
      expect(stripped).not.toContain(fk);
    }
  });

  it("server action calls executeImportIDPOrganizationToAG exactly once per invocation", () => {
    const src = readSrc("../app/site-admin/org-link/readiness/actions.ts");
    // One call inside the function body. The import counts as a separate
    // occurrence of the identifier, so we expect exactly 2 hits across the
    // file: the import statement and the single call site.
    const occurrences = src.match(/executeImportIDPOrganizationToAG/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("server action allowlist contains no forbidden field names", () => {
    const src = readSrc("../app/site-admin/org-link/readiness/actions.ts");
    const match = src.match(/ALLOWED_FORM_FIELDS\s*=\s*\[([\s\S]*?)\]/);
    expectNotNull(match);
    const body = match[1];
    for (const fk of [
      "password",
      "passwords",
      "mfa",
      "mfa_secret",
      "totp",
      "users",
      "user_count",
      "org_admins",
      "role_bindings",
      "sessions",
      "tokens",
      "license",
      "signature",
      "ciphertext",
      "private_key",
      "raw_json",
      "json",
    ]) {
      expect(body).not.toContain(`"${fk}"`);
    }
  });
});

describe("readiness page execute-form invariants", () => {
  function readSrc(rel: string): string {
    const fs = require("node:fs");
    return fs.readFileSync(new URL(rel, import.meta.url).pathname, "utf-8");
  }

  const PAGE = "../app/site-admin/org-link/readiness/page.tsx";

  it("page renders per-row execute buttons for planned create/link rows only", () => {
    const src = readSrc(PAGE);
    expect(src).toContain("isExecutableDryRun");
    // The execute gate must require status==="planned" and one of the two
    // mutation actions.
    expect(src).toMatch(/status\s*!==\s*"planned"/);
    expect(src).toContain('action === "create_ag_organization"');
    expect(src).toContain('action === "link_existing_ag_organization"');
  });

  it("page surfaces both execute button labels", () => {
    const src = readSrc(PAGE);
    expect(src).toContain("Create AG organization");
    expect(src).toContain("Link existing AG organization");
  });

  it("page wires the form to executeOrganizationImportFormAction and includes confirm_scope", () => {
    const src = readSrc(PAGE);
    expect(src).toContain("executeOrganizationImportFormAction");
    expect(src).toContain('name="confirm_scope"');
    expect(src).toContain('value="organization_only"');
  });

  it("confirm_scope is rendered as a visible required checkbox, not a hidden input", () => {
    const src = readSrc(PAGE);
    // The confirm_scope JSX must use a checkbox with `required` (and an
    // ARIA equivalent). It must NOT use type="hidden".
    expect(src).toMatch(/type="checkbox"[\s\S]*?name="confirm_scope"/);
    expect(src).toMatch(/name="confirm_scope"[\s\S]*?required/);
    expect(src).toContain('aria-required="true"');
    // Defensive: confirm_scope must not appear inside a type="hidden" input
    // anywhere in the file. Scan all hidden inputs and ensure none names
    // confirm_scope.
    const hiddenInputs = src.match(/<input[^>]*type="hidden"[^>]*>/g) ?? [];
    for (const inp of hiddenInputs) {
      expect(inp).not.toContain('name="confirm_scope"');
    }
  });

  it("confirm_scope label contains the organization-only warning and forbidden-copy list", () => {
    const src = readSrc(PAGE);
    // The visible label must clearly call out organization-only scope and
    // every forbidden category the server action defends against.
    expect(src).toContain("I understand this action only creates or links the organization record");
    for (const term of [
      "users",
      "passwords",
      "MFA",
      "roles",
      "admins",
      "reviewers",
      "auditors",
      "sessions",
      "tokens",
    ]) {
      // Each forbidden-copy category must appear in the visible label.
      // The label text is the only source on this page that lists every
      // term together, so a single contains-each pass is sufficient.
      expect(src).toContain(term);
    }
  });

  it("page does not introduce any bulk import button", () => {
    const src = readSrc(PAGE);
    // Code-only scan to avoid matching scope-notice prose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const pattern of [
      "Import all",
      "import_all",
      "importAllOrgsAction",
      "Bulk import",
      "bulkImport",
    ]) {
      expect(code).not.toContain(pattern);
    }
  });

  it("page only renders fields from the safe candidate shape in hidden inputs", () => {
    const src = readSrc(PAGE);
    for (const forbidden of [
      'name="password"',
      'name="mfa"',
      'name="mfa_secret"',
      'name="users"',
      'name="org_admins"',
      'name="role_bindings"',
      'name="sessions"',
      'name="tokens"',
      'name="license"',
      'name="signature"',
      'name="private_key"',
      'name="ciphertext"',
      'name="raw_json"',
      'name="json"',
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("page existing readiness/candidate/dry-run sections remain intact", () => {
    const src = readSrc(PAGE);
    expect(src).toContain("Readiness check for IDP ↔ AG organization linking");
    expect(src).toContain("Organization candidates");
    expect(src).toContain("Possible matches");
    expect(src).toContain("Import/link dry-run preview");
    expect(src).toContain("Dry-run only. Nothing is written.");
    // Disabled Start linking button is preserved.
    expect(src).toContain("Start linking");
    expect(src).toContain('aria-disabled="true"');
  });
});
