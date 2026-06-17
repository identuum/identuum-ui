/**
 * Pins the per-backend liveness path the `/api/status` route hits
 * against each configured backend's base URL.
 *
 * Background. The route's pre-2026-06-16 implementation hard-coded
 * `/health` for both backends. identuum-idp-ce only mounts
 * `/healthz` (Kubernetes-convention, registered in
 * cmd/identuum-idp/serve.go); the probe therefore 404'd and the
 * logged-in site-admin overview rendered an alarming
 * "identuum-idp: unreachable" red chip even though the IDP was
 * fully reachable on the in-network DNS path the runtime
 * composition uses successfully for /api/v1/component. The fix
 * pins the IDP probe to /healthz while preserving AG's /health
 * probe (per task scope: do not broaden AG behavior unless
 * required).
 *
 * These tests intercept `fetch` so they can assert the exact URL
 * the route builds without depending on a live backend. They do
 * NOT exercise the cookie / runtime-config / NextResponse layers
 * — those are covered separately by integration tests against
 * the real customer-smoke stack.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/status/route";

// Stub the runtime config loader to advertise both backends
// configured and enabled, so the route's checkHealth helper runs
// for both. The base URLs are deliberately distinct so a
// concatenated-URL assertion below can prove the per-backend
// path branch fires correctly.
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: { enabled: true, internal_base_url: "http://identuum-idp:7123", public_base_url: "" },
    ag: { enabled: true, internal_base_url: "http://identuum-ag:7215", public_base_url: "" },
  }),
  idpBaseUrl: () => "http://identuum-idp:7123",
  agBaseUrl: () => "http://identuum-ag:7215",
}));

// deriveProductLabel is exercised by its own tests; we only need
// it to not throw on whatever body we hand back from the fake
// fetch.
vi.mock("@/lib/backend-product-labels", () => ({
  deriveProductLabel: (_domain: string, _body: unknown) => "stub-label",
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/status liveness paths", () => {
  it("probes /healthz on the IDP base URL (regression pin: pre-fix used /health and surfaced false-positive 'unreachable' on customer-smoke)", async () => {
    const observed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        observed.push(url);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idp.healthy).toBe(true);

    expect(observed).toContain("http://identuum-idp:7123/healthz");
    expect(observed).not.toContain("http://identuum-idp:7123/health");
  });

  it("preserves /health on the AG base URL (do not broaden AG behavior per task scope)", async () => {
    const observed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        observed.push(url);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ag.healthy).toBe(true);

    expect(observed).toContain("http://identuum-ag:7215/health");
    expect(observed).not.toContain("http://identuum-ag:7215/healthz");
  });

  it("does not concatenate the backend domain into the IDP path (paranoid pin)", async () => {
    // A historical refactor risk is templating something like
    // `${base}/health${z?}` and accidentally rendering `/healthz` for
    // AG too, or `/healthidp` for IDP, etc. This asserts the path is
    // EXACTLY one of /healthz or /health, never a join thereof.
    const observed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        observed.push(typeof input === "string" ? input : input.toString());
        return new Response("{}", { status: 200 });
      })
    );

    await GET();

    for (const url of observed) {
      const tail = url.split(/:\d+/).pop() ?? "";
      expect(tail === "/healthz" || tail === "/health").toBe(true);
    }
  });

  it("classifies the IDP as unreachable when /healthz returns non-2xx (no fallback to /health)", async () => {
    // Pins that the route does NOT silently fall back to /health on
    // a 404/5xx from /healthz. The IDP-CE binary's contract is that
    // /healthz is THE liveness endpoint; if it stops returning 200
    // the operator should see a real 'unreachable' signal, not a
    // success masked by a second-chance probe against /health.
    let idpProbeCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("identuum-idp")) {
          idpProbeCount += 1;
          return new Response("not found", { status: 404 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const res = await GET();
    const body = await res.json();
    expect(body.idp.healthy).toBe(false);
    expect(idpProbeCount).toBe(1);
  });
});
