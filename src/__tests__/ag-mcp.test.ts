/**
 * Tests for the AG MCP Server page.
 *
 * Static source-inspection tests — verify data-fetching strategy,
 * rendering safety, and structural requirements.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/mcp/page.tsx");

describe("MCP Server page — structure", () => {
  it("page title is 'MCP Server'", () => {
    expect(page).toContain("MCP Server");
  });

  it("page metadata title set correctly", () => {
    expect(page).toContain("MCP Server — Identuum AG");
  });

  it("is force-dynamic (not statically rendered)", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("explains MCP in operator-friendly language", () => {
    expect(page).toContain("MCP");
    expect(page).toContain("natural-language");
    expect(page).toContain("agent governance");
  });

  it("explains that MCP activity appears as agent sessions", () => {
    expect(page).toContain("agent sessions");
    expect(page).toContain("agent policy");
  });
});

describe("MCP Server page — backend API", () => {
  it("fetches from /admin/mcp/status endpoint", () => {
    expect(page).toContain("/admin/mcp/status");
  });

  it("uses agRequest server-side (no token in browser)", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
    expect(page).not.toContain("localStorage");
  });

  it("renders available flag from backend", () => {
    expect(page).toContain("status.available");
    expect(page).toContain("Available");
    expect(page).toContain("Not licensed");
  });

  it("renders management path from backend", () => {
    expect(page).toContain("status.path");
    expect(page).toContain("Management path");
  });

  it("renders tool_categories from backend", () => {
    expect(page).toContain("tool_categories");
    expect(page).toContain("ToolCategoriesCard");
    expect(page).toContain("CATEGORY_LABELS");
  });

  it("shows Enterprise license note when not available", () => {
    expect(page).toContain("Enterprise license");
  });

  it("does NOT call the /mcp transport endpoint", () => {
    // /mcp is a streaming MCP transport, not a REST endpoint
    expect(page).not.toContain('agRequest("/mcp")');
    expect(page).not.toContain("agRequest(`/mcp`");
  });

  it("explains the /mcp transport endpoint is for MCP clients, not the browser", () => {
    expect(page).toContain("TransportNote");
    expect(page).toContain("MCP-compatible client");
    expect(page).toContain("Streamable HTTP transport");
  });
});

describe("MCP Server page — tool categories", () => {
  it("maps agent_registry category to human-readable label", () => {
    expect(page).toContain("agent_registry");
    expect(page).toContain("Agent Registry");
  });

  it("maps agent_sessions category to human-readable label", () => {
    expect(page).toContain("agent_sessions");
    expect(page).toContain("Agent Sessions");
  });

  it("maps hitl_queue category to human-readable label", () => {
    expect(page).toContain("hitl_queue");
    expect(page).toContain("HITL");
  });
});

describe("MCP Server page — fallback states", () => {
  it("renders safe unavailable state when status fetch fails", () => {
    expect(page).toContain("UnavailableState");
    expect(page).toContain("MCP Server status unavailable");
  });

  it("unavailable state includes links to sessions, agents, hitl, dashboard", () => {
    const unavailableStart = page.indexOf("function UnavailableState");
    const snippet = page.slice(unavailableStart, unavailableStart + 1000);
    expect(snippet).toContain("/ag-admin/sessions");
    expect(snippet).toContain("/ag-admin/agents");
    expect(snippet).toContain("/ag-admin/hitl");
    expect(snippet).toContain("/ag-admin");
  });
});

describe("MCP Server page — quick links", () => {
  it("has quick link to Agent Sessions", () => {
    expect(page).toContain("Agent Sessions");
    expect(page).toContain("/ag-admin/sessions");
  });

  it("has quick link to Agent Registry", () => {
    expect(page).toContain("Agent Registry");
    expect(page).toContain("/ag-admin/agents");
  });

  it("has quick link to HITL / CBAA", () => {
    expect(page).toContain("HITL / CBAA");
    expect(page).toContain("/ag-admin/hitl");
  });

  it("has quick link to Dashboard", () => {
    expect(page).toContain("Dashboard");
    expect(page).toContain('href="/ag-admin"');
  });
});

describe("MCP Server page — security", () => {
  it("does not expose cookies, tokens, or internal URLs in rendered HTML", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("bearer token handled server-side only by agRequest", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
    expect(page).not.toContain("Authorization:");
  });
});

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
    expect(loginLayout.toLowerCase()).not.toContain("sign out");
  });
});
