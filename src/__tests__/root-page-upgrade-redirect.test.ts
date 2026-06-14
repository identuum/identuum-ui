/**
 * Pins the root `/` page redirect priority for the OSS-to-CE upgrade
 * wizard. The full priority on the root page is:
 *
 *   1. No runtime state OR mode=unconfigured → /setup-required
 *   2. IDP reports upgrade-required state    → /upgrade        (NEW)
 *   3. mode=misconfigured                    → /platform-status
 *   4. IDP usable + setupState=setup_required → /setup
 *   5. mode=agent-governance-only|degraded-idp-unavailable → /ag-admin
 *   6. Otherwise (IDP usable, no setup_required)            → /login
 *
 * Rule 2 must fire BEFORE rule 3 because the CE binary in upgrade
 * mode is technically "misconfigured" (no /api/v1/component), but
 * the upgrade wizard is the correct destination — NOT the platform
 * status page.
 *
 * Rule 2 must NOT fire for older OSS backends (upgradeState=null)
 * or for healthy CE deployments (state=ce_migrations_current).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IdpSetupStateView,
  IdpUpgradeStateView,
  PlatformMode,
  RuntimeState,
} from "../lib/types";

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

function idpComponent(
  usable: boolean,
  setupState: IdpSetupStateView | null | undefined,
  upgradeState: IdpUpgradeStateView | null | undefined
) {
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
    upgradeState,
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

function runtime(
  mode: PlatformMode,
  setupState: IdpSetupStateView | null | undefined,
  upgradeState: IdpUpgradeStateView | null | undefined,
  idpUsable = true
): RuntimeState {
  return {
    mode,
    components: { idp: idpComponent(idpUsable, setupState, upgradeState), ag: agComponent() },
  };
}

const ossDetected: IdpUpgradeStateView = {
  state: "oss_database_detected",
  distribution: "ce",
  upgradeAvailable: true,
  ceMigrationsCurrent: false,
  ossDatabaseDetected: true,
  backupRequired: true,
  nextAction: "Existing OSS deployment detected.",
};

const ceCurrent: IdpUpgradeStateView = {
  state: "ce_migrations_current",
  distribution: "ce",
  upgradeAvailable: false,
  ceMigrationsCurrent: true,
  ossDatabaseDetected: true,
  backupRequired: false,
  nextAction: "No upgrade required.",
};

beforeEach(() => {
  vi.resetModules();
  redirectMock.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("root page redirect priority — upgrade wizard", () => {
  it("redirects to /upgrade when upgradeState indicates oss_database_detected (usable IDP)", async () => {
    getStateMock.mockReturnValue(runtime("identity-only", null, ossDetected, true));
    const target = await callRoot();
    expect(target).toBe("/upgrade");
  });

  it("redirects to /upgrade when upgradeState indicates oss_database_detected (unusable IDP)", async () => {
    // CE upgrade mode: /api/v1/component returns 404 → IDP looks
    // unusable (mode=misconfigured), but /api/upgrade/status answers.
    // The wizard MUST take precedence over /platform-status.
    getStateMock.mockReturnValue(runtime("misconfigured", null, ossDetected, false));
    const target = await callRoot();
    expect(target).toBe("/upgrade");
  });

  it("redirects to /upgrade for fresh_ce, upgrade_required, incompatible_database, database_unreachable, backup_required", async () => {
    for (const state of [
      "fresh_ce",
      "upgrade_required",
      "incompatible_database",
      "database_unreachable",
      "backup_required",
    ] as const) {
      getStateMock.mockReturnValue(runtime("identity-only", null, { ...ossDetected, state }, true));
      const target = await callRoot();
      expect(target).toBe("/upgrade");
    }
  });

  it("does NOT redirect to /upgrade when ce_migrations_current — falls through to /login", async () => {
    getStateMock.mockReturnValue(runtime("identity-only", null, ceCurrent, true));
    const target = await callRoot();
    expect(target).toBe("/login");
  });

  it("does NOT redirect to /upgrade when upgradeState is null (older OSS)", async () => {
    getStateMock.mockReturnValue(runtime("identity-only", null, null, true));
    const target = await callRoot();
    expect(target).toBe("/login");
  });

  it("redirects to /setup-required when no runtime state (unchanged rule)", async () => {
    getStateMock.mockReturnValue(null);
    const target = await callRoot();
    expect(target).toBe("/setup-required");
  });

  it("redirects to /setup-required when mode=unconfigured (unchanged rule)", async () => {
    getStateMock.mockReturnValue(runtime("unconfigured", null, null, false));
    const target = await callRoot();
    expect(target).toBe("/setup-required");
  });

  it("upgrade takes precedence over setup_required", async () => {
    const setupReq: IdpSetupStateView = {
      state: "setup_required",
      setupTokenRequired: true,
      firstSigningKeyExists: false,
      siteAdminExists: false,
      firstOrganizationExists: false,
      nextAction: "",
    };
    getStateMock.mockReturnValue(runtime("identity-only", setupReq, ossDetected, true));
    const target = await callRoot();
    expect(target).toBe("/upgrade");
  });

  it("upgrade takes precedence over misconfigured platform-status redirect", async () => {
    getStateMock.mockReturnValue(runtime("misconfigured", null, ossDetected, false));
    const target = await callRoot();
    expect(target).toBe("/upgrade");
  });
});
