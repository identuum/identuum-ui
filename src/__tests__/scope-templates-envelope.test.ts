/**
 * FUNC-M5 (audits/oss-functionality-2026-10-05.md): GET /api/v1/scope-templates
 * answers {count, scope_templates}; the console read a bare array, so a created
 * template never showed ("No scope templates are available for your
 * organization"). Synthetic responses only.
 */
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

import { listScopeTemplates } from "../lib/idp-admin-client";

function serverAnswers(body: unknown): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

const tpl = { id: "t1", name: "reports", description: "d", scopes: ["read:reports"] };

describe("listScopeTemplates reads what the IdP answers", () => {
  it("the {count, scope_templates} envelope", async () => {
    serverAnswers({ count: 1, scope_templates: [tpl] });
    const r = await listScopeTemplates();
    expect(r.ok && r.templates.map((t) => t.name)).toEqual(["reports"]);
  });

  it("a bare array still reads", async () => {
    serverAnswers([tpl]);
    const r = await listScopeTemplates();
    expect(r.ok && r.templates.map((t) => t.name)).toEqual(["reports"]);
  });
});
