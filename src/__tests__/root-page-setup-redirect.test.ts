/**
 * Pins the root `/` page redirect logic added by the appliance setup
 * foundation. The redirect priority on the root page is:
 *
 *   1. No runtime state OR mode=unconfigured → /setup-required (existing)
 *   2. mode=misconfigured                    → /platform-status (existing)
 *   3. IDP usable + setupState.state=setup_required → /setup        (NEW)
 *   4. mode=agent-governance-only|degraded-idp-unavailable → /ag-admin
 *   5. Otherwise (IDP usable, no setup_required)            → /login
 *
 * The new check (rule 3) must NOT break rules 1, 2, 4, 5 — older OSS
 * backends report setupState=null and fall through to the existing
 * behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdpSetupStateView, PlatformMode, RuntimeState } from "../lib/types";

const redirectMock = vi.fn();
const getStateMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`__redirect:${url}`);
  },
}));

vi.mock("@/lib/server-runtime-state", () => ({
  getServerRuntimeState: () => getStateMock(),
}));

async function callRoot(): Promise<string | null> {
  redirectMock.mockClear();
  // Re-import per call so the dynamic export is freshly executed.
  const { default: RootPage } = await import("../app/page");
  try {
    await RootPage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("__redirect:")) {
      return msg.slice("__redirect:".length);
    }
    throw err;
  }
  return null;
}

function idpComponent(usable: boolean, setupState: IdpSetupStateView | null | undefined) {
  return {
    configured: true,
    reachable: usable,
    usable,
    component: usable ? "identuum-idp" : null,
    product: null,
    capability_map_schema_version: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" as const },
    error: null,
    setupState,
  };
}

function agComponent() {
  return {
    configured: false,
    reachable: false,
    usable: false,
    component: null,
    product: null,
    capability_map_schema_version: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" as const },
    error: null,
  };
}

function makeState(
  mode: PlatformMode,
  idpUsable: boolean,
  setupState: IdpSetupStateView | null | undefined
): RuntimeState {
  return {
    mode,
    components: {
      idp: idpComponent(idpUsable, setupState),
      ag: agComponent(),
    },
  };
}

describe("RootPage redirect priority", () => {
  beforeEach(() => {
    getStateMock.mockReset();
    redirectMock.mockClear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("null state → /setup-required", async () => {
    getStateMock.mockResolvedValue(null);
    expect(await callRoot()).toBe("/setup-required");
  });

  it("mode=unconfigured → /setup-required", async () => {
    getStateMock.mockResolvedValue(makeState("unconfigured", false, undefined));
    expect(await callRoot()).toBe("/setup-required");
  });

  it("mode=misconfigured → /platform-status (setup probe ignored)", async () => {
    const state = makeState("misconfigured", false, undefined);
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/platform-status");
  });

  it("IDP usable + setupState=setup_required → /setup (NEW)", async () => {
    const state = makeState("identity-only", true, {
      state: "setup_required",
      setupTokenRequired: true,
      firstSigningKeyExists: false,
      siteAdminExists: false,
      firstOrganizationExists: false,
      nextAction: "Open the setup wizard",
    });
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/setup");
  });

  it("IDP usable + setupState=setup_complete → /login (default)", async () => {
    const state = makeState("identity-only", true, {
      state: "setup_complete",
      setupTokenRequired: false,
      firstSigningKeyExists: true,
      siteAdminExists: true,
      firstOrganizationExists: true,
      nextAction: "Setup is complete.",
    });
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/login");
  });

  it("IDP usable + setupState=null (older backend) → /login (no new redirect)", async () => {
    const state = makeState("identity-only", true, null);
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/login");
  });

  it("mode=agent-governance-only → /ag-admin (setup probe ignored — IDP not usable here)", async () => {
    const state = makeState("agent-governance-only", false, undefined);
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/ag-admin");
  });

  it("mode=degraded-idp-unavailable → /ag-admin (IDP unusable so setupState undefined)", async () => {
    const state = makeState("degraded-idp-unavailable", false, undefined);
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/ag-admin");
  });

  it("full-platform + setup_required → /setup overrides /login (new check has higher priority)", async () => {
    const state = makeState("full-platform", true, {
      state: "setup_required",
      setupTokenRequired: true,
      firstSigningKeyExists: false,
      siteAdminExists: false,
      firstOrganizationExists: false,
      nextAction: "Open the setup wizard",
    });
    getStateMock.mockResolvedValue(state);
    expect(await callRoot()).toBe("/setup");
  });
});
