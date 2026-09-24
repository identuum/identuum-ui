import { afterEach, describe, expect, it, vi } from "vitest";
import { nextProxyFetch } from "../src/next-proxy";

// PLAN-D-4: the shared browser clients (idp-client, idp-account-client, the
// setup, upgrade and license clients) call the Next deployment's IdP proxy,
// /api/idp/<path>. The export has no Next server; this adapter gives the
// same paths the binary's answer: /api/v1 through the boundary (with the
// browser proof, owner decision D1), the binary's other public routes
// (/api/setup/*, /api/upgrade/*) directly, and nothing else touched.

const ORIGIN = "http://localhost:7113";
afterEach(() => vi.unstubAllGlobals());

function setup() {
  vi.stubGlobal("window", { location: new URL(`${ORIGIN}/login`) });
  const seen: Array<{ url: string; method: string; proof: string | null; body: unknown }> = [];
  const original = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push({
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      proof: new Headers(init.headers).get("X-Requested-With"),
      body: init.body,
    });
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", original);
  return { wrapped: nextProxyFetch(original as unknown as typeof fetch), seen };
}

describe("the Next IdP proxy path in the export", () => {
  it("an /api/v1 call goes through the boundary with the browser proof, method and body kept", async () => {
    const { wrapped, seen } = setup();
    await wrapped("/api/idp/api/v1/auth/login", { method: "POST", body: '{"email":"a@b.test"}' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: "/bff/api/v1/auth/login",
      method: "POST",
      proof: "identuum-ui",
      body: '{"email":"a@b.test"}',
    });
  });

  it("the query string travels with the path", async () => {
    const { wrapped, seen } = setup();
    await wrapped(`${ORIGIN}/api/idp/api/v1/auth/organization-lookup?domain=x.test`);
    expect(seen[0]?.url).toBe("/bff/api/v1/auth/organization-lookup?domain=x.test");
  });

  it("a public route outside /api/v1 goes to the binary directly, without the proof", async () => {
    const { wrapped, seen } = setup();
    await wrapped("/api/idp/api/setup/status");
    expect(seen[0]).toMatchObject({ url: "/api/setup/status", proof: null });
  });

  it("anything else is untouched: other same-origin paths and every other origin", async () => {
    const { wrapped, seen } = setup();
    await wrapped("/api/status");
    await wrapped("https://elsewhere.test/api/idp/api/v1/validate");
    await wrapped("/bff/api/v1/validate", { headers: { "X-Requested-With": "identuum-ui" } });
    expect(seen.map((s) => s.url)).toEqual([
      "/api/status",
      "https://elsewhere.test/api/idp/api/v1/validate",
      "/bff/api/v1/validate",
    ]);
  });
});
