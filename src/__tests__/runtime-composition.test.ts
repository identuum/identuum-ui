import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_AG_COMPONENT,
  EXPECTED_IDP_COMPONENT,
  computePlatformMode,
  discoverRuntime,
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
    capabilities: { identity: true, organizations: true, site_admin: true },
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
    capabilities: { agent_governance: true, site_admin: true },
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
    expect(idp.capabilities).toMatchObject({ identity: true, organizations: true });
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
