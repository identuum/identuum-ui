/**
 * OSS-MUST1-RETIRE-TTL (owner rulings l-o, 2026-10-06): OSS has one
 * access-token lifetime, 1 hour, and no per-resource lifetime. The resource
 * field token_ttl_secs never changed a token; identuum-idp-oss now refuses it
 * with 400. The console's create and update never send it, even when a form
 * posts it, and no API resource page offers or shows it. Synthetic responses
 * only; no real IdP is called.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
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

import {
  createApiResourceAction,
  updateApiResourceAction,
} from "../app/org-admin/api-resources/actions";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const RESOURCE = {
  id: "0190a000-0000-7000-8000-0000000000a1",
  organization_id: "0190a000-0000-7000-8000-00000000000a",
  name: "Billing",
  audience: "https://billing.example.test",
  active: true,
  scopes: [],
};

function capture(status: number, body: unknown): string[] {
  const bodies: string[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(String(init.body));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return bodies;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("the console never sends token_ttl_secs", () => {
  it("create sends name, audience and scopes only, even when the form posts a lifetime", async () => {
    const bodies = capture(201, { ...RESOURCE, secret: "s3cr3t-placeholder" });
    const state = await createApiResourceAction(
      { phase: "idle" },
      form({ name: "Billing", audience: RESOURCE.audience, token_ttl_secs: "600" })
    );
    expect(state.phase).toBe("success");
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toContain("token_ttl_secs");
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ name: "Billing", audience: RESOURCE.audience });
  });

  it("update sends no lifetime, even when the form posts one", async () => {
    const bodies = capture(200, RESOURCE);
    const state = await updateApiResourceAction(
      RESOURCE.id,
      { phase: "idle" },
      form({ name: "Billing", active: "on", token_ttl_secs: "600" })
    );
    expect(state.phase).toBe("success");
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toContain("token_ttl_secs");
  });
});

describe("no API resource page offers or shows a lifetime", () => {
  const files = [
    "src/app/org-admin/api-resources/new/create-api-resource-form.tsx",
    "src/app/org-admin/api-resources/[id]/edit/edit-api-resource-form.tsx",
    "src/app/org-admin/api-resources/[id]/edit/page.tsx",
    "src/app/org-admin/api-resources/[id]/page.tsx",
    "src/app/org-admin/api-resources/page.tsx",
    "src/app/org-admin/api-resources/actions.ts",
  ];
  it.each(files)("%s names no token_ttl_secs and no TTL control", (f) => {
    const src = readFileSync(resolve(__dirname, "..", "..", f), "utf8");
    expect(src).not.toMatch(/token_ttl_secs|TokenTTLSecs|tokenTTLSecs/);
    expect(src).not.toMatch(/\bTTL\b/);
  });
});
