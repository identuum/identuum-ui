/**
 * FUNC-M16 (audits/oss-functionality-2026-10-05.md): the console's audit log
 * said "Showing 1–50 of 50 events" while GET /api/v1/audit/events answered
 * has_more=true, and offered no Next: older events were unreachable. Synthetic
 * responses only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: {
      enabled: true,
      public_base_url: "http://idp.test",
      internal_base_url: "http://idp.test",
    },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

import { auditRangeLabel } from "../lib/audit-paging";
import { listAuditEvents } from "../lib/idp-admin-client";

const fifty = Array.from({ length: 50 }, (_, i) => ({
  id: `e${i}`,
  created_at: "2026-10-05T00:00:00Z",
  event_type: "user_created",
  actor_type: "user",
}));

function serverAnswers(body: unknown): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

describe("audit paging follows has_more", () => {
  it("a full page with has_more=true says there is more, and invents no total", async () => {
    serverAnswers({ events: fifty, has_more: true });
    const r = await listAuditEvents({ page: 1, pageSize: 50 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.has_more).toBe(true);
    expect(r.total).toBeNull();
    expect(auditRangeLabel(1, 50, r)).toBe("Showing 1–50 — older events on the next page");
  });

  it("the last page says its range and no more", async () => {
    serverAnswers({ events: fifty.slice(0, 7), has_more: false });
    const r = await listAuditEvents({ page: 2, pageSize: 50 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.has_more).toBe(false);
    expect(auditRangeLabel(2, 50, r)).toBe("Showing 51–57 events");
  });

  it("both audit pages offer Next from has_more", () => {
    for (const p of ["org-admin/audit/page.tsx", "site-admin/audit/page.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../app", p), "utf8");
      expect(src).toContain("const hasNext = result.ok && result.has_more;");
      expect(src).toContain("auditRangeLabel(page, PAGE_SIZE, result)");
    }
  });
});
