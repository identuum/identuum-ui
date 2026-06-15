import { describe, expect, it } from "vitest";
import { deriveLicenseWarnings } from "../lib/license-warnings";
import type { BackendComponentState } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBackend(overrides: Partial<BackendComponentState> = {}): BackendComponentState {
  return {
    configured: true,
    reachable: true,
    usable: true,
    component: "identuum-idp",
    version: "1.0.0",
    status: "ok",
    capabilities: {},
    auth: {},
    license: { status: "valid", product: "identuum-idp", days_remaining: 364 },
    error: null,
    ...overrides,
  };
}

function makeAGBackend(overrides: Partial<BackendComponentState> = {}): BackendComponentState {
  return {
    ...makeBackend(),
    component: "identuum-ag",
    license: { status: "valid", product: "identuum-ag", days_remaining: 364 },
    ...overrides,
  };
}

function unconfigured(): BackendComponentState {
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

function unreachable(): BackendComponentState {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveLicenseWarnings", () => {
  it("returns no warnings when both backends have valid license with days_remaining 364", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: 364 } }),
      ag: makeAGBackend({ license: { status: "valid", days_remaining: 364 } }),
    });
    expect(warnings).toHaveLength(0);
  });

  it("returns no warning for valid license with days_remaining > 30", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: 31 } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(0);
  });

  it("returns warning for valid license with days_remaining 30", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: 30 } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("30 days");
    expect(warnings[0].message).toContain("Identity Provider");
  });

  it("returns warning for valid license with days_remaining 1 (singular day)", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: 1 } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("1 day");
    expect(warnings[0].message).not.toContain("days.");
  });

  it("returns critical warning for valid license with days_remaining 0", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: 0 } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("critical");
    expect(warnings[0].message).toContain("expired");
  });

  it("returns critical warning for valid license with days_remaining negative", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: -5 } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("critical");
  });

  it("returns critical warning for license status expired", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "expired" } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("critical");
    expect(warnings[0].message).toContain("expired");
  });

  it("returns critical warning for license status invalid", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "invalid" } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("critical");
    expect(warnings[0].message).toContain("invalid");
  });

  it("returns warning for unknown license status on reachable+usable backend", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "unknown" } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain("unknown");
  });

  it("returns warning for missing license status on reachable+usable backend", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "missing" } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
  });

  it("does not warn for unreachable backend", () => {
    const warnings = deriveLicenseWarnings({
      idp: unreachable(),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(0);
  });

  it("does not warn for unconfigured backend", () => {
    const warnings = deriveLicenseWarnings({
      idp: unconfigured(),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(0);
  });

  it("does not warn for backend that is reachable but not usable (wrong_component)", () => {
    const warnings = deriveLicenseWarnings({
      idp: {
        configured: true,
        reachable: true,
        usable: false,
        component: "identuum-ag",
        version: null,
        status: null,
        capabilities: {},
        auth: {},
        license: { status: "unknown" },
        error: "wrong_component",
      },
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(0);
  });

  it("returns no warning for valid license with null days_remaining (perpetual)", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "valid", days_remaining: null } }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(0);
  });

  it("returns warnings for both backends when both have issues", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "invalid" } }),
      ag: makeAGBackend({ license: { status: "expired" } }),
    });
    expect(warnings).toHaveLength(2);
    const ids = warnings.map((w) => w.backendId);
    expect(ids).toContain("idp");
    expect(ids).toContain("ag");
  });

  it("returns warnings in stable idp-first order", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ license: { status: "invalid" } }),
      ag: makeAGBackend({ license: { status: "expired" } }),
    });
    expect(warnings[0].backendId).toBe("idp");
    expect(warnings[1].backendId).toBe("ag");
  });

  it("uses Identity Provider label for identuum-idp component", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({ component: "identuum-idp", license: { status: "invalid" } }),
      ag: unconfigured(),
    });
    expect(warnings[0].message).toContain("Identity Provider");
  });

  it("uses Agent Governance label for identuum-ag component", () => {
    const warnings = deriveLicenseWarnings({
      idp: unconfigured(),
      ag: makeAGBackend({ component: "identuum-ag", license: { status: "invalid" } }),
    });
    expect(warnings[0].message).toContain("Agent Governance");
  });

  it("warning message does not contain any sensitive field names", () => {
    const warnings = deriveLicenseWarnings({
      idp: makeBackend({
        license: {
          status: "invalid",
          // These extra fields would never arrive via the allowlist in practice,
          // but verify the message string itself stays clean.
          tier: "enterprise",
        },
      }),
      ag: unconfigured(),
    });
    expect(warnings).toHaveLength(1);
    const msg = warnings[0].message;
    expect(msg).not.toContain("entitlement");
    expect(msg).not.toContain("feature");
    expect(msg).not.toContain("customer_id");
    expect(msg).not.toContain("license_id");
    expect(msg).not.toContain("signature");
    expect(msg).not.toContain("ciphertext");
    expect(msg).not.toContain("private_key");
    expect(msg).not.toContain("licensee");
  });
});
