/**
 * Source-invariant pins for the 2026-06-17 Playwright regression
 * spec at e2e/upgrade-backup.spec.ts. Reads the spec source as
 * plain text and asserts:
 *
 *   - The spec never persists secrets / backup contents / filenames
 *     to localStorage, sessionStorage, or document.cookie. A
 *     Playwright spec that touched those would either be testing
 *     the wrong thing or surfacing a regression in the wizard's
 *     own no-secrets discipline.
 *   - The spec never names a direct identuum-idp URL — every IDP
 *     reference goes through the same-origin /api/idp/... proxy
 *     path. (The spec body would otherwise be coupling the
 *     wizard's network boundary to a non-canonical surface.)
 *   - The spec never injects raw backup body bytes (a `pg_dump`
 *     header line, a SQL statement, a CREATE TABLE fragment) into
 *     the mocked response. The mock surface MUST be
 *     metadata-only — the wizard is regression-pinned to NEVER
 *     render the body either way, and a mock that fed it bytes
 *     would be misleading.
 *   - The spec never leaks DB-password / DSN / upgrade-token
 *     plaintext substrings.
 *   - The spec's mocked filenames pass the client-side product
 *     pattern (so the wizard's own `isProductBackupFilename`
 *     guard does not short-circuit the destructive POST).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const specPath = join(root, "e2e/upgrade-backup.spec.ts");

function readSpec(): string {
  return readFileSync(specPath, "utf8");
}

function readSpecWithoutComments(): string {
  // Strip JSDoc / block comments AND single-line `//` comments
  // so the executable-code pins do not match comment text.
  const raw = readSpec();
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SPEC = readSpec();
const SPEC_CODE = readSpecWithoutComments();

describe("upgrade-backup playwright spec: no-secrets discipline", () => {
  for (const sink of ["localStorage", "sessionStorage", "document.cookie"]) {
    it(`spec source does not touch ${sink}`, () => {
      expect(SPEC_CODE).not.toContain(sink);
    });
  }

  it("spec does not include a raw DB password / DSN substring", () => {
    // Negative assertions (`.not.toContain("postgres://")`) legitimately
    // reference these strings; strip those lines before the leak pin so
    // we are checking for positive injection only.
    const positiveCode = SPEC.split("\n")
      .filter((line) => !line.includes(".not.toContain") && !line.includes(".not.toMatch"))
      .join("\n");
    const banned = ["identuum_idp_ce_local_default", "postgres://", "postgresql://", "PGPASSWORD"];
    for (const term of banned) {
      expect(positiveCode).not.toContain(term);
    }
  });

  it("spec does not include a raw upgrade-token plaintext literal", () => {
    // No literal that LOOKS like a real upgrade token (50+ base32
    // characters in a row).
    expect(SPEC).not.toMatch(/[A-Z0-9]{52}/);
  });
});

describe("upgrade-backup playwright spec: same-origin proxy only", () => {
  it("mock paths route through /api/idp/api/upgrade/... only", () => {
    // Every endpoint the mock matches must be a same-origin path.
    const mockPaths = [
      "/api/idp/api/upgrade/status",
      "/api/idp/api/upgrade/preflight",
      "/api/idp/api/upgrade/backup",
      "/api/idp/api/upgrade/backup/prune",
    ];
    for (const p of mockPaths) {
      expect(SPEC_CODE).toContain(p);
    }
  });

  it("spec does not reference a direct identuum-idp host", () => {
    expect(SPEC_CODE).not.toMatch(/https?:\/\/(?:identuum-idp|127\.0\.0\.1:7113|localhost:7113)/);
  });
});

describe("upgrade-backup playwright spec: metadata-only mock body", () => {
  // The mocked Create/Status responses MUST surface only safe
  // metadata. No backup-body bytes, no SQL fragments, no DB-row
  // contents. The spec body literally injects responses, so this
  // pin guarantees that even if the wizard regressed to render body
  // bytes, the spec would not validate that behavior.
  const bannedBodyFragments = [
    "PostgreSQL database dump",
    "-- pg_dump",
    "CREATE TABLE",
    "INSERT INTO",
    "COPY ",
    "pg_dump --format",
  ];
  for (const fragment of bannedBodyFragments) {
    it(`spec does not inject ${JSON.stringify(fragment)} into the mock body`, () => {
      // The HTML probe assertions at the bottom of each test
      // DELIBERATELY reference some of these strings as negative
      // assertions (`expect(html).not.toContain("PostgreSQL database dump")`).
      // We allow those by stripping `.not.toContain(...)` lines
      // before checking — the rule we want to pin is "no positive
      // mock injection of body bytes", not "no negative assertion
      // referencing body bytes".
      const positiveCode = SPEC_CODE.split("\n")
        .filter((line) => !line.includes(".not.toContain") && !line.includes(".not.toMatch"))
        .join("\n");
      expect(positiveCode).not.toContain(fragment);
    });
  }
});

describe("upgrade-backup playwright spec: filename guard alignment", () => {
  it("the pre-seeded filename literals match the product-managed pattern", () => {
    // Extract every const that names a backup filename literal.
    const literalMatches = SPEC.matchAll(
      /const\s+(PRESEEDED_\w+|NOT_FOUND_FILENAME)\s*=\s*"(identuum-idp-ce-upgrade-backup-[^"]+)"/g
    );
    let count = 0;
    for (const m of literalMatches) {
      count++;
      const filename = m[2];
      expect(filename).toMatch(/^identuum-idp-ce-upgrade-backup-\d{8}T\d{6}Z-[0-9a-f]{8}\.sql$/);
    }
    expect(count).toBeGreaterThanOrEqual(3); // PRESEEDED_NEWEST + PRESEEDED_OLDER + NOT_FOUND_FILENAME
  });
});

describe("upgrade-backup playwright spec: two-step destructive flow", () => {
  it("spec explicitly verifies the cancel branch does NOT fire a prune call", () => {
    // The cancel branch must assert `callCount.prune === 0` AFTER
    // the cancel click. Pin via text match — the assertion code
    // form is stable.
    expect(SPEC_CODE).toMatch(/expect\(pruneCalls\)\.toBe\(0\)/);
  });

  it("spec explicitly verifies exactly one prune call on the confirm branch", () => {
    expect(SPEC_CODE).toMatch(/expect\(finalState\.callCount\.prune\)\.toBe\(1\)/);
  });

  it("spec asserts the prune body never contains path separators or relative traversal", () => {
    expect(SPEC_CODE).toMatch(/pruneBodies\[0\]\)\.not\.toContain\("\/"\)/);
    expect(SPEC_CODE).toMatch(/pruneBodies\[0\]\)\.not\.toContain\("\\\\"\)/);
    expect(SPEC_CODE).toMatch(/pruneBodies\[0\]\)\.not\.toContain\("\.\."\)/);
  });
});
