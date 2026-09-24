import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveServerTree } from "../src/area-routes";
import { ExportRedirect } from "../src/platform/next-navigation";
import { isServerRoute } from "../src/server-routes";
import { installExport, session } from "./harness";
import { siteAnswers, sitePage } from "./recorded";

// PLAN-D-3: the shared site-admin layout as the static export renders it —
// the same module as Next, its guard running before any page data, and the
// async server components it nests (PlatformLicenseWarnings) resolved before
// the browser renders the tree.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("site-admin layout guard in the export", () => {
  it("an unauthenticated verdict redirects to /login?reason=session_expired before any page data", async () => {
    const env = installExport("/site-admin/organizations", {
      ...siteAnswers,
      "GET /api/v1/validate": { status: 401, json: { reason: "token_expired" } },
    });
    const { redirectedTo } = await env.render();
    expect(redirectedTo).toBe("/login?reason=session_expired");
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/organizations"))).toBe(false);
  });

  it("an unavailable IdP renders in place and never redirects to /login", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const env = installExport("/site-admin/organizations", {
      "GET /api/v1/validate": { status: 503, json: {}, headers: { "X-Request-ID": "cid-sa-503" } },
    });
    const pending = env.render();
    await vi.advanceTimersByTimeAsync(8100);
    const { html, redirectedTo } = await pending;
    expect(html).toContain('data-testid="service-unavailable"');
    expect(html).toContain("cid-sa-503");
    expect(redirectedTo).toBeNull();
  });

  it.each([
    ["org_admin", "/org-admin"],
    ["org_user", "/dashboard"],
  ])("a %s is sent to its own home, never shown site administration", async (role, home) => {
    const env = installExport("/site-admin/organizations", {
      ...siteAnswers,
      "GET /api/v1/validate": { json: session(role) },
    });
    expect((await env.render()).redirectedTo).toBe(home);
    expect(env.calls.some((c) => c.path.startsWith("/api/v1/organizations"))).toBe(false);
  });

  it("the site administrator gets the shared shell around the page", async () => {
    const { html, redirectedTo } = await sitePage("/site-admin/organizations");
    expect(redirectedTo).toBeNull();
    expect(html).toContain('href="/site-admin/organizations"');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toMatch(/<h1[^>]*>Organizations<\/h1>/);
  });
});

describe("site-admin routes in the export", () => {
  it("routes every site-admin page through the shared tree, the overview included", () => {
    expect(isServerRoute("/site-admin/organizations")).toBe(true);
    expect(isServerRoute("/site-admin/system/info")).toBe(true);
    // PLAN-D-4: the binary serves GET /api/status and GET /api/runtime-config,
    // the two UI routes the overview reads.
    expect(isServerRoute("/site-admin")).toBe(true);
  });

  it("settings is routed: it probes the binary's own /healthz, a health route and not the shell", async () => {
    const { html, env } = await sitePage("/site-admin/settings", {
      "GET /healthz": { json: { status: "healthy", mode: "oss", tier: "starter" } },
    });
    expect(html).not.toContain('data-testid="not-found"');
    expect(env.calls.find((c) => c.path === "/healthz")).toMatchObject({ viaBff: false });
  });
});

describe("resolveServerTree", () => {
  it("awaits a nested async component with its props and keeps client components as elements", async () => {
    async function AsyncBadge({ label }: { label: string }) {
      await Promise.resolve();
      return <em data-testid="badge">{label}</em>;
    }
    function Plain({ children }: { children: ReactNode }) {
      return <section data-testid="plain">{children}</section>;
    }
    const tree = (
      <div>
        <Plain>
          <AsyncBadge label="resolved" />
        </Plain>
      </div>
    );
    const html = renderToStaticMarkup(<>{await resolveServerTree(tree)}</>);
    expect(html).toContain('<section data-testid="plain"><em data-testid="badge">resolved</em>');
  });

  it("a redirect thrown by a nested async component propagates", async () => {
    async function Guarded(): Promise<ReactNode> {
      throw new ExportRedirect("/login?reason=session_expired");
    }
    await expect(resolveServerTree(<div>{createElement(Guarded)}</div>)).rejects.toBeInstanceOf(
      ExportRedirect
    );
  });
});
