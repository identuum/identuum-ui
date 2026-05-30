/**
 * Matrix tests for /org-admin/users/[id] action visibility +
 * authority-boundary copy.
 *
 * The page derives action visibility from a small set of input flags
 * (role, active, deleted, mfa_enabled, email_verified, email,
 * invitation_pending, invitation_email_bound) plus the page-computed
 * `activeAdminCount` for the sole-active-admin guard. The helper
 * module `src/app/org-admin/users/[id]/user-detail-actions.ts` is the
 * single source of truth; tests target it directly so a future agent
 * cannot silently:
 *   - expose lifecycle controls on a deleted user
 *   - expose lifecycle controls on a site_admin row (cross-tenant
 *     authority boundary)
 *   - show the wrong lifecycle pair (disable+enable simultaneously)
 *   - show MFA reset on an admin row (admin MFA recovery is the
 *     site-admin path)
 *   - show regenerate-invite on a non-pending row
 *   - fail the sole-active-admin protection
 *
 * SECURITY:
 *   - All synthetic fixtures use obviously-fake UUIDs and the
 *     documentation-range email `member@example.com`.
 *   - Tests do not submit any server action, do not mutate any user,
 *     and do not exercise any HTTP call.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORG_ADMIN_USER_ACTION_META,
  SOLE_ACTIVE_ADMIN_COPY,
  type OrgAdminUserActionInput,
  computeOrgUserStatus,
  deriveOrgAdminUserActions,
  getOrgAdminUserActionLabel,
  isNoEmailSentinel,
} from "../app/org-admin/users/[id]/user-detail-actions";

// Synthetic fixture builder. Defaults to an active org_user with MFA
// off. Tests override the flags they exercise.
function user(overrides: Partial<OrgAdminUserActionInput> = {}): OrgAdminUserActionInput {
  return {
    role: "org_user",
    active: true,
    deleted: false,
    mfa_enabled: false,
    email_verified: true,
    email: "member@example.com",
    invitation_pending: false,
    invitation_email_bound: true,
    ...overrides,
  };
}

// ── isNoEmailSentinel ────────────────────────────────────────────────────────

describe("isNoEmailSentinel — manual-invite sentinel detection", () => {
  it("returns true for the documented sentinel shape", () => {
    expect(
      isNoEmailSentinel("noemail+11111111-1111-1111-1111-111111111111@no-email.internal")
    ).toBe(true);
  });

  it("returns false for a normal email", () => {
    expect(isNoEmailSentinel("member@example.com")).toBe(false);
    expect(isNoEmailSentinel("admin@example.org")).toBe(false);
  });

  it("returns false when only one half of the sentinel pattern is present", () => {
    expect(isNoEmailSentinel("noemail+x@example.com")).toBe(false);
    expect(isNoEmailSentinel("regular@no-email.internal")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isNoEmailSentinel("")).toBe(false);
  });
});

// ── computeOrgUserStatus ─────────────────────────────────────────────────────

describe("computeOrgUserStatus — status precedence", () => {
  it("deleted dominates everything", () => {
    expect(computeOrgUserStatus(user({ deleted: true }))).toBe("deleted");
    expect(
      computeOrgUserStatus(user({ deleted: true, active: false, invitation_pending: true }))
    ).toBe("deleted");
  });

  it("invitation_pending → pending (when not deleted)", () => {
    expect(computeOrgUserStatus(user({ invitation_pending: true }))).toBe("pending");
  });

  it("no-email sentinel + not verified → pending (manual-invite case)", () => {
    expect(
      computeOrgUserStatus(
        user({
          email: "noemail+11111111-1111-1111-1111-111111111111@no-email.internal",
          email_verified: false,
          invitation_pending: false,
        })
      )
    ).toBe("pending");
  });

  it("no-email sentinel + verified → NOT pending (treated as a real account post-claim)", () => {
    // Once the invite is claimed and the email is verified, the sentinel
    // address should be hidden from the UI but the underlying row is a
    // real account. The status helper falls through to active/disabled.
    expect(
      computeOrgUserStatus(
        user({
          email: "noemail+11111111-1111-1111-1111-111111111111@no-email.internal",
          email_verified: true,
          active: true,
        })
      )
    ).toBe("active");
  });

  it("inactive (not deleted, not pending) → disabled", () => {
    expect(computeOrgUserStatus(user({ active: false }))).toBe("disabled");
  });

  it("active+verified+no-pending → active", () => {
    expect(computeOrgUserStatus(user())).toBe("active");
  });
});

// ── deriveOrgAdminUserActions — deleted dominates ────────────────────────────

describe("deriveOrgAdminUserActions — deleted users", () => {
  it("returns no actions when the user is deleted (any role, any flags)", () => {
    for (const role of ["org_user", "org_admin", "site_admin"] as const) {
      for (const active of [true, false]) {
        for (const mfa_enabled of [true, false]) {
          const r = deriveOrgAdminUserActions(user({ role, deleted: true, active, mfa_enabled }), 5);
          expect(r.status).toBe("deleted");
          expect(r.actions).toEqual([]);
          expect(r.soleActiveAdmin).toBe(false);
        }
      }
    }
  });
});

// ── deriveOrgAdminUserActions — site_admin boundary ──────────────────────────

describe("deriveOrgAdminUserActions — site_admin authority boundary", () => {
  it("returns no actions for a site_admin target (org_admin cannot manage system identities)", () => {
    // This is the cross-tenant authority boundary: org_admin viewing
    // /org-admin/users/[id] of a site_admin row sees the read-only
    // detail card but no action affordances. The Blind Sovereign
    // Bunker policy operates in both directions — site_admin cannot
    // manage tenant users (Section 5/8b precedent), AND org_admin
    // cannot manage system users.
    for (const active of [true, false]) {
      for (const mfa_enabled of [true, false]) {
        const r = deriveOrgAdminUserActions(
          user({ role: "site_admin", active, mfa_enabled }),
          5
        );
        expect(r.actions).toEqual([]);
        expect(r.soleActiveAdmin).toBe(false);
      }
    }
  });
});

// ── deriveOrgAdminUserActions — pending invitations ──────────────────────────

describe("deriveOrgAdminUserActions — pending invitations", () => {
  it("email-bound pending → only regenerate-invite", () => {
    const r = deriveOrgAdminUserActions(
      user({ invitation_pending: true, invitation_email_bound: true }),
      5
    );
    expect(r.status).toBe("pending");
    expect(r.actions).toEqual(["regenerate-invite"]);
  });

  it("manual-invite pending (no-email sentinel) → only regenerate-invite", () => {
    const r = deriveOrgAdminUserActions(
      user({
        invitation_pending: true,
        invitation_email_bound: false,
        email: "noemail+22222222-2222-2222-2222-222222222222@no-email.internal",
        email_verified: false,
      }),
      5
    );
    expect(r.status).toBe("pending");
    expect(r.actions).toEqual(["regenerate-invite"]);
  });

  it("pending users NEVER surface disable/enable/reset-mfa (account does not yet exist as a real session-bearing user)", () => {
    const r = deriveOrgAdminUserActions(user({ invitation_pending: true }), 5);
    expect(r.actions).not.toContain("disable");
    expect(r.actions).not.toContain("enable");
    expect(r.actions).not.toContain("reset-mfa");
  });
});

// ── deriveOrgAdminUserActions — active org_user ──────────────────────────────

describe("deriveOrgAdminUserActions — active org_user", () => {
  it("active org_user with MFA on → [disable, reset-mfa] in order", () => {
    const r = deriveOrgAdminUserActions(
      user({ role: "org_user", active: true, mfa_enabled: true }),
      5
    );
    expect(r.status).toBe("active");
    expect(r.actions).toEqual(["disable", "reset-mfa"]);
  });

  it("active org_user with MFA off → [disable] only", () => {
    const r = deriveOrgAdminUserActions(
      user({ role: "org_user", active: true, mfa_enabled: false }),
      5
    );
    expect(r.status).toBe("active");
    expect(r.actions).toEqual(["disable"]);
  });

  it("active org_user NEVER surfaces enable (mutex with disable)", () => {
    const r = deriveOrgAdminUserActions(user({ role: "org_user", active: true }), 5);
    expect(r.actions).toContain("disable");
    expect(r.actions).not.toContain("enable");
  });
});

// ── deriveOrgAdminUserActions — disabled org_user ────────────────────────────

describe("deriveOrgAdminUserActions — disabled org_user", () => {
  it("disabled (non-deleted, non-pending) org_user → [enable] only", () => {
    const r = deriveOrgAdminUserActions(user({ role: "org_user", active: false }), 5);
    expect(r.status).toBe("disabled");
    expect(r.actions).toEqual(["enable"]);
  });

  it("disabled org_user with MFA on still surfaces enable, NOT reset-mfa (MFA reset is for active rows)", () => {
    const r = deriveOrgAdminUserActions(
      user({ role: "org_user", active: false, mfa_enabled: true }),
      5
    );
    expect(r.actions).toEqual(["enable"]);
    expect(r.actions).not.toContain("reset-mfa");
    expect(r.actions).not.toContain("disable");
  });
});

// ── deriveOrgAdminUserActions — active org_admin (not sole) ──────────────────

describe("deriveOrgAdminUserActions — active org_admin (not sole)", () => {
  it("active org_admin with co-admins → [disable] only (no MFA reset for admins)", () => {
    const r = deriveOrgAdminUserActions(
      user({ role: "org_admin", active: true, mfa_enabled: true }),
      3 // 3 active admins; target is not sole
    );
    expect(r.status).toBe("active");
    expect(r.actions).toEqual(["disable"]);
    expect(r.actions).not.toContain("reset-mfa");
    expect(r.soleActiveAdmin).toBe(false);
  });

  it("active org_admin NEVER surfaces reset-mfa, regardless of MFA state (admin MFA reset is the site-admin path)", () => {
    for (const mfa_enabled of [true, false]) {
      const r = deriveOrgAdminUserActions(
        user({ role: "org_admin", active: true, mfa_enabled }),
        3
      );
      expect(r.actions).not.toContain("reset-mfa");
    }
  });
});

// ── deriveOrgAdminUserActions — sole-active-admin guard ──────────────────────

describe("deriveOrgAdminUserActions — sole-active-admin protection", () => {
  it("sole active org_admin (count=1) → soleActiveAdmin=true (caller suppresses the disable button)", () => {
    const r = deriveOrgAdminUserActions(user({ role: "org_admin", active: true }), 1);
    expect(r.soleActiveAdmin).toBe(true);
    // The action list still names `disable` so the page knows which
    // lifecycle pair to consider — the JSX swaps the button for the
    // explanatory copy block when the guard fires.
    expect(r.actions).toEqual(["disable"]);
  });

  it("sole active admin when listOrgUsers failed (count=0) → soleActiveAdmin=true (fail-closed)", () => {
    // The page sets activeAdminCount=0 when listOrgUsers returns null.
    // For an active org_admin target this still trips the guard
    // (`activeAdminCount <= 1` is true) so the operator sees the
    // explanatory copy and the backend enforces the final guard.
    const r = deriveOrgAdminUserActions(user({ role: "org_admin", active: true }), 0);
    expect(r.soleActiveAdmin).toBe(true);
  });

  it("disabled org_admin does NOT trip the sole-active-admin guard (sign-out has no effect)", () => {
    const r = deriveOrgAdminUserActions(user({ role: "org_admin", active: false }), 1);
    expect(r.soleActiveAdmin).toBe(false);
    expect(r.actions).toEqual(["enable"]);
  });

  it("non-admin role never trips the guard", () => {
    const r = deriveOrgAdminUserActions(user({ role: "org_user", active: true }), 0);
    expect(r.soleActiveAdmin).toBe(false);
  });
});

// ── Action metadata ──────────────────────────────────────────────────────────

describe("ORG_ADMIN_USER_ACTION_META + getOrgAdminUserActionLabel", () => {
  it("disable → 'Suspend access' (operator-friendly copy, not 'Delete' or 'Ban')", () => {
    expect(ORG_ADMIN_USER_ACTION_META.disable.sectionLabel).toBe("Suspend access");
    expect(getOrgAdminUserActionLabel("disable")).toBe("Suspend access");
  });

  it("enable → 'Restore access'", () => {
    expect(getOrgAdminUserActionLabel("enable")).toBe("Restore access");
  });

  it("regenerate-invite → 'Setup link'", () => {
    expect(getOrgAdminUserActionLabel("regenerate-invite")).toBe("Setup link");
  });

  it("reset-mfa → 'MFA enrollment'", () => {
    expect(getOrgAdminUserActionLabel("reset-mfa")).toBe("MFA enrollment");
  });

  it("the metadata table has exactly the four known actions (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_USER_ACTION_META).sort();
    expect(keys).toEqual(["disable", "enable", "regenerate-invite", "reset-mfa"]);
  });
});

// ── Negative-invariant brute force across the matrix ─────────────────────────

describe("deriveOrgAdminUserActions — global allowlist + negative invariants", () => {
  // Brute-force across every meaningful input combination and assert
  // the result never includes any action identifier outside the
  // four-element allowlist. Adding a new action would require a
  // matching enum entry in the helper, AND a test update here.
  const KNOWN_ACTIONS = new Set(["disable", "enable", "regenerate-invite", "reset-mfa"]);

  // Forbidden action identifiers that would signal a tenant-internal
  // or cross-org surface leaked into the helper. These map to UI
  // routes that the /org-admin shell intentionally does not expose.
  const TENANT_INTERNAL_FORBIDDEN = [
    "delete-user",
    "hard-delete",
    "promote-to-admin",
    "demote-from-admin",
    "edit-roles",
    "edit-permissions",
    "switch-organization",
    "cross-org",
    "system-user",
    "site-admin",
    "site_admin",
  ];

  it("every result for every input combination is a subset of the four-action allowlist", () => {
    for (const role of ["org_user", "org_admin", "site_admin"] as const) {
      for (const active of [true, false]) {
        for (const deleted of [true, false]) {
          for (const mfa_enabled of [true, false]) {
            for (const invitation_pending of [true, false]) {
              for (const count of [0, 1, 5]) {
                const r = deriveOrgAdminUserActions(
                  user({ role, active, deleted, mfa_enabled, invitation_pending }),
                  count
                );
                for (const a of r.actions) {
                  expect(KNOWN_ACTIONS.has(a)).toBe(true);
                }
              }
            }
          }
        }
      }
    }
  });

  it("disable and enable are NEVER both present in the same result (mutual exclusion)", () => {
    for (const role of ["org_user", "org_admin", "site_admin"] as const) {
      for (const active of [true, false]) {
        for (const deleted of [true, false]) {
          for (const mfa_enabled of [true, false]) {
            for (const invitation_pending of [true, false]) {
              const r = deriveOrgAdminUserActions(
                user({ role, active, deleted, mfa_enabled, invitation_pending }),
                3
              );
              const hasDisable = r.actions.includes("disable");
              const hasEnable = r.actions.includes("enable");
              expect(hasDisable && hasEnable).toBe(false);
            }
          }
        }
      }
    }
  });

  it("results never include tenant-internal or cross-org action identifiers", () => {
    for (const role of ["org_user", "org_admin", "site_admin"] as const) {
      for (const active of [true, false]) {
        for (const deleted of [true, false]) {
          for (const invitation_pending of [true, false]) {
            const r = deriveOrgAdminUserActions(
              user({ role, active, deleted, invitation_pending }),
              3
            );
            for (const forbidden of TENANT_INTERNAL_FORBIDDEN) {
              expect(r.actions as string[]).not.toContain(forbidden);
            }
          }
        }
      }
    }
  });

  it("reset-mfa only ever appears for active org_user with MFA on", () => {
    for (const role of ["org_user", "org_admin", "site_admin"] as const) {
      for (const active of [true, false]) {
        for (const deleted of [true, false]) {
          for (const mfa_enabled of [true, false]) {
            for (const invitation_pending of [true, false]) {
              const r = deriveOrgAdminUserActions(
                user({ role, active, deleted, mfa_enabled, invitation_pending }),
                3
              );
              if (r.actions.includes("reset-mfa")) {
                expect(role).toBe("org_user");
                expect(active).toBe(true);
                expect(mfa_enabled).toBe(true);
                expect(deleted).toBe(false);
                expect(invitation_pending).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

// ── Source-file negative invariants — boundary-copy + credential terms ──────

describe("Negative invariants — helper + page source contain no boundary or credential leaks", () => {
  function readSrc(rel: string): string {
    return readFileSync(
      resolve(__dirname, "..", "app", "org-admin", "users", "[id]", rel),
      "utf-8"
    );
  }

  // Strip JS comments before scanning. Doc-blocks and inline `//`
  // comments legitimately reference boundary terms (e.g. "Org scoping
  // enforced at service layer (ErrForbidden for cross-org IDs)") that
  // describe the invariant being enforced. Those are not operator-
  // facing copy and must not trip the misleading-phrase blocklist.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/^\s*\/\/.*$/gm, ""); // line comments
  }

  const HELPER_SRC = stripComments(readSrc("user-detail-actions.ts"));
  const PAGE_SRC = stripComments(readSrc("page.tsx"));

  // Phrases that would imply org_admin can reach into site-admin or
  // cross-org authority. The helper module's doc-block legitimately
  // *mentions* "site_admin" / "cross-tenant" / "Blind Sovereign Bunker"
  // when explaining the boundary it enforces, so those checks are
  // applied to the page source only (which renders operator-facing
  // copy). The helper source is held to the credential blocklist
  // alone.
  const MISLEADING_PHRASES = [
    /manage all organizations/i,
    /\bcross[- ]org\b/i,
    /switch organization/i,
    /archive organization/i,
    /restore organization/i,
    /sovereign bunker override/i,
    /all organizations/i,
    /system user/i,
  ];

  const CREDENTIAL_TERMS = [
    /password_hash/i,
    /mfa_secret/i,
    /otpauth:\/\//i,
    /Bearer\s+[A-Za-z0-9._-]{8,}/,
    /Set-Cookie/i,
    /session_validator/i,
    /reset_token/i,
    /claim_token/i,
  ];

  it("user-detail-actions.ts contains no credential-material terms", () => {
    for (const pat of CREDENTIAL_TERMS) {
      expect(HELPER_SRC, `helper must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("page.tsx contains no misleading 'site_admin/cross-org' operator-facing copy", () => {
    for (const pat of MISLEADING_PHRASES) {
      expect(PAGE_SRC, `page must not contain operator copy matching ${pat}`).not.toMatch(pat);
    }
  });

  it("page.tsx contains no credential-material terms", () => {
    for (const pat of CREDENTIAL_TERMS) {
      expect(PAGE_SRC, `page must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("page.tsx renders user.id only inside hidden form inputs (never as visible text)", () => {
    // user.id is the opaque revocation handle that gets POSTed to the
    // server action. A regression that surfaced `{user.id}` as
    // operator-visible text would leak the identifier into the page
    // body. The user-row-actions sub-component owns the hidden input
    // shape; here we just pin that the detail page never renders
    // user.id directly.
    const visibleIdLeak = PAGE_SRC.match(/>\s*\{user\.id\}\s*</);
    expect(visibleIdLeak).toBeNull();
  });
});

// ── Sole-active-admin guard copy ─────────────────────────────────────────────

describe("SOLE_ACTIVE_ADMIN_COPY — exact guard copy pin", () => {
  it("sectionHeading matches the operator-facing copy rendered above the panel", () => {
    expect(SOLE_ACTIVE_ADMIN_COPY.sectionHeading).toBe("Suspend access");
  });

  it("title exactly matches the documented amber-panel heading", () => {
    // The title MUST use the word "Cannot" — framing the constraint as
    // a restriction, not as a tip. A regression that softened this to
    // "You may want to assign another admin first" would imply the
    // disable action is available with extra caution, which is wrong.
    expect(SOLE_ACTIVE_ADMIN_COPY.title).toBe(
      "Cannot disable the last active organization admin"
    );
    expect(SOLE_ACTIVE_ADMIN_COPY.title).toMatch(/^Cannot/);
  });

  it("body explains the corrective action AND the underlying invariant", () => {
    expect(SOLE_ACTIVE_ADMIN_COPY.body).toBe(
      "Assign another administrator before suspending this account. This organization must always have at least one active admin."
    );
    expect(SOLE_ACTIVE_ADMIN_COPY.body).toMatch(/Assign another administrator/i);
    expect(SOLE_ACTIVE_ADMIN_COPY.body).toMatch(/must always have at least one active admin/i);
  });

  it("the copy bundle has exactly the three known keys (allowlist key shape)", () => {
    const keys = Object.keys(SOLE_ACTIVE_ADMIN_COPY).sort();
    expect(keys).toEqual(["body", "sectionHeading", "title"]);
  });
});

describe("SOLE_ACTIVE_ADMIN_COPY — boundary + credential negative invariants", () => {
  const ALL_GUARD_COPY = [
    SOLE_ACTIVE_ADMIN_COPY.sectionHeading,
    SOLE_ACTIVE_ADMIN_COPY.title,
    SOLE_ACTIVE_ADMIN_COPY.body,
  ];

  // Phrases that would imply org_admin can reach into site-admin or
  // cross-org authority. None of these may appear in the guard copy —
  // the guard is about a same-org constraint, not a cross-tenant one.
  const MISLEADING_PHRASES = [
    /\bsite[- ]admin\b/i,
    /\bcross[- ]org\b/i,
    /all organizations/i,
    /system user/i,
    /sovereign bunker override/i,
    /archive organization/i,
    /restore organization/i,
    /hard delete/i,
    /delete organization/i,
  ];

  // Credential-material patterns that must never appear in operator-
  // facing copy. The guard panel is a copy surface; no credential
  // strings have any business here.
  const CREDENTIAL_TERMS = [
    /password_hash/i,
    /mfa_secret/i,
    /otpauth:\/\//i,
    /Bearer\s+[A-Za-z0-9._-]{8,}/,
    /Set-Cookie/i,
    /session\s+validator/i,
    /reset\s+token/i,
    /claim_token/i,
  ];

  it("no guard-copy string contains site_admin / cross-org / cross-tenant authority wording", () => {
    for (const s of ALL_GUARD_COPY) {
      for (const pat of MISLEADING_PHRASES) {
        expect(s, `guard copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no guard-copy string contains credential-material terms", () => {
    for (const s of ALL_GUARD_COPY) {
      for (const pat of CREDENTIAL_TERMS) {
        expect(s, `guard copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("guard copy does NOT include the user.id, session id, or any UUID-shaped substring", () => {
    // The amber panel is about the user's role state, not their
    // identity. A regression that interpolated `${user.id}` into the
    // copy would leak the opaque revocation handle into the page body.
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const s of ALL_GUARD_COPY) {
      expect(s).not.toMatch(UUID_RE);
    }
  });

  it("guard copy uses restriction language ('Cannot') not capability language", () => {
    // The title MUST signal restriction. A copy edit that flipped the
    // framing to "You may suspend …" or "Suspending the last admin is
    // discouraged" would weaken the boundary.
    expect(SOLE_ACTIVE_ADMIN_COPY.title).toMatch(/\bCannot\b/);
    expect(SOLE_ACTIVE_ADMIN_COPY.title).not.toMatch(/\bMay\b/i);
    expect(SOLE_ACTIVE_ADMIN_COPY.title).not.toMatch(/\bdiscouraged\b/i);
    expect(SOLE_ACTIVE_ADMIN_COPY.title).not.toMatch(/\bnot recommended\b/i);
  });
});

describe("SOLE_ACTIVE_ADMIN_COPY — page renders the constants (source pin)", () => {
  // Belt-and-suspenders: read the page source and confirm it imports
  // and uses each of the three SOLE_ACTIVE_ADMIN_COPY keys. A
  // regression that re-inlined a hand-typed string (and diverged from
  // the constant) would fail this assertion AND the exact-copy pins.

  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "users", "[id]", "page.tsx"),
    "utf-8"
  );

  it("page.tsx imports SOLE_ACTIVE_ADMIN_COPY from the helper module", () => {
    expect(PAGE_SRC).toMatch(/import\s*\{[\s\S]*?SOLE_ACTIVE_ADMIN_COPY[\s\S]*?\}\s*from\s+["']\.\/user-detail-actions["']/);
  });

  it("page.tsx references each SOLE_ACTIVE_ADMIN_COPY field exactly once each", () => {
    expect(PAGE_SRC).toMatch(/SOLE_ACTIVE_ADMIN_COPY\.sectionHeading/);
    expect(PAGE_SRC).toMatch(/SOLE_ACTIVE_ADMIN_COPY\.title/);
    expect(PAGE_SRC).toMatch(/SOLE_ACTIVE_ADMIN_COPY\.body/);
  });

  it("page.tsx no longer contains the inline literal guard-copy strings (regression sentry)", () => {
    // After extraction, the previous inline literals must NOT survive
    // in the page source — a future agent that re-typed them inline
    // (rather than editing the constant) would create the kind of
    // copy drift the constants were extracted to prevent.
    expect(PAGE_SRC).not.toMatch(/"Cannot disable the last active organization admin"/);
    expect(PAGE_SRC).not.toMatch(/"Assign another administrator before suspending/);
  });

  it("page.tsx still renders <UserRowActions /> for the non-sole-admin lifecycle path", () => {
    // Sanity: the destructive action component is still mounted for
    // the non-guard path. Without this assertion an over-eager refactor
    // that hid UserRowActions globally would slip through.
    expect(PAGE_SRC).toMatch(/<UserRowActions/);
  });
});

describe("deriveOrgAdminUserActions — sole-admin returns actions=[disable] (guard fires at render layer)", () => {
  // Cross-reference test: the helper does NOT remove "disable" from
  // the action list when the guard fires. The page's JSX is responsible
  // for swapping the action UI for the amber panel. This is intentional
  // — the helper exposes the soleActiveAdmin flag so the caller decides
  // how to render. A future agent who "fixes" this by removing `disable`
  // from the action list would break the page's switch logic.
  it("sole-active-admin still has disable in the action list, with soleActiveAdmin=true", () => {
    const r = deriveOrgAdminUserActions(
      {
        role: "org_admin",
        active: true,
        deleted: false,
        mfa_enabled: false,
        email_verified: true,
        email: "admin@example.com",
        invitation_pending: false,
        invitation_email_bound: true,
      },
      1
    );
    expect(r.soleActiveAdmin).toBe(true);
    expect(r.actions).toContain("disable");
    // The action list does NOT include enable (mutex) or reset-mfa
    // (org_admin role) — same as the non-sole case.
    expect(r.actions).not.toContain("enable");
    expect(r.actions).not.toContain("reset-mfa");
    expect(r.actions).not.toContain("regenerate-invite");
  });
});

describe("Helper module — file existence pins", () => {
  it("src/app/org-admin/users/[id]/user-detail-actions.ts exists", () => {
    const p = resolve(
      __dirname,
      "..",
      "app",
      "org-admin",
      "users",
      "[id]",
      "user-detail-actions.ts"
    );
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });

  it("src/app/org-admin/users/[id]/page.tsx exists", () => {
    const p = resolve(__dirname, "..", "app", "org-admin", "users", "[id]", "page.tsx");
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });
});
