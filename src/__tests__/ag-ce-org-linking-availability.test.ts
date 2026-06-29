/**
 * Tests for ag-ce-org-linking-availability.ts.
 *
 * Verifies the decision matrix of `deriveAGCEOrgLinkAvailability`:
 *
 *   capability:true + readiness:ok+configured+ready → actionable
 *   capability:true + readiness:ok+!configured       → readiness_pending (notes from probe)
 *   capability:true + readiness:ok+!ready            → readiness_pending (notes from probe)
 *   capability:true + readiness:unavailable          → readiness_unknown
 *   capability:true + readiness:not_configured       → readiness_unknown
 *   capability:true + readiness:error                → readiness_unknown
 *   capability:false / undefined / missing           → capability_missing
 *                                                      (even with readiness:ok)
 */

import { describe, expect, it } from "vitest";

import { deriveAGCEOrgLinkAvailability } from "../lib/ag-ce-org-linking-availability";
import type { AGOrgLinkReadinessResult } from "../lib/ag-org-link-readiness-client";
import type { ComponentCapabilities } from "../lib/types";

const fullyMounted: AGOrgLinkReadinessResult = {
  status: "ok",
  readiness: {
    configured: true,
    ready: true,
    plan_endpoint: "/api/v1/org-link/plan",
    detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
    notes: ["AG CE org-link plan + detail + link/unlink WRITE routes are mounted."],
  },
};

const unconfigured: AGOrgLinkReadinessResult = {
  status: "ok",
  readiness: {
    configured: false,
    ready: false,
    plan_endpoint: "",
    detail_endpoint_pattern: "",
    notes: ["AG CE org-link planning is not yet wired."],
  },
};

const configuredButNotReady: AGOrgLinkReadinessResult = {
  status: "ok",
  readiness: {
    configured: true,
    ready: false,
    plan_endpoint: "/api/v1/org-link/plan",
    detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
    notes: ["Operator token not yet provisioned; mount the WRITE flow."],
  },
};

describe("deriveAGCEOrgLinkAvailability — happy paths", () => {
  it("returns actionable when capability=true + readiness configured+ready", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, fullyMounted);
    expect(v.state).toBe("actionable");
  });

  it("returns readiness_pending with surfaced notes when readiness reports unconfigured", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, unconfigured);
    expect(v.state).toBe("readiness_pending");
    if (v.state === "readiness_pending") {
      expect(v.reasons).toEqual(["AG CE org-link planning is not yet wired."]);
    }
  });

  it("returns readiness_pending with surfaced notes when readiness reports configured-but-not-ready", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, configuredButNotReady);
    expect(v.state).toBe("readiness_pending");
    if (v.state === "readiness_pending") {
      expect(v.reasons).toEqual(["Operator token not yet provisioned; mount the WRITE flow."]);
    }
  });
});

describe("deriveAGCEOrgLinkAvailability — capability gate", () => {
  it("returns capability_missing when capabilities object is empty", () => {
    const caps: ComponentCapabilities = {};
    const v = deriveAGCEOrgLinkAvailability(caps, fullyMounted);
    expect(v.state).toBe("capability_missing");
  });

  it("returns capability_missing when organization_linking is explicit false", () => {
    const caps: ComponentCapabilities = { organization_linking: false };
    const v = deriveAGCEOrgLinkAvailability(caps, fullyMounted);
    expect(v.state).toBe("capability_missing");
  });

  it("returns capability_missing when capabilities is null", () => {
    const v = deriveAGCEOrgLinkAvailability(null, fullyMounted);
    expect(v.state).toBe("capability_missing");
  });

  it("returns capability_missing when capabilities is undefined", () => {
    const v = deriveAGCEOrgLinkAvailability(undefined, fullyMounted);
    expect(v.state).toBe("capability_missing");
  });

  it("capability_missing short-circuits even when readiness is unavailable (defensive)", () => {
    const caps: ComponentCapabilities = { organization_linking: false };
    const v = deriveAGCEOrgLinkAvailability(caps, { status: "ag_unavailable" });
    expect(v.state).toBe("capability_missing");
  });
});

describe("deriveAGCEOrgLinkAvailability — readiness unknown", () => {
  it("returns readiness_unknown / not_configured when AG is disabled", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, { status: "not_configured" });
    expect(v.state).toBe("readiness_unknown");
    if (v.state === "readiness_unknown") expect(v.reason).toBe("not_configured");
  });

  it("returns readiness_unknown / ag_unavailable on network failure", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, { status: "ag_unavailable" });
    expect(v.state).toBe("readiness_unknown");
    if (v.state === "readiness_unknown") expect(v.reason).toBe("ag_unavailable");
  });

  it("returns readiness_unknown / error on malformed body", () => {
    const caps: ComponentCapabilities = { organization_linking: true };
    const v = deriveAGCEOrgLinkAvailability(caps, { status: "error" });
    expect(v.state).toBe("readiness_unknown");
    if (v.state === "readiness_unknown") expect(v.reason).toBe("error");
  });
});

describe("deriveAGCEOrgLinkAvailability — conservative-false capability matrix", () => {
  // Conservative-false AG CE capabilities (per 2026-07-01 closure audit)
  // MUST NEVER be over-advertised. None of them being true should ever
  // upgrade an availability verdict that the organization_linking gate
  // already denied.
  const otherCaps: Array<keyof ComponentCapabilities> = [
    "identity_provider",
    "agent_governance",
    "license_status",
    "auth_provider_discovery",
    "organization_export",
    "organization_import",
    "hitl",
    "agent_sessions",
  ];

  for (const flag of otherCaps) {
    it(`capability_missing remains when only ${flag} is true (organization_linking gates)`, () => {
      const caps: ComponentCapabilities = { [flag]: true } as ComponentCapabilities;
      const v = deriveAGCEOrgLinkAvailability(caps, fullyMounted);
      expect(v.state).toBe("capability_missing");
    });
  }
});
