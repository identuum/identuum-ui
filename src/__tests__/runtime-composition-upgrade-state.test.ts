/**
 * Tests for the OSS-to-CE upgrade-status probe added to
 * runtime-composition.ts. Covers fetchIdpUpgradeState in isolation
 * and its integration into discoverRuntime (IDP base URL configured
 * → probe; older OSS backend 404 → upgradeState=null so the UI
 * keeps default behaviour; upgrade-mode CE binary unreachable on
 * /api/v1/component but reachable on /api/upgrade/status → still
 * probes and surfaces the state).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverRuntime,
  fetchIdpUpgradeState,
  upgradeStateNeedsWizard,
} from "../lib/runtime-composition";

function validIDPResponse(): Record<string, unknown> {
  return {
    component: "identuum-idp",
    version: "0.6.0",
    status: "ok",
    product: "identuum-idp-ce",
    capability_map_schema_version: "idp-capabilities.v1",
    capabilities: { identity_provider: true, component_discovery: true },
    auth: { authority: "identuum-idp", provider_mode: "local" },
    license: { status: "valid", product: "identuum-idp-ce" },
  };
}

function ossDatabaseDetectedBody(): Record<string, unknown> {
  return {
    state: "oss_database_detected",
    product: "identuum-idp-ce",
    distribution: "ce",
    upgrade_available: true,
    ce_migrations_current: false,
    oss_database_detected: true,
    backup_required: true,
    pending_count: 7,
    applied_version: "0021",
    target_version: "0028",
    next_action: "Existing OSS deployment detected; confirm backup.",
  };
}

function ceMigrationsCurrentBody(): Record<string, unknown> {
  return {
    state: "ce_migrations_current",
    product: "identuum-idp-ce",
    distribution: "ce",
    upgrade_available: false,
    ce_migrations_current: true,
    oss_database_detected: true,
    backup_required: false,
    pending_count: 0,
    next_action: "No upgrade required.",
  };
}

function urlAwareMockFetch(map: Record<string, () => Response>): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    for (const key of Object.keys(map)) {
      if (url.endsWith(key)) return map[key]();
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchIdpUpgradeState", () => {
  it("projects the oss_database_detected body shape", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/upgrade/status": () =>
          new Response(JSON.stringify(ossDatabaseDetectedBody()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      })
    );
    const got = await fetchIdpUpgradeState("http://idp:7113");
    expect(got).not.toBeNull();
    if (!got) return;
    expect(got.state).toBe("oss_database_detected");
    expect(got.distribution).toBe("ce");
    expect(got.upgradeAvailable).toBe(true);
    expect(got.ossDatabaseDetected).toBe(true);
    expect(got.backupRequired).toBe(true);
    expect(got.nextAction).toContain("Existing OSS");
  });

  it("returns null on 404 (older OSS backend without the endpoint)", async () => {
    vi.stubGlobal("fetch", urlAwareMockFetch({}));
    const got = await fetchIdpUpgradeState("http://idp:7113");
    expect(got).toBeNull();
  });

  it("returns null on non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/upgrade/status": () => new Response("not-json", { status: 200 }),
      })
    );
    const got = await fetchIdpUpgradeState("http://idp:7113");
    expect(got).toBeNull();
  });

  it("returns null on unknown state value", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/upgrade/status": () =>
          new Response(JSON.stringify({ state: "made_up_state" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      })
    );
    const got = await fetchIdpUpgradeState("http://idp:7113");
    expect(got).toBeNull();
  });

  it("returns null on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network failure")));
    const got = await fetchIdpUpgradeState("http://idp:7113");
    expect(got).toBeNull();
  });
});

describe("discoverRuntime integration", () => {
  it("probes the upgrade endpoint when IDP base URL is configured and reachable", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () =>
          new Response(JSON.stringify(validIDPResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        "/api/setup/status": () => new Response("", { status: 404 }),
        "/api/upgrade/status": () =>
          new Response(JSON.stringify(ossDatabaseDetectedBody()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      })
    );
    const state = await discoverRuntime("http://idp:7113", null);
    expect(state.components.idp.upgradeState).not.toBeNull();
    expect(state.components.idp.upgradeState?.state).toBe("oss_database_detected");
  });

  it("probes the upgrade endpoint EVEN WHEN /api/v1/component is unreachable (upgrade-mode CE)", async () => {
    // Upgrade-mode CE binary mounts only /healthz + /api/upgrade/*,
    // so the component discovery probe fails — but the upgrade probe
    // succeeds. The runtime composition must still surface the
    // upgradeState so the root page can redirect to /upgrade.
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () => new Response("", { status: 404 }),
        "/api/upgrade/status": () =>
          new Response(JSON.stringify(ossDatabaseDetectedBody()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      })
    );
    const state = await discoverRuntime("http://idp:7113", null);
    expect(state.components.idp.usable).toBe(false);
    expect(state.components.idp.upgradeState).not.toBeNull();
    expect(state.components.idp.upgradeState?.state).toBe("oss_database_detected");
  });

  it("does not probe when IDP base URL is null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const state = await discoverRuntime(null, null);
    expect(state.components.idp.upgradeState).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats older OSS backend (no upgrade endpoint) as upgradeState=null", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () =>
          new Response(JSON.stringify({ ...validIDPResponse(), product: "identuum-idp-oss" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        "/api/setup/status": () => new Response("", { status: 404 }),
        // No /api/upgrade/status handler — 404 by default.
      })
    );
    const state = await discoverRuntime("http://idp:7113", null);
    expect(state.components.idp.upgradeState).toBeNull();
  });

  it("preserves ce_migrations_current state (no-op deployment)", async () => {
    vi.stubGlobal(
      "fetch",
      urlAwareMockFetch({
        "/api/v1/component": () =>
          new Response(JSON.stringify(validIDPResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        "/api/setup/status": () => new Response("", { status: 404 }),
        "/api/upgrade/status": () =>
          new Response(JSON.stringify(ceMigrationsCurrentBody()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      })
    );
    const state = await discoverRuntime("http://idp:7113", null);
    expect(state.components.idp.upgradeState?.state).toBe("ce_migrations_current");
    expect(upgradeStateNeedsWizard("ce_migrations_current")).toBe(false);
  });
});
