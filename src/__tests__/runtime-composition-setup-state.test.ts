/**
 * Tests for the appliance setup-status probe added to runtime-composition.ts.
 * Covers fetchIdpSetupState in isolation and its integration into
 * discoverRuntime (IDP usable → probe; IDP unusable → no probe; older
 * backend 404 → setupState=null so the UI keeps default behaviour).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverRuntime, fetchIdpSetupState } from "../lib/runtime-composition";

function validIDPResponse(): Record<string, unknown> {
  return {
    component: "identuum-idp",
    version: "0.6.0",
    status: "ok",
    product: "identuum-idp-oss",
    capability_map_schema_version: "idp-capabilities.v1",
    capabilities: {
      identity_provider: true,
      component_discovery: true,
      license_status: true,
    },
    auth: { authority: "identuum-idp", provider_mode: "local" },
    license: { status: "valid", product: "identuum-idp-oss" },
  };
}

function validSetupRequiredResponse(): Record<string, unknown> {
  return {
    state: "setup_required",
    setup_complete: false,
    setup_token_required: true,
    product: "identuum-idp-oss",
    distribution: "oss",
    issuer: "http://localhost:7113",
    first_signing_key_exists: false,
    site_admin_exists: false,
    first_organization_exists: false,
    next_action:
      "Open the setup wizard and submit the first organization, the site administrator credentials, and the setup code from the data-volume file.",
  };
}

function validSetupCompleteResponse(): Record<string, unknown> {
  return {
    state: "setup_complete",
    setup_complete: true,
    setup_token_required: false,
    product: "identuum-idp-oss",
    distribution: "oss",
    issuer: "http://localhost:7113",
    first_signing_key_exists: true,
    site_admin_exists: true,
    first_organization_exists: true,
    next_action: "Setup is complete. Use the login page to sign in.",
  };
}

/**
 * urlAwareMockFetch returns a vi.fn() that resolves with a different
 * body per URL path, so a single test can exercise both the
 * /api/v1/component and the /api/setup/status calls discoverRuntime
 * makes.
 *
 * routes is keyed by URL suffix; the matcher prefers the longer
 * (most specific) suffix that matches the request URL. Returning
 * `null` from the route fn produces a 503 non-OK response; `undefined`
 * produces an aborted fetch.
 */
function urlAwareMockFetch(
  routes: Record<string, () => unknown | "non-ok" | "throw">
): typeof fetch {
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  return vi.fn().mockImplementation(async (url: string) => {
    for (const key of keys) {
      if (url.endsWith(key)) {
        const r = routes[key]();
        if (r === "non-ok") return { ok: false, status: 503 };
        if (r === "throw") throw new Error("ECONNREFUSED");
        return { ok: true, json: async () => r };
      }
    }
    return { ok: false, status: 404 };
  }) as unknown as typeof fetch;
}

describe("fetchIdpSetupState", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the setup_required view on a successful probe", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => validSetupRequiredResponse(),
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got).not.toBeNull();
    expect(got?.state).toBe("setup_required");
    expect(got?.setupTokenRequired).toBe(true);
    expect(got?.firstSigningKeyExists).toBe(false);
    expect(got?.siteAdminExists).toBe(false);
    expect(got?.firstOrganizationExists).toBe(false);
    expect(got?.nextAction).toContain("setup wizard");
  });

  it("returns the setup_complete view after wizard completion", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => validSetupCompleteResponse(),
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got?.state).toBe("setup_complete");
    expect(got?.setupTokenRequired).toBe(false);
    expect(got?.firstSigningKeyExists).toBe(true);
  });

  it("returns null when the endpoint 404s (older OSS backend)", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => "non-ok",
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => "throw",
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got).toBeNull();
  });

  it("returns null when the response shape is not an object", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => "not-json",
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got).toBeNull();
  });

  it("returns null when state is an unexpected value", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/setup/status": () => ({ state: "something_else" }),
      })
    );
    const got = await fetchIdpSetupState("http://localhost:7113");
    expect(got).toBeNull();
  });

  it("trims trailing slashes from the base URL when composing the probe URL", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => validSetupRequiredResponse() });
    vi.stubGlobal("fetch", spy);
    await fetchIdpSetupState("http://localhost:7113/");
    expect(spy).toHaveBeenCalledWith("http://localhost:7113/api/setup/status", expect.any(Object));
  });
});

describe("discoverRuntime — setup state integration", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches setupState=setup_required when IDP usable + probe succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () => validIDPResponse(),
        "/api/setup/status": () => validSetupRequiredResponse(),
      })
    );
    const state = await discoverRuntime("http://localhost:7113", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.setupState?.state).toBe("setup_required");
  });

  it("attaches setupState=null when IDP usable but probe 404s (older backend)", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () => validIDPResponse(),
        "/api/setup/status": () => "non-ok",
      })
    );
    const state = await discoverRuntime("http://localhost:7113", null);
    expect(state.components.idp.usable).toBe(true);
    expect(state.components.idp.setupState).toBeNull();
  });

  it("does not probe setup-status when IDP is not configured", async () => {
    const spy = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => validIDPResponse(),
    }));
    vi.stubGlobal("fetch", spy);
    await discoverRuntime(null, null);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not probe setup-status when IDP is configured but unreachable", async () => {
    let setupCalled = false;
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () => "throw",
        "/api/setup/status": () => {
          setupCalled = true;
          return validSetupRequiredResponse();
        },
      })
    );
    const state = await discoverRuntime("http://localhost:7113", null);
    expect(state.components.idp.usable).toBe(false);
    expect(setupCalled).toBe(false);
  });
});
