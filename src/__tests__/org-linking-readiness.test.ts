import { describe, expect, it } from "vitest";
import { deriveOrganizationLinkingReadiness } from "../lib/org-linking-readiness";
import type { BackendComponentState, ComponentCapabilities, RuntimeState } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIDPState(overrides: Partial<BackendComponentState> = {}): BackendComponentState {
  return {
    configured: true,
    reachable: true,
    usable: true,
    component: "identuum-idp",
    version: "1.0.0",
    status: "ok",
    capabilities: {
      organization_export: true,
      organization_linking: true,
    },
    auth: {},
    license: { status: "valid" },
    error: null,
    ...overrides,
  };
}

function makeAGState(overrides: Partial<BackendComponentState> = {}): BackendComponentState {
  return {
    configured: true,
    reachable: true,
    usable: true,
    component: "identuum-ag",
    version: "0.0.0-dev",
    status: "ok",
    capabilities: {
      organization_import: true,
      organization_linking: true,
    },
    auth: {},
    license: { status: "valid" },
    error: null,
    ...overrides,
  };
}

function makeState(
  idpOverrides: Partial<BackendComponentState> = {},
  agOverrides: Partial<BackendComponentState> = {}
): RuntimeState {
  return {
    mode: "full-platform",
    components: {
      idp: makeIDPState(idpOverrides),
      ag: makeAGState(agOverrides),
    },
  };
}

function unconfiguredBackend(): BackendComponentState {
  return {
    configured: false,
    reachable: false,
    usable: false,
    component: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" },
    error: null,
  };
}

function unreachableBackend(): BackendComponentState {
  return {
    configured: true,
    reachable: false,
    usable: false,
    component: null,
    version: null,
    status: null,
    capabilities: {},
    auth: {},
    license: { status: "unknown" },
    error: "unreachable",
  };
}

function withCaps(caps: ComponentCapabilities): Partial<BackendComponentState> {
  return { capabilities: caps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveOrganizationLinkingReadiness", () => {
  it("returns ready=true when both backends are configured, usable, and have required capabilities", () => {
    const result = deriveOrganizationLinkingReadiness(makeState());
    expect(result.ready).toBe(true);
    expect(result.prerequisites.every((p) => p.met)).toBe(true);
  });

  it("returns ready=false when IDP is unconfigured", () => {
    const state: RuntimeState = {
      mode: "agent-governance-only",
      components: { idp: unconfiguredBackend(), ag: makeAGState() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(unmet.length).toBeGreaterThan(0);
    const msgs = unmet.map((p) => p.failMessage);
    expect(msgs.some((m) => m.toLowerCase().includes("identity provider"))).toBe(true);
    expect(msgs.some((m) => m.toLowerCase().includes("not configured"))).toBe(true);
  });

  it("fail message for IDP unconfigured contains 'not configured'", () => {
    const state: RuntimeState = {
      mode: "agent-governance-only",
      components: { idp: unconfiguredBackend(), ag: makeAGState() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(
      unmet.some((p) => p.failMessage === "Identity Provider backend is not configured.")
    ).toBe(true);
  });

  it("returns ready=false when AG is unconfigured", () => {
    const state: RuntimeState = {
      mode: "identity-only",
      components: { idp: makeIDPState(), ag: unconfiguredBackend() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    const msgs = unmet.map((p) => p.failMessage);
    expect(msgs.some((m) => m.toLowerCase().includes("agent governance"))).toBe(true);
    expect(msgs.some((m) => m.toLowerCase().includes("not configured"))).toBe(true);
  });

  it("fail message for AG unconfigured contains 'not configured'", () => {
    const state: RuntimeState = {
      mode: "identity-only",
      components: { idp: makeIDPState(), ag: unconfiguredBackend() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(unmet.some((p) => p.failMessage === "Agent Governance backend is not configured.")).toBe(
      true
    );
  });

  it("returns ready=false when IDP is configured but unreachable/not usable", () => {
    const state: RuntimeState = {
      mode: "degraded-idp-unavailable",
      components: { idp: unreachableBackend(), ag: makeAGState() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    const msgs = unmet.map((p) => p.failMessage);
    expect(msgs.some((m) => m.toLowerCase().includes("identity provider"))).toBe(true);
    expect(msgs.some((m) => /unreachable|not configured/i.test(m))).toBe(true);
  });

  it("fail message for IDP unreachable contains 'unreachable'", () => {
    const state: RuntimeState = {
      mode: "degraded-idp-unavailable",
      components: { idp: unreachableBackend(), ag: makeAGState() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(unmet.some((p) => p.failMessage === "Identity Provider backend is unreachable.")).toBe(
      true
    );
  });

  it("returns ready=false when AG is configured but unreachable/not usable", () => {
    const state: RuntimeState = {
      mode: "degraded-ag-unavailable",
      components: { idp: makeIDPState(), ag: unreachableBackend() },
    };
    const result = deriveOrganizationLinkingReadiness(state);
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    const msgs = unmet.map((p) => p.failMessage);
    expect(msgs.some((m) => /unreachable/i.test(m) && /agent governance/i.test(m))).toBe(true);
  });

  it("returns ready=false when IDP is missing organization_export capability", () => {
    const result = deriveOrganizationLinkingReadiness(
      makeState(withCaps({ organization_export: false, organization_linking: true }))
    );
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(
      unmet.some(
        (p) => p.failMessage === "Identity Provider does not report organization export capability."
      )
    ).toBe(true);
  });

  it("returns ready=false when IDP is missing organization_linking capability", () => {
    const result = deriveOrganizationLinkingReadiness(
      makeState(withCaps({ organization_export: true, organization_linking: false }))
    );
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(
      unmet.some(
        (p) =>
          p.failMessage === "Identity Provider does not report organization linking capability."
      )
    ).toBe(true);
  });

  it("returns ready=false when AG is missing organization_import capability", () => {
    const result = deriveOrganizationLinkingReadiness(
      makeState({}, withCaps({ organization_import: false, organization_linking: true }))
    );
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(
      unmet.some(
        (p) => p.failMessage === "Agent Governance does not report organization import capability."
      )
    ).toBe(true);
  });

  it("returns ready=false when AG is missing organization_linking capability", () => {
    const result = deriveOrganizationLinkingReadiness(
      makeState({}, withCaps({ organization_import: true, organization_linking: false }))
    );
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    expect(
      unmet.some(
        (p) => p.failMessage === "Agent Governance does not report organization linking capability."
      )
    ).toBe(true);
  });

  it("handles older backend with no capabilities object — not ready, no crash", () => {
    const result = deriveOrganizationLinkingReadiness(
      makeState(
        { usable: true, reachable: true, configured: true, capabilities: {} },
        { usable: true, reachable: true, configured: true, capabilities: {} }
      )
    );
    expect(result.ready).toBe(false);
    const unmet = result.prerequisites.filter((p) => !p.met);
    // All four capability checks should fail
    expect(unmet.some((p) => p.failMessage.includes("organization export"))).toBe(true);
    expect(unmet.some((p) => p.failMessage.includes("organization linking"))).toBe(true);
    expect(unmet.some((p) => p.failMessage.includes("organization import"))).toBe(true);
  });

  it("capability checks fail gracefully when capabilities object is empty (no crash)", () => {
    expect(() =>
      deriveOrganizationLinkingReadiness(makeState({ capabilities: {} }, { capabilities: {} }))
    ).not.toThrow();
  });

  it("always returns all 8 prerequisites regardless of met state", () => {
    const result = deriveOrganizationLinkingReadiness(makeState());
    expect(result.prerequisites).toHaveLength(8);

    const noneResult = deriveOrganizationLinkingReadiness({
      mode: "unconfigured",
      components: { idp: unconfiguredBackend(), ag: unconfiguredBackend() },
    });
    expect(noneResult.prerequisites).toHaveLength(8);
  });

  it("prerequisites each have met, label, and failMessage fields", () => {
    const result = deriveOrganizationLinkingReadiness(makeState());
    for (const p of result.prerequisites) {
      expect(typeof p.met).toBe("boolean");
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.failMessage).toBe("string");
      expect(p.failMessage.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Scope and security assertions
// ---------------------------------------------------------------------------

describe("org-linking-readiness — scope and security", () => {
  it("page scope text: users are not copied (validates helper description)", () => {
    // The scope notice on the page and in the helper doc explicitly states that
    // users, passwords, MFA, org admins, role bindings, and credentials are
    // never part of the linking scope. The helper itself does not mention users.
    const src = deriveOrganizationLinkingReadiness.toString();
    // Confirm it does not evaluate any user or credential field
    expect(src).not.toContain("password");
    expect(src).not.toContain("mfa");
    expect(src).not.toContain("role_binding");
    expect(src).not.toContain("org_admin");
    expect(src).not.toContain("credential");
  });

  it("prerequisite messages do not contain sensitive field names", () => {
    const result = deriveOrganizationLinkingReadiness(makeState());
    const allMessages = result.prerequisites.flatMap((p) => [p.label, p.failMessage]).join(" ");
    expect(allMessages).not.toContain("entitlement");
    expect(allMessages).not.toContain("license_id");
    expect(allMessages).not.toContain("customer_id");
    expect(allMessages).not.toContain("signature");
    expect(allMessages).not.toContain("ciphertext");
    expect(allMessages).not.toContain("private_key");
    expect(allMessages).not.toContain("password");
    expect(allMessages).not.toContain("internal_url");
  });

  it("does not include users, passwords, MFA, or role bindings in readiness output", () => {
    const result = deriveOrganizationLinkingReadiness(makeState());
    const json = JSON.stringify(result);
    expect(json).not.toContain("user");
    expect(json).not.toContain("password");
    expect(json).not.toContain("mfa");
    expect(json).not.toContain("role_binding");
    expect(json).not.toContain("credential");
    expect(json).not.toContain("reviewer");
    expect(json).not.toContain("auditor");
  });

  it("page navigation: platform-status page links to org-link/readiness", () => {
    // This test validates the navigation contract by importing the page module source.
    // The platform-status page must contain a link to /site-admin/org-link/readiness.
    // We verify this at the source level since rendering requires Next.js infrastructure.
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../app/platform-status/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("/site-admin/org-link/readiness");
  });

  it("readiness page source explicitly states users/passwords/MFA/role bindings are not copied", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(
      new URL("../app/site-admin/org-link/readiness/page.tsx", import.meta.url).pathname,
      "utf-8"
    );
    // Scope declaration must be present in the page
    expect(src).toContain("users");
    expect(src).toContain("passwords");
    expect(src).toContain("MFA");
    expect(src).toContain("org admins");
    expect(src).toContain("role bindings");
  });
});
