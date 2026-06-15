/**
 * Tests for AG list clickability and detail pages.
 *
 * Covers:
 *   - Agent list rows have clickable Details links to /ag-admin/agents/:id
 *   - Session list rows have clickable Details links to /ag-admin/sessions/:id
 *   - Agent detail page renders safe fields, handles not-found, no secrets
 *   - Session detail page renders safe fields, handles not-found, no secrets
 *   - Human-readable identity: intent as primary title, UUIDs as secondary
 *   - Agent name/slug lookup via /admin/agent-registry/:id in session detail
 *   - Login page remains sidebar-free
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

// ── Agent list — clickability ──────────────────────────────────────────────

describe("agents list — clickable rows", () => {
  const page = readFile("src/app/ag-admin/(authed)/agents/page.tsx");

  it("each agent row has a Details link to /ag-admin/agents/:id", () => {
    expect(page).toContain("/ag-admin/agents/${agent.id}");
    expect(page).toContain("Details →");
  });

  it("agent key/slug is rendered as a clickable link", () => {
    expect(page).toContain("href={`/ag-admin/agents/${agent.id}`}");
  });

  it("column header says 'Agent key' not bare 'Slug'", () => {
    expect(page).toContain("Agent key");
    expect(page).not.toContain(">Slug ");
    expect(page).not.toContain(">Slug<");
  });

  it("search placeholder says 'agent key' not 'slug'", () => {
    expect(page).toContain("agent key");
    expect(page).not.toContain('placeholder="Search by slug');
  });

  it("sort still uses slug as the backend API field (not renamed)", () => {
    expect(page).toContain('sortUrl("slug")');
    expect(page).toContain('"slug"');
  });

  it("Details link has aria-label for accessibility", () => {
    expect(page).toContain("aria-label");
  });

  it("pagination controls still present", () => {
    expect(page).toContain("PaginationBar");
    expect(page).toContain("prevUrl");
    expect(page).toContain("nextUrl");
  });

  it("search/sort controls still present", () => {
    expect(page).toContain('type="search"');
    expect(page).toContain("BACKEND_SORT_FIELDS");
  });
});

// ── Session list — clickability, human-readable identity, and agent filter ────

describe("sessions list — intent safety and fallback", () => {
  const page = readFile("src/app/ag-admin/(authed)/sessions/page.tsx");

  it("empty intent gets 'Untitled session' fallback in list rows", () => {
    expect(page).toContain('"Untitled session"');
    expect(page).not.toContain("`Session ${s.id.slice(0, 8)}");
  });

  it("list row intent uses truncate to prevent layout overflow on long text", () => {
    expect(page).toContain("truncate block");
  });

  it("list row intent uses max-w to prevent unbounded width", () => {
    expect(page).toContain("max-w-sm");
  });
});

describe("sessions list — clickable rows", () => {
  const page = readFile("src/app/ag-admin/(authed)/sessions/page.tsx");

  it("each session row has a Details link to /ag-admin/sessions/:id", () => {
    expect(page).toContain("/ag-admin/sessions/${s.id}");
    expect(page).toContain("Details →");
  });

  it("session ID is rendered as a clickable link", () => {
    expect(page).toContain("href={`/ag-admin/sessions/${s.id}`}");
  });

  it("intent is the primary row text (not UUID prefix)", () => {
    expect(page).toContain("{s.intent ||");
    const primaryAnchorIdx = page.indexOf("href={`/ag-admin/sessions/${s.id}`}");
    const intentIdx = page.indexOf("{s.intent ||");
    expect(intentIdx).toBeGreaterThan(-1);
    expect(primaryAnchorIdx).toBeGreaterThan(-1);
    expect(Math.abs(intentIdx - primaryAnchorIdx)).toBeLessThan(300);
  });

  it("session UUID shown as secondary technical ID in row", () => {
    expect(page).toContain("s.id.slice(0, 12)");
  });

  it("agent ID in session row links to agent detail page", () => {
    expect(page).toContain("href={`/ag-admin/agents/${s.agent_id}`}");
  });

  it("status tabs still present", () => {
    expect(page).toContain("STATUS_FILTER_OPTIONS");
  });

  it("pagination controls still present", () => {
    expect(page).toContain("PaginationBar");
  });
});

describe("sessions list — agentId filter", () => {
  const page = readFile("src/app/ag-admin/(authed)/sessions/page.tsx");

  it("reads agentId from URL search params", () => {
    expect(page).toContain("params.agentId");
    expect(page).toContain("rawAgentId");
  });

  it("UUID validation: only valid UUID forwarded as agent_id to backend", () => {
    expect(page).toContain("isUUID");
    expect(page).toContain("validAgentId");
    // The backend param is agent_id (snake_case)
    expect(page).toContain('qs.set("agent_id"');
  });

  it("invalid non-UUID agentId never forwarded to backend", () => {
    expect(page).toContain("invalidAgentId");
    // Only UUIDs are forwarded; the guard is isUUID check
    const backendLine = page.indexOf('qs.set("agent_id"');
    const uuidCheckLine = page.indexOf("isUUID");
    expect(backendLine).toBeGreaterThan(-1);
    expect(uuidCheckLine).toBeGreaterThan(-1);
    // isUUID check appears before the qs.set("agent_id") call
    expect(uuidCheckLine).toBeLessThan(backendLine);
  });

  it("shows agent filter banner when valid agentId is active", () => {
    expect(page).toContain("validAgentId &&");
    expect(page).toContain("Showing sessions for agent");
  });

  it("shows invalid-filter notice for non-UUID agentId", () => {
    expect(page).toContain("invalidAgentId &&");
    expect(page).toContain("Invalid agent filter");
    expect(page).toContain("is not a valid UUID");
  });

  it("Clear filter link removes agentId from URL", () => {
    expect(page).toContain("clearAgentUrl");
    expect(page).toContain("Clear filter");
  });

  it("buildUrl preserves valid agentId in pagination/sort/status links", () => {
    expect(page).toContain('p.set("agentId", validAgentId)');
  });

  it("page size links preserve valid agentId", () => {
    // Page size links are built inline; they must include agentId when valid
    expect(page).toContain('ps.set("agentId", validAgentId)');
  });

  it("search form preserves valid agentId via hidden input", () => {
    expect(page).toContain('name="agentId"');
    expect(page).toContain("value={validAgentId}");
  });

  it("sort links reset page to 1 while preserving agentId", () => {
    expect(page).toContain("sortUrl");
    // sortUrl calls buildUrl which preserves agentId
    expect(page).toContain("buildUrl({ sort: field, dir: newDir, page: 1 })");
  });

  it("Clear all preserves agentId but removes q and status", () => {
    // The clear-all URL includes agentId but not q/status
    expect(page).toContain('p.set("agentId", validAgentId)');
    expect(page).toContain("Clear all");
  });

  it("fetchAgentLabel is called for valid agentId to resolve slug/name", () => {
    expect(page).toContain("fetchAgentLabel");
    expect(page).toContain("agentLabel");
  });

  it("agent label shown with link to agent detail page", () => {
    expect(page).toContain("/ag-admin/agents/${validAgentId}");
    expect(page).toContain("agentLabel.slug");
  });

  it("does not expose raw tokens, cookies, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});

// ── Agent detail page ─────────────────────────────────────────────────────

describe("agent detail page", () => {
  const page = readFile("src/app/ag-admin/(authed)/agents/[id]/page.tsx");

  // Identity / config / audit fields (must remain)
  it("fetches from /admin/agent-registry/:id backend endpoint", () => {
    expect(page).toContain("/admin/agent-registry/");
  });

  it("renders safe identity fields: id, slug/agent-key, name", () => {
    expect(page).toContain("agent.id");
    expect(page).toContain("agent.slug");
    expect(page).toContain("agent.name");
  });

  it("identity card uses 'Agent key' label instead of bare 'Slug'", () => {
    expect(page).toContain('"Agent key"');
    expect(page).not.toContain('"Slug"');
  });

  it("renders configuration fields: mode, tools, token limits", () => {
    expect(page).toContain("default_agent_mode");
    expect(page).toContain("allowed_tools_default");
    expect(page).toContain("max_session_duration_seconds");
  });

  it("renders timestamps: created_at, updated_at", () => {
    expect(page).toContain("agent.created_at");
    expect(page).toContain("agent.updated_at");
  });

  // Operational summary
  it("fetches recent sessions via /admin/agent-sessions with agent_id filter", () => {
    expect(page).toContain("fetchRecentSessions");
    expect(page).toContain("/admin/agent-sessions");
    expect(page).toContain("agent_id");
  });

  it("agent and session fetches run in parallel via Promise.all", () => {
    expect(page).toContain("Promise.all");
  });

  it("renders operational summary section", () => {
    expect(page).toContain("OperationalSummary");
    expect(page).toContain("Operational summary");
  });

  it("operational summary shows total session count", () => {
    expect(page).toContain("totalCount");
    expect(page).toContain("Sessions");
  });

  it("operational summary shows last active timestamp", () => {
    expect(page).toContain("Last active");
    expect(page).toContain("mostRecentActivity");
  });

  it("operational summary shows enabled/disabled state", () => {
    expect(page).toContain("agent.enabled");
  });

  // Recent sessions section
  it("renders recent sessions section", () => {
    expect(page).toContain("RecentSessions");
    expect(page).toContain("Recent sessions");
  });

  it("session row uses intent as primary text", () => {
    expect(page).toContain("s.intent");
    const intentIdx = page.indexOf("s.intent ||");
    const linkIdx = page.indexOf("/ag-admin/sessions/${s.id}");
    expect(intentIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(-1);
    expect(Math.abs(intentIdx - linkIdx)).toBeLessThan(400);
  });

  it("recent session row links to /ag-admin/sessions/:id", () => {
    expect(page).toContain("href={`/ag-admin/sessions/${s.id}`}");
    expect(page).toContain("Details →");
  });

  it("session ID shown only as secondary technical metadata", () => {
    expect(page).toContain("s.id.slice(0, 12)");
  });

  it("zero sessions empty state renders", () => {
    expect(page).toContain("No sessions recorded for this agent yet.");
  });

  it("session fetch failure renders safe unavailable state", () => {
    expect(page).toContain("Recent sessions unavailable.");
  });

  it("All sessions link includes agentId filter param", () => {
    expect(page).toContain("agentId=");
    expect(page).toContain("All sessions →");
    // Link must use encodeURIComponent on agentId
    expect(page).toContain("encodeURIComponent(agentId)");
  });

  // Existing error/guard behavior
  it("handles not-found state safely (does not throw)", () => {
    expect(page).toContain("not_found");
    expect(page).toContain("NotFoundState");
  });

  it("handles unavailable state safely", () => {
    expect(page).toContain("unavailable");
    expect(page).toContain("UnavailableState");
  });

  it("has a Back to Agents link", () => {
    expect(page).toContain("/ag-admin/agents");
    expect(page).toContain("← Agents");
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("does not render raw tokens, IBTs, or session validators in rendered HTML", () => {
    for (const forbidden of ["{s.cnf_jkt}", "s.ibt", "{s.access_token}"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("does not render Sign out or sidebar", () => {
    expect(page.toLowerCase()).not.toContain("sign out");
    expect(page).not.toContain("AgAdminNav");
    expect(page).not.toContain("<aside");
  });
});

// ── Session detail page ───────────────────────────────────────────────────

describe("session detail page", () => {
  const page = readFile("src/app/ag-admin/(authed)/sessions/[id]/page.tsx");

  it("uses the direct management endpoint /admin/agent-sessions/:id", () => {
    expect(page).toContain("/admin/agent-sessions/${encodeURIComponent(id)}");
  });

  it("does NOT use the old list+filter workaround", () => {
    expect(page).not.toContain("q: id");
    expect(page).not.toContain("new URLSearchParams({ q: id");
    expect(page).not.toContain("s.id === id");
  });

  it("fetches agent name/slug via /admin/agent-registry/:id", () => {
    expect(page).toContain("/admin/agent-registry/");
    expect(page).toContain("fetchAgentSummary");
    expect(page).toContain("agentInfo");
  });

  it("agent name is primary; agent key (slug) shown as secondary labeled field", () => {
    // agentInfo.name is the primary link text
    expect(page).toContain("agentInfo.name");
    // slug appears only as secondary "Agent key:" label
    expect(page).toContain("Agent key:");
    expect(page).toContain("agentInfo.slug");
  });

  it("session detail does not use bare 'Slug' as a visible label", () => {
    // "Slug" must not appear as a standalone user-visible label
    // Internal variables (agentInfo.slug, AgentSummary.slug) are fine
    expect(page).not.toContain('"Slug"');
    expect(page).not.toContain(">Slug<");
  });

  it("agent UUID shown as secondary Technical ID field", () => {
    expect(page).toContain("Technical ID:");
    expect(page).toContain("s.agent_id}");
  });

  it("intent is the primary page title (h1), not UUID prefix", () => {
    // pageTitle must be intent, not raw UUID
    expect(page).toContain("pageTitle = s.intent");
    const h1Idx = page.indexOf("<h1 ");
    const pageTitleIdx = page.indexOf("{pageTitle}");
    expect(pageTitleIdx).toBeGreaterThan(h1Idx);
    expect(pageTitleIdx - h1Idx).toBeLessThan(300);
  });

  it("session UUID shown as secondary subtitle below intent h1", () => {
    // Short session ID prefix below the h1
    expect(page).toContain("s.id.slice(0, 12)");
  });

  it("fetches operator display via /admin/ag-users/:id/display", () => {
    expect(page).toContain("fetchOperatorDisplay");
    expect(page).toContain("/admin/ag-users/");
    expect(page).toContain("/display");
  });

  it("fetches org display via /admin/organizations/:id/display", () => {
    expect(page).toContain("fetchOrgDisplay");
    expect(page).toContain("/admin/organizations/");
  });

  it("shows operator email/display_name when operatorDisplay is resolved", () => {
    expect(page).toContain("operatorDisplay.email");
    expect(page).toContain("operatorDisplay.display_name");
  });

  it("shows org display_name/name when orgDisplay is resolved", () => {
    expect(page).toContain("orgDisplay.display_name");
    expect(page).toContain("orgDisplay.name");
  });

  it("operator technical ID shown as secondary labeled field", () => {
    expect(page).toContain("Operator ID:");
    expect(page).toContain("s.ag_user_id}");
  });

  it("org technical ID shown as secondary labeled field", () => {
    expect(page).toContain("Org ID:");
    expect(page).toContain("s.organization_id}");
  });

  it("shows fallback when operatorDisplay is unavailable", () => {
    expect(page).toContain("Operator display unavailable");
  });

  it("shows fallback when orgDisplay is unavailable (non-system org)", () => {
    expect(page).toContain("Organization display unavailable");
  });

  it("system org UUID renders as 'System organization' label, not display unavailable", () => {
    expect(page).toContain("AG_SYSTEM_ORG_ID");
    expect(page).toContain("isSystemOrg");
    expect(page).toContain("System organization (platform scope)");
  });

  it("system org check uses the correct sentinel UUID", () => {
    expect(page).toContain("00000000-0000-7000-0000-000000000000");
  });

  it("secondary fetches run in parallel via Promise.all", () => {
    expect(page).toContain("Promise.all");
  });

  it("maps 404 backend response to not_found state", () => {
    expect(page).toContain("res.status === 404");
    expect(page).toContain("not_found");
  });

  it("maps 400 backend response (invalid UUID) to not_found state", () => {
    expect(page).toContain("res.status === 400");
  });

  it("renders safe identity fields: id, agent_id, intent, task_id", () => {
    expect(page).toContain("s.id");
    expect(page).toContain("s.agent_id");
    expect(page).toContain("s.intent");
    expect(page).toContain("s.task_id");
  });

  it("renders all lifecycle fields: status, created_at, last_activity_at, expires_at", () => {
    expect(page).toContain("sessionStatus");
    expect(page).toContain("s.created_at");
    expect(page).toContain("s.last_activity_at");
    expect(page).toContain("s.expires_at");
    expect(page).toContain("s.revoked_at");
    expect(page).toContain("s.revocation_reason");
  });

  it("renders allowed_tools field", () => {
    expect(page).toContain("s.allowed_tools");
    expect(page).toContain("Allowed tools");
  });

  it("allowed_tools empty renders semantically correct wording (no tool restriction)", () => {
    expect(page).toContain("No tool restriction (all tools permitted)");
    expect(page).not.toContain("none restricted");
  });

  it("allowed_tools with entries renders badge list", () => {
    expect(page).toContain("s.allowed_tools.map");
  });

  it("intent in header is clamped to prevent enormous h1", () => {
    expect(page).toContain("line-clamp-3");
    expect(page).toContain("break-words");
  });

  it("intent in Task section has safe wrapping for long text", () => {
    expect(page).toContain("whitespace-pre-wrap");
    const intentFieldIdx = page.indexOf("No intent provided");
    const breakWordsIdx = page.indexOf("break-words whitespace-pre-wrap");
    expect(intentFieldIdx).toBeGreaterThan(-1);
    expect(breakWordsIdx).toBeGreaterThan(-1);
  });

  it("empty/missing intent gets 'Untitled session' fallback in header", () => {
    expect(page).toContain('"Untitled session"');
  });

  it("empty/missing intent gets 'No intent provided' fallback in Task section", () => {
    expect(page).toContain('"No intent provided"');
  });

  it("renders agent_mode field", () => {
    expect(page).toContain("s.agent_mode");
    expect(page).toContain("Agent mode");
  });

  it("agent_id in detail page links to agent detail page", () => {
    expect(page).toContain("/ag-admin/agents/");
  });

  it("handles not-found state with explanation about session expiry", () => {
    expect(page).toContain("not_found");
    expect(page).toContain("NotFoundState");
    expect(page).toContain("expired");
  });

  it("handles unavailable state safely", () => {
    expect(page).toContain("unavailable");
    expect(page).toContain("UnavailableState");
  });

  it("has a Back to Sessions link", () => {
    expect(page).toContain("/ag-admin/sessions");
    expect(page).toContain("← Sessions");
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("does not render Sign out or sidebar", () => {
    expect(page.toLowerCase()).not.toContain("sign out");
    expect(page).not.toContain("AgAdminNav");
  });

  it("does not render sensitive fields from session data (cnf_jkt, ibt, access_token, refresh_token)", () => {
    // These should never appear as rendered JSX field accesses like {s.cnf_jkt} or s.ibt
    for (const forbidden of ["{s.cnf_jkt}", "s.ibt", "{s.access_token}", "{s.refresh_token}"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});

// ── Login page remains sidebar-free ────────────────────────────────────────

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
    expect(loginLayout.toLowerCase()).not.toContain("sign out");
  });

  it("/ag-admin/(authed)/layout.tsx still has sidebar for authenticated pages", () => {
    const authedLayout = readFile("src/app/ag-admin/(authed)/layout.tsx");
    expect(authedLayout).toContain("AgAdminNav");
    expect(authedLayout).toContain("<aside");
  });
});
