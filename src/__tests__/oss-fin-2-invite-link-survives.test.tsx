/**
 * OSS-FIN-2 live attempt 2: after "Send invitation" for a user created with a
 * password before D-017, the one-time link never appeared. The action
 * revalidates the page; the user is then pending, so the page's action moves
 * from invite-unverified to reissue-invite. When those rendered
 * ReissueInviteButton at two different places in the tree, React unmounted
 * the one holding the issued link and mounted a fresh one.
 *
 * React keeps a client component's state across a re-render only when the
 * element keeps its type at the same position. This test finds
 * ReissueInviteButton in the page's element tree for both states and
 * requires the same path.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true }, ag: { enabled: false } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("@/lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    components: { idp: { usable: true, capabilities: { user_invite: true, org_audit: false } } },
  }),
}));
vi.mock("@/lib/mail-capabilities", () => ({
  adminResetLinkAvailable: async () => false,
  userApprovalAvailable: async () => true,
  userInviteAvailable: async () => true,
  selfRegistrationAvailable: async () => false,
}));

const USER_ID = "01990000-0000-7000-8000-0000000000aa";
let current: Record<string, unknown> = {};
vi.mock("@/lib/idp-admin-client", async (orig) => ({
  ...(await orig<object>()),
  getOrgUserById: async () => current,
  getOwnOrganization: async () => ({ id: "01990000-0000-7000-8000-0000000000bb" }),
  listOrgUsers: async () => ({ users: [] }),
  listUserRoles: async () => ({ ok: true, roles: [] }),
  listOrgRoles: async () => ({ ok: true, roles: [] }),
  listAuditEvents: async () => null,
}));

const base = {
  id: USER_ID,
  email: "old@example.test",
  name: "Old Member",
  role: "org_user",
  active: true,
  banned: false,
  deleted: false,
  mfa_enabled: false,
  invitation_email_bound: true,
  created_at: "2026-09-29T10:00:00Z",
};

/** Index path to the first element of `type`, following props.children. */
function pathTo(node: ReactNode, type: unknown, path: number[] = []): number[] | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return path;
  const kids = el.props?.children;
  const list = Array.isArray(kids) ? kids : [kids];
  for (let i = 0; i < list.length; i++) {
    const found = pathTo(list[i], type, [...path, i]);
    if (found) return found;
  }
  return null;
}

describe("the issued invitation survives the page's re-render", () => {
  it("ReissueInviteButton keeps its place when the user turns pending", async () => {
    const { ReissueInviteButton } = await import(
      "../app/org-admin/users/[id]/reissue-invite-button"
    );
    const Page = (await import("../app/org-admin/users/[id]/page")).default;
    current = { ...base, email_verified: false, invitation_pending: false };
    const before = pathTo(
      await Page({ params: Promise.resolve({ id: USER_ID }) }),
      ReissueInviteButton
    );
    current = { ...base, email_verified: false, invitation_pending: true };
    const after = pathTo(
      await Page({ params: Promise.resolve({ id: USER_ID }) }),
      ReissueInviteButton
    );
    expect(before, "Send invitation is offered to the unverified user").not.toBeNull();
    expect(after, "Re-issue is offered to the pending user").not.toBeNull();
    expect(after, "the same element position, so the issued link is kept").toEqual(before);
  });
});
