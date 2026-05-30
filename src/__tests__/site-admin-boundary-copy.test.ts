/**
 * Authority-boundary copy tests for the site-admin organization detail page.
 *
 * Pins the operator-facing prose that communicates the "Blind Sovereign
 * Bunker" boundary documented in UI-FEATURES.md Section 2: `site_admin`
 * is infrastructure / bootstrap / recovery authority and MUST NOT be
 * presented as able to browse, manage, or edit tenant-owned resources
 * (tenant users, OAuth clients, API resources, org roles, identity
 * providers, application configuration).
 *
 * The strings live in `BOUNDARY_COPY` in
 * `src/app/site-admin/organizations/[id]/operational-status.ts` and are
 * rendered by the page. Tests assert against the constants directly so
 * they run fast and can catch every reword without rendering React.
 *
 * Edits to the prose:
 *   - Strengthening the boundary is welcome — adjust the tests in the
 *     same change.
 *   - Weakening or removing the boundary fails this test. Future agents
 *     who attempt to imply site_admin can manage tenant resources will
 *     see a clear test failure pointing at the offending substring.
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_STATE_COPY,
  BOUNDARY_COPY,
  LIFECYCLE_COPY,
} from "../app/site-admin/organizations/[id]/operational-status";

// Phrases that would mislead an operator into thinking site_admin can
// reach into tenant-owned surfaces. Any of these appearing in the
// boundary copy or adjacent operator-facing strings is a regression.
const MISLEADING_PHRASES: string[] = [
  "manage all users",
  "manage tenant users",
  "browse tenant users",
  "browse all users",
  "edit tenant users",
  "edit all users",
  "list all users",
  "view all users",
  "manage oauth clients",
  "manage api resources",
  "manage org roles",
  "manage identity providers",
  "manage applications",
  "edit organization settings",
];

// Credential-material substrings that must never appear in operator-
// facing copy. The boundary card is not a credential surface; any
// occurrence would indicate a different bug (a credential leaked into
// page-level prose).
const CREDENTIAL_TERMS: string[] = [
  "password_hash",
  "mfa_secret",
  "otpauth://",
  "claim_token",
  "bearer token",
  "set-cookie",
];

// All operator-facing copy fragments rendered by the detail page that
// this test guards against weakening. The MfaSection lives in a separate
// section (Section 8) and is not included here.
const ALL_DETAIL_COPY: string[] = [
  BOUNDARY_COPY.administratorStatusCard,
  BOUNDARY_COPY.recoveryCardDescription,
  ...Object.values(LIFECYCLE_COPY).flatMap((c) => [c.label, c.body]),
  ...Object.values(ADMIN_STATE_COPY).flatMap((c) => [c.label, c.body]),
];

describe("BOUNDARY_COPY — Administrator status card boundary", () => {
  const copy = BOUNDARY_COPY.administratorStatusCard;

  it("pins the exact phrasing (regression sentry for silent rewords)", () => {
    // Exact match. Any single-character edit fails this assertion so a
    // future agent must either keep the wording byte-identical or
    // explicitly update this test in the same change.
    expect(copy).toBe(
      "Site administrators cannot view or list tenant organization members. This is enforced by the sovereign bunker policy to preserve tenant privacy boundaries."
    );
  });

  it("contains the load-bearing 'cannot view or list' restriction", () => {
    // Sub-phrase pin: even if a future agent restructures the sentence
    // around the cannot-list semantics, the restriction must still
    // appear word-for-word so the operator's read is unambiguous.
    expect(copy).toMatch(/cannot view or list/i);
  });

  it("names tenant organization members as the protected subject", () => {
    expect(copy).toMatch(/tenant organization members/i);
  });

  it("references the sovereign bunker policy by name", () => {
    // The phrase is the index into the IDP-side enforcement docstring
    // (`internal/service/user_read_service.go:ListUsersByOrganization`).
    // Cross-references must stay coherent.
    expect(copy).toMatch(/sovereign bunker policy/i);
  });

  it("does NOT contain misleading 'site_admin can manage tenant…' phrases", () => {
    const lower = copy.toLowerCase();
    for (const phrase of MISLEADING_PHRASES) {
      expect(lower).not.toContain(phrase);
    }
  });

  it("does NOT contain credential-material terms", () => {
    const lower = copy.toLowerCase();
    for (const term of CREDENTIAL_TERMS) {
      expect(lower).not.toContain(term);
    }
  });
});

describe("BOUNDARY_COPY — Organization administrators recovery card description", () => {
  const copy = BOUNDARY_COPY.recoveryCardDescription;

  it("pins the exact phrasing", () => {
    expect(copy).toBe(
      "Reset MFA for an administrator who has lost their authenticator. Only org_admin accounts are shown — tenant org_users remain hidden under the sovereign bunker policy."
    );
  });

  it("scopes the card explicitly to org_admin accounts (not all users)", () => {
    // Section 5's narrow exception is org_admin-only. The card MUST say
    // so out loud — a future agent who edits this to "Only administrators
    // are shown" would lose the role-specific scope.
    expect(copy).toMatch(/Only org_admin accounts are shown/);
  });

  it("explicitly excludes tenant org_users from the listing", () => {
    expect(copy).toMatch(/tenant org_users remain hidden/);
  });

  it("references the sovereign bunker policy by name", () => {
    expect(copy).toMatch(/sovereign bunker policy/i);
  });

  it("does NOT contain misleading 'site_admin can manage tenant…' phrases", () => {
    const lower = copy.toLowerCase();
    for (const phrase of MISLEADING_PHRASES) {
      expect(lower).not.toContain(phrase);
    }
  });

  it("does NOT contain credential-material terms", () => {
    const lower = copy.toLowerCase();
    for (const term of CREDENTIAL_TERMS) {
      expect(lower).not.toContain(term);
    }
  });
});

describe("BOUNDARY_COPY — global invariants across all detail-page operator copy", () => {
  it("no detail-page operator string contains misleading 'manage tenant…' phrases", () => {
    // Brute-force across every operator-facing string the page renders
    // via the helper module (boundary copy + lifecycle copy + admin-state
    // copy). The page renders these directly so a regression anywhere
    // surfaces here.
    for (const s of ALL_DETAIL_COPY) {
      const lower = s.toLowerCase();
      for (const phrase of MISLEADING_PHRASES) {
        expect(lower, `phrase "${phrase}" must not appear in: ${s}`).not.toContain(phrase);
      }
    }
  });

  it("no detail-page operator string contains credential-material terms", () => {
    for (const s of ALL_DETAIL_COPY) {
      const lower = s.toLowerCase();
      for (const term of CREDENTIAL_TERMS) {
        expect(lower, `credential term "${term}" must not appear in: ${s}`).not.toContain(term);
      }
    }
  });

  it("BOUNDARY_COPY is a frozen-shape constant (only the two known keys)", () => {
    // The shape pin catches a regression where a future agent adds a
    // third boundary string without writing tests for it. Adding a new
    // key here is intentional and welcome — the test forces the change
    // to be explicit.
    const keys = Object.keys(BOUNDARY_COPY).sort();
    expect(keys).toEqual(["administratorStatusCard", "recoveryCardDescription"]);
  });

  it("both boundary strings explicitly name the sovereign bunker policy", () => {
    // Cross-references between the UI and the IDP service docstring
    // depend on the exact phrase. Both copy fragments must keep it.
    expect(BOUNDARY_COPY.administratorStatusCard).toMatch(/sovereign bunker policy/i);
    expect(BOUNDARY_COPY.recoveryCardDescription).toMatch(/sovereign bunker policy/i);
  });
});

describe("BOUNDARY_COPY — authority-language invariants", () => {
  it("administrator status copy frames site_admin in terms of restriction, not capability", () => {
    // The card explains what site_admin CANNOT do. A copy edit that
    // flipped the framing to capability language ("Site administrators
    // may view tenant organization members") would weaken the boundary.
    expect(BOUNDARY_COPY.administratorStatusCard).toMatch(/cannot/i);
    expect(BOUNDARY_COPY.administratorStatusCard).not.toMatch(/\bcan view\b/i);
    expect(BOUNDARY_COPY.administratorStatusCard).not.toMatch(/\bcan list\b/i);
    expect(BOUNDARY_COPY.administratorStatusCard).not.toMatch(/\bcan manage\b/i);
  });

  it("recovery card description frames its surface as a narrow, role-scoped exception", () => {
    // "Only org_admin accounts are shown" is the load-bearing phrase
    // that signals the narrow exception. The opposite framing ("All
    // accounts are shown" / "Every administrator is shown") would
    // dissolve the boundary.
    expect(BOUNDARY_COPY.recoveryCardDescription).toMatch(/Only org_admin accounts/);
    expect(BOUNDARY_COPY.recoveryCardDescription).not.toMatch(/all\s+accounts/i);
    expect(BOUNDARY_COPY.recoveryCardDescription).not.toMatch(/every\s+(user|administrator)/i);
  });
});
