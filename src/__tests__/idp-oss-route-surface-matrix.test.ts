import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SurfaceClass =
  | "OSS-supported"
  | "CE-only"
  | "AG-dependent"
  | "mixed-mode"
  | "backend-absent tolerant"
  | "unknown/backend-dependent";

interface SurfaceMatrixRow {
  route: string;
  classification: SurfaceClass;
  coveredRoutes: string[];
  files: string[];
  signals: string[];
}

const ROOT = resolve(__dirname, "..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

function collectIDPFacingPageRoutes(dir = resolve(ROOT, "app"), segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "api" || entry === "ag-admin") continue;
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      routes.push(...collectIDPFacingPageRoutes(full, [...segments, entry]));
      continue;
    }
    if (entry !== "page.tsx") continue;
    const route = `/${segments.join("/")}`.replace(/\/$/, "");
    routes.push(route === "" ? "/" : route);
  }
  return routes.sort();
}

const IDP_ROUTE_SURFACE_MATRIX: SurfaceMatrixRow[] = [
  {
    route: "/ + /setup-required runtime entrypoints",
    classification: "backend-absent tolerant",
    coveredRoutes: ["/", "/setup-required"],
    files: ["app/page.tsx", "app/setup-required/page.tsx"],
    signals: ["degraded-idp-unavailable", "Setup required", "runtime configuration"],
  },
  {
    route: "/unavailable outage landing (THE-UNAVAILABLE-IS-NOT-EXPIRED)",
    classification: "backend-absent tolerant",
    coveredRoutes: ["/unavailable"],
    files: [
      "app/unavailable/page.tsx",
      "components/shared/service-unavailable.tsx",
      "lib/server-session.ts",
      "lib/session-guard.ts",
    ],
    signals: [
      "ServiceUnavailable",
      "correlationId",
      "Temporarily unavailable",
      "render-unavailable",
    ],
  },
  {
    route: "/setup appliance first-run wizard",
    classification: "OSS-supported",
    coveredRoutes: ["/setup"],
    files: ["app/setup/page.tsx", "app/setup/setup-wizard.tsx", "lib/idp-setup-client.ts"],
    signals: ["First-run setup", "getSetupStatus", "verifySetupToken", "completeSetup"],
  },
  {
    route: "/account/settings",
    classification: "OSS-supported",
    coveredRoutes: ["/account/settings"],
    files: ["app/account/settings/page.tsx", "lib/idp-account-client.ts"],
    signals: ["getOwnMfaStatus", "listOwnSessions", "PasskeySection", "/api/v1/me/mfa/status"],
  },
  {
    route: "/login + MFA session handling",
    classification: "OSS-supported",
    // /logout (CE-UI-1): the sign-out page, whose form posts the sign-out.
    coveredRoutes: ["/login", "/logout"],
    files: [
      "app/login/page.tsx",
      "app/logout/page.tsx",
      "components/auth/password-form.tsx",
      "lib/idp-client.ts",
    ],
    signals: ["LoginPageClient", "mfa_enrollment_required", "sessionId: string | null"],
  },
  {
    // /invitation DELETED 2026-08-29 (THE-DEAD-INVITATION, owner ruling):
    // neither the OSS nor the CE backend mounts its mint/validate/consume
    // flow — the page was dead on both. Removed, not mounted.
    route: "/claim + /activate + password recovery + /verify-email",
    classification: "OSS-supported",
    coveredRoutes: ["/activate", "/claim", "/forgot-password", "/reset-password", "/verify-email"],
    files: [
      "app/activate/page.tsx",
      "app/claim/page.tsx",
      "app/forgot-password/page.tsx",
      "app/reset-password/page.tsx",
      "app/verify-email/page.tsx",
    ],
    signals: [
      "/api/v1/auth/claim",
      "/api/v1/auth/organizations/activate",
      "/api/v1/auth/verify-email",
      "ResetPasswordForm",
    ],
  },
  {
    route: "/dashboard + /dashboard/security",
    classification: "OSS-supported",
    coveredRoutes: ["/dashboard", "/dashboard/security"],
    files: ["app/dashboard/page.tsx", "app/dashboard/security/page.tsx"],
    signals: ["getOwnProfile", "/account/settings?tab=passkeys"],
  },
  {
    route: "/org-admin overview + users",
    classification: "OSS-supported",
    coveredRoutes: ["/org-admin", "/org-admin/users", "/org-admin/users/[id]"],
    files: ["app/org-admin/page.tsx", "app/org-admin/users/page.tsx", "lib/idp-admin-client.ts"],
    signals: ["getOwnOrganization", "listOrgUsers", "org_admin"],
  },
  {
    route: "/org-admin/settings",
    classification: "mixed-mode",
    coveredRoutes: ["/org-admin/settings"],
    files: [
      "app/org-admin/settings/page.tsx",
      "app/org-admin/settings/settings-readonly-sections.tsx",
      "app/site-admin/organizations/[id]/protocol-settings-panel.tsx",
    ],
    signals: [
      "DCR Foundation",
      "SCIM 2.0 provisioning is an Enterprise/CE capability",
      "OSS/Starter Authorization Server surface",
    ],
  },
  {
    route: "/org-admin/audit",
    classification: "CE-only",
    coveredRoutes: ["/org-admin/audit"],
    files: ["app/org-admin/audit/page.tsx"],
    signals: ["Audit log requires Enterprise/CE", "IDP OSS"],
  },
  {
    route: "/site-admin/audit",
    classification: "CE-only",
    coveredRoutes: ["/site-admin/audit"],
    files: ["app/site-admin/audit/page.tsx"],
    signals: ["Audit log requires Enterprise/CE", "IDP OSS"],
  },
  {
    route: "/site-admin/anomaly",
    classification: "CE-only",
    coveredRoutes: ["/site-admin/anomaly"],
    files: ["app/site-admin/anomaly/page.tsx"],
    signals: ["Anomaly detection is an Enterprise/CE IDP capability", "IDP OSS"],
  },
  {
    route: "/site-admin/reports",
    // Owner decision 5 (2026-09-25): no edition serves report exports; the
    // page states that boundary and requests nothing.
    classification: "backend-absent tolerant",
    coveredRoutes: ["/site-admin/reports"],
    files: ["app/site-admin/reports/page.tsx"],
    signals: [
      "Report exports are not available",
      "No edition of the identity provider serves report exports",
    ],
  },
  {
    route: "/site-admin/system/audit-chain",
    classification: "CE-only",
    coveredRoutes: ["/site-admin/system/audit-chain"],
    files: ["app/site-admin/system/audit-chain/page.tsx", "lib/idp-admin-client.ts"],
    signals: ["Audit chain verification requires Enterprise/CE", "classifyAdminReadFailure(res)"],
  },
  {
    route: "/site-admin/license",
    classification: "CE-only",
    coveredRoutes: ["/site-admin/license"],
    files: [
      "app/site-admin/license/page.tsx",
      "app/site-admin/license/license-manager.tsx",
      "lib/idp-license-client.ts",
    ],
    signals: [
      "Site-admin CE license management page",
      "adminGetLicenseStatus",
      "adminUploadLicense",
      "admin:license",
    ],
  },
  {
    route: "/upgrade OSS-to-CE upgrade wizard",
    classification: "CE-only",
    coveredRoutes: ["/upgrade"],
    files: ["app/upgrade/page.tsx", "app/upgrade/upgrade-wizard.tsx", "lib/idp-upgrade-client.ts"],
    signals: [
      "OSS-to-CE upgrade wizard",
      "getUpgradeStatus",
      "ce_migrations_current",
      "CE schema upgrade is complete",
    ],
  },
  {
    route: "/org-admin/api-resources",
    classification: "OSS-supported",
    coveredRoutes: [
      "/org-admin/api-resources",
      "/org-admin/api-resources/[id]",
      "/org-admin/api-resources/[id]/edit",
      "/org-admin/api-resources/new",
    ],
    files: ["app/org-admin/api-resources/page.tsx", "lib/idp-admin-client.ts"],
    signals: [
      "OSS/Starter Authorization Server surface",
      "This IDP backend did not make the endpoint available",
    ],
  },
  {
    route: "/org-admin/applications",
    classification: "OSS-supported",
    coveredRoutes: [
      "/org-admin/applications",
      "/org-admin/applications/[id]",
      "/org-admin/applications/[id]/edit",
      "/org-admin/applications/new",
    ],
    files: ["app/org-admin/applications/page.tsx", "lib/idp-admin-client.ts"],
    signals: ["/api/v1/clients", "OAuth"],
  },
  {
    route: "/org-admin/service-accounts",
    classification: "OSS-supported",
    coveredRoutes: [
      "/org-admin/service-accounts",
      "/org-admin/service-accounts/[id]",
      "/org-admin/service-accounts/new",
    ],
    files: ["app/org-admin/service-accounts/page.tsx", "lib/idp-admin-client.ts"],
    signals: ["service account", "No usable credential is issued here"],
  },
  {
    route: "/site-admin overview + settings",
    classification: "backend-absent tolerant",
    coveredRoutes: ["/site-admin", "/site-admin/settings"],
    files: ["app/site-admin/page.tsx", "app/site-admin/settings/page.tsx"],
    signals: ["SiteAdminOverviewClient", "Runtime health of configured backend services"],
  },
  {
    route: "/site-admin/organizations/* actions",
    classification: "OSS-supported",
    coveredRoutes: [
      "/site-admin/organizations",
      "/site-admin/organizations/[id]",
      "/site-admin/organizations/[id]/assign-admin",
      "/site-admin/organizations/[id]/deactivate",
      "/site-admin/organizations/[id]/delete",
      "/site-admin/organizations/[id]/edit",
      "/site-admin/organizations/[id]/reactivate",
      "/site-admin/organizations/[id]/restore",
      "/site-admin/organizations/new",
    ],
    files: [
      "app/site-admin/organizations/[id]/page.tsx",
      "app/site-admin/organizations/[id]/operational-status.ts",
      "lib/idp-admin-client.ts",
    ],
    signals: ["resetOrgAdminMFA", "sovereign bunker"],
  },
  {
    route: "/site-admin/keys",
    classification: "OSS-supported",
    coveredRoutes: ["/site-admin/keys"],
    files: ["app/site-admin/keys/page.tsx", "lib/idp-admin-client.ts"],
    signals: ["Signing keys", "listSigningKeys", "Key rotation"],
  },
  {
    route: "/site-admin/system info + sessions",
    classification: "OSS-supported",
    coveredRoutes: ["/site-admin/system", "/site-admin/system/info", "/site-admin/system/sessions"],
    files: [
      "app/site-admin/system/page.tsx",
      "app/site-admin/system/info/page.tsx",
      "app/site-admin/system/sessions/page.tsx",
    ],
    signals: ["Runtime info", "Admin sessions", "Read-only system observability"],
  },
  {
    route: "/site-admin/org-link + import",
    classification: "AG-dependent",
    coveredRoutes: [
      "/site-admin/org-link",
      "/site-admin/org-link/readiness",
      "/site-admin/org-link/ag-plan",
    ],
    files: [
      "app/site-admin/org-link/page.tsx",
      "app/site-admin/org-link/readiness/page.tsx",
      "app/site-admin/org-link/ag-plan/page.tsx",
    ],
    signals: ["AG Organizations", "Organization scope only", "dry_run"],
  },
  {
    route: "/platform-status + /api/status",
    classification: "backend-absent tolerant",
    coveredRoutes: ["/platform-status"],
    files: ["app/platform-status/page.tsx", "app/api/status/route.ts"],
    signals: ["Live discovery state", "healthy: null", "Not configured"],
  },
  {
    route: "IDP capability-map discovery",
    classification: "backend-absent tolerant",
    coveredRoutes: [],
    files: ["lib/runtime-composition.ts", "lib/types.ts", "app/platform-status/page.tsx"],
    signals: [
      "capabilities",
      "capability_map_schema_version",
      "account_self_service",
      "oauth_clients",
      "api_resources",
      "service_accounts",
      "scope_templates",
      "protocol_settings",
      "dynamic_client_registration",
      "Account self-service",
      "scim",
    ],
  },
];

describe("IDP OSS route/surface matrix", () => {
  it("covers the expected high-value IDP-facing surfaces", () => {
    expect(IDP_ROUTE_SURFACE_MATRIX.map((row) => row.route)).toEqual([
      "/ + /setup-required runtime entrypoints",
      "/unavailable outage landing (THE-UNAVAILABLE-IS-NOT-EXPIRED)",
      "/setup appliance first-run wizard",
      "/account/settings",
      "/login + MFA session handling",
      "/claim + /activate + password recovery + /verify-email",
      "/dashboard + /dashboard/security",
      "/org-admin overview + users",
      "/org-admin/settings",
      "/org-admin/audit",
      "/site-admin/audit",
      "/site-admin/anomaly",
      "/site-admin/reports",
      "/site-admin/system/audit-chain",
      "/site-admin/license",
      "/upgrade OSS-to-CE upgrade wizard",
      "/org-admin/api-resources",
      "/org-admin/applications",
      "/org-admin/service-accounts",
      "/site-admin overview + settings",
      "/site-admin/organizations/* actions",
      "/site-admin/keys",
      "/site-admin/system info + sessions",
      "/site-admin/org-link + import",
      "/platform-status + /api/status",
      "IDP capability-map discovery",
    ]);
  });

  it("uses every required classification at least once", () => {
    const classes = new Set(IDP_ROUTE_SURFACE_MATRIX.map((row) => row.classification));
    expect(classes).toEqual(
      new Set<SurfaceClass>([
        "OSS-supported",
        "CE-only",
        "AG-dependent",
        "mixed-mode",
        "backend-absent tolerant",
      ])
    );
  });

  it("covers every current IDP-facing app page route exactly once", () => {
    const actualRoutes = collectIDPFacingPageRoutes();
    const coveredRoutes = IDP_ROUTE_SURFACE_MATRIX.flatMap((row) => row.coveredRoutes).sort();
    expect(coveredRoutes).toEqual(actualRoutes);
  });

  for (const row of IDP_ROUTE_SURFACE_MATRIX) {
    it(`${row.route} has source signals for ${row.classification}`, () => {
      for (const rel of row.files) {
        expect(existsSync(resolve(ROOT, rel)), `${rel} must exist`).toBe(true);
      }
      const combined = row.files.map(readSource).join("\n");
      for (const signal of row.signals) {
        expect(combined, `${row.route} missing signal ${signal}`).toContain(signal);
      }
    });
  }

  it("keeps SCIM out of OSS/Foundation wording while preserving DCR Foundation", () => {
    const protocolPanel = readSource(
      "app/site-admin/organizations/[id]/protocol-settings-panel.tsx"
    );
    expect(protocolPanel).toContain("Controls per-organization availability of DCR Foundation");
    expect(protocolPanel).toContain("SCIM 2.0 provisioning is an Enterprise/CE capability");
    expect(protocolPanel).not.toMatch(/SCIM.*(OSS|Foundation|Starter)/i);
  });

  it("offers no report export link in any edition (owner decision 5)", () => {
    const reportsPage = readSource("app/site-admin/reports/page.tsx");
    expect(reportsPage).not.toContain("/api/idp");
    expect(reportsPage).not.toMatch(/<a\b/);
    expect(reportsPage).toContain("No edition of the identity provider serves report exports");
  });
});
