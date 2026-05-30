/**
 * Matrix tests for the site-admin organization detail Actions card
 * visibility derivation.
 *
 * Pins the action-list contract enforced by `deriveOrganizationActions`
 * in `src/app/site-admin/organizations/[id]/operational-status.ts`. The
 * page.tsx Actions card gates each link with `.includes(...)` against
 * the returned list, so the assertions here are a tight contract with
 * what the operator sees.
 *
 * UI-FEATURES.md Section 2 documents the load-bearing invariants:
 *   - deleted dominates → restore-only
 *   - assign-admin appears iff `!has_admin || can_assign_admin` AND
 *     not deleted
 *   - the Actions card MUST NOT expose tenant-internal site_admin
 *     surfaces (tenant users, OAuth clients, API resources, org roles,
 *     identity providers) — the OrganizationAction enum is the
 *     allowlist
 *
 * Tests do not render React and do not submit any lifecycle action.
 * They target the pure-derivation helper only.
 */

import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_ACTION_META,
  type OperationalStatusInput,
  type OrganizationAction,
  deriveOrganizationActions,
  getOrganizationActionHref,
  getOrganizationActionLabel,
} from "../app/site-admin/organizations/[id]/operational-status";

// Helper: cheap fixture builder. Defaults to "happy path" (active org
// with a verified admin); each test overrides the relevant flags.
function org(overrides: Partial<OperationalStatusInput> = {}): OperationalStatusInput {
  return {
    active: true,
    deleted: false,
    has_admin: true,
    can_assign_admin: false,
    ...overrides,
  };
}

// Allowlist of tenant-internal surfaces that MUST NOT appear in the
// action list. Used by the negative-invariant test. This list is the
// "definitely not here" half of the contract — the page must never
// surface these on the site_admin detail page per the Blind Sovereign
// Bunker policy.
const TENANT_INTERNAL_FORBIDDEN: string[] = [
  "tenant-users",
  "users",
  "oauth-clients",
  "clients",
  "api-resources",
  "resources",
  "org-roles",
  "roles",
  "identity-providers",
  "idps",
];

// Allowlist of the only six identifiers the helper is allowed to
// return. Any new value would be a contract change requiring an
// explicit doc update.
const KNOWN_ACTIONS: ReadonlySet<OrganizationAction> = new Set([
  "edit",
  "deactivate",
  "reactivate",
  "assign-admin",
  "archive",
  "restore",
]);

describe("deriveOrganizationActions — non-deleted active organizations", () => {
  it("active org + verified admin (steady state) → edit, deactivate, archive (no assign-admin)", () => {
    const actions = deriveOrganizationActions(org());
    expect(actions).toEqual(["edit", "deactivate", "archive"]);
  });

  it("active org + expired-pending admin → edit, deactivate, assign-admin, archive", () => {
    const actions = deriveOrganizationActions(org({ has_admin: true, can_assign_admin: true }));
    expect(actions).toEqual(["edit", "deactivate", "assign-admin", "archive"]);
  });

  it("active org + no admin → edit, deactivate, assign-admin, archive", () => {
    const actions = deriveOrganizationActions(org({ has_admin: false, can_assign_admin: false }));
    expect(actions).toEqual(["edit", "deactivate", "assign-admin", "archive"]);
  });

  it("active org + no admin + can_assign_admin=true → edit, deactivate, assign-admin, archive", () => {
    // can_assign_admin=true is the IDP DB-error fallback default; the
    // helper must not flip on a phantom assign affordance compared to
    // the can_assign_admin=false branch — both end with the same
    // visible set.
    const actions = deriveOrganizationActions(org({ has_admin: false, can_assign_admin: true }));
    expect(actions).toEqual(["edit", "deactivate", "assign-admin", "archive"]);
  });
});

describe("deriveOrganizationActions — non-deleted inactive organizations", () => {
  it("inactive org + verified admin → edit, reactivate, archive (no assign-admin)", () => {
    const actions = deriveOrganizationActions(org({ active: false }));
    expect(actions).toEqual(["edit", "reactivate", "archive"]);
  });

  it("inactive org + expired-pending admin → edit, reactivate, assign-admin, archive", () => {
    const actions = deriveOrganizationActions(
      org({ active: false, has_admin: true, can_assign_admin: true })
    );
    expect(actions).toEqual(["edit", "reactivate", "assign-admin", "archive"]);
  });

  it("inactive org + no admin → edit, reactivate, assign-admin, archive", () => {
    const actions = deriveOrganizationActions(org({ active: false, has_admin: false }));
    expect(actions).toEqual(["edit", "reactivate", "assign-admin", "archive"]);
  });

  it("inactive org never shows Deactivate (mutually-exclusive with Reactivate)", () => {
    const actions = deriveOrganizationActions(org({ active: false }));
    expect(actions).not.toContain("deactivate");
    expect(actions).toContain("reactivate");
  });

  it("active org never shows Reactivate (mutually-exclusive with Deactivate)", () => {
    const actions = deriveOrganizationActions(org({ active: true }));
    expect(actions).not.toContain("reactivate");
    expect(actions).toContain("deactivate");
  });
});

describe("deriveOrganizationActions — deleted dominates everything", () => {
  // The deleted flag is the highest-priority dimension. The action list
  // collapses to exactly ["restore"] regardless of any other flag.

  const deletedCombos: { name: string; overrides: Partial<OperationalStatusInput> }[] = [
    { name: "deleted + active=true + has_admin=true + can_assign_admin=false", overrides: { deleted: true, active: true, has_admin: true, can_assign_admin: false } },
    { name: "deleted + active=true + has_admin=true + can_assign_admin=true",  overrides: { deleted: true, active: true, has_admin: true, can_assign_admin: true } },
    { name: "deleted + active=true + has_admin=false + can_assign_admin=false", overrides: { deleted: true, active: true, has_admin: false, can_assign_admin: false } },
    { name: "deleted + active=true + has_admin=false + can_assign_admin=true",  overrides: { deleted: true, active: true, has_admin: false, can_assign_admin: true } },
    { name: "deleted + active=false + has_admin=true + can_assign_admin=false", overrides: { deleted: true, active: false, has_admin: true, can_assign_admin: false } },
    { name: "deleted + active=false + has_admin=true + can_assign_admin=true",  overrides: { deleted: true, active: false, has_admin: true, can_assign_admin: true } },
    { name: "deleted + active=false + has_admin=false + can_assign_admin=false", overrides: { deleted: true, active: false, has_admin: false, can_assign_admin: false } },
    { name: "deleted + active=false + has_admin=false + can_assign_admin=true",  overrides: { deleted: true, active: false, has_admin: false, can_assign_admin: true } },
  ];

  for (const c of deletedCombos) {
    it(`${c.name} → exactly ["restore"]`, () => {
      const actions = deriveOrganizationActions(org(c.overrides));
      expect(actions).toEqual(["restore"]);
    });
  }

  it("deleted org with no admin must NOT include assign-admin", () => {
    const actions = deriveOrganizationActions(org({ deleted: true, has_admin: false }));
    expect(actions).not.toContain("assign-admin");
  });

  it("deleted org with can_assign_admin=true must NOT include assign-admin", () => {
    const actions = deriveOrganizationActions(
      org({ deleted: true, has_admin: false, can_assign_admin: true })
    );
    expect(actions).not.toContain("assign-admin");
  });

  it("deleted org NEVER shows edit, deactivate, reactivate, or archive", () => {
    // Brute-force all 8 deleted combinations and assert each forbidden
    // identifier is absent.
    for (const c of deletedCombos) {
      const actions = deriveOrganizationActions(org(c.overrides));
      for (const forbidden of ["edit", "deactivate", "reactivate", "archive"] as const) {
        expect(actions).not.toContain(forbidden);
      }
    }
  });
});

describe("deriveOrganizationActions — assign-admin visibility boundary", () => {
  it("active + verified admin (has_admin=true, can_assign_admin=false): assign-admin IS HIDDEN", () => {
    const actions = deriveOrganizationActions(org({ has_admin: true, can_assign_admin: false }));
    expect(actions).not.toContain("assign-admin");
  });

  it("active + expired-pending (has_admin=true, can_assign_admin=true): assign-admin IS VISIBLE", () => {
    const actions = deriveOrganizationActions(org({ has_admin: true, can_assign_admin: true }));
    expect(actions).toContain("assign-admin");
  });

  it("has_admin=false always makes assign-admin visible (unless deleted)", () => {
    // Cover all 4 non-deleted combinations where has_admin=false.
    for (const active of [true, false]) {
      for (const can_assign_admin of [true, false]) {
        const actions = deriveOrganizationActions(
          org({ active, has_admin: false, can_assign_admin })
        );
        expect(actions).toContain("assign-admin");
      }
    }
  });
});

describe("deriveOrganizationActions — site_admin authority-boundary invariants", () => {
  it("returned identifiers are always a subset of the known six-element enum", () => {
    // Brute-force all 16 input combinations. Every returned identifier
    // must be one of the known six. A new identifier silently appearing
    // would mean either a contract change or an accidental leak (e.g.
    // a tenant-internal surface).
    for (const active of [true, false]) {
      for (const deleted of [true, false]) {
        for (const has_admin of [true, false]) {
          for (const can_assign_admin of [true, false]) {
            const actions = deriveOrganizationActions({
              active,
              deleted,
              has_admin,
              can_assign_admin,
            });
            for (const a of actions) {
              expect(KNOWN_ACTIONS.has(a)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("returned identifiers NEVER include tenant-internal surfaces", () => {
    // Belt-and-suspenders: the previous test pins the positive allowlist.
    // This one pins the negative list explicitly so a future agent who
    // tries to add (say) "tenant-users" sees this test fail with the
    // exact identifier in the failure message.
    for (const active of [true, false]) {
      for (const deleted of [true, false]) {
        for (const has_admin of [true, false]) {
          for (const can_assign_admin of [true, false]) {
            const actions = deriveOrganizationActions({
              active,
              deleted,
              has_admin,
              can_assign_admin,
            });
            for (const forbidden of TENANT_INTERNAL_FORBIDDEN) {
              expect(actions as string[]).not.toContain(forbidden);
            }
          }
        }
      }
    }
  });

  it("active org with verified admin has the smallest steady-state action set (no recovery affordance)", () => {
    // Steady-state operator UX: no recovery actions surfaced unless the
    // state actually warrants one.
    const actions = deriveOrganizationActions(
      org({ active: true, deleted: false, has_admin: true, can_assign_admin: false })
    );
    expect(actions).toEqual(["edit", "deactivate", "archive"]);
    expect(actions).not.toContain("assign-admin");
    expect(actions).not.toContain("restore");
    expect(actions).not.toContain("reactivate");
  });
});

describe("deriveOrganizationActions — ordering pins left-to-right render order", () => {
  // The page renders actions in the array order. Reordering the helper
  // would shuffle the operator's mental model. Pin the order.

  it("active + recovery state renders edit → deactivate → assign-admin → archive", () => {
    const actions = deriveOrganizationActions(org({ has_admin: false }));
    expect(actions.indexOf("edit")).toBeLessThan(actions.indexOf("deactivate"));
    expect(actions.indexOf("deactivate")).toBeLessThan(actions.indexOf("assign-admin"));
    expect(actions.indexOf("assign-admin")).toBeLessThan(actions.indexOf("archive"));
  });

  it("inactive + recovery state renders edit → reactivate → assign-admin → archive", () => {
    const actions = deriveOrganizationActions(org({ active: false, has_admin: false }));
    expect(actions.indexOf("edit")).toBeLessThan(actions.indexOf("reactivate"));
    expect(actions.indexOf("reactivate")).toBeLessThan(actions.indexOf("assign-admin"));
    expect(actions.indexOf("assign-admin")).toBeLessThan(actions.indexOf("archive"));
  });

  it("archive is always the last action in non-deleted states (destructive ordering)", () => {
    for (const active of [true, false]) {
      for (const has_admin of [true, false]) {
        for (const can_assign_admin of [true, false]) {
          const actions = deriveOrganizationActions({
            active,
            deleted: false,
            has_admin,
            can_assign_admin,
          });
          expect(actions[actions.length - 1]).toBe("archive");
        }
      }
    }
  });
});

// ── Action metadata: visible label + href suffix ─────────────────────────────
//
// Pins the operator-facing label and the sub-route each action targets.
// The page renders these via `getOrganizationActionLabel(action)` and
// `getOrganizationActionHref(orgID, action)`, so the assertions here are
// the exact contract with what the operator clicks. Tests do not click
// any link, do not submit any form, and do not exercise the IDP — pure
// metadata pins only.

const ALL_ACTIONS: ReadonlyArray<OrganizationAction> = [
  "edit",
  "deactivate",
  "reactivate",
  "assign-admin",
  "archive",
  "restore",
];

// Test fixture: a syntactically valid UUIDv7. Tests rely on the fixture
// only for string concatenation; the literal value carries no semantic
// meaning and is not a secret.
const FIXTURE_ORG_ID = "019e67c6-e71d-76ce-a615-ada70411d953";

// Sub-route segments that MUST NOT appear in any action's metadata.
// These are the tenant-internal surfaces that violate the Blind
// Sovereign Bunker policy if they ever surface on the site_admin org
// detail page.
const TENANT_INTERNAL_ROUTES: string[] = [
  "users",
  "oauth-clients",
  "clients",
  "api-resources",
  "resources",
  "org-roles",
  "roles",
  "identity-providers",
  "idps",
];

// Operator-misleading labels that MUST NOT appear on any action.
// "Delete" specifically is forbidden as the soft-delete/archive label
// because operators read it as irreversible — the archive route's
// visible label must say "Archive" instead. "Hard delete" is forbidden
// outright (no hard-delete affordance exists on this page).
const MISLEADING_LABELS: string[] = [
  "Delete",
  "Hard delete",
  "Hard Delete",
  "Permanently delete",
];

// Credential-material terms that must never appear in a label or href.
const CREDENTIAL_TERMS: string[] = [
  "password_hash",
  "mfa_secret",
  "otpauth",
  "claim_token",
  "bearer",
  "set-cookie",
];

describe("ORGANIZATION_ACTION_META — label and route mapping", () => {
  it("edit maps to label 'Edit' and route 'edit'", () => {
    expect(ORGANIZATION_ACTION_META.edit).toEqual({ label: "Edit", route: "edit" });
  });

  it("deactivate maps to label 'Deactivate' and route 'deactivate'", () => {
    expect(ORGANIZATION_ACTION_META.deactivate).toEqual({
      label: "Deactivate",
      route: "deactivate",
    });
  });

  it("reactivate maps to label 'Reactivate' and route 'reactivate'", () => {
    expect(ORGANIZATION_ACTION_META.reactivate).toEqual({
      label: "Reactivate",
      route: "reactivate",
    });
  });

  it("assign-admin maps to label 'Assign admin' and route 'assign-admin'", () => {
    expect(ORGANIZATION_ACTION_META["assign-admin"]).toEqual({
      label: "Assign admin",
      route: "assign-admin",
    });
  });

  it("archive maps to label 'Archive' and route 'delete' (load-bearing naming asymmetry)", () => {
    // The visible label intentionally says Archive because the
    // operation is soft-delete/archival. The route is `delete` because
    // that is the sub-route the existing identuum-idp /delete endpoint
    // is rooted at. A future agent that "unifies" these by renaming
    // either side breaks the operator's mental model OR the routing
    // contract. Pin both halves explicitly so the asymmetry survives.
    expect(ORGANIZATION_ACTION_META.archive).toEqual({ label: "Archive", route: "delete" });
  });

  it("restore maps to label 'Restore' and route 'restore'", () => {
    expect(ORGANIZATION_ACTION_META.restore).toEqual({ label: "Restore", route: "restore" });
  });

  it("the metadata table has exactly the six known actions (allowlist key shape)", () => {
    const keys = Object.keys(ORGANIZATION_ACTION_META).sort();
    expect(keys).toEqual(
      ["archive", "assign-admin", "deactivate", "edit", "reactivate", "restore"].sort()
    );
  });
});

describe("getOrganizationActionLabel and getOrganizationActionHref helpers", () => {
  it("getOrganizationActionLabel returns the table label for each action", () => {
    expect(getOrganizationActionLabel("edit")).toBe("Edit");
    expect(getOrganizationActionLabel("deactivate")).toBe("Deactivate");
    expect(getOrganizationActionLabel("reactivate")).toBe("Reactivate");
    expect(getOrganizationActionLabel("assign-admin")).toBe("Assign admin");
    expect(getOrganizationActionLabel("archive")).toBe("Archive");
    expect(getOrganizationActionLabel("restore")).toBe("Restore");
  });

  it("getOrganizationActionHref builds an absolute path rooted at /site-admin/organizations/<id>/", () => {
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "edit")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/edit`
    );
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "deactivate")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/deactivate`
    );
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "reactivate")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/reactivate`
    );
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "assign-admin")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/assign-admin`
    );
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "restore")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/restore`
    );
  });

  it("getOrganizationActionHref for 'archive' points at the /delete soft-delete route", () => {
    // This is the load-bearing asymmetry test: visible label is
    // Archive but the route is /delete. The href must NOT be /archive.
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "archive")).toBe(
      `/site-admin/organizations/${FIXTURE_ORG_ID}/delete`
    );
    expect(getOrganizationActionHref(FIXTURE_ORG_ID, "archive")).not.toMatch(/\/archive$/);
  });

  it("every action's href starts with /site-admin/organizations/<id>/", () => {
    for (const a of ALL_ACTIONS) {
      const href = getOrganizationActionHref(FIXTURE_ORG_ID, a);
      expect(href.startsWith(`/site-admin/organizations/${FIXTURE_ORG_ID}/`)).toBe(true);
    }
  });

  it("every action's href is relative (no scheme, no protocol-relative leak)", () => {
    // Belt-and-suspenders: a regression that introduced an absolute URL
    // (e.g. concatenated `https://` from a misconfigured env) would
    // route the click outside the UI origin. The helper construction
    // guarantees a leading `/`; pin it.
    for (const a of ALL_ACTIONS) {
      const href = getOrganizationActionHref(FIXTURE_ORG_ID, a);
      expect(href.startsWith("/")).toBe(true);
      expect(href).not.toMatch(/^https?:\/\//);
      expect(href).not.toMatch(/^\/\//); // protocol-relative
    }
  });
});

describe("Composed sequences — deriveOrganizationActions × metadata", () => {
  it("active + verified admin renders [Edit, Deactivate, Archive] in order", () => {
    const actions = deriveOrganizationActions({
      active: true,
      deleted: false,
      has_admin: true,
      can_assign_admin: false,
    });
    const labels = actions.map(getOrganizationActionLabel);
    expect(labels).toEqual(["Edit", "Deactivate", "Archive"]);
  });

  it("inactive + expired-pending renders [Edit, Reactivate, Assign admin, Archive] in order", () => {
    const actions = deriveOrganizationActions({
      active: false,
      deleted: false,
      has_admin: true,
      can_assign_admin: true,
    });
    const labels = actions.map(getOrganizationActionLabel);
    expect(labels).toEqual(["Edit", "Reactivate", "Assign admin", "Archive"]);
  });

  it("active + no admin renders [Edit, Deactivate, Assign admin, Archive] in order", () => {
    const actions = deriveOrganizationActions({
      active: true,
      deleted: false,
      has_admin: false,
      can_assign_admin: false,
    });
    const labels = actions.map(getOrganizationActionLabel);
    expect(labels).toEqual(["Edit", "Deactivate", "Assign admin", "Archive"]);
  });

  it("deleted org renders exactly [Restore] with href → /restore", () => {
    const actions = deriveOrganizationActions({
      active: true,
      deleted: true,
      has_admin: true,
      can_assign_admin: false,
    });
    const labels = actions.map(getOrganizationActionLabel);
    const hrefs = actions.map((a) => getOrganizationActionHref(FIXTURE_ORG_ID, a));
    expect(labels).toEqual(["Restore"]);
    expect(hrefs).toEqual([`/site-admin/organizations/${FIXTURE_ORG_ID}/restore`]);
  });
});

describe("Negative invariants — no misleading labels, no tenant-internal hrefs, no credentials", () => {
  it("no action label is 'Delete' or 'Hard delete' (Archive is the soft-delete operator copy)", () => {
    for (const a of ALL_ACTIONS) {
      const label = getOrganizationActionLabel(a);
      for (const forbidden of MISLEADING_LABELS) {
        expect(label).not.toBe(forbidden);
      }
    }
  });

  it("no action href contains a tenant-internal sub-route segment", () => {
    // Iterate every action and assert the href does not match the
    // tenant-internal route names. Use word-boundary matching on the
    // sub-route position so e.g. `/edit` does not falsely match
    // "users".
    for (const a of ALL_ACTIONS) {
      const href = getOrganizationActionHref(FIXTURE_ORG_ID, a);
      const segment = href.split("/").pop() ?? "";
      for (const forbidden of TENANT_INTERNAL_ROUTES) {
        expect(segment).not.toBe(forbidden);
      }
    }
  });

  it("no action label or href contains credential-material terms", () => {
    for (const a of ALL_ACTIONS) {
      const label = getOrganizationActionLabel(a).toLowerCase();
      const href = getOrganizationActionHref(FIXTURE_ORG_ID, a).toLowerCase();
      for (const term of CREDENTIAL_TERMS) {
        expect(label).not.toContain(term);
        expect(href).not.toContain(term);
      }
    }
  });

  it("the metadata table does not contain any action whose route segment matches a tenant-internal surface", () => {
    // Brute-force across the table itself (not just via the helper)
    // to catch a regression where a new action is added with a
    // tenant-internal route — even if the action is never reached via
    // `deriveOrganizationActions`.
    for (const a of ALL_ACTIONS) {
      const meta = ORGANIZATION_ACTION_META[a];
      for (const forbidden of TENANT_INTERNAL_ROUTES) {
        expect(meta.route).not.toBe(forbidden);
      }
    }
  });
});
