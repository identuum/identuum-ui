/**
 * FUNC-M4 (audits/oss-functionality-2026-10-05.md): a sign-up held for
 * approval showed as "Active" in the users table and counted as Active,
 * while the "Pending approval" tab said "No pending registrations". The IdP
 * holds a sign-up with registration_state, not banned, so the user list alone
 * cannot say it; the console now marks the users the IdP lists as held.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AWAITING_APPROVAL_STATUS_LABEL,
  computeOrgUserStatus,
  deriveOrgAdminUserActions,
  type OrgAdminUserActionInput,
  pendingApprovalLabel,
} from "../app/org-admin/users/[id]/user-detail-actions";

const held: OrgAdminUserActionInput = {
  role: "org_user",
  active: true,
  deleted: false,
  mfa_enabled: false,
  email_verified: false,
  email: "new@example.com",
  invitation_pending: false,
  invitation_email_bound: true,
  banned: false,
  registration_held: true,
};

describe("a sign-up held for approval", () => {
  it("is awaiting approval, not Active", () => {
    expect(computeOrgUserStatus(held)).toBe("pending_approval");
    expect(pendingApprovalLabel(held)).toBe(AWAITING_APPROVAL_STATUS_LABEL);
  });

  it("offers Approve and not Enable (it is not disabled)", () => {
    const { status, actions } = deriveOrgAdminUserActions(held, 1, null, {});
    expect(status).toBe("pending_approval");
    expect(actions).toEqual(["approve-registration"]);
  });

  it("the users page and the detail page read the IdP's list of held sign-ups", () => {
    for (const page of ["page.tsx", "[id]/page.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../app/org-admin/users", page), "utf8");
      expect(src).toContain("listPendingRegistrations");
      expect(src).toContain("registration_held");
    }
  });
});
