import { describe, expect, it } from "vitest";
import { navigationVisibility } from "../lib/navigation-mode";
import type { BackendComponentState, PlatformMode, RuntimeState } from "../lib/types";

// ---------------------------------------------------------------------------
// navigationVisibility — mode-to-nav-visibility mapping
// ---------------------------------------------------------------------------

describe("navigationVisibility", () => {
  it("identity-only: shows Identity navigation, hides AG navigation", () => {
    const v = navigationVisibility("identity-only");
    expect(v.showIdentityNavigation).toBe(true);
    expect(v.showAgNavigation).toBe(false);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });

  it("agent-governance-only: shows AG navigation, hides Identity navigation", () => {
    const v = navigationVisibility("agent-governance-only");
    expect(v.showAgNavigation).toBe(true);
    expect(v.showIdentityNavigation).toBe(false);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });

  it("full-platform: shows both Identity and AG navigation", () => {
    const v = navigationVisibility("full-platform");
    expect(v.showIdentityNavigation).toBe(true);
    expect(v.showAgNavigation).toBe(true);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });

  it("degraded-ag-unavailable: shows Identity navigation and AG-unavailable notice", () => {
    const v = navigationVisibility("degraded-ag-unavailable");
    expect(v.showIdentityNavigation).toBe(true);
    expect(v.showAgNavigation).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(true);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });

  it("degraded-idp-unavailable: shows AG navigation and IDP-unavailable notice", () => {
    const v = navigationVisibility("degraded-idp-unavailable");
    expect(v.showAgNavigation).toBe(true);
    expect(v.showIdentityNavigation).toBe(false);
    expect(v.showIdpUnavailableNotice).toBe(true);
    expect(v.showAgUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });

  it("misconfigured: hides both navigation surfaces, shows misconfigured flag", () => {
    const v = navigationVisibility("misconfigured");
    expect(v.showIdentityNavigation).toBe(false);
    expect(v.showAgNavigation).toBe(false);
    expect(v.showMisconfigured).toBe(true);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
  });

  it("unconfigured: hides both navigation surfaces, shows setup-required flag", () => {
    const v = navigationVisibility("unconfigured");
    expect(v.showIdentityNavigation).toBe(false);
    expect(v.showAgNavigation).toBe(false);
    expect(v.showSetupRequired).toBe(true);
    expect(v.showMisconfigured).toBe(false);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Availability/notice mutual exclusivity
// ---------------------------------------------------------------------------

describe("navigationVisibility invariants", () => {
  const allModes: PlatformMode[] = [
    "identity-only",
    "agent-governance-only",
    "full-platform",
    "degraded-idp-unavailable",
    "degraded-ag-unavailable",
    "misconfigured",
    "unconfigured",
  ];

  it("showIdpUnavailableNotice and showAgUnavailableNotice are never both true", () => {
    for (const mode of allModes) {
      const v = navigationVisibility(mode);
      expect(
        v.showIdpUnavailableNotice && v.showAgUnavailableNotice,
        `mode ${mode}: both unavailable notices set simultaneously`
      ).toBe(false);
    }
  });

  it("showSetupRequired and showMisconfigured are never both true", () => {
    for (const mode of allModes) {
      const v = navigationVisibility(mode);
      expect(
        v.showSetupRequired && v.showMisconfigured,
        `mode ${mode}: both setup-required and misconfigured set`
      ).toBe(false);
    }
  });

  it("degraded modes always show exactly one navigation surface", () => {
    const degradedModes: PlatformMode[] = ["degraded-idp-unavailable", "degraded-ag-unavailable"];
    for (const mode of degradedModes) {
      const v = navigationVisibility(mode);
      const shown = [v.showIdentityNavigation, v.showAgNavigation].filter(Boolean).length;
      expect(shown, `degraded mode ${mode} should show exactly one navigation surface`).toBe(1);
    }
  });

  it("full-platform shows both navigation surfaces and no notices", () => {
    const v = navigationVisibility("full-platform");
    expect(v.showIdentityNavigation).toBe(true);
    expect(v.showAgNavigation).toBe(true);
    expect(v.showIdpUnavailableNotice).toBe(false);
    expect(v.showAgUnavailableNotice).toBe(false);
    expect(v.showSetupRequired).toBe(false);
    expect(v.showMisconfigured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runtime state shape — security: no secret-like fields
// ---------------------------------------------------------------------------

describe("RuntimeState shape — no secret fields", () => {
  function makeBackendState(overrides: Partial<BackendComponentState> = {}): BackendComponentState {
    return {
      configured: true,
      reachable: true,
      usable: true,
      component: "identuum-idp",
      version: "1.0.0",
      status: "ok",
      capabilities: { identity_provider: true },
      auth: { authority: "identuum-idp", provider_mode: "local" },
      license: { status: "valid" },
      error: null,
      ...overrides,
    };
  }

  it("BackendComponentState serializes without secret-like field names", () => {
    const state: RuntimeState = {
      mode: "full-platform",
      components: {
        idp: makeBackendState({ component: "identuum-idp" }),
        ag: makeBackendState({ component: "identuum-ag" }),
      },
    };
    const json = JSON.stringify(state);
    const forbidden = ["password", "private_key", "secret", "token", "internal_base_url"];
    for (const field of forbidden) {
      expect(json, `field "${field}" must not appear in RuntimeState output`).not.toContain(field);
    }
  });

  it("error field uses safe error code categories only", () => {
    const safeErrorCodes = [
      "unreachable",
      "timeout",
      "invalid_json",
      "wrong_component",
      "discovery_failed",
    ];
    const state = makeBackendState({ usable: false, error: "unreachable" });
    expect(safeErrorCodes).toContain(state.error);
  });

  it("auth field contains only metadata, not credentials", () => {
    const state = makeBackendState({
      auth: { authority: "identuum-idp", provider_mode: "local" },
    });
    const json = JSON.stringify(state.auth);
    expect(json).not.toContain("password");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("token");
    expect(json).not.toContain("key");
  });
});

// ---------------------------------------------------------------------------
// Mode-to-routing mapping (documents root page redirect logic)
// ---------------------------------------------------------------------------

describe("platformMode routing intent", () => {
  type RouteDestination = "/setup-required" | "/platform-status" | "/ag-admin" | "/login";

  function expectedRoute(mode: PlatformMode): RouteDestination {
    switch (mode) {
      case "unconfigured":
        return "/setup-required";
      case "misconfigured":
        return "/platform-status";
      case "agent-governance-only":
      case "degraded-idp-unavailable":
        return "/ag-admin";
      default:
        return "/login";
    }
  }

  it("unconfigured routes to /setup-required", () => {
    expect(expectedRoute("unconfigured")).toBe("/setup-required");
  });

  it("misconfigured routes to /platform-status", () => {
    expect(expectedRoute("misconfigured")).toBe("/platform-status");
  });

  it("agent-governance-only routes to /ag-admin", () => {
    expect(expectedRoute("agent-governance-only")).toBe("/ag-admin");
  });

  it("degraded-idp-unavailable routes to /ag-admin", () => {
    expect(expectedRoute("degraded-idp-unavailable")).toBe("/ag-admin");
  });

  it("identity-only routes to /login", () => {
    expect(expectedRoute("identity-only")).toBe("/login");
  });

  it("full-platform routes to /login", () => {
    expect(expectedRoute("full-platform")).toBe("/login");
  });

  it("degraded-ag-unavailable routes to /login", () => {
    expect(expectedRoute("degraded-ag-unavailable")).toBe("/login");
  });
});
