/**
 * Tests for the AG operator login layout fix.
 *
 * The /ag-admin/login page must render without the AG Governance sidebar.
 * Authenticated AG admin pages (under (authed) route group) render with sidebar.
 *
 * These tests verify structural invariants about the layout hierarchy:
 *   - ag-admin/layout.tsx no longer imports AgAdminNav or renders the sidebar
 *   - ag-admin/(authed)/layout.tsx renders the sidebar for authenticated routes
 *   - ag-admin/login/layout.tsx wraps the login page without sidebar
 *   - No secret-like fields or internal URLs are referenced in login layout
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");

function readLayout(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

describe("ag-admin root layout — no sidebar", () => {
  const layout = readLayout("src/app/ag-admin/layout.tsx");

  it("does not import AgAdminNav", () => {
    expect(layout).not.toContain("AgAdminNav");
  });

  it("does not render the sidebar aside element", () => {
    expect(layout).not.toContain("<aside");
  });

  it("does not render sidebar navigation items (Sign out, agent sessions, hitl)", () => {
    expect(layout.toLowerCase()).not.toContain("sign out");
    expect(layout.toLowerCase()).not.toContain("logout");
    expect(layout).not.toContain("agent-sessions");
    expect(layout).not.toContain("hitl");
  });

  it("does not expose internal backend URLs in rendered output", () => {
    for (const forbidden of ["internal_base_url", "management_base_url", "host.docker.internal"]) {
      expect(layout).not.toContain(forbidden);
    }
  });

  it("still contains the configuration guard (not_configured/not_enabled)", () => {
    expect(layout).toContain("not_configured");
    expect(layout).toContain("not_enabled");
    expect(layout).toContain("ag.enabled");
  });
});

describe("ag-admin login layout — standalone unauthenticated", () => {
  const layout = readLayout("src/app/ag-admin/login/layout.tsx");

  it("exists as a separate layout file", () => {
    expect(layout.length).toBeGreaterThan(0);
  });

  it("does not import AgAdminNav", () => {
    expect(layout).not.toContain("AgAdminNav");
  });

  it("does not render sidebar aside element", () => {
    expect(layout).not.toContain("<aside");
  });

  it("does not render AG Governance navigation links", () => {
    expect(layout).not.toContain("agent-sessions");
    expect(layout).not.toContain("hitl");
  });

  it("does not render Sign out", () => {
    expect(layout.toLowerCase()).not.toContain("sign out");
  });

  it("renders children", () => {
    expect(layout).toContain("children");
  });
});

describe("ag-admin login page — desktop split-panel layout", () => {
  const page = readLayout("src/app/ag-admin/login/page.tsx");

  it("uses flex row for desktop split-panel layout (lg:flex-row)", () => {
    expect(page).toContain("lg:flex-row");
  });

  it("has a hero/intro left panel hidden on mobile (hidden lg:flex)", () => {
    expect(page).toContain("hidden lg:flex");
  });

  it("hero panel contains AG Governance heading", () => {
    expect(page).toContain("AG");
    expect(page).toContain("Governance");
  });

  it("hero panel contains product feature bullets", () => {
    expect(page).toContain("Agent session oversight");
    expect(page).toContain("HITL review");
    expect(page).toContain("MCP governance");
  });

  it("login card uses wider max-w-[480px] not narrow max-w-sm", () => {
    expect(page).toContain("max-w-[480px]");
    expect(page).not.toContain("max-w-sm");
  });

  it("mobile header is hidden on desktop (lg:hidden)", () => {
    expect(page).toContain("lg:hidden");
  });

  it("provider login buttons still rendered (AgProviderSection)", () => {
    expect(page).toContain("AgProviderSection");
    expect(page).toContain("AgProviderButton");
  });

  it("operator sign-in form still rendered (AgAdminLoginForm)", () => {
    expect(page).toContain("AgAdminLoginForm");
  });

  it("provider href uses /api/ag-auth/login not raw AG URL", () => {
    expect(page).toContain("/api/ag-auth/login?idp=");
    expect(page).not.toContain("7214");
    expect(page).not.toContain("identity_base_url");
  });

  it("does not render Sign out or authenticated nav", () => {
    expect(page.toLowerCase()).not.toContain("sign out");
    expect(page).not.toContain("AgAdminNav");
    expect(page).not.toContain("<aside");
  });

  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "bearer", "client_secret", "host.docker.internal", "internal_base_url"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});

describe("ag-admin (authed) layout — sidebar present", () => {
  const layout = readLayout("src/app/ag-admin/(authed)/layout.tsx");

  it("imports AgAdminNav", () => {
    expect(layout).toContain("AgAdminNav");
  });

  it("renders the sidebar aside element", () => {
    expect(layout).toContain("<aside");
  });

  it("renders AG Governance heading", () => {
    expect(layout).toContain("AG Governance");
  });

  it("still contains session guard redirect to login", () => {
    expect(layout).toContain("hasAgSession");
    expect(layout).toContain('/ag-admin/login');
  });

  it("does not expose internal URLs or secret-like fields", () => {
    for (const forbidden of ["internal_base_url", "bearer", "password", "secret"]) {
      expect(layout).not.toContain(forbidden);
    }
  });
});

// ── Cookie name alignment ─────────────────────────────────────────────────────

describe("ag-client cookie name matches AG backend", () => {
  it("AG_COOKIE_NAME is ag_operator_session — matches AG OperatorSessionCookieName", async () => {
    const { AG_COOKIE_NAME } = await import("../lib/ag-client");
    expect(AG_COOKIE_NAME).toBe("ag_operator_session");
  });

  it("UI login route uses AG_COOKIE_NAME not a hardcoded name", () => {
    const loginRoute = readLayout("src/app/api/ag/login/route.ts");
    expect(loginRoute).toContain("AG_COOKIE_NAME");
    expect(loginRoute).not.toContain('"ag_access_token"');
  });

  it("UI logout route uses AG_COOKIE_NAME not a hardcoded name", () => {
    const logoutRoute = readLayout("src/app/api/ag/logout/route.ts");
    expect(logoutRoute).toContain("AG_COOKIE_NAME");
    expect(logoutRoute).not.toContain('"ag_access_token"');
  });

  it("AG authed layout uses hasAgSession which reads AG_COOKIE_NAME", () => {
    const layout = readLayout("src/app/ag-admin/(authed)/layout.tsx");
    expect(layout).toContain("hasAgSession");
    expect(layout).not.toContain('"ag_access_token"');
  });
});
