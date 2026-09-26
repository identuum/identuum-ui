/**
 * CE-UI-3a (owner ruling 2026-09-26). identuum-idp-ce has no
 * pending-registration state and serves no POST /api/v1/users/:id/approve,
 * so it declares GET /api/v1/component capabilities.user_approval = false and
 * the org_admin's user detail page offers no Approve. identuum-idp-oss
 * declares nothing, and a missing key keeps Approve exactly as before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let capabilities: Record<string, boolean> = {};
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities }, ag: null },
  }),
}));

// Banned org_user with no known policy: the row is "pending_approval".
const awaiting = {
  role: "org_user" as const,
  email: "member@example.test",
  active: false,
  banned: true,
  deleted: false,
  pending_setup: false,
  mfa_enabled: false,
};

describe("Approve follows capabilities.user_approval", () => {
  it("offers Enable but not Approve where the IdP has no approval state", async () => {
    const { deriveOrgAdminUserActions } = await import(
      "../app/org-admin/users/[id]/user-detail-actions"
    );
    const r = deriveOrgAdminUserActions(awaiting as never, 1, null, { userApproval: false });
    expect(r.status).toBe("pending_approval");
    expect(r.actions).toEqual(["enable"]);
  });

  it("keeps Approve where the IdP does not say otherwise (identuum-idp-oss)", async () => {
    const { deriveOrgAdminUserActions } = await import(
      "../app/org-admin/users/[id]/user-detail-actions"
    );
    expect(deriveOrgAdminUserActions(awaiting as never, 1, null, {}).actions).toEqual([
      "enable",
      "approve-registration",
    ]);
  });

  it("reads the capability: only an explicit false turns Approve off", async () => {
    const { userApprovalAvailable } = await import("../lib/mail-capabilities");
    capabilities = { user_approval: false };
    expect(await userApprovalAvailable()).toBe(false);
    capabilities = {};
    expect(await userApprovalAvailable()).toBe(true);
    capabilities = { user_approval: true };
    expect(await userApprovalAvailable()).toBe(true);
  });

  it("the user detail page passes the capability to the action derivation", () => {
    const src = readFileSync(join(__dirname, "../app/org-admin/users/[id]/page.tsx"), "utf8");
    expect(src).toMatch(/userApproval:\s*await userApprovalAvailable\(\)/);
  });
});
