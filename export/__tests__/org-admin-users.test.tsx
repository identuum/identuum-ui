import { afterEach, describe, expect, it, vi } from "vitest";
import { setUserActiveAction } from "@/app/org-admin/users/actions";
import { useLocation } from "../src/router";
import {
  ADMIN_ID,
  everyApiCallThroughTheBoundary,
  installExport,
  ORG_ID,
  session,
} from "./harness";
import { answers } from "./recorded";

// Plan D: the shared org-admin layout, overview, users list and user detail
// as the static export renders them — same modules as Next, data through the
// Go boundary. The Next-side behaviour of these pages is covered by the
// existing suites under src/__tests__; these prove the export keeps it.

const OTHER_ID = "01990000-0000-7000-8000-000000000002";
const user = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  email,
  role: "org_user",
  active: true,
  created_at: "2026-09-01T00:00:00Z",
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("org-admin layout guard in the export", () => {
  it("an unauthenticated verdict redirects to /login?reason=session_expired", async () => {
    const env = installExport("/org-admin/users", {
      "GET /api/v1/validate": { status: 401, json: { reason: "token_expired" } },
    });
    const { redirectedTo } = await env.render();
    expect(redirectedTo).toBe("/login?reason=session_expired");
    expect(env.location.pathname).toBe("/login");
    // The guard ran first: no page data was requested.
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/users"))).toBe(false);
  });

  it("an unavailable IdP renders in place and never redirects to /login", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const env = installExport("/org-admin/users", {
      "GET /api/v1/validate": { status: 503, json: {}, headers: { "X-Request-ID": "cid-503" } },
    });
    const pending = env.render();
    await vi.advanceTimersByTimeAsync(8100);
    const { html, redirectedTo } = await pending;
    expect(html).toContain('data-testid="service-unavailable"');
    expect(html).toContain("cid-503");
    expect(redirectedTo === null || redirectedTo.startsWith("/unavailable")).toBe(true);
    expect(env.location.pathname).not.toBe("/login");
  });

  it("a site_admin is sent to its own home, never shown tenant administration", async () => {
    const env = installExport("/org-admin/users", {
      "GET /api/v1/validate": { json: session("site_admin") },
    });
    expect((await env.render()).redirectedTo).toBe("/site-admin");
  });

  it("an org_admin without MFA is sent to enrol first", async () => {
    const env = installExport("/org-admin", {
      "GET /api/v1/validate": { json: session("org_admin", { mfa_enabled: false }) },
    });
    expect((await env.render()).redirectedTo).toBe("/account/settings?reason=mfa_required");
  });
});

describe("overview, users list and user detail in the export", () => {
  it("the overview shows the signed-in identity and the section links", async () => {
    const env = installExport("/org-admin");
    const { html } = await env.render();
    expect(html).toContain('data-testid="home"');
    expect(html).toContain("admin@tenant-a.test");
    expect(html).toContain(ORG_ID);
    expect(html).toContain('href="/org-admin/users"');
  });

  it("the users list reads page 1 through the boundary and links each user", async () => {
    const env = installExport("/org-admin/users", {
      "GET /api/v1/users": {
        json: {
          users: [
            user(ADMIN_ID, "admin@tenant-a.test", { role: "org_admin" }),
            user(OTHER_ID, "member@tenant-a.test"),
          ],
          total: 2,
        },
      },
    });
    const { html } = await env.render();
    expect(html).toContain('data-testid="user-list"');
    expect(html).toContain(`href="/org-admin/users/${OTHER_ID}"`);
    expect(html).toContain("member@tenant-a.test");
    expect(env.calls.map((c) => c.path)).toContain("/api/v1/users?page=1&page_size=200");
    expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
  });

  it("a users-list outage is an error state, never an empty list", async () => {
    const env = installExport("/org-admin/users", {
      "GET /api/v1/users": { status: 503, json: {} },
    });
    const { html } = await env.render();
    expect(html).toContain('data-testid="users-unavailable"');
    expect(html).not.toContain('data-testid="user-list"');
  });

  it("a user detail renders the record for its id", async () => {
    const env = installExport(`/org-admin/users/${OTHER_ID}`, {
      [`GET /api/v1/users/${OTHER_ID}`]: { json: user(OTHER_ID, "member@tenant-a.test") },
      "GET /api/v1/users": { json: { users: [], total: 0 } },
    });
    const { html } = await env.render();
    expect(html).toContain(`data-testid="user-detail" data-id="${OTHER_ID}"`);
    expect(html).toMatch(/data-testid="user-email"[^>]*>member@tenant-a\.test/);
  });

  it.each([403, 404])("a %s (other tenant or missing) is the not-found panel", async (status) => {
    const env = installExport(`/org-admin/users/${OTHER_ID}`, {
      [`GET /api/v1/users/${OTHER_ID}`]: { status, json: {} },
    });
    const { html } = await env.render();
    expect(html).toContain('data-testid="user-not-found"');
    expect(html).not.toContain('data-testid="user-detail"');
  });

  it("a user-detail outage is unavailable, not missing", async () => {
    const env = installExport(`/org-admin/users/${OTHER_ID}`, {
      [`GET /api/v1/users/${OTHER_ID}`]: { status: 503, json: {} },
    });
    const { html } = await env.render();
    expect(html).toContain('data-testid="user-unavailable"');
    expect(html).not.toContain('data-testid="user-not-found"');
  });

  it("a non-UUID id is not found before any user request", async () => {
    const env = installExport("/org-admin/users/not-a-uuid");
    const { html } = await env.render();
    expect(html).toContain('data-testid="user-not-found"');
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/users/"))).toBe(false);
  });
});

describe("a users-area mutation in the export", () => {
  it("disabling a user validates first, PUTs through the boundary, and revalidates the page", async () => {
    const env = installExport("/org-admin/users", {
      [`PUT /api/v1/users/${OTHER_ID}`]: { json: user(OTHER_ID, "member@tenant-a.test") },
    });
    let revalidation = -1;
    const probe = () => {
      revalidation = useLocation().revalidation;
      return null;
    };
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    renderToStaticMarkup(createElement(probe));
    const before = revalidation;

    const form = new FormData();
    form.set("userId", OTHER_ID);
    form.set("active", "false");
    const result = await setUserActiveAction({ phase: "idle" }, form);

    expect(result).toEqual({ phase: "idle" });
    const put = env.calls.find((c) => c.method === "PUT");
    expect(put).toMatchObject({ path: `/api/v1/users/${OTHER_ID}`, viaBff: true, proof: true });
    expect(put?.body).toMatchObject({ active: false });
    // The mutation was preceded by a validation (renewal before submission).
    const putIndex = env.calls.indexOf(put as (typeof env.calls)[number]);
    expect(env.calls.slice(0, putIndex).some((c) => c.path === "/api/v1/validate")).toBe(true);
    renderToStaticMarkup(createElement(probe));
    expect(revalidation).toBeGreaterThan(before);
  });

  it("a refused mutation keeps the server's message and does not revalidate as success", async () => {
    const env = installExport("/org-admin/users", {
      [`PUT /api/v1/users/${OTHER_ID}`]: { status: 403, json: { error: "forbidden" } },
    });
    const form = new FormData();
    form.set("userId", OTHER_ID);
    form.set("active", "false");
    const result = await setUserActiveAction({ phase: "idle" }, form);
    expect(result.phase).toBe("error");
    expect(result.userId).toBe(OTHER_ID);
    expect(env.calls.some((c) => c.method === "PUT" && c.viaBff && c.proof)).toBe(true);
  });
});

// v0.2.3 (F3): a disabled member is Disabled with Enable unless the
// organization takes public registrations AND holds them for approval, where
// the row is "Disabled or awaiting approval". The export renders the same
// page modules, so it must show the same; the policy comes from
// GET /api/v1/organizations/current through the boundary.
describe("a disabled member in the export (F3)", () => {
  const recordedOrg = answers["GET /api/v1/organizations/current"] as {
    json: Record<string, unknown>;
  };
  const orgWith = (allow: boolean, approval: boolean) => ({
    json: {
      ...recordedOrg.json,
      allow_public_registration: allow,
      require_registration_approval: approval,
    },
  });
  const disabled = user(OTHER_ID, "member@tenant-a.test", { active: false, banned: true });

  it.each([
    ["invite-only", "Disabled", false, false],
    ["public-with-approval", "Disabled or awaiting approval", true, true],
  ])(
    "the users list under %s labels the row %s and offers Enable",
    async (_name, label, allow, approval) => {
      const env = installExport("/org-admin/users", {
        "GET /api/v1/organizations/current": orgWith(allow, approval),
        "GET /api/v1/users": {
          json: {
            users: [user(ADMIN_ID, "admin@tenant-a.test", { role: "org_admin" }), disabled],
            total: 2,
          },
        },
      });
      const { html } = await env.render();
      const row = html.slice(html.indexOf("member@tenant-a.test"));
      const rowEnd = row.indexOf("</tr>");
      const rowHtml = row.slice(0, rowEnd);
      expect(rowHtml).toContain(`>${label}</span>`);
      expect(rowHtml).toMatch(/>Enable<\/button>/);
      expect(rowHtml).not.toContain(">Pending approval</span>");
      expect(env.calls.map((c) => c.path)).toContain("/api/v1/organizations/current");
      expect(everyApiCallThroughTheBoundary(env.calls)).toBe(true);
    }
  );

  it("the user detail under invite-only offers Restore access and no Approve registration", async () => {
    const env = installExport(`/org-admin/users/${OTHER_ID}`, {
      "GET /api/v1/organizations/current": orgWith(false, false),
      [`GET /api/v1/users/${OTHER_ID}`]: { json: disabled },
      "GET /api/v1/users": { json: { users: [], total: 0 } },
    });
    const { html } = await env.render();
    expect(html).toContain("Restore access");
    expect(html).toMatch(/>Enable<\/button>/);
    expect(html).not.toContain("Approve registration");
    expect(html).not.toContain("Disabled or awaiting approval");
  });

  it("the user detail under public-with-approval offers both Enable and Approve registration", async () => {
    const env = installExport(`/org-admin/users/${OTHER_ID}`, {
      "GET /api/v1/organizations/current": orgWith(true, true),
      [`GET /api/v1/users/${OTHER_ID}`]: { json: disabled },
      "GET /api/v1/users": { json: { users: [], total: 0 } },
    });
    const { html } = await env.render();
    expect(html).toContain("Disabled or awaiting approval");
    expect(html).toContain("Restore access");
    expect(html).toMatch(/>Enable<\/button>/);
    expect(html).toContain("Approve registration");
  });
});
