/**
 * FUNC-M13 (audits/oss-functionality-2026-10-05.md): an expired first-admin
 * invite on an ACTIVE organization was a dead end. The page said "you can
 * issue a new one"; that path re-issued an activation link (409) and said
 * "This organization is already active — its administrator has completed
 * activation. Nothing to re-issue", which was false. POST /users/{id}/invite
 * as the site admin works, and the page now offers it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pendingInvitedAdmin } from "../app/site-admin/organizations/[id]/operational-status";

const dir = resolve(__dirname, "../app/site-admin/organizations/[id]");
const read = (p: string) => readFileSync(resolve(dir, p), "utf8");
const org = { active: true, deleted: false, has_admin: true };

describe("an active organization whose administrator never accepted the invite", () => {
  it("names that administrator for a re-issued invite", () => {
    const admins = [{ id: "a1", email_verified: false }];
    expect(pendingInvitedAdmin(org, admins)?.id).toBe("a1");
  });

  it("names none once an administrator accepted, for an inactive org, or when admins are unknown", () => {
    expect(pendingInvitedAdmin(org, [{ id: "a1", email_verified: true }])).toBeNull();
    expect(
      pendingInvitedAdmin({ ...org, active: false }, [{ id: "a1", email_verified: false }])
    ).toBeNull();
    expect(pendingInvitedAdmin(org, null)).toBeNull();
  });

  it("the page offers Re-issue invite, through POST /users/:id/invite", () => {
    expect(read("page.tsx")).toContain("<ReissueAdminInviteButton userId={invitedAdmin.id} />");
    expect(read("reissue-activation-actions.ts")).toContain(
      "reissueUserInvite(parsed.data.user_id)"
    );
  });

  it("no refusal claims the administrator completed activation", () => {
    for (const p of ["assign-admin/actions.ts", "reissue-activation-actions.ts"]) {
      expect(read(p)).not.toMatch(/has completed activation|has activated it/);
    }
  });
});
