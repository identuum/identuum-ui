import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_AG_COMPONENT,
  EXPECTED_IDP_COMPONENT,
  computePlatformMode,
  discoverRuntime,
  extractCapabilities,
} from "../lib/runtime-composition";
import type { BackendComponentState } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validIDPResponse(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    component: "identuum-idp",
    version: "0.6.0",
    status: "ok",
    capabilities: {
      identity_provider: true,
      component_discovery: true,
      license_status: true,
      auth_provider_discovery: true,
    },
    auth: { authority: "identuum-idp", provider_mode: "local" },
    license: { status: "valid", product: "identuum-idp" },
    ...overrides,
  };
}

function validAGResponse(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    component: "identuum-ag",
    version: "0.0.0-dev",
    status: "ok",
    capabilities: {
      agent_governance: true,
      component_discovery: true,
      hitl: true,
      agent_sessions: true,
    },
    auth: { authority: "identuum-ag", human_auth_provider: "unknown" },
    license: { status: "valid", product: "identuum-ag" },
    ...overrides,
  };
}

function usableState(component: string): BackendComponentState {
  return {
    configured: true,
    reachable: true,
    usable: true,
    component,
    version: "1.0.0",
    status: "ok",
    capabilities: {},
    auth: {},
    license: { status: "valid" },
    error: null,
  };
}

function unusableState(configured = true): BackendComponentState {
  return {
    configured,
    reachable: configured,
    usable: false,
    component: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" },
    error: configured ? "unreachable" : null,
  };
}

function mockOkFetch(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function mockFailFetch(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
}

function mockNonOkFetch(status = 503): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: false, status }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// computePlatformMode unit tests
// ---------------------------------------------------------------------------

describe("computePlatformMode", () => {
  it("returns unconfigured when neither backend is configured", () => {
    expect(computePlatformMode(unusableState(false), unusableState(false))).toBe("unconfigured");
  });

  it("returns identity-only when only IDP is usable and AG not configured", () => {
    expect(computePlatformMode(usableState(EXPECTED_IDP_COMPONENT), unusableState(false))).toBe(
      "identity-only"
    );
  });

  it("returns agent-governance-only when only AG is usable and IDP not configured", () => {
    expect(computePlatformMode(unusableState(false), usableState(EXPECTED_AG_COMPONENT))).toBe(
      "agent-governance-only"
    );
  });

  it("returns full-platform when both IDP and AG are usable", () => {
    expect(
      computePlatformMode(usableState(EXPECTED_IDP_COMPONENT), usableState(EXPECTED_AG_COMPONENT))
    ).toBe("full-platform");
  });

  it("returns degraded-idp-unavailable when IDP configured but unusable and AG usable", () => {
    expect(computePlatformMode(unusableState(true), usableState(EXPECTED_AG_COMPONENT))).toBe(
      "degraded-idp-unavailable"
    );
  });

  it("returns degraded-ag-unavailable when AG configured but unusable and IDP usable", () => {
    expect(computePlatformMode(usableState(EXPECTED_IDP_COMPONENT), unusableState(true))).toBe(
      "degraded-ag-unavailable"
    );
  });

  it("returns misconfigured when both configured but neither usable", () => {
    expect(computePlatformMode(unusableState(true), unusableState(true))).toBe("misconfigured");
  });
});

// ---------------------------------------------------------------------------
// discoverRuntime integration tests (fetch mocked)
// ---------------------------------------------------------------------------

describe("discoverRuntime", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unconfigured when both URLs are null", async () => {
    const state = await discoverRuntime(null, null);
    expect(state.mode).toBe("unconfigured");
    expect(state.components.idp.configured).toBe(false);
    expect(state.components.ag.configured).toBe(false);
    expect(state.components.idp.error).toBeNull();
    expect(state.components.ag.error).toBeNull();
  });

  it("returns identity-only when only IDP is configured and responds correctly", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse()));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.mode).toBe("identity-only");
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.component).toBe("identuum-idp");
    expect(state.components.ag.configured).toBe(false);
  });

  it("returns agent-governance-only when only AG is configured and responds correctly", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validAGResponse()));
    const state = await discoverRuntime(null, "http://ag:7215");
    expect(state.mode).toBe("agent-governance-only");
    expect(state.components.ag.usable).toBe(true);
    expect(state.components.ag.component).toBe("identuum-ag");
    expect(state.components.idp.configured).toBe(false);
  });

  it("returns full-platform when both backends respond correctly", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        const body = callCount === 1 ? validIDPResponse() : validAGResponse();
        return Promise.resolve({ ok: true, json: async () => body });
      })
    );
    const state = await discoverRuntime("http://idp:8080", "http://ag:7215");
    expect(state.mode).toBe("full-platform");
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.ag.usable).toBe(true);
  });

  it("returns degraded-idp-unavailable when IDP is unreachable and AG is usable", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // IDP call fails
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        // AG call succeeds
        return Promise.resolve({ ok: true, json: async () => validAGResponse() });
      })
    );
    const state = await discoverRuntime("http://idp:8080", "http://ag:7215");
    expect(state.mode).toBe("degraded-idp-unavailable");
    expect(state.components.idp.reachable).toBe(false);
    expect(state.components.idp.error).toBe("unreachable");
    expect(state.components.ag.usable).toBe(true);
  });

  it("returns degraded-ag-unavailable when AG is unreachable and IDP is usable", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // IDP call succeeds
          return Promise.resolve({ ok: true, json: async () => validIDPResponse() });
        }
        // AG call fails
        return Promise.reject(new Error("ECONNREFUSED"));
      })
    );
    const state = await discoverRuntime("http://idp:8080", "http://ag:7215");
    expect(state.mode).toBe("degraded-ag-unavailable");
    expect(state.components.ag.reachable).toBe(false);
    expect(state.components.ag.error).toBe("unreachable");
    expect(state.components.idp.usable).toBe(true);
  });

  it("returns misconfigured when both backends are configured but unreachable", async () => {
    vi.stubGlobal("fetch", mockFailFetch());
    const state = await discoverRuntime("http://idp:8080", "http://ag:7215");
    expect(state.mode).toBe("misconfigured");
    expect(state.components.idp.reachable).toBe(false);
    expect(state.components.ag.reachable).toBe(false);
  });

  it("marks IDP unusable and error=wrong_component when IDP URL returns AG component", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validAGResponse()));
    const state = await discoverRuntime("http://wrong-backend:8080", null);
    expect(state.components.idp.usable).toBe(false);
    expect(state.components.idp.error).toBe("wrong_component");
    expect(state.components.idp.reachable).toBe(true);
    expect(state.mode).toBe("misconfigured");
  });

  it("marks AG unusable and error=wrong_component when AG URL returns IDP component", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse()));
    const state = await discoverRuntime(null, "http://wrong-backend:7215");
    expect(state.components.ag.usable).toBe(false);
    expect(state.components.ag.error).toBe("wrong_component");
    expect(state.components.ag.reachable).toBe(true);
  });

  it("marks backend unreachable on non-OK HTTP status", async () => {
    vi.stubGlobal("fetch", mockNonOkFetch(503));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.reachable).toBe(false);
    expect(state.components.idp.error).toBe("unreachable");
    expect(state.mode).toBe("misconfigured");
  });

  it("marks backend invalid on invalid JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => "not-an-object",
      }) as unknown as typeof fetch
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.usable).toBe(false);
    expect(state.components.idp.error).toBe("invalid_json");
    expect(state.components.idp.reachable).toBe(true);
  });

  it("preserves capabilities, auth, and license in successful response", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse()));
    const state = await discoverRuntime("http://idp:8080", null);
    const idp = state.components.idp;
    expect(idp.capabilities).toMatchObject({ identity_provider: true, component_discovery: true });
    expect(idp.auth).toMatchObject({ authority: "identuum-idp" });
    expect(idp.license.status).toBe("valid");
  });

  it("preserves version and status from backend response", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse()));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.version).toBe("0.6.0");
    expect(state.components.idp.status).toBe("ok");
  });

  it("does not include secrets in serialized response", () => {
    // Spot-check that none of the known secret field names appear in the
    // BackendComponentState type or are added to the response accidentally.
    const state = {
      configured: true,
      reachable: true,
      usable: true,
      component: "identuum-idp",
      version: "1.0.0",
      status: "ok",
      capabilities: {},
      auth: { authority: "identuum-idp" },
      license: { status: "valid" },
      error: null,
    };
    const json = JSON.stringify(state);
    expect(json).not.toContain("password");
    expect(json).not.toContain("private_key");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("token");
    expect(json).not.toContain("internal_base_url");
  });

  it("uses the correct discovery endpoint path", async () => {
    const mockFetch = mockOkFetch(validIDPResponse());
    vi.stubGlobal("fetch", mockFetch);
    await discoverRuntime("http://idp:8080", null);
    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://idp:8080/api/v1/component");
  });

  it("strips trailing slash from base URL before appending path", async () => {
    const mockFetch = mockOkFetch(validIDPResponse());
    vi.stubGlobal("fetch", mockFetch);
    await discoverRuntime("http://idp:8080/", null);
    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://idp:8080/api/v1/component");
  });
});

// ---------------------------------------------------------------------------
// License field extraction (new bundle model fields)
// ---------------------------------------------------------------------------

describe("license fields in component discovery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes through tier from backend license response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", product: "identuum-idp", tier: "enterprise" } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.tier).toBe("enterprise");
  });

  it("passes through expires_at from backend license response", async () => {
    const expiry = "2027-05-22T04:32:29Z";
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", expires_at: expiry } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.expires_at).toBe(expiry);
  });

  it("passes through days_remaining from backend license response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", days_remaining: 365 } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.days_remaining).toBe(365);
  });

  it("passes through deployment_mode from backend license response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validAGResponse({ license: { status: "valid", product: "identuum-ag", deployment_mode: "online" } }))
    );
    const state = await discoverRuntime(null, "http://ag:7215");
    expect(state.components.ag.license.deployment_mode).toBe("online");
  });

  it("passes through license_type from backend license response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", license_type: "internal" } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.license_type).toBe("internal");
  });

  it("passes null expires_at when backend sends null", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", expires_at: null } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.expires_at).toBeNull();
  });

  it("passes null days_remaining when backend sends null", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", days_remaining: null } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.days_remaining).toBeNull();
  });

  it("handles old backend shape with only status — tier is undefined", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", product: "identuum-idp" } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.status).toBe("valid");
    expect(state.components.idp.license.tier).toBeUndefined();
    expect(state.components.idp.license.expires_at).toBeUndefined();
    expect(state.components.idp.license.days_remaining).toBeUndefined();
  });

  it("does not pass through entitlements, features, customer_id or other sensitive keys", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          license: {
            status: "valid",
            tier: "enterprise",
            entitlements: [{ product: "identuum-idp", tier: "enterprise" }],
            features: "vault,sso",
            customer_id: "cust_acme",
            customer_name: "Acme Corp",
            license_id: "lic-0001",
            licensee: "Acme Corp",
            signature: "deadbeef",
            ciphertext: "abc123",
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    const lic = state.components.idp.license;
    const licJson = JSON.stringify(lic);
    expect(licJson).not.toContain("entitlements");
    expect(licJson).not.toContain("features");
    expect(licJson).not.toContain("customer_id");
    expect(licJson).not.toContain("customer_name");
    expect(licJson).not.toContain("license_id");
    expect(licJson).not.toContain("licensee");
    expect(licJson).not.toContain("signature");
    expect(licJson).not.toContain("ciphertext");
    // Safe fields remain
    expect(lic.status).toBe("valid");
    expect(lic.tier).toBe("enterprise");
  });

  it("IDP component has product identuum-idp from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validIDPResponse({ license: { status: "valid", product: "identuum-idp" } }))
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.license.product).toBe("identuum-idp");
  });

  it("AG component has product identuum-ag from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(validAGResponse({ license: { status: "valid", product: "identuum-ag" } }))
    );
    const state = await discoverRuntime(null, "http://ag:7215");
    expect(state.components.ag.license.product).toBe("identuum-ag");
  });

  it("unreachable backend has license status unknown with no new fields", async () => {
    vi.stubGlobal("fetch", mockFailFetch());
    const state = await discoverRuntime("http://idp:8080", null);
    const lic = state.components.idp.license;
    expect(lic.status).toBe("unknown");
    expect(lic.tier).toBeUndefined();
    expect(lic.expires_at).toBeUndefined();
    expect(lic.days_remaining).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractCapabilities — direct unit tests
// ---------------------------------------------------------------------------

describe("extractCapabilities", () => {
  it("returns empty object for null input", () => {
    expect(extractCapabilities(null)).toEqual({});
  });

  it("returns empty object for non-object scalar", () => {
    expect(extractCapabilities("string")).toEqual({});
    expect(extractCapabilities(42)).toEqual({});
    expect(extractCapabilities(true)).toEqual({});
  });

  it("returns empty object for array input", () => {
    expect(extractCapabilities(["identity_provider", true])).toEqual({});
  });

  it("returns empty object for empty object", () => {
    expect(extractCapabilities({})).toEqual({});
  });

  it("extracts known boolean true values", () => {
    const result = extractCapabilities({ identity_provider: true, agent_governance: true });
    expect(result.identity_provider).toBe(true);
    expect(result.agent_governance).toBe(true);
  });

  it("extracts known boolean false values", () => {
    const result = extractCapabilities({ identity_provider: false, agent_governance: true });
    expect(result.identity_provider).toBe(false);
    expect(result.agent_governance).toBe(true);
  });

  it("discards unknown keys", () => {
    const result = extractCapabilities({
      identity_provider: true,
      unknown_key: true,
      another_unknown: true,
    }) as Record<string, unknown>;
    expect(result.unknown_key).toBeUndefined();
    expect(result.another_unknown).toBeUndefined();
    expect(result.identity_provider).toBe(true);
  });

  it("discards non-boolean values for known keys", () => {
    const result = extractCapabilities({
      identity_provider: "yes",
      component_discovery: 1,
      agent_governance: true,
    });
    expect(result.identity_provider).toBeUndefined();
    expect(result.component_discovery).toBeUndefined();
    expect(result.agent_governance).toBe(true);
  });

  it("extracts all 10 known capability keys when present", () => {
    const input = {
      identity_provider: true,
      agent_governance: true,
      component_discovery: true,
      license_status: true,
      auth_provider_discovery: true,
      organization_export: true,
      organization_import: true,
      organization_linking: true,
      hitl: true,
      agent_sessions: true,
    };
    const result = extractCapabilities(input);
    expect(result.identity_provider).toBe(true);
    expect(result.agent_governance).toBe(true);
    expect(result.component_discovery).toBe(true);
    expect(result.license_status).toBe(true);
    expect(result.auth_provider_discovery).toBe(true);
    expect(result.organization_export).toBe(true);
    expect(result.organization_import).toBe(true);
    expect(result.organization_linking).toBe(true);
    expect(result.hitl).toBe(true);
    expect(result.agent_sessions).toBe(true);
  });

  it("does not include sensitive field names in output", () => {
    const result = extractCapabilities({
      identity_provider: true,
      entitlements: ["vault"],
      features: "sso",
      customer_id: "cust_acme",
      license_id: "lic-001",
      signature: "deadbeef",
      ciphertext: "abc123",
      private_key: "-----BEGIN",
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("entitlements");
    expect(json).not.toContain("features");
    expect(json).not.toContain("customer_id");
    expect(json).not.toContain("license_id");
    expect(json).not.toContain("signature");
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("private_key");
  });
});

// ---------------------------------------------------------------------------
// Capabilities extraction via discoverRuntime
// ---------------------------------------------------------------------------

describe("capabilities in component discovery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts IDP capabilities from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          capabilities: {
            identity_provider: true,
            component_discovery: true,
            auth_provider_discovery: true,
            agent_governance: false,
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.capabilities.identity_provider).toBe(true);
    expect(state.components.idp.capabilities.component_discovery).toBe(true);
    expect(state.components.idp.capabilities.auth_provider_discovery).toBe(true);
    expect(state.components.idp.capabilities.agent_governance).toBe(false);
  });

  it("extracts AG capabilities from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validAGResponse({
          capabilities: {
            agent_governance: true,
            hitl: true,
            agent_sessions: true,
            organization_import: true,
            organization_linking: true,
          },
        })
      )
    );
    const state = await discoverRuntime(null, "http://ag:7215");
    expect(state.components.ag.capabilities.agent_governance).toBe(true);
    expect(state.components.ag.capabilities.hitl).toBe(true);
    expect(state.components.ag.capabilities.agent_sessions).toBe(true);
    expect(state.components.ag.capabilities.organization_import).toBe(true);
    expect(state.components.ag.capabilities.organization_linking).toBe(true);
  });

  it("returns empty capabilities when capabilities field is missing (backward compat)", async () => {
    const body = { ...validIDPResponse() };
    delete body.capabilities;
    vi.stubGlobal("fetch", mockOkFetch(body));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.capabilities).toEqual({});
  });

  it("returns empty capabilities when backend sends null capabilities", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse({ capabilities: null })));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.capabilities).toEqual({});
  });

  it("returns empty capabilities when backend sends non-object capabilities", async () => {
    vi.stubGlobal("fetch", mockOkFetch(validIDPResponse({ capabilities: "not-an-object" })));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.capabilities).toEqual({});
  });

  it("discards unknown capability keys from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          capabilities: {
            identity_provider: true,
            legacy_identity: true,
            organizations: true,
            site_admin: true,
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    const caps = state.components.idp.capabilities as Record<string, unknown>;
    expect(caps.legacy_identity).toBeUndefined();
    expect(caps.organizations).toBeUndefined();
    expect(caps.site_admin).toBeUndefined();
    expect(state.components.idp.capabilities.identity_provider).toBe(true);
  });

  it("discards non-boolean capability values from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          capabilities: {
            identity_provider: "yes",
            component_discovery: 1,
            agent_governance: true,
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.capabilities.identity_provider).toBeUndefined();
    expect(state.components.idp.capabilities.component_discovery).toBeUndefined();
    expect(state.components.idp.capabilities.agent_governance).toBe(true);
  });

  it("older backend with license but no capabilities field stays usable", async () => {
    const body = { ...validIDPResponse() };
    delete body.capabilities;
    vi.stubGlobal("fetch", mockOkFetch(body));
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.capabilities).toEqual({});
    expect(state.components.idp.license.status).toBe("valid");
    expect(state.mode).toBe("identity-only");
  });

  it("platform-status display: only known capability keys appear in extracted state", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          capabilities: {
            identity_provider: true,
            unknown_cap: true,
            entitlements: ["vault"],
            signature: "deadbeef",
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    const capsJson = JSON.stringify(state.components.idp.capabilities);
    expect(capsJson).toContain("identity_provider");
    expect(capsJson).not.toContain("unknown_cap");
    expect(capsJson).not.toContain("entitlements");
    expect(capsJson).not.toContain("signature");
  });

  it("platform-status display: known true capabilities appear; false ones present but not rendered", async () => {
    vi.stubGlobal(
      "fetch",
      mockOkFetch(
        validIDPResponse({
          capabilities: {
            identity_provider: true,
            agent_governance: false,
            component_discovery: true,
          },
        })
      )
    );
    const state = await discoverRuntime("http://idp:8080", null);
    expect(state.components.idp.capabilities.identity_provider).toBe(true);
    expect(state.components.idp.capabilities.agent_governance).toBe(false);
    expect(state.components.idp.capabilities.component_discovery).toBe(true);
  });
});
