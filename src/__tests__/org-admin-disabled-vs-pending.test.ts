/**
 * org-admin-disabled-vs-pending.test.ts — a disabled user is shown as
 * Disabled with Enable (v0.2.3, F3).
 *
 * OSS stores an admin-disabled org_user and a self-registrant held for
 * approval the same way: banned=true. Only an organization that takes public
 * registrations AND holds them for approval can have the second kind, so a
 * banned org_user is shown as possibly awaiting approval only there (or when
 * the policy could not be read); everywhere else it is Disabled with Enable.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANNED_AMBIGUOUS_STATUS_LABEL,
  computeOrgUserStatus,
  deriveOrgAdminUserActions,
  type OrgAdminUserActionInput,
  type OrgRegistrationPolicy,
} from "../app/org-admin/users/[id]/user-detail-actions";

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
    banned: false,
    ...overrides,
  };
}

const banned = () => user({ banned: true, active: false });
const active = () => user();

const POLICIES: Array<[string, OrgRegistrationPolicy, boolean]> = [
  // [name, policy, holds registrations for approval]
  [
    "invite-only",
    { allow_public_registration: false, require_registration_approval: false },
    false,
  ],
  [
    "public-immediate",
    { allow_public_registration: true, require_registration_approval: false },
    false,
  ],
  [
    "approval flag without public registration",
    { allow_public_registration: false, require_registration_approval: true },
    false,
  ],
  [
    "public-with-approval",
    { allow_public_registration: true, require_registration_approval: true },
    true,
  ],
];

describe.each(POLICIES)("organization %s", (_name, policy, holdsForApproval) => {
  it(`a banned org_user is ${holdsForApproval ? "ambiguous (Enable + Approve)" : "Disabled with Enable"}`, () => {
    const r = deriveOrgAdminUserActions(banned(), 2, policy);
    expect(computeOrgUserStatus(banned(), policy)).toBe(r.status);
    if (holdsForApproval) {
      expect(r.status).toBe("pending_approval");
      expect(r.actions).toEqual(["enable", "approve-registration"]);
    } else {
      expect(r.status).toBe("disabled");
      expect(r.actions).toEqual(["enable"]);
    }
  });

  it("an active org_user is Active with Disable", () => {
    const r = deriveOrgAdminUserActions(active(), 2, policy);
    expect(r.status).toBe("active");
    expect(r.actions).toEqual(["disable"]);
    expect(computeOrgUserStatus(active(), policy)).toBe("active");
  });
});

describe("an unreadable registration policy", () => {
  it("shows a banned org_user as ambiguous and offers both actions", () => {
    const r = deriveOrgAdminUserActions(banned(), 2, null);
    expect(r.status).toBe("pending_approval");
    expect(r.actions).toEqual(["enable", "approve-registration"]);
  });
});

describe("the ambiguous label is truthful", () => {
  it("names both possibilities", () => {
    expect(BANNED_AMBIGUOUS_STATUS_LABEL).toBe("Disabled or awaiting approval");
  });

  it.each([
    ["users/page.tsx", ["app", "org-admin", "users", "page.tsx"]],
    ["users/[id]/page.tsx", ["app", "org-admin", "users", "[id]", "page.tsx"]],
  ])(
    "%s derives status from the shared helper with the org's policy and renders the label",
    (_n, parts) => {
      const src = readFileSync(resolve(__dirname, "..", ...parts), "utf-8");
      expect(src).toMatch(/computeOrgUserStatus\([^)]*,\s*[A-Za-z_.]+/);
      expect(src).toContain("BANNED_AMBIGUOUS_STATUS_LABEL");
      expect(src).not.toMatch(/label:\s*"Pending approval"\s*,\s*cls/);
    }
  );
});
