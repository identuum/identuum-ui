import { afterEach, describe, expect, it, vi } from "vitest";
import { inviteUserAction } from "@/app/org-admin/users/actions";
import { nextProxyFetch } from "../src/next-proxy";
import { ExportNotFound } from "../src/platform/next-navigation";
import {
  everyApiCallThroughTheBoundary,
  installExport,
  OSS_COMPONENT,
  type Routes,
} from "./harness";

// OSS-ONBOARD-B (D-016): the user invite as the static export serves it —
// /org-admin/users/new and the public /invite are routed to the SAME page and
// action modules as Next, gated on capabilities.user_invite.

afterEach(() => vi.unstubAllGlobals());

const TOKEN = "a".repeat(64);
const WITH_INVITE: Routes = {
  "GET /api/v1/component": {
    json: { ...OSS_COMPONENT, capabilities: { ...OSS_COMPONENT.capabilities, user_invite: true } },
  },
};

async function render(path: string, routes: Routes = {}) {
  const env = installExport(path, routes);
  vi.stubGlobal("fetch", nextProxyFetch(globalThis.fetch));
  return { ...(await env.render()), env };
}

describe("/invite in the export", () => {
  it("validates the token on load and shows the invited email", async () => {
    const { html, env } = await render(`/invite?token=${TOKEN}`, {
      ...WITH_INVITE,
      [`GET /api/v1/auth/invite/${TOKEN}`]: {
        json: { success: true, email: "newcomer@tenant-a.test" },
      },
    });
    expect(html).toContain("newcomer@tenant-a.test");
    expect(html).toContain('name="password"');
    expect(env.calls.some((c) => c.path === `/api/v1/auth/invite/${TOKEN}`)).toBe(true);
  });
  it("calls no invite route where the binary reports no user_invite", async () => {
    const { html, env } = await render(`/invite?token=${TOKEN}`);
    expect(html).toContain("not available on this installation");
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/auth/invite"))).toBe(false);
  });
});

describe("/org-admin/users/new in the export", () => {
  it("renders the invite form where user_invite is true", async () => {
    const { html } = await render("/org-admin/users/new", WITH_INVITE);
    expect(html).toContain('id="invite-email"');
    expect(html).toContain('name="role"');
  });
  it("is not found where user_invite is absent", async () => {
    await expect(render("/org-admin/users/new")).rejects.toBeInstanceOf(ExportNotFound);
  });
  it("invites through the boundary with the proof header", async () => {
    const env = installExport("/org-admin/users/new", {
      ...WITH_INVITE,
      "POST /api/v1/users": {
        status: 201,
        json: {
          user: { id: "u1", email: "newcomer@tenant-a.test" },
          invite_token: TOKEN,
          invite_url: `http://idp.test/invite?token=${TOKEN}`,
          expires_at: "2026-09-29T10:00:00Z",
        },
      },
    });
    const f = new FormData();
    f.set("email", "newcomer@tenant-a.test");
    f.set("name", "New Comer");
    f.set("role", "org_user");
    const state = await inviteUserAction({ phase: "form" }, f);
    expect(state.phase).toBe("issued");
    const post = env.calls.find((c) => c.method === "POST" && c.path === "/api/v1/users");
    expect(post?.body).toEqual({
      email: "newcomer@tenant-a.test",
      name: "New Comer",
      role: "org_user",
    });
    expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
  });
});

describe("/login in the export", () => {
  it("shows the invite_accepted notice", async () => {
    const { html } = await render("/login?notice=invite_accepted");
    expect(html).toContain("Your password is set");
  });
});
