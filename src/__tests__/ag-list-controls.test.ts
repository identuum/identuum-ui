/**
 * Tests for AG list page backend pagination integration.
 *
 * Covers:
 *   - Query string construction with correct backend params
 *   - Backend sort allowlist enforcement
 *   - Paginated response shape parsing
 *   - Raw-array fallback compatibility
 *   - Structural invariants of page files
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readPage(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

// ── Backend sort allowlists (mirroring page constants) ────────────────────────

const AGENT_BACKEND_SORT = new Set(["slug", "name", "created_at", "updated_at", "enabled"]);
const SESSION_BACKEND_SORT = new Set(["created_at", "expires_at", "last_activity_at", "agent_mode"]);

// ── Backend query string builder helpers ──────────────────────────────────────

function buildAgentQuery(opts: {
  page?: number; pageSize?: number; q?: string; sort?: string; dir?: string;
}): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("page", String(opts.page ?? 1));
  qs.set("page_size", String(opts.pageSize ?? 25));
  if (opts.q) qs.set("q", opts.q);
  const sort = opts.sort ?? "created_at";
  if (AGENT_BACKEND_SORT.has(sort)) qs.set("sort", sort);
  if (opts.dir === "asc") qs.set("dir", "asc");
  return qs;
}

function buildSessionQuery(opts: {
  page?: number; pageSize?: number; q?: string; sort?: string; dir?: string; status?: string;
}): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("page", String(opts.page ?? 1));
  qs.set("page_size", String(opts.pageSize ?? 25));
  if (opts.q) qs.set("q", opts.q);
  const sort = opts.sort ?? "created_at";
  if (SESSION_BACKEND_SORT.has(sort)) qs.set("sort", sort);
  if (opts.dir === "asc") qs.set("dir", "asc");
  if (opts.status && opts.status !== "all") qs.set("status", opts.status);
  return qs;
}

// ── Paginated response parsing ────────────────────────────────────────────────

interface PaginationMeta {
  page: number; page_size: number; total_items: number;
  total_pages: number; has_previous: boolean; has_next: boolean;
}

function parsePaginatedResponse(raw: unknown): { items: unknown[]; pagination: PaginationMeta | null; rawArray: boolean } {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "items" in raw && "pagination" in raw) {
    const typed = raw as { items: unknown[]; pagination: PaginationMeta };
    return { items: typed.items ?? [], pagination: typed.pagination, rawArray: false };
  }
  if (Array.isArray(raw)) {
    return { items: raw, pagination: null, rawArray: true };
  }
  throw new Error("unexpected response shape");
}

// ── Agent query builder tests ─────────────────────────────────────────────────

describe("agents — backend query string", () => {
  it("includes page and page_size as backend params", () => {
    const qs = buildAgentQuery({ page: 2, pageSize: 10 });
    expect(qs.get("page")).toBe("2");
    expect(qs.get("page_size")).toBe("10");
    expect(qs.has("limit")).toBe(false);
  });

  it("maps UI pageSize to backend page_size", () => {
    const qs = buildAgentQuery({ pageSize: 50 });
    expect(qs.get("page_size")).toBe("50");
  });

  it("includes q param when provided", () => {
    const qs = buildAgentQuery({ q: "my-agent" });
    expect(qs.get("q")).toBe("my-agent");
  });

  it("includes sort when in allowlist", () => {
    expect(buildAgentQuery({ sort: "created_at" }).get("sort")).toBe("created_at");
    expect(buildAgentQuery({ sort: "slug" }).get("sort")).toBe("slug");
    expect(buildAgentQuery({ sort: "name" }).get("sort")).toBe("name");
    expect(buildAgentQuery({ sort: "enabled" }).get("sort")).toBe("enabled");
    expect(buildAgentQuery({ sort: "updated_at" }).get("sort")).toBe("updated_at");
  });

  it("does not send sort for unsupported fields like mode/intent/status", () => {
    expect(buildAgentQuery({ sort: "mode" }).has("sort")).toBe(false);
    expect(buildAgentQuery({ sort: "intent" }).has("sort")).toBe(false);
    expect(buildAgentQuery({ sort: "status" }).has("sort")).toBe(false);
  });

  it("includes dir=asc when ascending", () => {
    expect(buildAgentQuery({ dir: "asc" }).get("dir")).toBe("asc");
  });

  it("does not include dir when descending (default)", () => {
    expect(buildAgentQuery({ dir: "desc" }).has("dir")).toBe(false);
  });
});

// ── Sessions query builder tests ──────────────────────────────────────────────

describe("sessions — backend query string", () => {
  it("includes status param for active/expired/revoked", () => {
    expect(buildSessionQuery({ status: "active" }).get("status")).toBe("active");
    expect(buildSessionQuery({ status: "expired" }).get("status")).toBe("expired");
    expect(buildSessionQuery({ status: "revoked" }).get("status")).toBe("revoked");
  });

  it("does not include status=all (backend default)", () => {
    expect(buildSessionQuery({ status: "all" }).has("status")).toBe(false);
    expect(buildSessionQuery({}).has("status")).toBe(false);
  });

  it("includes allowed sort fields", () => {
    expect(buildSessionQuery({ sort: "created_at" }).get("sort")).toBe("created_at");
    expect(buildSessionQuery({ sort: "expires_at" }).get("sort")).toBe("expires_at");
    expect(buildSessionQuery({ sort: "last_activity_at" }).get("sort")).toBe("last_activity_at");
    expect(buildSessionQuery({ sort: "agent_mode" }).get("sort")).toBe("agent_mode");
  });

  it("does not send sort for unsupported fields like intent/status", () => {
    expect(buildSessionQuery({ sort: "intent" }).has("sort")).toBe(false);
    expect(buildSessionQuery({ sort: "status" }).has("sort")).toBe(false);
  });

  it("maps UI pageSize to backend page_size", () => {
    expect(buildSessionQuery({ pageSize: 100 }).get("page_size")).toBe("100");
  });
});

// ── Paginated response parsing ─────────────────────────────────────────────────

describe("paginated response parsing", () => {
  it("parses paginated shape correctly", () => {
    const raw = {
      items: [{ id: "abc" }],
      pagination: { page: 1, page_size: 25, total_items: 100, total_pages: 4, has_previous: false, has_next: true },
    };
    const result = parsePaginatedResponse(raw);
    expect(result.rawArray).toBe(false);
    expect(result.pagination?.total_items).toBe(100);
    expect(result.pagination?.total_pages).toBe(4);
    expect(result.pagination?.has_next).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it("falls back to rawArray for plain array response", () => {
    const result = parsePaginatedResponse([{ id: "a" }, { id: "b" }]);
    expect(result.rawArray).toBe(true);
    expect(result.pagination).toBeNull();
    expect(result.items).toHaveLength(2);
  });

  it("rawArray fallback returns all items without pagination", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
    const result = parsePaginatedResponse(items);
    expect(result.rawArray).toBe(true);
    expect(result.items).toHaveLength(30);
    expect(result.pagination).toBeNull();
  });

  it("pagination has_previous false on first page", () => {
    const raw = {
      items: [],
      pagination: { page: 1, page_size: 25, total_items: 30, total_pages: 2, has_previous: false, has_next: true },
    };
    const result = parsePaginatedResponse(raw);
    expect(result.pagination?.has_previous).toBe(false);
    expect(result.pagination?.has_next).toBe(true);
  });
});

// ── Structural invariants for page files ──────────────────────────────────────

describe("agents page — uses backend pagination", () => {
  const page = readPage("src/app/ag-admin/(authed)/agents/page.tsx");

  it("forwards page and page_size to backend", () => {
    expect(page).toContain("page_size");
    expect(page).toContain("qs.set");
  });

  it("has BACKEND_SORT_FIELDS allowlist that excludes mode", () => {
    expect(page).toContain("BACKEND_SORT_FIELDS");
    // 'mode' is NOT in the backend allowlist
    expect(page).not.toContain('"mode"');
  });

  it("parses paginated response shape with items + pagination", () => {
    expect(page).toContain('"items" in raw');
    expect(page).toContain('"pagination" in raw');
  });

  it("falls back gracefully for raw array response", () => {
    expect(page).toContain("rawArray");
    expect(page).toContain("Array.isArray(raw)");
  });

  it("uses backend pagination metadata for prev/next links", () => {
    expect(page).toContain("has_previous");
    expect(page).toContain("has_next");
  });

  it("does not expose cookies or internal URLs", () => {
    expect(page).not.toContain('"ag_operator_session"');
    expect(page).not.toContain("host.docker.internal");
    expect(page).not.toContain("client_secret");
  });
});

describe("sessions page — uses backend pagination", () => {
  const page = readPage("src/app/ag-admin/(authed)/sessions/page.tsx");

  it("forwards page, page_size, status, sort, dir to backend", () => {
    expect(page).toContain("page_size");
    expect(page).toContain("qs.set");
    expect(page).toContain("status");
  });

  it("has BACKEND_SORT_FIELDS that only allows backend-supported sort fields", () => {
    expect(page).toContain("BACKEND_SORT_FIELDS");
    // BACKEND_SORT_FIELDS must NOT include intent or status as sort keys
    // (status is a filter, not a sort field)
    const backendSortMatch = page.match(/BACKEND_SORT_FIELDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
    expect(backendSortMatch).toBeTruthy();
    const sortFields = backendSortMatch![1];
    expect(sortFields).not.toContain('"intent"');
    expect(sortFields).not.toContain('"status"');
  });

  it("parses paginated response shape", () => {
    expect(page).toContain('"items" in raw');
    expect(page).toContain("rawArray");
  });

  it("has status filter tabs for all/active/expired/revoked", () => {
    expect(page).toContain("STATUS_FILTER_OPTIONS");
    expect(page).toContain('"active"');
    expect(page).toContain('"revoked"');
  });

  it("does not expose cookies or internal URLs", () => {
    expect(page).not.toContain('"ag_operator_session"');
    expect(page).not.toContain("host.docker.internal");
    expect(page).not.toContain("client_secret");
  });
});

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/(authed)/layout.tsx has sidebar for authenticated pages", () => {
    const layout = readPage("src/app/ag-admin/(authed)/layout.tsx");
    expect(layout).toContain("AgAdminNav");
    expect(layout).toContain("<aside");
  });

  it("/ag-admin/login/layout.tsx does not have sidebar", () => {
    const loginLayout = readPage("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
  });
});

// ── Pagination control regression fix tests ───────────────────────────────────

describe("page size navigation links — no defaultValue select", () => {
  const agentsPage = readPage("src/app/ag-admin/(authed)/agents/page.tsx");
  const sessionsPage = readPage("src/app/ag-admin/(authed)/sessions/page.tsx");

  it("agents page uses navigation links for page size, not a <select>", () => {
    // The fix replaces <select name="pageSize"> with anchor links to avoid
    // React's defaultValue reconciliation bug on client-side navigation.
    expect(agentsPage).not.toContain('<select');
    expect(agentsPage).not.toContain('defaultValue={pageSize}');
  });

  it("sessions page uses navigation links for page size, not a <select>", () => {
    expect(sessionsPage).not.toContain('<select');
    expect(sessionsPage).not.toContain('defaultValue={pageSize}');
  });

  it("agents page size links reset page to 1 and preserve q/sort/dir", () => {
    // All page size links must include page=1 in their URL construction
    expect(agentsPage).toContain('ps.set("page", "1")');
    // Links preserve q param
    expect(agentsPage).toContain('if (q) ps.set("q", q)');
    // Links preserve sort param
    expect(agentsPage).toContain('ps.set("sort", sortField)');
  });

  it("sessions page size links reset page to 1 and preserve q/status/sort/dir", () => {
    expect(sessionsPage).toContain('ps.set("page", "1")');
    expect(sessionsPage).toContain('if (q) ps.set("q", q)');
    expect(sessionsPage).toContain('ps.set("status", statusFilter)');
  });

  it("agents page size links do not include pageSize=25 for default (clean URLs)", () => {
    // When n === DEFAULT_PAGE_SIZE, pageSize is NOT added to the link URL.
    expect(agentsPage).toContain('if (n !== DEFAULT_PAGE_SIZE) ps.set("pageSize"');
  });

  it("sessions page size links do not include pageSize=25 for default (clean URLs)", () => {
    expect(sessionsPage).toContain('if (n !== DEFAULT_PAGE_SIZE) ps.set("pageSize"');
  });

  it("agents search form preserves pageSize via hidden input when non-default", () => {
    // The search form includes a hidden pageSize input so searching doesn't reset page size.
    expect(agentsPage).toContain('pageSize !== DEFAULT_PAGE_SIZE');
    expect(agentsPage).toContain('<input type="hidden" name="pageSize"');
  });

  it("sessions search form preserves pageSize via hidden input when non-default", () => {
    expect(sessionsPage).toContain('pageSize !== DEFAULT_PAGE_SIZE');
    expect(sessionsPage).toContain('<input type="hidden" name="pageSize"');
  });
});

describe("page size URL construction helpers", () => {
  // Pure helpers mirroring the inline URL construction in the pages.
  const DEFAULT = 25;

  function pageSizeUrl(current: { q: string; sort: string; dir: string; pageSize?: number }, n: number): string {
    const ps = new URLSearchParams();
    if (current.q) ps.set("q", current.q);
    if (current.sort !== "created_at") ps.set("sort", current.sort);
    if (current.dir !== "desc") ps.set("dir", current.dir);
    if (n !== DEFAULT) ps.set("pageSize", String(n));
    ps.set("page", "1");
    return ps.toString() ? `?${ps.toString()}` : "";
  }

  it("page size 10 produces pageSize=10 and page=1", () => {
    const url = pageSizeUrl({ q: "", sort: "created_at", dir: "desc" }, 10);
    expect(url).toContain("pageSize=10");
    expect(url).toContain("page=1");
  });

  it("page size 25 (default) does NOT produce pageSize in URL", () => {
    const url = pageSizeUrl({ q: "", sort: "created_at", dir: "desc" }, 25);
    expect(url).not.toContain("pageSize");
    expect(url).toContain("page=1");
  });

  it("preserves q param when changing page size", () => {
    const url = pageSizeUrl({ q: "test", sort: "created_at", dir: "desc" }, 10);
    expect(url).toContain("q=test");
    expect(url).toContain("pageSize=10");
  });

  it("preserves sort param when changing page size", () => {
    const url = pageSizeUrl({ q: "", sort: "slug", dir: "desc" }, 50);
    expect(url).toContain("sort=slug");
    expect(url).toContain("pageSize=50");
  });

  it("always resets page to 1 when changing page size", () => {
    // Regardless of which page size is selected, page resets to 1.
    for (const n of [10, 25, 50, 100]) {
      const url = pageSizeUrl({ q: "", sort: "created_at", dir: "desc" }, n);
      expect(url).toContain("page=1");
    }
  });
});
