import { describe, expect, it } from "vitest";
import {
  deriveOrganizationCandidateMatches,
  parseOrganizationExportCandidate,
  parseOrganizationExportCandidatesResponse,
} from "../lib/org-export-candidates";
import type { OrganizationExportCandidate } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<OrganizationExportCandidate> = {}
): OrganizationExportCandidate {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Acme Corp",
    slug: "acme",
    status: "active",
    created_at: "2026-05-20T12:00:00Z",
    updated_at: "2026-05-22T12:00:00Z",
    source_component: "identuum-idp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseOrganizationExportCandidate
// ---------------------------------------------------------------------------

describe("parseOrganizationExportCandidate", () => {
  it("returns null for non-object input", () => {
    expect(parseOrganizationExportCandidate(null, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate(undefined, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate("string", "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate(42, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate([], "identuum-idp")).toBeNull();
  });

  it("returns null when id is missing or non-string", () => {
    expect(parseOrganizationExportCandidate({ name: "x" }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: 42, name: "x" }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: "", name: "x" }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: "  ", name: "x" }, "identuum-idp")).toBeNull();
  });

  it("returns null when name is missing or non-string", () => {
    expect(parseOrganizationExportCandidate({ id: "a" }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: "a", name: 42 }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: "a", name: "" }, "identuum-idp")).toBeNull();
    expect(parseOrganizationExportCandidate({ id: "a", name: "   " }, "identuum-idp")).toBeNull();
  });

  it("projects minimal valid object onto safe shape with defaults", () => {
    const got = parseOrganizationExportCandidate(
      { id: "abc", name: "Acme" },
      "identuum-idp"
    );
    expect(got).toEqual({
      id: "abc",
      name: "Acme",
      slug: "",
      status: "",
      created_at: null,
      updated_at: null,
      source_component: "identuum-idp",
      linked_idp_organization_id: "",
      link_status: "",
    });
  });

  it("preserves all known safe fields when present", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "uuid",
        name: "Acme",
        slug: "acme",
        status: "active",
        created_at: "2026-05-20T12:00:00Z",
        updated_at: "2026-05-22T12:00:00Z",
        source_component: "identuum-ag",
      },
      "identuum-idp"
    );
    expect(got).toEqual({
      id: "uuid",
      name: "Acme",
      slug: "acme",
      status: "active",
      created_at: "2026-05-20T12:00:00Z",
      updated_at: "2026-05-22T12:00:00Z",
      source_component: "identuum-ag",
      linked_idp_organization_id: "",
      link_status: "",
    });
  });

  it("stamps fallback source when source_component is missing or non-string", () => {
    expect(
      parseOrganizationExportCandidate({ id: "a", name: "x" }, "identuum-ag")?.source_component
    ).toBe("identuum-ag");
    expect(
      parseOrganizationExportCandidate(
        { id: "a", name: "x", source_component: 42 },
        "identuum-ag"
      )?.source_component
    ).toBe("identuum-ag");
    expect(
      parseOrganizationExportCandidate(
        { id: "a", name: "x", source_component: "" },
        "identuum-ag"
      )?.source_component
    ).toBe("identuum-ag");
  });

  it("discards unknown and sensitive keys silently", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "a",
        name: "x",
        password: "p4ssw0rd",
        mfa_secret: "secret",
        emails: ["x@y.z"],
        users: [{ id: "u1" }],
        org_admins: ["admin@y.z"],
        role_bindings: [{}],
        sessions: [{}],
        tokens: [{}],
        license_id: "L-1",
        signature: "deadbeef",
        ciphertext: "abc",
        private_key: "-----BEGIN",
        entitlements: [{}],
        customer_id: "cust",
        audit: { logged: true },
      },
      "identuum-idp"
    );
    const json = JSON.stringify(got);
    for (const forbidden of [
      "password",
      "mfa_secret",
      "emails",
      "users",
      "org_admins",
      "role_bindings",
      "sessions",
      "tokens",
      "license_id",
      "signature",
      "ciphertext",
      "private_key",
      "entitlements",
      "customer_id",
      "audit",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect(got).toEqual({
      id: "a",
      name: "x",
      slug: "",
      status: "",
      created_at: null,
      updated_at: null,
      source_component: "identuum-idp",
      linked_idp_organization_id: "",
      link_status: "",
    });
  });

  it("coerces non-string optional fields to safe defaults", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "a",
        name: "x",
        slug: 42,
        status: { bad: true },
        created_at: 1234567890,
        updated_at: null,
      },
      "identuum-idp"
    );
    expect(got?.slug).toBe("");
    expect(got?.status).toBe("");
    expect(got?.created_at).toBeNull();
    expect(got?.updated_at).toBeNull();
  });

  // ── Link-status fields ────────────────────────────────────────────────

  it("preserves linked_idp_organization_id and link_status from backend", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        source_component: "identuum-ag",
        linked_idp_organization_id: "11111111-1111-1111-1111-111111111111",
        link_status: "linked",
      },
      "identuum-ag"
    );
    expect(got?.linked_idp_organization_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(got?.link_status).toBe("linked");
  });

  it("preserves link_status='unlinked' even when linked_idp_organization_id is absent", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        source_component: "identuum-ag",
        link_status: "unlinked",
      },
      "identuum-ag"
    );
    expect(got?.link_status).toBe("unlinked");
    expect(got?.linked_idp_organization_id).toBe("");
  });

  it("discards non-string linked_idp_organization_id", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        linked_idp_organization_id: 42,
        link_status: "linked",
      },
      "identuum-ag"
    );
    expect(got?.linked_idp_organization_id).toBe("");
    expect(got?.link_status).toBe("linked");
  });

  it("discards non-string link_status", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        link_status: { enabled: true },
        linked_idp_organization_id: "11111111-1111-1111-1111-111111111111",
      },
      "identuum-ag"
    );
    expect(got?.link_status).toBe("");
    expect(got?.linked_idp_organization_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("treats empty-string linked_idp_organization_id as unlinked", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        linked_idp_organization_id: "",
        link_status: "unlinked",
      },
      "identuum-ag"
    );
    expect(got?.linked_idp_organization_id).toBe("");
    expect(got?.link_status).toBe("unlinked");
  });

  it("does not preserve other unknown link-shaped keys", () => {
    const got = parseOrganizationExportCandidate(
      {
        id: "abc",
        name: "Acme",
        linked_idp_organization_id: "11111111-1111-1111-1111-111111111111",
        link_status: "linked",
        // Unknown variants must NOT be projected.
        idp_org_id: "22222222-2222-2222-2222-222222222222",
        linked_idp_id: "33333333-3333-3333-3333-333333333333",
        ag_link_status: "linked-elsewhere",
        link_metadata: { sig: "x" },
      },
      "identuum-ag"
    );
    const json = JSON.stringify(got);
    expect(json).not.toContain("idp_org_id");
    expect(json).not.toContain("linked_idp_id");
    expect(json).not.toContain("ag_link_status");
    expect(json).not.toContain("link_metadata");
    expect(got?.linked_idp_organization_id).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("link fields default to empty string when missing", () => {
    const got = parseOrganizationExportCandidate(
      { id: "abc", name: "Acme" },
      "identuum-idp"
    );
    expect(got?.linked_idp_organization_id).toBe("");
    expect(got?.link_status).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseOrganizationExportCandidatesResponse
// ---------------------------------------------------------------------------

describe("parseOrganizationExportCandidatesResponse", () => {
  it("returns empty list for non-object input", () => {
    expect(parseOrganizationExportCandidatesResponse(null, "identuum-idp")).toEqual({
      organizations: [],
    });
    expect(parseOrganizationExportCandidatesResponse("x", "identuum-idp")).toEqual({
      organizations: [],
    });
    expect(parseOrganizationExportCandidatesResponse([], "identuum-idp")).toEqual({
      organizations: [],
    });
  });

  it("returns empty list when organizations field is absent or not an array", () => {
    expect(parseOrganizationExportCandidatesResponse({}, "identuum-idp")).toEqual({
      organizations: [],
    });
    expect(
      parseOrganizationExportCandidatesResponse({ organizations: null }, "identuum-idp")
    ).toEqual({ organizations: [] });
    expect(
      parseOrganizationExportCandidatesResponse({ organizations: "x" }, "identuum-idp")
    ).toEqual({ organizations: [] });
  });

  it("returns empty list when response has empty organizations array", () => {
    expect(
      parseOrganizationExportCandidatesResponse({ organizations: [] }, "identuum-idp")
    ).toEqual({ organizations: [] });
  });

  it("skips malformed rows but keeps valid ones", () => {
    const got = parseOrganizationExportCandidatesResponse(
      {
        organizations: [
          null,
          { not_an_org: true },
          { id: "good1", name: "Good 1" },
          "garbage",
          { id: "good2", name: "Good 2", slug: "good2" },
          [],
          { id: 42, name: "BadId" },
          { id: "missing_name" },
        ],
      },
      "identuum-idp"
    );
    expect(got.organizations).toHaveLength(2);
    expect(got.organizations[0].id).toBe("good1");
    expect(got.organizations[1].id).toBe("good2");
  });

  it("stamps fallback source on every row", () => {
    const got = parseOrganizationExportCandidatesResponse(
      {
        organizations: [
          { id: "a", name: "x" },
          { id: "b", name: "y", source_component: "" },
          { id: "c", name: "z", source_component: "identuum-ag" },
        ],
      },
      "identuum-idp"
    );
    expect(got.organizations[0].source_component).toBe("identuum-idp");
    expect(got.organizations[1].source_component).toBe("identuum-idp");
    expect(got.organizations[2].source_component).toBe("identuum-ag");
  });

  it("does not crash on deeply nested malformed input", () => {
    const got = parseOrganizationExportCandidatesResponse(
      {
        organizations: [
          {
            id: "a",
            name: "x",
            nested: { user: { mfa: "secret" } },
            arr: [{ password: "p" }],
          },
        ],
      },
      "identuum-idp"
    );
    expect(got.organizations).toHaveLength(1);
    expect(JSON.stringify(got.organizations[0])).not.toContain("password");
    expect(JSON.stringify(got.organizations[0])).not.toContain("mfa");
    expect(JSON.stringify(got.organizations[0])).not.toContain("user");
  });

  it("does not preserve sensitive top-level keys from response", () => {
    const got = parseOrganizationExportCandidatesResponse(
      {
        organizations: [{ id: "a", name: "x" }],
        users: [{ email: "x@y.z", password: "p" }],
        license: { signature: "deadbeef" },
        tokens: [{ jwt: "abc" }],
      },
      "identuum-idp"
    );
    const json = JSON.stringify(got);
    for (const forbidden of [
      "users",
      "license",
      "tokens",
      "password",
      "email",
      "jwt",
      "signature",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveOrganizationCandidateMatches
// ---------------------------------------------------------------------------

describe("deriveOrganizationCandidateMatches", () => {
  it("returns empty list when either side is empty", () => {
    expect(deriveOrganizationCandidateMatches([], [])).toEqual([]);
    expect(
      deriveOrganizationCandidateMatches([makeCandidate()], [])
    ).toEqual([]);
    expect(
      deriveOrganizationCandidateMatches([], [makeCandidate({ source_component: "identuum-ag" })])
    ).toEqual([]);
  });

  it("matches by exact slug", () => {
    const idp = makeCandidate({ id: "idp1", name: "IDP Acme", slug: "acme" });
    const ag = makeCandidate({
      id: "ag1",
      name: "AG Acme Inc",
      slug: "acme",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].idp.id).toBe("idp1");
    expect(matches[0].ag.id).toBe("ag1");
    expect(matches[0].reason).toBe("exact_slug");
  });

  it("matches by exact name when slugs differ", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme Corp", slug: "" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Acme Corp",
      slug: "",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("exact_name");
  });

  it("prefers exact_slug over exact_name when both match", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme", slug: "acme" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Acme",
      slug: "acme",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("exact_slug");
  });

  it("normalizes case and trims whitespace when matching", () => {
    const idp = makeCandidate({ id: "idp1", name: "  Acme Corp  ", slug: "ACME" });
    const ag = makeCandidate({
      id: "ag1",
      name: "acme corp",
      slug: "acme",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("exact_slug");
  });

  it("normalizes case when matching by name only", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme Corp", slug: "" });
    const ag = makeCandidate({
      id: "ag1",
      name: "acme corp",
      slug: "",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("exact_name");
  });

  it("does not match unrelated organizations", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme", slug: "acme" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Beta",
      slug: "beta",
      source_component: "identuum-ag",
    });
    expect(deriveOrganizationCandidateMatches([idp], [ag])).toEqual([]);
  });

  it("does not slug-match when slug is empty on either side", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme A", slug: "" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Acme B",
      slug: "",
      source_component: "identuum-ag",
    });
    expect(deriveOrganizationCandidateMatches([idp], [ag])).toEqual([]);
  });

  it("each AG candidate contributes at most one match", () => {
    const idp1 = makeCandidate({ id: "idp1", name: "Acme", slug: "acme" });
    const idp2 = makeCandidate({ id: "idp2", name: "Acme", slug: "acme-2" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Acme",
      slug: "acme",
      source_component: "identuum-ag",
    });
    const matches = deriveOrganizationCandidateMatches([idp1, idp2], [ag]);
    expect(matches).toHaveLength(1);
    expect(matches[0].idp.id).toBe("idp1");
  });

  it("does not mutate inputs", () => {
    const idp = makeCandidate({ id: "idp1", name: "Acme", slug: "acme" });
    const ag = makeCandidate({
      id: "ag1",
      name: "Acme",
      slug: "acme",
      source_component: "identuum-ag",
    });
    const idpFrozen = Object.freeze({ ...idp });
    const agFrozen = Object.freeze({ ...ag });
    const idpInputs = Object.freeze([idpFrozen]);
    const agInputs = Object.freeze([agFrozen]);

    expect(() => {
      deriveOrganizationCandidateMatches(idpInputs, agInputs);
    }).not.toThrow();

    expect(idpFrozen).toEqual(idp);
    expect(agFrozen).toEqual(ag);
  });

  it("produces multiple matches across multiple AG candidates", () => {
    const idpList = [
      makeCandidate({ id: "idp1", name: "Acme", slug: "acme" }),
      makeCandidate({ id: "idp2", name: "Beta", slug: "beta" }),
      makeCandidate({ id: "idp3", name: "Gamma", slug: "" }),
    ];
    const agList = [
      makeCandidate({ id: "ag1", name: "Acme", slug: "acme", source_component: "identuum-ag" }),
      makeCandidate({ id: "ag2", name: "Beta Inc", slug: "beta", source_component: "identuum-ag" }),
      makeCandidate({ id: "ag3", name: "Gamma", slug: "", source_component: "identuum-ag" }),
      makeCandidate({ id: "ag4", name: "Delta", slug: "delta", source_component: "identuum-ag" }),
    ];
    const matches = deriveOrganizationCandidateMatches(idpList, agList);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.ag.id).sort()).toEqual(["ag1", "ag2", "ag3"]);
    expect(matches.find((m) => m.ag.id === "ag1")?.reason).toBe("exact_slug");
    expect(matches.find((m) => m.ag.id === "ag2")?.reason).toBe("exact_slug");
    expect(matches.find((m) => m.ag.id === "ag3")?.reason).toBe("exact_name");
  });
});

// ---------------------------------------------------------------------------
// Source-level page invariants
// ---------------------------------------------------------------------------

describe("readiness page — candidate section invariants", () => {
  it("page source renders IDP and AG candidate cards", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("Identity Provider organizations");
    expect(src).toContain("Agent Governance organizations");
    expect(src).toContain("Organization candidates");
    expect(src).toContain("Possible matches");
    // Start linking remains disabled
    expect(src).toContain("Start linking");
    expect(src).toContain('aria-disabled="true"');
    expect(src).toContain("Wizard implementation is pending");
  });

  it("page source does not include sensitive field reads from candidate rows", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    // The page renders only name, slug, status, source_component, and a
    // timestamp helper. It must not reference any of these sensitive field
    // names on candidate rows.
    for (const forbidden of [
      "org.email",
      "org.password",
      "org.mfa",
      "org.users",
      "org.org_admins",
      "org.role_bindings",
      "org.sessions",
      "org.tokens",
      "org.license",
      "org.signature",
      "org.private_key",
      "org.ciphertext",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("page source renders 'Linked to IDP' / 'Unlinked' badges and shortens IDP UUID", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("Linked to IDP");
    expect(src).toContain("Unlinked");
    expect(src).toContain("shortenIDPUUID");
    // The redaction helper takes a UUID and trims to 8 + ellipsis.
    expect(src).toMatch(/slice\(0,\s*8\)/);
    // CandidateRow reads only the safe link fields.
    expect(src).toContain("org.link_status");
    expect(src).toContain("org.linked_idp_organization_id");
  });

  it("page source surfaces 'AG linked' badge and 'AG already linked' state", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("AG linked");
    expect(src).toContain("AG already linked");
    // Suppression gate on link-existing execute form for already-linked AG.
    expect(src).toContain("shouldSuppressExecuteForAlreadyLinkedAG");
    expect(src).toContain("isAGCandidateLinked");
  });

  it("page existing readiness/candidate/dry-run/execute sections remain intact", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    // Readiness/scope sections preserved.
    expect(src).toContain("Readiness check for IDP ↔ AG organization linking");
    expect(src).toContain("Organization candidates");
    expect(src).toContain("Possible matches");
    expect(src).toContain("Import/link dry-run preview");
    expect(src).toContain("Dry-run only. Nothing is written.");
    // Per-row execute form labels preserved.
    expect(src).toContain("Create AG organization");
    expect(src).toContain("Link existing AG organization");
    // Visible confirmation checkbox label asserts organization-only scope
    // (see src/__tests__/org-import-execute.test.ts for the full label +
    // checkbox-shape invariants). The substring below is a stable anchor
    // for "the safety statement is present on the page".
    expect(src).toContain(
      "I understand this action only creates or links the organization record"
    );
    // Disabled global Start linking preserved.
    expect(src).toContain("Start linking");
    expect(src).toContain('aria-disabled="true"');
  });
});

// ---------------------------------------------------------------------------
// Link-status field allowlist invariants on the parser source
// ---------------------------------------------------------------------------

describe("parser source — link field allowlist", () => {
  it("parser source reads only the two allowlisted link fields", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      new URL("../lib/org-export-candidates.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("linked_idp_organization_id");
    expect(src).toContain("link_status");
    // Unknown link-shaped keys must NOT be referenced.
    expect(src).not.toContain("idp_org_id");
    expect(src).not.toContain("linked_idp_id");
    expect(src).not.toContain("ag_link_status");
    expect(src).not.toContain("link_metadata");
  });
});
