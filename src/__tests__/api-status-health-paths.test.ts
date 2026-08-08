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
  it("probes /healthz FIRST on the IDP base URL and stops there when it answers (CE pin: pre-fix used /health and surfaced false-positive 'unreachable' on customer-smoke)", async () => {
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
    // A 200 from /healthz must SHORT-CIRCUIT: no second probe of /health.
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

  it("falls back to /health when /healthz 404s (released identuum-idp-oss mounts /health, not /healthz) and reports healthy", async () => {
    // CROSS-TIER pin (THE-ALL-GREEN-SUITE): identuum-idp-ce answers /healthz;
    // released identuum-idp-oss v0.3.0 404s /healthz and answers /health. The
    // probe must try the CE path first and fall back to the OSS path, so both
    // tiers report healthy without a false 'unreachable' chip.
    const observed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        observed.push(url);
        if (url.endsWith("identuum-idp:7123/healthz")) {
          return new Response("not found", { status: 404 });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const res = await GET();
    const body = await res.json();
    expect(body.idp.healthy).toBe(true);
    // Ordered probe: /healthz attempted BEFORE the /health fallback.
    const idpProbes = observed.filter((u) => u.includes("identuum-idp"));
    expect(idpProbes).toEqual([
      "http://identuum-idp:7123/healthz",
      "http://identuum-idp:7123/health",
    ]);
  });

  it("classifies the IDP as unreachable only when BOTH /healthz and /health fail", async () => {
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
    // Both tiers' paths were exhausted before declaring unreachable.
    expect(idpProbeCount).toBe(2);
  });
});
