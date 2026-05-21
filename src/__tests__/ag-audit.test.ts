/**
 * Tests for the AG Audit / Activity page.
 *
 * Backend: GET /admin/audit-log?limit=25&offset=0&event_stream=...&severity=...
 * Feature-gated: Pro/Enterprise only. 403 "feature_not_enabled" on Free tier.
 * payload field MUST NOT be rendered (may contain sensitive data).
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/audit/page.tsx");
const nav = readFile("src/components/ag-admin/ag-admin-nav.tsx");
const dashboard = readFile("src/app/ag-admin/(authed)/page.tsx");

// ── Page structure ────────────────────────────────────────────────────────────

describe("audit page — structure", () => {
  it("page title is 'Audit / Activity'", () => {
    expect(page).toContain("Audit / Activity");
    expect(page).toContain("Audit / Activity — Identuum AG");
  });

  it("is force-dynamic", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("explains what audit events record", () => {
    expect(page).toContain("governance");
    expect(page).toContain("HITL");
    expect(page).toContain("agent");
  });
});

// ── Backend API ───────────────────────────────────────────────────────────────

describe("audit page — backend API", () => {
  it("fetches from /admin/audit-log", () => {
    expect(page).toContain("/admin/audit-log");
    expect(page).toContain("agRequest");
  });

  it("fetches from /admin/audit-log/verify in parallel with list", () => {
    expect(page).toContain("/admin/audit-log/verify");
    expect(page).toContain("fetchAuditVerify");
    expect(page).toContain("Promise.all");
  });

  it("calls POST /admin/ag-users/display-batch with unique ag_user_id values", () => {
    expect(page).toContain("/admin/ag-users/display-batch");
    expect(page).toContain("fetchOperatorDisplayBatch");
    expect(page).toContain('method: "POST"');
  });

  it("calls POST /admin/agent-sessions/display-batch with unique agent_session_id values", () => {
    expect(page).toContain("/admin/agent-sessions/display-batch");
    expect(page).toContain("fetchSessionDisplayBatch");
  });

  it("sends limit and offset for pagination", () => {
    expect(page).toContain("limit");
    expect(page).toContain("offset");
  });

  it("supports event_stream, severity, and event_type filters", () => {
    expect(page).toContain("event_stream");
    expect(page).toContain("severity");
    expect(page).toContain("event_type");
  });

  it("reads eventType URL param and sends as event_type to backend", () => {
    expect(page).toContain("sp.eventType");
    expect(page).toContain("eventType");
    expect(page).toContain('qs.set("event_type"');
  });

  it("parses backend events array from response envelope", () => {
    expect(page).toContain("data.events");
    expect(page).toContain("Array.isArray");
    expect(page).toContain("data.total");
  });
});

// ── Feature-not-enabled handling ──────────────────────────────────────────────

describe("audit page — feature gating", () => {
  it("handles 403 feature_not_enabled distinctly from auth error", () => {
    expect(page).toContain("feature_not_enabled");
    expect(page).toContain('body?.error === "feature_not_enabled"');
  });

  it("feature-not-enabled state shows tier upgrade message", () => {
    expect(page).toContain("Professional or Enterprise tier");
  });

  it("feature-not-enabled state has links to dashboard/sessions/revocations", () => {
    // Find the feature_not_enabled render block (not the condition check)
    const featureBlock = page.indexOf("Audit log requires Professional");
    const snippet = page.slice(featureBlock, featureBlock + 800);
    expect(snippet).toContain("/ag-admin");
    expect(snippet).toContain("/ag-admin/sessions");
    expect(snippet).toContain("/ag-admin/revocations");
  });
});

// ── Chain verification panel ──────────────────────────────────────────────────

describe("audit page — chain verification (on-demand)", () => {
  it("ChainVerifyPanel component defined and rendered", () => {
    expect(page).toContain("ChainVerifyPanel");
    expect(page).toContain("verifyResult");
  });

  it("default page does NOT auto-call fetchAuditVerify (requires verify=1)", () => {
    expect(page).toContain("shouldVerify");
    expect(page).toContain("sp.verify === \"1\"");
    // Only called when shouldVerify is true
    expect(page).toContain("shouldVerify ? fetchAuditVerify()");
  });

  it("idle/not-run state shown when verify not requested", () => {
    expect(page).toContain("Verification has not been run");
    expect(page).toContain("Run to check the append-only");
  });

  it("Run verification link includes verify=1 and preserves current filters", () => {
    expect(page).toContain("Run verification");
    expect(page).toContain("runVerifyUrl");
    expect(page).toContain('verify: 1');
  });

  it("Run again link present in result states", () => {
    expect(page).toContain("Run again");
  });

  it("valid chain state shows 'Append-only chain verified' and total_rows", () => {
    expect(page).toContain("Append-only chain verified");
    expect(page).toContain("no chain break detected");
    expect(page).toContain("total_rows");
  });

  it("tampered chain state shows 'Chain integrity check failed' and chain position", () => {
    expect(page).toContain("Chain integrity check failed");
    expect(page).toContain("tampered_at");
    expect(page).toContain("chain position");
  });

  it("tampered chain state includes local/dev context explaining why it can occur", () => {
    expect(page).toContain("local development");
    expect(page).toContain("test database resets");
    expect(page).toContain("production, investigate");
  });

  it("tampered chain state uses 'Chain break' badge not 'Tampered'", () => {
    expect(page).toContain("Chain break");
    // Old bare "Tampered" badge is removed
    expect(page).not.toContain(">Tampered<");
  });

  it("service error state shows safe operator message, not raw backend error", () => {
    expect(page).toContain("Verification error");
    expect(page).toContain("service_error");
    // Raw backend error string must not be forwarded
    expect(page).not.toContain("result.Error");
    expect(page).not.toContain("data?.error");
  });

  it("feature_not_enabled from verify shows Enterprise tier message", () => {
    expect(page).toContain("Hash-chain verification requires Enterprise tier");
  });

  it("verify unavailable state renders only when verify=1 was requested", () => {
    // State is shown when shouldVerify=true but result is unavailable
    expect(page).toContain("Chain verification unavailable");
    // Panel still shows idle state when shouldVerify=false
    expect(page).toContain("Verification has not been run");
  });

  it("verify result is independent of list result (both in Promise.all)", () => {
    const parallelCall = page.indexOf("Promise.all");
    const listCall = page.indexOf("fetchAuditLog");
    const verifyCall = page.indexOf("fetchAuditVerify");
    expect(parallelCall).toBeGreaterThan(-1);
    expect(listCall).toBeGreaterThan(-1);
    expect(verifyCall).toBeGreaterThan(-1);
  });

  it("tampered_at is shown as chain position number, not a hash or secret", () => {
    expect(page).toContain("chain position");
    expect(page).toContain("tampered_at");
    expect(page).not.toContain("hash:");
    expect(page).not.toContain("prev_hash");
  });
});

// ── Safety — payload exclusion ────────────────────────────────────────────────

// ── Event type filter ──────────────────────────────────────────────────────────

describe("audit page — event type filter", () => {
  it("renders event type select control with grouped options", () => {
    expect(page).toContain('name="eventType"');
    expect(page).toContain("optgroup");
    expect(page).toContain("All event types");
  });

  it("includes AG governance event types from backend constants", () => {
    // Agent sessions
    expect(page).toContain("agent_session_created");
    expect(page).toContain("agent_session_revoked");
    // HITL
    expect(page).toContain("hitl_approved");
    expect(page).toContain("hitl_denied");
    // Agent registry
    expect(page).toContain("agent_registry_created");
    expect(page).toContain("agent_registry_updated");
    // Tokens
    expect(page).toContain("token_revoked");
    // Operator
    expect(page).toContain("operator_login");
  });

  it("event type form resets to page 1 on submit", () => {
    // Hidden input for page=1
    expect(page).toContain('name="page" value="1"');
  });

  it("event type form preserves stream and severity filters as hidden inputs", () => {
    expect(page).toContain('name="stream"');
    expect(page).toContain('name="severity"');
  });

  it("Clear event type link removes eventType from URL and resets to page 1", () => {
    expect(page).toContain("Clear event type");
  });

  it("buildUrl preserves eventType in pagination/sort links", () => {
    expect(page).toContain('p.set("eventType", eventType)');
  });

  it("streamUrl preserves eventType in stream filter links", () => {
    // streamUrl includes eventType
    const streamUrlIdx = page.indexOf("function streamUrl");
    const snippet = page.slice(streamUrlIdx, streamUrlIdx + 400);
    expect(snippet).toContain("eventType");
  });

  it("page size links preserve eventType", () => {
    expect(page).toContain('p.set("eventType", eventType)');
  });

  it("Run verification link includes verify=1 and preserves eventType via buildUrl", () => {
    expect(page).toContain("runVerifyUrl");
    // buildUrl({verify:1}) already includes eventType via the function
    expect(page).toContain("buildUrl({ verify: 1 })");
  });
});

// ── Operator display ──────────────────────────────────────────────────────────

describe("audit page — operator display (batch)", () => {
  it("uses POST /admin/ag-users/display-batch instead of per-user GET calls", () => {
    expect(page).toContain("fetchOperatorDisplayBatch");
    expect(page).toContain("/admin/ag-users/display-batch");
    expect(page).toContain('method: "POST"');
    // No individual GET per user
    expect(page).not.toContain("fetchOperatorDisplay(id)");
    expect(page).not.toContain("OPERATOR_LOOKUP_CAP");
  });

  it("sends unique ag_user_id values as ids array", () => {
    expect(page).toContain("new Set(events.map((e) => e.ag_user_id)");
    expect(page).toContain("uniqueUserIds");
    expect(page).toContain('JSON.stringify({ ids }');
  });

  it("batch request body contains ids field", () => {
    expect(page).toContain("JSON.stringify({ ids })");
  });

  it("batch returns a Map from id to OperatorDisplay", () => {
    expect(page).toContain("operatorMap");
    expect(page).toContain("Map<string, OperatorDisplay>");
  });

  it("display_name used as primary label when available", () => {
    expect(page).toContain("opDisplay.display_name");
    expect(page).toContain("opPrimary");
  });

  it("email shown as secondary line when display_name is present", () => {
    expect(page).toContain("opSecondary");
    expect(page).toContain("opDisplay.email");
  });

  it("short UUID fallback when lookup fails (null in operatorMap)", () => {
    // When opDisplay is null or undefined, short UUID is shown
    expect(page).toContain("e.ag_user_id.slice(0, 8)");
  });

  it("no operator lookup for empty/null ag_user_id values", () => {
    // filter ensures only non-null IDs are looked up
    expect(page).toContain('filter((id): id is string => !!id)');
  });

  it("audit list still renders when operator lookups return null", () => {
    // operatorMap stores null for failed lookups; row renders fallback
    expect(page).toContain("operatorMap.get(e.ag_user_id)");
  });

  it("raw operator lookup errors are not rendered (function returns null on failure)", () => {
    expect(page).not.toContain("lookupError");
    // fetchOperatorDisplay catches and returns null on any error
    expect(page).toContain("fetchOperatorDisplay");
    // null returned on failure — never forwarded as error
    expect(page).toContain("return null");
  });
});

// ── Session display ───────────────────────────────────────────────────────────

describe("audit page — session display (batch)", () => {
  it("uses POST /admin/agent-sessions/display-batch for session context", () => {
    expect(page).toContain("fetchSessionDisplayBatch");
    expect(page).toContain("/admin/agent-sessions/display-batch");
    expect(page).toContain('method: "POST"');
  });

  it("deduplicates agent_session_id values before request", () => {
    expect(page).toContain("new Set(events.map((e) => e.agent_session_id)");
    expect(page).toContain("uniqueSessionIds");
  });

  it("sessionMap used in AuditEventRow to render session context", () => {
    expect(page).toContain("sessionMap");
    expect(page).toContain("sessDisplay");
  });

  it("session intent rendered clamped and wrapped safely", () => {
    expect(page).toContain("sessDisplay?.intent");
    expect(page).toContain("line-clamp-1");
    expect(page).toContain("break-words");
  });

  it("session task_id rendered with truncation", () => {
    expect(page).toContain("sessDisplay?.task_id");
    expect(page).toContain("truncate");
  });

  it("session status badge rendered from revoked_at and expires_at", () => {
    expect(page).toContain("SESSION_STATUS_MINI_STYLES");
    expect(page).toContain("sessStatus");
    expect(page).toContain("sessionStatusLabel");
  });

  it("rows without agent_session_id do not trigger session lookup", () => {
    // Lookup only for rows where e.agent_session_id is truthy
    expect(page).toContain("filter((id): id is string => !!id)");
  });

  it("session display failure returns empty Map — list still renders", () => {
    expect(page).toContain("return new Map()");
  });

  it("session display does not expose tool inputs, cnf_jkt, or auth claims", () => {
    const sessionDisplayFn = page.indexOf("fetchSessionDisplayBatch");
    const snippet = page.slice(sessionDisplayFn, sessionDisplayFn + 800);
    expect(snippet).not.toContain("cnf_jkt");
    expect(snippet).not.toContain("allowed_tools");
    expect(snippet).not.toContain("auth_time");
    expect(snippet).not.toContain("acr");
  });
});

describe("audit page — payload exclusion", () => {
  it("payload field is NOT mapped or rendered", () => {
    // payload may contain tool inputs, JWT claims, session validators
    expect(page).not.toContain("e.payload");
    expect(page).not.toContain("{e.payload}");
    expect(page).toContain("payload intentionally not mapped");
  });

  it("organization_id is NOT rendered", () => {
    expect(page).not.toContain("e.organization_id");
    expect(page).not.toContain("organization_id:");
  });

  it("correlation_id is NOT rendered", () => {
    expect(page).not.toContain("e.correlation_id");
  });

  it("request_id is NOT rendered", () => {
    expect(page).not.toContain("e.request_id");
  });

  it("chain_position is NOT rendered", () => {
    expect(page).not.toContain("e.chain_position");
  });

  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});

// ── Safe fields rendered ──────────────────────────────────────────────────────

describe("audit page — safe fields rendered", () => {
  it("renders event_type with human-readable label", () => {
    expect(page).toContain("EVENT_TYPE_LABELS");
    expect(page).toContain("e.event_type");
  });

  it("renders event_severity with styled badge", () => {
    expect(page).toContain("SEVERITY_STYLES");
    expect(page).toContain("e.event_severity");
  });

  it("renders event_stream label", () => {
    expect(page).toContain("STREAM_LABELS");
    expect(page).toContain("e.event_stream");
  });

  it("renders event_timestamp", () => {
    expect(page).toContain("e.event_timestamp");
    expect(page).toContain("formatDate");
  });

  it("links agent_session_id to /ag-admin/sessions/:id", () => {
    expect(page).toContain("/ag-admin/sessions/${e.agent_session_id}");
  });

  it("shows ag_user_id as short UUID only (no name lookup)", () => {
    expect(page).toContain("ag_user_id");
    expect(page).toContain("slice(0, 8)");
  });

  it("renders risk_level and decision when present", () => {
    expect(page).toContain("e.risk_level");
    expect(page).toContain("e.decision");
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe("audit page — filters", () => {
  it("stream filter tabs present for all/compliance/agentic/system", () => {
    expect(page).toContain("STREAM_OPTIONS");
    expect(page).toContain("compliance");
    expect(page).toContain("agentic_security");
    expect(page).toContain("system");
  });

  it("severity filter tabs present", () => {
    expect(page).toContain("SEVERITY_OPTIONS");
    expect(page).toContain("info");
    expect(page).toContain("warning");
    expect(page).toContain("critical");
  });

  it("stream tabs reset page to 1", () => {
    expect(page).toContain("streamUrl");
    expect(page).toContain('page", "1"');
  });

  it("page size selector present", () => {
    expect(page).toContain("PAGE_SIZES");
    expect(page).toContain("pageSize");
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("audit page — pagination", () => {
  it("renders Prev/Next controls", () => {
    expect(page).toContain("← Prev");
    expect(page).toContain("Next →");
    expect(page).toContain("hasPrev");
    expect(page).toContain("hasNext");
  });

  it("calculates offset from page and pageSize", () => {
    expect(page).toContain("offset");
    expect(page).toContain("(page - 1) * pageSize");
  });
});

// ── Fallback states ───────────────────────────────────────────────────────────

describe("audit page — fallback states", () => {
  it("empty state renders", () => {
    expect(page).toContain("EmptyState");
    expect(page).toContain("No audit events found");
  });

  it("unavailable state renders with links", () => {
    expect(page).toContain("UnavailableState");
    expect(page).toContain("Audit log unavailable");
  });

  it("no undo/delete/bulk/export actions", () => {
    expect(page).not.toContain("DELETE");
    expect(page).not.toContain("bulk");
    expect(page).not.toContain("Export");
    expect(page).not.toContain("Download");
  });
});

// ── Navigation integration ────────────────────────────────────────────────────

describe("AG sidebar — audit nav link", () => {
  it("Audit / Activity link added to sidebar nav", () => {
    expect(nav).toContain("Audit / Activity");
    expect(nav).toContain("/ag-admin/audit");
  });
});

describe("AG dashboard — audit integration", () => {
  it("Audit log quick link on dashboard", () => {
    expect(dashboard).toContain("Audit log");
    expect(dashboard).toContain("/ag-admin/audit");
  });

  it("Audit GovernanceCard on dashboard", () => {
    expect(dashboard).toContain('title="Audit / Activity"');
  });
});

// ── Login sidebar-free ────────────────────────────────────────────────────────

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
  });
});
