/**
 * platform-status-ag-capability-display.test.ts
 *
 * Pins the /platform-status page behavior added by
 * cdx1-20260609-ag-oss-ui-platform-status-capability-display:
 *
 * 1. The runtime-composition fetcher carries the new top-level
 *    `product` and `capability_map_schema_version` fields through
 *    to BackendComponentState on the success, wrong-component, and
 *    invalid-json paths, and explicitly nulls them on the
 *    unreachable / not-configured paths.
 *
 * 2. The /platform-status page (`src/app/platform-status/page.tsx`)
 *    surfaces those backend-identity facts in the AG BackendCard via
 *    two dedicated rows (`Backend product`, `Capability schema`),
 *    and only when the backend actually reports them — preserving
 *    unknown/unavailable semantics for unreachable / wrong-component /
 *    not-configured states.
 *
 * 3. Explicit-false CE-only capabilities (e.g. hitl,
 *    organization_export, organization_import) reported by AG OSS
 *    remain rendered as Unavailable (not silently dropped) through
 *    the existing CapabilitiesList filter (which already keeps
 *    explicit false and drops only `unknown`).
 *
 * Style: source-invariant + fetcher unit tests. No React render —
 * matches the existing src/__tests__ test style (compare with
 * idp-oss-route-surface-matrix.test.ts and runtime-composition.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverRuntime,
  extractCapabilities,
  getCapabilityAvailability,
} from "../lib/runtime-composition";

const ROOT = resolve(__dirname, "..");
const PLATFORM_STATUS_SOURCE = readFileSync(resolve(ROOT, "app/platform-status/page.tsx"), "utf-8");

/** Live AG OSS post-fix payload. Must match the contract recorded in
 *  wiki/repos/identuum-ag-oss.md § "cdx1 — AG↔UI component-discovery
 *  wire-shape fix (2026-06-09)". */
function liveAGOSSResponse(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    component: "identuum-ag",
    product: "identuum-ag-oss",
    capability_map_schema_version: "ag-capabilities.v1",
    version: "0.0.0-dev",
    status: "ok",
    capabilities: {
      identity_provider: true,
      agent_governance: true,
      component_discovery: true,
      license_status: true,
      // AG-32 (2026-06-11) flipped this to true — both /api/v1/auth-providers
      // and /admin/identity-providers are live in OSS.
      auth_provider_discovery: true,
      organization_linking: false,
      agent_sessions: true,
      organizations: false,
      organization_export: false,
      organization_import: false,
      trusted_oidc: false,
      hitl: false,
      mcp: false,
      site_admin: false,
    },
    auth: { authority: "identuum-ag-oss", human_auth_provider: "oidc" },
    license: { status: "valid", product: "identuum-ag-oss", tier: "starter" },
    ...overrides,
  };
}

function mockOkFetch(body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

function mockFailFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
}

describe("runtime-composition fetcher carries backend-identity fields", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AG OSS success path: product and capability_map_schema_version are surfaced", async () => {
    vi.stubGlobal("fetch", mockOkFetch(liveAGOSSResponse()));
    const state = await discoverRuntime(null, "http://ag-oss:7215");
    const ag = state.components.ag;
    expect(ag.usable).toBe(true);
    expect(ag.product).toBe("identuum-ag-oss");
    expect(ag.capability_map_schema_version).toBe("ag-capabilities.v1");
  });

  it("wrong_component path still surfaces product and schema when present (operator visibility)", async () => {
    vi.stubGlobal("fetch", mockOkFetch(liveAGOSSResponse({ component: "identuum-ag-oss" })));
    const state = await discoverRuntime(null, "http://ag-oss:7215");
    const ag = state.components.ag;
    expect(ag.usable).toBe(false);
    expect(ag.error).toBe("wrong_component");
    // The product/schema fields remain available so the operator can see
    // what the misbehaving backend reported. Capabilities are still empty
    // (not silently flipped to false) and the license collapses to unknown.
    expect(ag.product).toBe("identuum-ag-oss");
    expect(ag.capability_map_schema_version).toBe("ag-capabilities.v1");
    expect(ag.capabilities).toEqual({});
    expect(ag.license.status).toBe("unknown");
  });

  it("unreachable backend: product and capability_map_schema_version are null (unknown/unavailable preserved)", async () => {
    vi.stubGlobal("fetch", mockFailFetch());
    const state = await discoverRuntime(null, "http://ag-oss:7215");
    const ag = state.components.ag;
    expect(ag.reachable).toBe(false);
    expect(ag.usable).toBe(false);
    expect(ag.product).toBeNull();
    expect(ag.capability_map_schema_version).toBeNull();
    // Capability flags stay empty — no silent false.
    expect(ag.capabilities).toEqual({});
    expect(ag.license.status).toBe("unknown");
  });

  it("not configured AG: product and capability_map_schema_version are null", async () => {
    const state = await discoverRuntime(null, null);
    const ag = state.components.ag;
    expect(ag.configured).toBe(false);
    expect(ag.product).toBeNull();
    expect(ag.capability_map_schema_version).toBeNull();
  });

  it("backend that omits the optional fields (older responder) is still usable; new fields stay null", async () => {
    // Older AG-side responder that does not yet carry product or
    // capability_map_schema_version. Must remain usable.
    vi.stubGlobal(
      "fetch",
      mockOkFetch({
        component: "identuum-ag",
        version: "0.0.0-legacy",
        status: "ok",
        capabilities: { agent_governance: true, component_discovery: true },
        auth: { authority: "identuum-ag", human_auth_provider: "oidc" },
        license: { status: "valid" },
      })
    );
    const state = await discoverRuntime(null, "http://ag-legacy:7215");
    const ag = state.components.ag;
    expect(ag.usable).toBe(true);
    expect(ag.product).toBeNull();
    expect(ag.capability_map_schema_version).toBeNull();
  });

  it("explicit-false CE-only capabilities (hitl, organization_export, organization_import) remain visible as unavailable", () => {
    const caps = extractCapabilities(liveAGOSSResponse().capabilities);
    // The CapabilitiesList rendering filter drops only `unknown`; explicit
    // `false` remains and is rendered as "Unavailable". Pin both the source
    // of truth and the visible-vs-hidden classification.
    expect(getCapabilityAvailability(caps, "hitl")).toBe("unavailable");
    expect(getCapabilityAvailability(caps, "organization_export")).toBe("unavailable");
    expect(getCapabilityAvailability(caps, "organization_import")).toBe("unavailable");
    // Sanity: a true flag is still available.
    expect(getCapabilityAvailability(caps, "agent_governance")).toBe("available");
  });
});

describe("/platform-status page source pins the new backend-identity rows", () => {
  it("renders a Backend product row gated on backend.product truthiness", () => {
    // The new row must be present in source AND must be gated on the
    // optional truthy product field — never hardcoded.
    expect(PLATFORM_STATUS_SOURCE).toMatch(
      /\{backend\.product\s*&&\s*<StatusRow label="Backend product" value=\{backend\.product\} \/>\}/
    );
  });

  it("renders a Capability schema row gated on backend.capability_map_schema_version truthiness", () => {
    // Match the multi-line JSX gate that wraps the StatusRow with a
    // truthy guard on capability_map_schema_version. Pinning the gate
    // ensures the row never appears for unreachable / not-configured AG.
    expect(PLATFORM_STATUS_SOURCE).toContain("backend.capability_map_schema_version &&");
    expect(PLATFORM_STATUS_SOURCE).toContain('label="Capability schema"');
    expect(PLATFORM_STATUS_SOURCE).toContain("value={backend.capability_map_schema_version}");
  });

  it("AG BackendCard is still wired with expectedComponent=identuum-ag (family identifier)", () => {
    expect(PLATFORM_STATUS_SOURCE).toMatch(/label="Agent Governance \(AG\)"/);
    expect(PLATFORM_STATUS_SOURCE).toMatch(/expectedComponent="identuum-ag"/);
  });

  it("page imports BackendComponentState for type-safe rendering (no untyped any)", () => {
    expect(PLATFORM_STATUS_SOURCE).toContain("BackendComponentState");
  });

  it("capability rendering still filters only unknown — explicit false stays visible as Unavailable", () => {
    // Source-of-truth pin: the CapabilitiesList only drops `unknown`.
    // Explicit `false` capabilities (e.g. CE-only) survive and render
    // as "Unavailable", consistent with the
    // implementation_requirements:preserve-explicit-false rule.
    expect(PLATFORM_STATUS_SOURCE).toContain('availability !== "unknown"');
    expect(PLATFORM_STATUS_SOURCE).toContain('"Available"');
    expect(PLATFORM_STATUS_SOURCE).toContain('"Unavailable"');
  });

  it("does not hardcode any AG capability as true (no static availability booleans for AG)", () => {
    // The CE behavior posture demands that no capability is presented
    // as available unless the live backend says so. Guard against a
    // future regression that inlines `hitl: true` etc. directly in the
    // page source.
    expect(PLATFORM_STATUS_SOURCE).not.toMatch(/hitl:\s*true/);
    expect(PLATFORM_STATUS_SOURCE).not.toMatch(/organization_export:\s*true/);
    expect(PLATFORM_STATUS_SOURCE).not.toMatch(/organization_import:\s*true/);
    expect(PLATFORM_STATUS_SOURCE).not.toMatch(/mcp:\s*true/);
    expect(PLATFORM_STATUS_SOURCE).not.toMatch(/trusted_oidc:\s*true/);
  });
});
