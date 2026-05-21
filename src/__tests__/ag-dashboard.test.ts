/**
 * Tests for the AG operator dashboard page.
 *
 * All tests are static source-inspection tests (no runtime needed).
 * They verify the page's data-fetching strategy, rendering safety,
 * and structural requirements.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/page.tsx");

describe("AG dashboard — summary counts", () => {
  it("fetches active session count with status=active and page_size=1", () => {
    expect(page).toContain("status=active");
    expect(page).toContain("page_size=1");
  });

  it("fetches expired session count with status=expired", () => {
    expect(page).toContain("status=expired");
  });

  it("fetches revoked session count with status=revoked", () => {
    expect(page).toContain("status=revoked");
  });

  it("fetches agent count from /admin/agent-registry", () => {
    expect(page).toContain("/admin/agent-registry");
    expect(page).toContain("agentCount");
  });

  it("derives total sessions from active + expired + revoked", () => {
    expect(page).toContain("totalSessions");
    expect(page).toContain("activeCount + expiredCount + revokedCount");
  });

  it("uses pagination.total_items for counts", () => {
    expect(page).toContain("total_items");
    expect(page).toContain("totalItems");
  });

  it("renders summary stat cards with session/agent counts", () => {
    expect(page).toContain("StatCard");
    expect(page).toContain("Total agents");
    expect(page).toContain("Total sessions");
    expect(page).toContain("Active");
    expect(page).toContain("Expired");
    expect(page).toContain("Revoked");
  });
});

describe("AG dashboard — recent sessions panel", () => {
  it("fetches recent sessions with page_size=10 and sort=last_activity_at", () => {
    expect(page).toContain("page_size=10");
    expect(page).toContain("sort=last_activity_at");
    expect(page).toContain("dir=desc");
    expect(page).toContain("status=all");
  });

  it("Recent sessions panel has View all link to /ag-admin/sessions", () => {
    expect(page).toContain("View all sessions →");
    expect(page).toContain("/ag-admin/sessions");
  });

  it("renders recent sessions section", () => {
    expect(page).toContain("Recent sessions");
    expect(page).toContain("DashSessionRow");
  });

  it("session row uses intent as primary text", () => {
    expect(page).toContain("s.intent ||");
    expect(page).toContain("Untitled session");
  });

  it("session row has Details link to /ag-admin/sessions/:id", () => {
    expect(page).toContain("/ag-admin/sessions/${s.id}");
    expect(page).toContain("Details →");
  });

  it("session row shows status badge", () => {
    expect(page).toContain("SESSION_STATUS_STYLES");
    expect(page).toContain("sessionStatus");
  });

  it("session row shows agent_mode badge", () => {
    expect(page).toContain("s.agent_mode");
  });

  it("session row shows last_activity_at timestamp", () => {
    expect(page).toContain("s.last_activity_at");
  });

  it("session ID is secondary technical metadata", () => {
    expect(page).toContain("s.id.slice(0, 12)");
  });

  it("long intent preview is clamped safely", () => {
    expect(page).toContain("line-clamp-1");
  });

  it("renders empty state when no sessions", () => {
    expect(page).toContain("No sessions recorded yet.");
  });

  it("renders unavailable state when sessions panel fails", () => {
    expect(page).toContain("Recent sessions unavailable.");
  });

  it("has View all sessions link", () => {
    expect(page).toContain("View all sessions →");
    expect(page).toContain("/ag-admin/sessions");
  });
});

describe("AG dashboard — agents panel", () => {
  it("fetches recent agents with page_size=10 and sort=updated_at", () => {
    expect(page).toContain("page_size=10");
    expect(page).toContain("sort=updated_at");
  });

  it("Agent registry panel has View all link to /ag-admin/agents", () => {
    expect(page).toContain("View all agents →");
    expect(page).toContain("/ag-admin/agents");
  });

  it("renders agent registry section", () => {
    expect(page).toContain("Agent registry");
    expect(page).toContain("DashAgentRow");
  });

  it("agent row shows name as primary display", () => {
    expect(page).toContain("a.name");
  });

  it("agent row shows Agent key (slug) as secondary when different from name", () => {
    expect(page).toContain("Agent key:");
    expect(page).toContain("a.slug");
  });

  it("agent row has Details link to /ag-admin/agents/:id", () => {
    expect(page).toContain("/ag-admin/agents/${a.id}");
    expect(page).toContain("Details →");
  });

  it("agent row shows enabled/disabled badge", () => {
    expect(page).toContain("a.enabled");
    expect(page).toContain("enabled");
    expect(page).toContain("disabled");
  });

  it("renders empty state when no agents", () => {
    expect(page).toContain("No agents registered yet.");
  });

  it("renders unavailable state when agents panel fails", () => {
    expect(page).toContain("Agent registry unavailable.");
  });

  it("has View all agents link", () => {
    expect(page).toContain("View all agents →");
    expect(page).toContain("/ag-admin/agents");
  });
});

describe("AG dashboard — data strategy", () => {
  it("all fetches run in parallel via Promise.all", () => {
    expect(page).toContain("Promise.all");
  });

  it("redirects to login on auth error from any call", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("individual panel failures degrade gracefully", () => {
    expect(page).toContain('"unavailable"');
  });

  it("does not expose cookies, tokens, or internal URLs in rendered HTML", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("bearer token handled server-side only by agRequest", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
    expect(page).not.toContain("localStorage");
  });

  it("AG health check uses server-side fetch, not agRequest (no auth needed)", () => {
    expect(page).toContain("checkAgHealth");
    expect(page).toContain("fetch(");
  });
});

describe("AG dashboard — quick links", () => {
  it("has quick link to all agents", () => {
    expect(page).toContain("All agents");
    expect(page).toContain("/ag-admin/agents");
  });

  it("has quick link to active sessions", () => {
    expect(page).toContain("Active sessions");
    expect(page).toContain("status=active");
  });

  it("has quick link to revoked sessions", () => {
    expect(page).toContain("Revoked sessions");
    expect(page).toContain("status=revoked");
  });
});

describe("AG dashboard — existing governance nav cards", () => {
  it("still has HITL governance card", () => {
    expect(page).toContain("HITL");
    expect(page).toContain("/ag-admin/hitl");
  });

  it("still has MCP Server governance card", () => {
    expect(page).toContain("MCP Server");
    expect(page).toContain("/ag-admin/mcp");
  });
});

describe("AG dashboard — panel order", () => {
  it("governance surfaces section appears before Recent sessions and Agent registry panels", () => {
    const governanceIdx = page.indexOf("Governance surfaces");
    const recentSessionsIdx = page.indexOf("Recent sessions");
    const agentRegistryIdx = page.indexOf("Agent registry");
    expect(governanceIdx).toBeGreaterThan(-1);
    expect(recentSessionsIdx).toBeGreaterThan(-1);
    expect(agentRegistryIdx).toBeGreaterThan(-1);
    // Governance surfaces must come before the list panels
    expect(governanceIdx).toBeLessThan(recentSessionsIdx);
    expect(governanceIdx).toBeLessThan(agentRegistryIdx);
  });

  it("System status section appears before Recent sessions and Agent registry panels", () => {
    const statusIdx = page.indexOf("System status");
    const recentSessionsIdx = page.indexOf("Recent sessions");
    expect(statusIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(recentSessionsIdx);
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
