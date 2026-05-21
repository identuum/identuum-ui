/**
 * Tests for the HITL / CBAA page.
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

const page = readFile("src/app/ag-admin/(authed)/hitl/page.tsx");

describe("HITL / CBAA page — structure", () => {
  it("page title is 'HITL / CBAA'", () => {
    expect(page).toContain("HITL / CBAA");
  });

  it("page metadata title set correctly", () => {
    expect(page).toContain("HITL / CBAA — Identuum AG");
  });

  it("is force-dynamic (not statically rendered)", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("explains HITL in operator-friendly language", () => {
    expect(page).toContain("Human-in-the-Loop");
    expect(page).toContain("HITL");
  });

  it("explains CBAA in operator-friendly language", () => {
    expect(page).toContain("CBAA");
    expect(page).toContain("Capability-Bound Agent Approval");
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });
});

describe("HITL / CBAA page — backend API usage", () => {
  it("fetches from /admin/hitl/queue", () => {
    expect(page).toContain("/admin/hitl/queue");
  });

  it("uses agRequest server-side (no token in browser)", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
  });

  it("parses backend held_requests wrapper object", () => {
    expect(page).toContain("held_requests");
    expect(page).toContain("Array.isArray");
  });

  it("uses the backend count field", () => {
    expect(page).toContain("count");
    expect(page).toContain("QueueResult");
  });

  it("request_payload is NOT mapped or rendered", () => {
    // request_payload must never appear as rendered JSX
    expect(page).not.toContain("{r.request_payload}");
    expect(page).not.toContain("request_payload:");
    expect(page).toContain("request_payload intentionally");
  });
});

describe("HITL / CBAA page — queue rendering", () => {
  it("renders summary count cards", () => {
    expect(page).toContain("CountCard");
    expect(page).toContain("Pending review");
    expect(page).toContain("Approved");
    expect(page).toContain("Denied");
    expect(page).toContain("Expired");
  });

  it("queue rows show gate_state badge", () => {
    expect(page).toContain("GATE_STATE_STYLES");
    expect(page).toContain("item.gate_state");
  });

  it("queue rows link to associated agent session detail", () => {
    expect(page).toContain("/ag-admin/sessions/${item.agent_session_id}");
    expect(page).toContain("Session →");
  });

  it("session ID shown as secondary technical metadata", () => {
    expect(page).toContain("item.agent_session_id.slice(0, 12)");
  });

  it("intervention ID shown as secondary technical metadata", () => {
    expect(page).toContain("item.id.slice(0, 12)");
  });

  it("shows pending_since and expires_at timestamps", () => {
    expect(page).toContain("item.pending_since");
    expect(page).toContain("item.expires_at");
  });

  it("separates pending items from decided/expired items", () => {
    expect(page).toContain("Pending review");
    expect(page).toContain("Decided / expired");
    expect(page).toContain('gate_state === "pending"');
  });
});

describe("HITL / CBAA page — fallback states", () => {
  it("renders safe unavailable state when queue fetch fails", () => {
    expect(page).toContain("UnavailableState");
    expect(page).toContain("HITL / CBAA backend unavailable");
  });

  it("renders empty state when no items in queue", () => {
    expect(page).toContain("EmptyState");
    expect(page).toContain("No HITL / CBAA review items found");
  });

  it("quick links to sessions, agents, and dashboard are always rendered", () => {
    expect(page).toContain("Agent Sessions");
    expect(page).toContain("Agent Registry");
    expect(page).toContain("Dashboard");
    expect(page).toContain("/ag-admin/sessions");
    expect(page).toContain("/ag-admin/agents");
    expect(page).toContain('href="/ag-admin"');
  });
});

describe("HITL / CBAA page — security", () => {
  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("approve/deny actions acknowledged but not wired", () => {
    expect(page).toContain("Approve / Deny actions are not yet wired");
    expect(page).toContain("/admin/hitl/:id/approve");
    expect(page).toContain("/admin/hitl/:id/deny");
  });

  it("mentions ACR requirement for approve/deny", () => {
    expect(page).toContain("ACR");
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
