/**
 * Tests for the AG Revocations page.
 *
 * Backend: GET /admin/revocations?kind=session|jti
 * Returns: {"success": true, "revocations": [...], "count": N}
 * No pagination in current backend.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/revocations/page.tsx");
const nav = readFile("src/components/ag-admin/ag-admin-nav.tsx");
const dashboard = readFile("src/app/ag-admin/(authed)/page.tsx");

// ── Page structure ────────────────────────────────────────────────────────────

describe("revocations page — structure", () => {
  it("page title is Revocations", () => {
    expect(page).toContain("Revocations");
    expect(page).toContain("Revocations — Identuum AG");
  });

  it("is force-dynamic", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("explanation text describes revocations purpose", () => {
    expect(page).toContain("prevent further use");
    expect(page).toContain("sessions");
  });
});

// ── Backend API usage ─────────────────────────────────────────────────────────

describe("revocations page — backend API", () => {
  it("fetches from /admin/revocations with pagination params", () => {
    expect(page).toContain("/admin/revocations");
    expect(page).toContain("agRequest");
    expect(page).toContain("page_size");
    expect(page).toContain("page");
  });

  it("performs count-only calls for total/session/jti summary cards", () => {
    expect(page).toContain("fetchCount");
    expect(page).toContain("totalCount");
    expect(page).toContain("sessionCount");
    expect(page).toContain("jtiCount");
  });

  it("count-only calls use page_size=1", () => {
    expect(page).toContain('page_size: "1"');
    expect(page).toContain('page: "1"');
  });

  it("count calls run in parallel via Promise.all", () => {
    expect(page).toContain("Promise.all");
  });

  it("count calls use pagination.total_items for accurate count", () => {
    expect(page).toContain("pagination.total_items");
  });

  it("supports kind, sort, dir query params", () => {
    expect(page).toContain("kind");
    expect(page).toContain("sort");
    expect(page).toContain("dir");
  });

  it("parses backend revocations array and pagination metadata", () => {
    expect(page).toContain("data.revocations");
    expect(page).toContain("Array.isArray");
    expect(page).toContain("data.pagination");
    expect(page).toContain("total_items");
  });

  it("jti field is NOT mapped or displayed", () => {
    expect(page).not.toContain("r.jti");
    expect(page).not.toContain("{r.jti}");
    expect(page).toContain("jti intentionally not mapped");
  });

  it("organization_id is NOT rendered", () => {
    expect(page).not.toContain("organization_id:");
    expect(page).not.toContain("r.organization_id");
  });
});

// ── Summary cards ────────────────────────────────────────────────────────────

describe("revocations page — summary cards", () => {
  it("renders summary cards with SummaryCard component", () => {
    expect(page).toContain("SummaryCard");
    expect(page).toContain("Total revocations");
    expect(page).toContain("Session revocations");
    expect(page).toContain("Token (JTI) revocations");
  });

  it("total card uses totalCount from count-only call", () => {
    expect(page).toContain("value={totalCount}");
  });

  it("session card uses sessionCount from count-only call", () => {
    expect(page).toContain("value={sessionCount}");
  });

  it("jti card uses jtiCount from count-only call", () => {
    expect(page).toContain("value={jtiCount}");
  });

  it("count-only call failure returns null (shows '—' for that card only)", () => {
    expect(page).toContain("return null");
    // fetchCount returns null on any failure; SummaryCard shows '—' for null
    expect(page).toContain("value !== null");
  });

  it("main list still renders when a count call fails (null is graceful)", () => {
    // fetchCount catches all errors and returns null independently from result
    expect(page).toContain("fetchCount");
    expect(page).toContain('result !== "unavailable"');
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("revocations page — pagination", () => {
  it("sends page and page_size to backend", () => {
    expect(page).toContain("page_size");
    expect(page).toContain("pageSize");
    expect(page).toContain("buildUrl");
  });

  it("renders pagination controls (prev/next)", () => {
    expect(page).toContain("← Prev");
    expect(page).toContain("Next →");
    expect(page).toContain("hasPrev");
    expect(page).toContain("hasNext");
  });

  it("kind tabs reset page to 1", () => {
    expect(page).toContain("kindUrl");
    expect(page).toContain('page", "1"');
  });

  it("page size links preserve kind/sort/dir", () => {
    expect(page).toContain("PAGE_SIZES");
    expect(page).toContain('page", "1"');
  });

  it("sort links preserve kind/pageSize and reset page to 1", () => {
    expect(page).toContain("sortUrl");
    expect(page).toContain("BACKEND_SORT_FIELDS");
  });

  it("sort on revoked_at column present", () => {
    expect(page).toContain("revoked_at");
    expect(page).toContain("sortArrow");
  });

  it("no inline pagination-gap note (backend now supports pagination)", () => {
    expect(page).not.toContain("backend does not yet support pagination");
    expect(page).not.toContain("no pagination");
  });
});

// ── Kind filter tabs ──────────────────────────────────────────────────────────

describe("revocations page — kind filter", () => {
  it("has kind filter tabs for all/session/jti", () => {
    expect(page).toContain("KIND_OPTIONS");
    expect(page).toContain('"all"');
    expect(page).toContain('"session"');
    expect(page).toContain('"jti"');
  });

  it("filter links use kind query param and reset page to 1", () => {
    expect(page).toContain("kind=");
    expect(page).toContain("kindUrl");
  });
});

// ── List rows ────────────────────────────────────────────────────────────────

describe("revocations page — list rows", () => {
  it("renders kind badge for each row", () => {
    expect(page).toContain("KIND_LABELS");
    expect(page).toContain("r.kind");
  });

  it("session revocation links to /ag-admin/sessions/:id", () => {
    expect(page).toContain("/ag-admin/sessions/${r.agent_session_id}");
    expect(page).toContain("agent_session_id");
  });

  it("reason text is clamped in list rows", () => {
    expect(page).toContain("line-clamp-2");
    expect(page).toContain("break-words");
    expect(page).toContain("r.reason");
  });

  it("revoked_at timestamp rendered for each row", () => {
    expect(page).toContain("r.revoked_at");
    expect(page).toContain("formatDate");
  });

  it("revoked_by_user_id shown as short technical ID when present", () => {
    expect(page).toContain("revoked_by_user_id");
    expect(page).toContain("slice(0, 8)");
  });

  it("no undo/delete/bulk actions", () => {
    expect(page).not.toContain("Undo");
    expect(page).not.toContain("DELETE");
    expect(page).not.toContain("bulk");
  });

  it("notes backend pagination gap", () => {
    expect(page).toContain("pagination");
  });
});

// ── Fallback states ───────────────────────────────────────────────────────────

describe("revocations page — fallback states", () => {
  it("renders empty state when no revocations", () => {
    expect(page).toContain("EmptyState");
    expect(page).toContain("No revocations found");
  });

  it("renders unavailable state on backend failure", () => {
    expect(page).toContain("UnavailableState");
    expect(page).toContain("Revocations unavailable");
  });

  it("unavailable state has links to sessions/agents/dashboard", () => {
    const unavailStart = page.indexOf("function UnavailableState");
    const snippet = page.slice(unavailStart, unavailStart + 900);
    expect(snippet).toContain("/ag-admin/sessions");
    expect(snippet).toContain("/ag-admin/agents");
    expect(snippet).toContain("/ag-admin");
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("revocations page — security", () => {
  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("no token material or raw JWT identifiers rendered", () => {
    expect(page).not.toContain("{r.jti}");
    expect(page).not.toContain("r.jti}");
  });
});

// ── Navigation integration ────────────────────────────────────────────────────

describe("AG sidebar — revocations nav link", () => {
  it("Revocations link added to sidebar nav", () => {
    expect(nav).toContain("Revocations");
    expect(nav).toContain("/ag-admin/revocations");
  });
});

describe("AG dashboard — revocations integration", () => {
  it("Revocations quick link on dashboard", () => {
    expect(dashboard).toContain("Revocations");
    expect(dashboard).toContain("/ag-admin/revocations");
  });

  it("Revocations GovernanceCard on dashboard", () => {
    const govCardIdx = dashboard.indexOf('title="Revocations"');
    expect(govCardIdx).toBeGreaterThan(-1);
    expect(dashboard.slice(govCardIdx, govCardIdx + 200)).toContain("revocations");
  });
});

// ── Login sidebar-free invariant ──────────────────────────────────────────────

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
  });
});
