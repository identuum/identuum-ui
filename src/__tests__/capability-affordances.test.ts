import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAuthorizationServerPageBoundary,
  getCapabilityAffordance,
  getPrimaryNavCapabilityDecision,
} from "../lib/capability-affordances";

const ROOT = resolve(__dirname, "..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("getCapabilityAffordance", () => {
  it("maps true facts to Available without looking at product or tier", () => {
    expect(
      getCapabilityAffordance({
        capabilities: { audit_log: true },
        key: "audit_log",
        boundary: "enterprise_ce",
      })
    ).toEqual({
      factState: "available",
      state: "available",
      label: "Available",
      source: "capability_fact",
    });
  });

  it("maps false facts to Unavailable and does not replace them with a CE boundary fallback", () => {
    expect(
      getCapabilityAffordance({
        capabilities: { scim: false },
        key: "scim",
        boundary: "enterprise_ce",
      })
    ).toEqual({
      factState: "unavailable",
      state: "unavailable",
      label: "Unavailable",
      source: "capability_fact",
    });
  });

  it("preserves omitted facts as Unknown when no source-invariant boundary is supplied", () => {
    expect(getCapabilityAffordance({ capabilities: {}, key: "authorization_server" })).toEqual({
      factState: "unknown",
      state: "unknown",
      label: "Unknown",
      source: "unknown",
    });
  });

  it("keeps omitted facts unknown while using Enterprise/CE as display fallback for known CE surfaces", () => {
    expect(
      getCapabilityAffordance({
        capabilities: {},
        key: "audit_log",
        boundary: "enterprise_ce",
      })
    ).toEqual({
      factState: "unknown",
      state: "enterprise_ce_boundary",
      label: "Enterprise/CE",
      source: "boundary_fallback",
    });
  });

  it("treats missing component discovery the same as omitted facts", () => {
    expect(
      getCapabilityAffordance({
        capabilities: null,
        key: "reporting",
        boundary: "enterprise_ce",
      })
    ).toMatchObject({
      factState: "unknown",
      state: "enterprise_ce_boundary",
      source: "boundary_fallback",
    });
  });
});

describe("getPrimaryNavCapabilityDecision", () => {
  it("hides mapped primary nav entries only when the backend fact is explicitly false", () => {
    expect(
      getPrimaryNavCapabilityDecision({
        capabilities: { api_resources: false },
        key: "api_resources",
        unavailableBehavior: "hide",
      })
    ).toEqual({
      factState: "unavailable",
      visible: false,
      source: "capability_fact",
    });
  });

  it("keeps mapped primary nav entries visible when the backend fact is explicitly true", () => {
    expect(
      getPrimaryNavCapabilityDecision({
        capabilities: { api_resources: true },
        key: "api_resources",
        unavailableBehavior: "hide",
      })
    ).toEqual({
      factState: "available",
      visible: true,
      source: "capability_fact",
    });
  });

  it("keeps mapped primary nav entries visible when the backend fact is omitted or discovery is absent", () => {
    expect(
      getPrimaryNavCapabilityDecision({
        capabilities: {},
        key: "api_resources",
        unavailableBehavior: "hide",
      })
    ).toEqual({
      factState: "unknown",
      visible: true,
      source: "unknown",
    });
    expect(
      getPrimaryNavCapabilityDecision({
        capabilities: null,
        key: "service_accounts",
        unavailableBehavior: "hide",
      })
    ).toMatchObject({
      factState: "unknown",
      visible: true,
      source: "unknown",
    });
  });

  it("keeps false facts visible for annotated links that have not opted into primary-nav hiding", () => {
    expect(
      getPrimaryNavCapabilityDecision({
        capabilities: { audit_log: false },
        key: "audit_log",
      })
    ).toEqual({
      factState: "unavailable",
      visible: true,
      source: "capability_fact",
    });
  });

  it("applies the same explicit-false primary-nav rule to site-admin observability facts", () => {
    for (const key of ["audit_log", "anomaly_detection", "reporting"] as const) {
      expect(
        getPrimaryNavCapabilityDecision({
          capabilities: { [key]: false },
          key,
          unavailableBehavior: "hide",
        })
      ).toEqual({
        factState: "unavailable",
        visible: false,
        source: "capability_fact",
      });

      expect(
        getPrimaryNavCapabilityDecision({
          capabilities: { [key]: true },
          key,
          unavailableBehavior: "hide",
        })
      ).toEqual({
        factState: "available",
        visible: true,
        source: "capability_fact",
      });

      expect(
        getPrimaryNavCapabilityDecision({
          capabilities: {},
          key,
          unavailableBehavior: "hide",
        })
      ).toEqual({
        factState: "unknown",
        visible: true,
        source: "unknown",
      });
    }
  });
});

describe("getAuthorizationServerPageBoundary", () => {
  it("maps explicit false API resource facts to backend-not-exposed page copy", () => {
    expect(
      getAuthorizationServerPageBoundary({
        capabilities: { api_resources: false },
        surface: "api_resources",
      })
    ).toEqual({
      surface: "api_resources",
      title: "API resources are unavailable from this backend",
      body: "API resources are an OSS/Starter Authorization Server surface when the backend exposes them. This IDP backend reports that the API resources endpoint is not exposed.",
      source: "capability_fact",
    });
  });

  it("maps explicit false OAuth client facts to backend-not-exposed page copy", () => {
    const boundary = getAuthorizationServerPageBoundary({
      capabilities: { oauth_clients: false },
      surface: "oauth_clients",
    });

    expect(boundary).toMatchObject({
      surface: "oauth_clients",
      title: "Applications are unavailable from this backend",
      source: "capability_fact",
    });
    expect(boundary?.body).toContain("OAuth client endpoint is not exposed");
    expect(boundary?.body).toContain("OSS/Starter Authorization Server surface");
    expect(boundary?.body).not.toMatch(/\b(Enterprise|CE|license|tier)\b/i);
  });

  it("maps explicit false service account facts without CE/license gating copy", () => {
    const boundary = getAuthorizationServerPageBoundary({
      capabilities: { service_accounts: false },
      surface: "service_accounts",
    });

    expect(boundary).toMatchObject({
      surface: "service_accounts",
      title: "Service accounts are unavailable from this backend",
      source: "capability_fact",
    });
    expect(boundary?.body).toContain("This IDP backend reports");
    expect(boundary?.body).not.toMatch(/\b(Enterprise|CE|license|tier)\b/i);
  });

  it("maps explicit false scope-template and protocol-setting facts without CE/license gating copy", () => {
    for (const surface of ["scope_templates", "protocol_settings"] as const) {
      const boundary = getAuthorizationServerPageBoundary({
        capabilities: { [surface]: false },
        surface,
      });

      expect(boundary).toMatchObject({
        surface,
        source: "capability_fact",
      });
      expect(boundary?.body).toContain("This IDP backend reports");
      expect(boundary?.body).not.toMatch(/\b(Enterprise|CE|license|tier)\b/i);
    }
  });

  it("does not block available OAuth client surfaces", () => {
    expect(
      getAuthorizationServerPageBoundary({
        capabilities: { oauth_clients: true },
        surface: "oauth_clients",
      })
    ).toBeNull();
  });

  it("preserves omitted facts as the existing page fallback path", () => {
    expect(
      getAuthorizationServerPageBoundary({ capabilities: {}, surface: "api_resources" })
    ).toBeNull();
    expect(
      getAuthorizationServerPageBoundary({ capabilities: null, surface: "service_accounts" })
    ).toBeNull();
  });

  it("preserves DCR and client-credentials facts as real capability facts", () => {
    expect(
      getCapabilityAffordance({
        capabilities: { dynamic_client_registration: true },
        key: "dynamic_client_registration",
      })
    ).toMatchObject({ state: "available", source: "capability_fact" });
    expect(
      getCapabilityAffordance({
        capabilities: { client_credentials: false },
        key: "client_credentials",
      })
    ).toMatchObject({ state: "unavailable", source: "capability_fact" });
    expect(
      getCapabilityAffordance({
        capabilities: {},
        key: "dynamic_client_registration",
      })
    ).toMatchObject({ state: "unknown", source: "unknown" });
  });
});

describe("admin navigation capability affordance source invariants", () => {
  const SITE_NAV_SRC = readSource("components/site-admin/site-admin-nav.tsx");
  const ORG_NAV_SRC = readSource("components/org-admin/org-admin-nav.tsx");
  const SITE_LAYOUT_SRC = readSource("app/site-admin/layout.tsx");
  const ORG_LAYOUT_SRC = readSource("app/org-admin/layout.tsx");

  it("site-admin passes real IDP component capabilities into the navigation shell", () => {
    expect(SITE_LAYOUT_SRC).toContain("getServerRuntimeState");
    expect(SITE_LAYOUT_SRC).toContain("runtimeState?.components.idp.capabilities");
    expect(SITE_LAYOUT_SRC).toContain("<SiteAdminNav capabilities={idpCapabilities} />");
  });

  it("org-admin passes real IDP component capabilities into the navigation shell", () => {
    expect(ORG_LAYOUT_SRC).toContain("getServerRuntimeState");
    expect(ORG_LAYOUT_SRC).toContain("runtimeState?.components.idp.capabilities");
    expect(ORG_LAYOUT_SRC).toContain("<OrgAdminNav capabilities={idpCapabilities} />");
  });

  it("site-admin CE links remain present and are annotated by backend capability keys", () => {
    const expected = [
      { label: "Audit", href: "/site-admin/audit", capability: "audit_log" },
      { label: "Anomaly", href: "/site-admin/anomaly", capability: "anomaly_detection" },
      { label: "Reports", href: "/site-admin/reports", capability: "reporting" },
    ];

    for (const item of expected) {
      const entry = SITE_NAV_SRC.match(
        new RegExp(`label:\\s*"${item.label}"[\\s\\S]*?href:\\s*"${item.href}"[\\s\\S]*?\\}`)
      )?.[0];
      expect(entry, `${item.label} nav entry`).toBeTruthy();
      expect(entry).toContain(`capability: "${item.capability}"`);
      expect(entry).toContain('boundary: "enterprise_ce"');
    }
  });

  it("org-admin links remain present and only mapped surfaces get real capability keys", () => {
    const auditEntry =
      ORG_NAV_SRC.match(/label:\s*"Audit"[\s\S]*?href:\s*"\/org-admin\/audit"[\s\S]*?\}/)?.[0] ??
      "";
    const applicationsEntry =
      ORG_NAV_SRC.match(
        /label:\s*"Applications"[\s\S]*?href:\s*"\/org-admin\/applications"[\s\S]*?\}/
      )?.[0] ?? "";
    const apiResourceEntry =
      ORG_NAV_SRC.match(
        /label:\s*"API resources"[\s\S]*?href:\s*"\/org-admin\/api-resources"[\s\S]*?\}/
      )?.[0] ?? "";
    const serviceAccountEntry =
      ORG_NAV_SRC.match(
        /label:\s*"Service accounts"[\s\S]*?href:\s*"\/org-admin\/service-accounts"[\s\S]*?\}/
      )?.[0] ?? "";

    expect(auditEntry).toContain('capability: "audit_log"');
    expect(auditEntry).toContain('boundary: "enterprise_ce"');
    expect(applicationsEntry).toContain('capability: "oauth_clients"');
    expect(applicationsEntry).not.toContain("enterprise_ce");
    expect(apiResourceEntry).toContain('capability: "api_resources"');
    expect(apiResourceEntry).not.toContain("enterprise_ce");
    expect(serviceAccountEntry).toContain('capability: "service_accounts"');
    expect(serviceAccountEntry).not.toContain("enterprise_ce");
  });

  it("org-admin Authorization Server links opt into explicit-false primary-nav hiding", () => {
    const applicationsEntry =
      ORG_NAV_SRC.match(
        /label:\s*"Applications"[\s\S]*?href:\s*"\/org-admin\/applications"[\s\S]*?\}/
      )?.[0] ?? "";
    const apiResourceEntry =
      ORG_NAV_SRC.match(
        /label:\s*"API resources"[\s\S]*?href:\s*"\/org-admin\/api-resources"[\s\S]*?\}/
      )?.[0] ?? "";
    const serviceAccountEntry =
      ORG_NAV_SRC.match(
        /label:\s*"Service accounts"[\s\S]*?href:\s*"\/org-admin\/service-accounts"[\s\S]*?\}/
      )?.[0] ?? "";
    const auditEntry =
      ORG_NAV_SRC.match(/label:\s*"Audit"[\s\S]*?href:\s*"\/org-admin\/audit"[\s\S]*?\}/)?.[0] ??
      "";

    expect(ORG_NAV_SRC).toContain("getPrimaryNavCapabilityDecision");
    expect(applicationsEntry).toContain('primaryNavUnavailableBehavior: "hide"');
    expect(apiResourceEntry).toContain('primaryNavUnavailableBehavior: "hide"');
    expect(serviceAccountEntry).toContain('primaryNavUnavailableBehavior: "hide"');
    expect(auditEntry).not.toContain("primaryNavUnavailableBehavior");
  });

  it("site-admin hides only direct-boundary primary links when the matching fact is explicitly false", () => {
    const expectedHiddenWhenFalse = [
      {
        label: "Audit",
        href: "/site-admin/audit",
        capability: "audit_log",
        directBoundaryFile: "app/site-admin/audit/page.tsx",
      },
      {
        label: "Anomaly",
        href: "/site-admin/anomaly",
        capability: "anomaly_detection",
        directBoundaryFile: "app/site-admin/anomaly/page.tsx",
      },
      {
        label: "Reports",
        href: "/site-admin/reports",
        capability: "reporting",
        directBoundaryFile: "app/site-admin/reports/page.tsx",
        // Owner decision 5: no edition serves report exports.
        boundaryCopy: "Report exports are not available",
      },
    ];

    expect(SITE_NAV_SRC).toContain("getPrimaryNavCapabilityDecision");
    for (const item of expectedHiddenWhenFalse) {
      const entry = SITE_NAV_SRC.match(
        new RegExp(`label:\\s*"${item.label}"[\\s\\S]*?href:\\s*"${item.href}"[\\s\\S]*?\\}`)
      )?.[0];
      expect(entry, `${item.label} nav entry`).toBeTruthy();
      expect(entry).toContain(`capability: "${item.capability}"`);
      expect(entry).toContain('boundary: "enterprise_ce"');
      expect(entry).toContain('primaryNavUnavailableBehavior: "hide"');

      const directPage = readSource(item.directBoundaryFile);
      expect(directPage).toContain("FeatureBoundaryPanel");
      expect(directPage).toContain(
        "boundaryCopy" in item ? String(item.boundaryCopy) : "Enterprise/CE"
      );
    }

    for (const label of ["Overview", "Organizations", "Signing keys", "System", "Settings"]) {
      const entry = SITE_NAV_SRC.match(new RegExp(`label:\\s*"${label}"[\\s\\S]*?\\}`))?.[0] ?? "";
      expect(entry).not.toContain("primaryNavUnavailableBehavior");
    }

    expect(SITE_NAV_SRC).not.toContain('capability: "audit_chain"');
    expect(SITE_NAV_SRC).not.toContain('capability: "observability"');
  });

  it("SCIM is not promoted into OSS/Foundation navigation", () => {
    expect(SITE_NAV_SRC).not.toMatch(/capability:\s*"scim"/);
    expect(ORG_NAV_SRC).not.toMatch(/capability:\s*"scim"/);
    expect(ORG_NAV_SRC).not.toMatch(/SCIM.*Foundation|Foundation.*SCIM/i);
  });

  it("navigation preserves anchors for visible annotated entries rather than disabling hrefs", () => {
    expect(SITE_NAV_SRC).toContain("href={item.href}");
    expect(ORG_NAV_SRC).toContain("href={item.href}");
    expect(SITE_NAV_SRC).not.toMatch(
      /if\s*\([^)]*affordance[^)]*unavailable[^)]*\)\s*return\s*<span/
    );
    expect(ORG_NAV_SRC).not.toMatch(
      /if\s*\([^)]*affordance[^)]*unavailable[^)]*\)\s*return\s*<span/
    );
  });
});
