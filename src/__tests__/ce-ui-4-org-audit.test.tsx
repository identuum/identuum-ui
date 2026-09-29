/**
 * CE-UI-4: identuum-idp-ce keeps no audit log per organization (its audit
 * rows carry no organization; the org_admin's audit needs a migration), so it
 * declares capabilities.org_audit false and answers the org_admin's
 * GET /api/v1/audit/events 403. The UI then shows no org-admin Audit link,
 * no audit page and no recent-activity cards, and asks nothing. An IdP that
 * does not report the key (identuum-idp-oss) keeps all of them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/org-admin/users" }));

let capabilities: Record<string, boolean> = {};
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({ components: { idp: { capabilities } } }),
}));

const listAuditEvents = vi.fn(async () => ({
  ok: true,
  events: [],
  total_count: 0,
  page: 1,
  page_size: 50,
}));
vi.mock("../lib/idp-admin-client", () => ({
  listAuditEvents: (...args: unknown[]) => listAuditEvents(...(args as [])),
  listAuditEventTypes: async () => null,
  // OSS-FIN-3: the page names its own organization in the Organization column.
  getOwnOrganization: async () => null,
}));

afterEach(() => {
  listAuditEvents.mockClear();
  capabilities = {};
});

const ROOT = resolve(__dirname, "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf-8");

describe("the capability projection carries org_audit", () => {
  it("keeps the IdP's org_audit answer", async () => {
    const { extractCapabilities } = await import("../lib/runtime-composition");
    expect(extractCapabilities({ org_audit: false }).org_audit).toBe(false);
    expect(extractCapabilities({ org_audit: true }).org_audit).toBe(true);
    expect(extractCapabilities({}).org_audit).toBeUndefined();
  });
});

describe("the org-admin nav and org_audit", () => {
  it("shows no Audit link where the IdP keeps no organization audit", async () => {
    const { OrgAdminNav } = await import("../components/org-admin/org-admin-nav");
    const html = renderToStaticMarkup(<OrgAdminNav capabilities={{ org_audit: false }} />);
    expect(html).not.toContain('href="/org-admin/audit"');
    expect(html).toContain('href="/org-admin/users"');
  });
  it("keeps it where the IdP does not say otherwise", async () => {
    const { OrgAdminNav } = await import("../components/org-admin/org-admin-nav");
    const html = renderToStaticMarkup(<OrgAdminNav capabilities={{}} />);
    expect(html).toContain('href="/org-admin/audit"');
  });
});

describe("the org-admin audit page and org_audit", () => {
  it("asks nothing and says the log is not kept, where org_audit is false", async () => {
    capabilities = { org_audit: false };
    const { default: Page } = await import("../app/org-admin/audit/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(listAuditEvents).not.toHaveBeenCalled();
    expect(html).toContain("does not keep an audit log per organization");
    expect(html).not.toContain("Could not load audit events");
  });
  it("reads the log where the IdP does not say otherwise", async () => {
    const { default: Page } = await import("../app/org-admin/audit/page");
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(listAuditEvents).toHaveBeenCalledTimes(1);
  });
});

describe("recent-activity cards ask for audit only where org_audit is not false", () => {
  const pages = [
    ["org-admin", "users", "[id]", "page.tsx"],
    ["org-admin", "applications", "[id]", "page.tsx"],
    ["org-admin", "api-resources", "[id]", "page.tsx"],
    ["org-admin", "service-accounts", "[id]", "page.tsx"],
  ];
  for (const p of pages) {
    it(`${p.slice(1, 3).join("/")}: the audit fetch is gated on org_audit`, () => {
      const src = read("app", ...p);
      expect(src).toContain("org_audit !== false");
      // Every audit fetch sits behind the gate: `orgAudit ? listAuditEvents(`.
      const calls = src.match(/listAuditEvents\(/g) ?? [];
      const gated = src.match(/orgAudit\s*\?\s*listAuditEvents\(/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      expect(gated.length).toBe(calls.length);
    });
  }
});
