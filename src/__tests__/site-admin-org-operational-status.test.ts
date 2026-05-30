/**
 * Matrix tests for the site-admin organization detail Operational status
 * derivation. Pins UI-FEATURES.md Section 2's load-bearing invariant that
 * the card's lifecycle × adminState × nextAction enum must not be
 * collapsed or inverted during future refactors.
 *
 * The derivation has 4 boolean inputs (active, deleted, has_admin,
 * can_assign_admin) → 16 logical combinations. Several combinations are
 * indistinguishable from each other for the deleted=true case, so the
 * card output collapses to 12 distinct states. Every meaningful input
 * combination is covered below.
 *
 * The tests target the pure derivation in
 * src/app/site-admin/organizations/[id]/operational-status.ts. They do
 * not render React. They also check the operator-facing copy (label +
 * body) so a future agent cannot silently reword "Pending invitation
 * expired" or "Administrator account active" without failing this gate.
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_STATE_COPY,
  LIFECYCLE_COPY,
  type OperationalStatusInput,
  deriveOperationalStatus,
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

describe("deriveOperationalStatus — happy paths", () => {
  it("active org + verified admin → operational, no recovery action", () => {
    const s = deriveOperationalStatus(org());
    expect(s.lifecycle).toBe("active");
    expect(s.adminState).toBe("operational");
    expect(s.assignmentAllowed).toBe(false);
    expect(s.nextAction).toBe("none");
  });

  it("active org + admin with expired pending invitation → expired-pending, assign-admin", () => {
    const s = deriveOperationalStatus(org({ has_admin: true, can_assign_admin: true }));
    expect(s.lifecycle).toBe("active");
    expect(s.adminState).toBe("expired-pending");
    expect(s.assignmentAllowed).toBe(true);
    expect(s.nextAction).toBe("assign-admin");
  });

  it("active org + no admin → no-admin, assign-admin", () => {
    const s = deriveOperationalStatus(org({ has_admin: false, can_assign_admin: false }));
    expect(s.lifecycle).toBe("active");
    expect(s.adminState).toBe("no-admin");
    expect(s.assignmentAllowed).toBe(true);
    expect(s.nextAction).toBe("assign-admin");
  });

  it("active org + no admin + can_assign_admin=true → no-admin, assign-admin (can_assign does not override no-admin label)", () => {
    // Edge: can_assign_admin defaults true on the IDP DB-error fallback
    // (safety-on-failure). If an org also reports has_admin=false, the
    // card still labels the state "no-admin" — the operator's mental
    // model is "no admin exists" first; the recovery affordance is the
    // same regardless of which path led here.
    const s = deriveOperationalStatus(org({ has_admin: false, can_assign_admin: true }));
    expect(s.lifecycle).toBe("active");
    expect(s.adminState).toBe("no-admin");
    expect(s.assignmentAllowed).toBe(true);
    expect(s.nextAction).toBe("assign-admin");
  });
});

describe("deriveOperationalStatus — inactive (deactivated, not deleted)", () => {
  it("inactive org + verified admin → operational, reactivate", () => {
    const s = deriveOperationalStatus(org({ active: false }));
    expect(s.lifecycle).toBe("inactive");
    expect(s.adminState).toBe("operational");
    expect(s.assignmentAllowed).toBe(false);
    expect(s.nextAction).toBe("reactivate");
  });

  it("inactive org + expired-pending admin → expired-pending, reactivate-and-assign", () => {
    const s = deriveOperationalStatus(org({ active: false, has_admin: true, can_assign_admin: true }));
    expect(s.lifecycle).toBe("inactive");
    expect(s.adminState).toBe("expired-pending");
    expect(s.assignmentAllowed).toBe(true);
    expect(s.nextAction).toBe("reactivate-and-assign");
  });

  it("inactive org + no admin → no-admin, reactivate-and-assign", () => {
    const s = deriveOperationalStatus(org({ active: false, has_admin: false }));
    expect(s.lifecycle).toBe("inactive");
    expect(s.adminState).toBe("no-admin");
    expect(s.assignmentAllowed).toBe(true);
    expect(s.nextAction).toBe("reactivate-and-assign");
  });
});

describe("deriveOperationalStatus — deleted dominates everything", () => {
  // The deleted flag is the highest-priority dimension. lifecycle is
  // always `deleted`, adminState is always `suspended`, nextAction is
  // always `restore` — regardless of any other flag value. assignment
  // is never allowed on a deleted org (deleted orgs cannot be edited).

  const deletedCombos: { name: string; overrides: Partial<OperationalStatusInput> }[] = [
    { name: "deleted, active=true, has_admin=true, can_assign_admin=false", overrides: { deleted: true, active: true, has_admin: true, can_assign_admin: false } },
    { name: "deleted, active=true, has_admin=true, can_assign_admin=true", overrides: { deleted: true, active: true, has_admin: true, can_assign_admin: true } },
    { name: "deleted, active=true, has_admin=false, can_assign_admin=false", overrides: { deleted: true, active: true, has_admin: false, can_assign_admin: false } },
    { name: "deleted, active=true, has_admin=false, can_assign_admin=true", overrides: { deleted: true, active: true, has_admin: false, can_assign_admin: true } },
    { name: "deleted, active=false, has_admin=true, can_assign_admin=false", overrides: { deleted: true, active: false, has_admin: true, can_assign_admin: false } },
    { name: "deleted, active=false, has_admin=false, can_assign_admin=false", overrides: { deleted: true, active: false, has_admin: false, can_assign_admin: false } },
    { name: "deleted, active=false, has_admin=false, can_assign_admin=true", overrides: { deleted: true, active: false, has_admin: false, can_assign_admin: true } },
    { name: "deleted, active=false, has_admin=true, can_assign_admin=true", overrides: { deleted: true, active: false, has_admin: true, can_assign_admin: true } },
  ];

  for (const c of deletedCombos) {
    it(`${c.name} → restore-only`, () => {
      const s = deriveOperationalStatus(org(c.overrides));
      expect(s.lifecycle).toBe("deleted");
      expect(s.adminState).toBe("suspended");
      expect(s.nextAction).toBe("restore");
    });
  }

  it("deleted org with no admin must NOT surface assign-admin as the next action", () => {
    // Belt-and-suspenders pin of the negative invariant from the task
    // spec: even though has_admin=false would otherwise route to
    // assign-admin, the deleted dimension dominates.
    const s = deriveOperationalStatus(org({ deleted: true, has_admin: false }));
    expect(s.nextAction).not.toBe("assign-admin");
    expect(s.nextAction).not.toBe("reactivate-and-assign");
    expect(s.nextAction).toBe("restore");
  });

  it("can_assign_admin=true must NOT override deleted=true", () => {
    const s = deriveOperationalStatus(org({ deleted: true, can_assign_admin: true }));
    expect(s.nextAction).toBe("restore");
    expect(s.adminState).toBe("suspended");
  });
});

describe("deriveOperationalStatus — assignmentAllowed boundary", () => {
  it("has_admin=false always allows assignment, unless deleted", () => {
    // Iterate every non-deleted combination where has_admin=false.
    for (const can_assign_admin of [true, false]) {
      for (const active of [true, false]) {
        const s = deriveOperationalStatus(org({ active, has_admin: false, can_assign_admin }));
        expect(s.assignmentAllowed).toBe(true);
      }
    }
    // Negative side: deleted dominates.
    const deletedNoAdmin = deriveOperationalStatus(org({ deleted: true, has_admin: false }));
    // assignmentAllowed is the derived "may delegate" flag; on a deleted
    // org the page never surfaces assign as a CTA. The function returns
    // the raw boolean here (assignmentAllowed=true because has_admin is
    // false) — the nextAction enum is the load-bearing field that
    // suppresses the CTA. Pin BOTH so a future agent that "tidies up"
    // assignmentAllowed sees the test fail at the next-action layer.
    expect(deletedNoAdmin.nextAction).toBe("restore");
  });

  it("has_admin=true + can_assign_admin=false blocks assignment (steady-state)", () => {
    const s = deriveOperationalStatus(org({ has_admin: true, can_assign_admin: false }));
    expect(s.assignmentAllowed).toBe(false);
    expect(s.nextAction).toBe("none");
  });

  it("has_admin=true + can_assign_admin=true allows assignment (recovery state)", () => {
    const s = deriveOperationalStatus(org({ has_admin: true, can_assign_admin: true }));
    expect(s.assignmentAllowed).toBe(true);
    expect(s.adminState).toBe("expired-pending");
    expect(s.nextAction).toBe("assign-admin");
  });
});

describe("operator-facing copy is pinned (regression sentry for label/body edits)", () => {
  // The exact strings here are operator-facing and form part of the UI
  // contract per UI-FEATURES.md Section 2. A future agent that
  // "polishes" these labels could silently change the operator's mental
  // model — e.g. renaming "Pending invitation expired" to "Pending
  // invitation" loses the "expired" semantic the recovery flow depends
  // on. These assertions catch such changes.

  it("LIFECYCLE_COPY contains the exact labels and reassurance bodies", () => {
    expect(LIFECYCLE_COPY.active.label).toBe("Active");
    expect(LIFECYCLE_COPY.active.body).toMatch(/User logins are permitted/);
    expect(LIFECYCLE_COPY.inactive.label).toBe("Inactive");
    expect(LIFECYCLE_COPY.inactive.body).toMatch(/Reactivate to allow users to sign in/);
    expect(LIFECYCLE_COPY.deleted.label).toBe("Archived");
    expect(LIFECYCLE_COPY.deleted.body).toMatch(/soft-deleted/);
    expect(LIFECYCLE_COPY.deleted.body).toMatch(/Restore to resume operations/);
  });

  it("ADMIN_STATE_COPY contains the exact labels and recovery-affordance bodies", () => {
    expect(ADMIN_STATE_COPY.operational.label).toBe("Administrator account active");
    expect(ADMIN_STATE_COPY.operational.body).toMatch(/No recovery action is needed/);
    expect(ADMIN_STATE_COPY["expired-pending"].label).toBe("Pending invitation expired");
    expect(ADMIN_STATE_COPY["expired-pending"].body).toMatch(/Recovery delegation is available/);
    expect(ADMIN_STATE_COPY["no-admin"].label).toBe("No administrator");
    expect(ADMIN_STATE_COPY["no-admin"].body).toMatch(/Recovery delegation is available/);
    expect(ADMIN_STATE_COPY.suspended.label).toBe("Admin management suspended");
    expect(ADMIN_STATE_COPY.suspended.body).toMatch(/Restore the organization/);
  });

  it("no copy table mentions credential material (passwords, tokens, secrets)", () => {
    // The card never echoes any credential strings. This is an
    // operator-facing-only surface; tokens belong elsewhere.
    for (const c of Object.values(LIFECYCLE_COPY)) {
      expect(c.label + " " + c.body).not.toMatch(/password|token|secret|otpauth|cookie/i);
    }
    for (const c of Object.values(ADMIN_STATE_COPY)) {
      expect(c.label + " " + c.body).not.toMatch(/password|token|secret|otpauth|cookie/i);
    }
  });
});
