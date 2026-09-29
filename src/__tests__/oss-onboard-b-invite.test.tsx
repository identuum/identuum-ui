/**
 * OSS-ONBOARD-B (owner ruling D-016): the ui half of the user invite, over the
 * OSS-ONBOARD-A contract (wiki log/0245).
 *
 *   capability  user_invite (only an explicit true offers anything; CE and an
 *               older binary report none)
 *   invite      POST /api/v1/users {email, name, role}, no password
 *               → 201 {user, invite_token, invite_url | invite_url_unavailable, expires_at}
 *   re-issue    POST /api/v1/users/:id/invite → 200 same fields | 409 user_not_pending
 *   validate    GET  /api/v1/auth/invite/:token → 200 {email} | 400 invalid_token | 429
 *   redeem      POST /api/v1/auth/invite {token, password}
 *               → 200 | 400 weak_password | 400 invalid_token | 429
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let capabilities: Record<string, boolean> = {};
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities }, ag: null },
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
  toPublicConfig: () => ({
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));

type Answer = { status: number; body?: unknown };
let idpAnswers: Record<string, Answer> = {};
const idpFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
  const key = `${(init.method ?? "GET").toUpperCase()} ${new URL(url).pathname}`;
  const a = idpAnswers[key] ?? { status: 404, body: {} };
  return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
});
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: (url: string, init?: RequestInit) => idpFetch(url, init),
}));

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  capabilities = { user_invite: true };
  idpAnswers = {};
  idpFetch.mockClear();
  fetchSpy = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = "a".repeat(64);
const USER_ID = "0198b2d0-0000-7000-8000-0000000000bb";
const pendingUser = {
  id: USER_ID,
  email: "newcomer@tenant-a.test",
  name: "New Comer",
  role: "org_user",
  banned: false,
  email_verified: false,
  invitation_pending: true,
  created_at: "2026-09-28T10:00:00Z",
};
const issued = (extra: Record<string, unknown> = {}) => ({
  invite_token: TOKEN,
  invite_url: `http://ui.test/invite?token=${TOKEN}`,
  expires_at: "2026-09-29T10:00:00Z",
  ...extra,
});
const pageTree = async (p: Promise<unknown>) =>
  renderToStaticMarkup((await p) as React.ReactElement);

describe("the entry points appear only with capabilities.user_invite", () => {
  const listAnswers = () => {
    idpAnswers["GET /api/v1/users"] = { status: 200, body: { users: [pendingUser], total: 1 } };
    idpAnswers["GET /api/v1/organizations/current"] = { status: 200, body: { id: "org" } };
  };
  it("the users list offers Invite user → /org-admin/users/new", async () => {
    listAnswers();
    const Page = (await import("../app/org-admin/users/page")).default;
    const html = await pageTree(Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/org-admin/users/new"');
    expect(html).toContain("Invite user");
  });
  for (const [label, caps] of [
    ["absent", {}],
    ["false", { user_invite: false }],
  ] as const) {
    it(`the users list hides Invite user when user_invite is ${label}`, async () => {
      capabilities = caps;
      listAnswers();
      const Page = (await import("../app/org-admin/users/page")).default;
      const html = await pageTree(Page({ searchParams: Promise.resolve({}) }));
      expect(html).not.toContain("/org-admin/users/new");
      expect(html).not.toContain("Invite user");
    });
    it(`/org-admin/users/new is not found when user_invite is ${label}`, async () => {
      capabilities = caps;
      const Page = (await import("../app/org-admin/users/new/page")).default;
      await expect(Page()).rejects.toThrow();
    });
    it(`/invite calls nothing when user_invite is ${label}`, async () => {
      capabilities = caps;
      const Page = (await import("../app/invite/page")).default;
      const html = await pageTree(Page({ searchParams: Promise.resolve({ token: TOKEN }) }));
      expect(html).toContain("not available on this installation");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(idpFetch).not.toHaveBeenCalled();
    });
  }
  it("re-issue is an action of a pending user only where user_invite is true", async () => {
    const { deriveOrgAdminUserActions } = await import(
      "../app/org-admin/users/[id]/user-detail-actions"
    );
    const pending = { ...pendingUser, active: true, deleted: false, mfa_enabled: false };
    expect(
      deriveOrgAdminUserActions(pending as never, 1, null, { userInvite: true }).actions
    ).toEqual(["reissue-invite"]);
    expect(deriveOrgAdminUserActions(pending as never, 1, null, {}).actions).toEqual([]);
    const active = { ...pending, invitation_pending: false, email_verified: true };
    expect(
      deriveOrgAdminUserActions(active as never, 1, null, { userInvite: true }).actions
    ).not.toContain("reissue-invite");
  });
});

describe("pending users read Invitation pending", () => {
  it("the list badge says Invitation pending and shows the real address", async () => {
    idpAnswers["GET /api/v1/users"] = { status: 200, body: { users: [pendingUser], total: 1 } };
    idpAnswers["GET /api/v1/organizations/current"] = { status: 200, body: { id: "org" } };
    const Page = (await import("../app/org-admin/users/page")).default;
    const html = await pageTree(Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Invitation pending");
    // OSS reports no invitation_email_bound: an invitee with a real address is
    // not a no-email manual invite.
    expect(html).toContain("newcomer@tenant-a.test");
    expect(html).not.toContain("No email — link not yet claimed");
  });
});

describe("invite and re-issue through the IdP", () => {
  it("invites with POST /api/v1/users {email, name, role} and no password", async () => {
    idpAnswers["POST /api/v1/users"] = {
      status: 201,
      body: { user: { ...pendingUser }, ...issued() },
    };
    const { inviteOrgUser } = await import("../lib/idp-admin-client");
    const out = await inviteOrgUser({
      email: "newcomer@tenant-a.test",
      name: "New Comer",
      role: "org_user",
    });
    const [url, init] = idpFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://idp.test/api/v1/users");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ email: "newcomer@tenant-a.test", name: "New Comer", role: "org_user" });
    expect("password" in body).toBe(false);
    expect(out).toEqual({
      ok: true,
      invite: {
        email: "newcomer@tenant-a.test",
        inviteToken: TOKEN,
        inviteUrl: `http://ui.test/invite?token=${TOKEN}`,
        inviteUrlUnavailable: null,
        expiresAt: "2026-09-29T10:00:00Z",
      },
    });
  });
  it("carries invite_url_unavailable when the IdP could not build a link", async () => {
    idpAnswers["POST /api/v1/users"] = {
      status: 201,
      body: {
        user: { ...pendingUser },
        invite_token: TOKEN,
        invite_url_unavailable: "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set",
        expires_at: "2026-09-29T10:00:00Z",
      },
    };
    const { inviteOrgUser } = await import("../lib/idp-admin-client");
    const out = await inviteOrgUser({ email: "x@tenant-a.test", name: "X", role: "org_user" });
    expect(out.ok && out.invite.inviteUrl).toBe(null);
    expect(out.ok && out.invite.inviteUrlUnavailable).toBe(
      "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set"
    );
  });
  it("re-issues with POST /api/v1/users/:id/invite", async () => {
    idpAnswers[`POST /api/v1/users/${USER_ID}/invite`] = {
      status: 200,
      body: { email: pendingUser.email, ...issued() },
    };
    const { reissueUserInvite } = await import("../lib/idp-admin-client");
    const out = await reissueUserInvite(USER_ID);
    expect(out.ok && out.invite.inviteToken).toBe(TOKEN);
  });
  it("a 409 user_not_pending is said plainly", async () => {
    idpAnswers[`POST /api/v1/users/${USER_ID}/invite`] = {
      status: 409,
      body: { error: "user_not_pending" },
    };
    const { reissueUserInvite } = await import("../lib/idp-admin-client");
    const out = await reissueUserInvite(USER_ID);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.status).toBe(409);
    expect(!out.ok && out.message).toMatch(/already accepted|no longer pending/i);
  });
  it("the invite action returns the invite once from the form", async () => {
    idpAnswers["POST /api/v1/users"] = {
      status: 201,
      body: { user: { ...pendingUser }, ...issued() },
    };
    const { inviteUserAction } = await import("../app/org-admin/users/actions");
    const f = new FormData();
    f.set("email", " Newcomer@Tenant-A.test ");
    f.set("name", "New Comer");
    f.set("role", "org_user");
    const state = await inviteUserAction({ phase: "form" }, f);
    expect(state.phase).toBe("issued");
    const sent = JSON.parse(
      (idpFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(sent.email).toBe("newcomer@tenant-a.test");
  });
  it("the invite action refuses a role outside org_user and org_admin", async () => {
    const { inviteUserAction } = await import("../app/org-admin/users/actions");
    const f = new FormData();
    f.set("email", "x@tenant-a.test");
    f.set("name", "X");
    f.set("role", "site_admin");
    const state = await inviteUserAction({ phase: "form" }, f);
    expect(state.phase).toBe("form");
    expect(idpFetch).not.toHaveBeenCalled();
  });
});

describe("the once-only invite panel", () => {
  it("shows the link with Copy, the raw token underneath and the expiry", async () => {
    const { InviteIssuedPanel } = await import("../components/shared/invite-issued-panel");
    const html = renderToStaticMarkup(
      <InviteIssuedPanel
        invite={{
          email: "newcomer@tenant-a.test",
          inviteToken: TOKEN,
          inviteUrl: `http://ui.test/invite?token=${TOKEN}`,
          inviteUrlUnavailable: null,
          expiresAt: "2026-09-29T10:00:00Z",
        }}
      />
    );
    expect(html).toContain(`value="http://ui.test/invite?token=${TOKEN}"`);
    expect(html).toContain("Copy");
    expect(html.indexOf(TOKEN, html.indexOf("value=") + 80)).toBeGreaterThan(0);
    expect(html).toContain('dateTime="2026-09-29T10:00:00.000Z"');
    expect(html).toMatch(/not be shown again/i);
  });
  it("shows the server's reason when there is no link, and still the token", async () => {
    const { InviteIssuedPanel } = await import("../components/shared/invite-issued-panel");
    const html = renderToStaticMarkup(
      <InviteIssuedPanel
        invite={{
          email: "x@tenant-a.test",
          inviteToken: TOKEN,
          inviteUrl: null,
          inviteUrlUnavailable: "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set",
          expiresAt: "2026-09-29T10:00:00Z",
        }}
      />
    );
    expect(html).toContain("IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set");
    expect(html).not.toContain("/invite?token=");
    expect(html).toContain(TOKEN);
  });
});

describe("the public /invite page", () => {
  const page = async (token: string) => {
    const Page = (await import("../app/invite/page")).default;
    return pageTree(Page({ searchParams: Promise.resolve({ token }) }));
  };
  const stubFetch = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
  it("validates on load and shows the email", async () => {
    stubFetch(200, { success: true, email: "newcomer@tenant-a.test" });
    const html = await page(TOKEN);
    expect(html).toContain("newcomer@tenant-a.test");
    expect(html).toContain('name="password"');
    expect(html).toMatch(/at least 8/i);
  });
  it("an invalid, expired or spent link reads one message", async () => {
    stubFetch(400, { error: "invalid_token" });
    const html = await page(TOKEN);
    expect(html).toContain("This invitation link is no longer valid");
    expect(html).not.toContain('name="password"');
  });
  it("a missing token reads the same message", async () => {
    const html = await page("");
    expect(html).toContain("This invitation link is no longer valid");
  });
  it("a 429 says to wait", async () => {
    stubFetch(429, {});
    const html = await page(TOKEN);
    expect(html).toContain("Too many attempts");
  });
  it("declares Referrer-Policy no-referrer (its URL carries the token)", async () => {
    const { metadata } = await import("../app/invite/page");
    expect(metadata.referrer).toBe("no-referrer");
  });
  it("redeems {token, password} and maps every answer", async () => {
    const { redeemInviteAction } = await import("../app/invite/actions");
    const f = () => {
      const d = new FormData();
      d.set("token", TOKEN);
      d.set("password", "A long enough password 1!");
      d.set("confirm", "A long enough password 1!");
      return d;
    };
    const post = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal("fetch", post);
    expect((await redeemInviteAction({ phase: "form" }, f())).phase).toBe("success");
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://idp.test/api/v1/auth/invite");
    expect(JSON.parse(init.body as string)).toEqual({
      token: TOKEN,
      password: "A long enough password 1!",
    });
    stubFetch(400, { error: "weak_password" });
    const weak = await redeemInviteAction({ phase: "form" }, f());
    expect(weak.phase).toBe("form");
    expect(weak.error).toMatch(/password/i);
    stubFetch(400, { error: "invalid_token" });
    expect((await redeemInviteAction({ phase: "form" }, f())).phase).toBe("invalid");
    stubFetch(429, {});
    const limited = await redeemInviteAction({ phase: "form" }, f());
    expect(limited.phase).toBe("form");
    expect(limited.error).toContain("Too many attempts");
  });
  it("success lands on /login with a notice", async () => {
    const Login = (await import("../app/login/page")).default;
    const html = await pageTree(
      Login({ searchParams: Promise.resolve({ notice: "invite_accepted" }) })
    );
    expect(html).toContain("Your password is set");
    const { INVITE_ACCEPTED_LOGIN } = await import("../app/invite/invite-copy");
    expect(INVITE_ACCEPTED_LOGIN).toBe("/login?notice=invite_accepted");
  });
});
