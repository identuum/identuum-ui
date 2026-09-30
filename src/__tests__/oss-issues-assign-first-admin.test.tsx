/**
 * OSS-ISSUES, GitHub issue #1 ("assign administrator"). An organization
 * created without an admin email is active with no administrator; its page
 * offers "Assign administrator", but that page could only re-issue a pending
 * administrator's activation and answered "already active". Reproduced on
 * v0.8.0. The IdP already lets a site_admin invite an organization's FIRST
 * org_admin (POST /api/v1/users without a password; the site_admin exception
 * of the admin model). The page now offers that when no administrator exists
 * and none is pending, and keeps the re-issue when an activation is pending.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));

const ORG_ID = "0190f000-0000-7000-8000-0000000000a1";
let org: Record<string, unknown> = {};
const sent: Array<{ url: string; body: unknown }> = [];
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if ((init.method ?? "GET") === "GET" && path === `/api/v1/organizations/${ORG_ID}`) {
      return new Response(JSON.stringify(org), { status: 200 });
    }
    sent.push({ url: path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(
      JSON.stringify({
        user: { email: "first@bugs.example" },
        invite_token: "a".repeat(64),
        invite_url: `http://ui.test/invite?token=${"a".repeat(64)}`,
        expires_at: "2026-10-01T10:00:00Z",
      }),
      { status: 201 }
    );
  }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

afterEach(() => {
  sent.length = 0;
});

const base = {
  id: ORG_ID,
  name: "Bugs Shell",
  domain: "bugs-shell.example",
  org_slug: "bugs-shell",
  active: true,
};

async function page() {
  const Page = (await import("../app/site-admin/organizations/[id]/assign-admin/page")).default;
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ORG_ID }) }));
}

describe("the assign-admin page for an organization with no administrator", () => {
  it("offers to invite the first administrator when none exists and none is pending", async () => {
    org = { ...base, is_claimed: false, can_assign_admin: false, activation_pending: false };
    const html = await page();
    expect(html).toContain("Invite the first administrator");
    expect(html).toMatch(/name="email"/);
    expect(html).not.toContain("Re-issue activation token");
  });
  it("keeps the re-issue when an activation is pending", async () => {
    org = {
      ...base,
      active: false,
      is_claimed: false,
      can_assign_admin: false,
      activation_pending: true,
    };
    const html = await page();
    expect(html).toContain("Re-issue activation token");
    expect(html).not.toContain("Invite the first administrator");
  });
  it("keeps the re-issue in the recovery state (admins exist, none verified)", async () => {
    org = { ...base, is_claimed: false, can_assign_admin: true, activation_pending: false };
    expect(await page()).toContain("Re-issue activation token");
  });
});

describe("inviting the first administrator", () => {
  it("posts the organization, the email and the org_admin role, and returns the one-time invite", async () => {
    const { inviteFirstOrgAdminAction } = await import(
      "../app/site-admin/organizations/[id]/assign-admin/actions"
    );
    const f = new FormData();
    f.set("org_id", ORG_ID);
    f.set("email", "first@bugs.example");
    f.set("name", "First Admin");
    const state = await inviteFirstOrgAdminAction({}, f);
    expect(sent).toEqual([
      {
        url: "/api/v1/users",
        body: {
          organization_id: ORG_ID,
          email: "first@bugs.example",
          name: "First Admin",
          role: "org_admin",
        },
      },
    ]);
    expect(state.invite?.email).toBe("first@bugs.example");
    expect(state.invite?.inviteUrl).toContain("/invite?token=");
  });
  it("refuses a malformed email without calling the IdP", async () => {
    const { inviteFirstOrgAdminAction } = await import(
      "../app/site-admin/organizations/[id]/assign-admin/actions"
    );
    const f = new FormData();
    f.set("org_id", ORG_ID);
    f.set("email", "not-an-email");
    const state = await inviteFirstOrgAdminAction({}, f);
    expect(state.error).toBeTruthy();
    expect(sent).toHaveLength(0);
  });
});
