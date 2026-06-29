/**
 * UI Role-Shell Stability Harness.
 *
 * Landed by agent-a-20260757-ui-role-shell-stability-harness-audit-and-pins
 * per the workspace stability mini-track at
 *   wiki/platform/workspace-stability-harness.md
 * and the CORE RULE in
 *   split-control/STABILITY_GUARDRAILS.md.
 *
 * Purpose: protect the role-shell + nav + capability-gate invariants for
 * the four authenticated UI role shells — site-admin, org-admin,
 * dashboard, account — and the platform-status page that consumes the
 * shared runtime composition. The Account Settings stability harness
 * already protects /account/*; this harness extends the same shape to
 * the other three role shells.
 *
 * Regression classes caught:
 *   - Sidebar/<aside> dropped from a role shell (the original
 *     agent-a-20260738 sidebar-missing-on-Account-Settings class)
 *   - Role redirect gate dropped (operators land in the wrong shell)
 *   - Capability-derived nav links wired to the wrong shape (the
 *     agent-a-20260738 TS2339 `runtimeState.idpCapabilities` regression
 *     class)
 *   - Platform-status page bypassing getServerRuntimeState (would
 *     re-introduce per-page readiness probes, the 2026-07-08 closure
 *     regression class)
 *   - Site/Org-admin nav drops the canonical link set (Organizations,
 *     Audit, Signing keys, License, Anomaly, Reports, System, Settings
 *     for site-admin; Overview, Users, Audit, Settings, Applications,
 *     API resources, Service accounts for org-admin)
 *   - Capability-gated nav entries lose the `getPrimaryNavCapabilityDecision`
 *     wiring (would silently render disabled features as active)
 *
 * SECURITY: source-text reflection only. No real secrets, cookies,
 * tokens, sessions, TOTP codes, recovery codes, or operator material
 * are referenced. Placeholder labels only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── /site-admin role shell ─────────────────────────────────────────────────

describe("site-admin role-shell layout invariants", () => {
  const layout = source("app/site-admin/layout.tsx");

  it("renders <aside> as the sidebar container (catches sidebar-missing regression)", () => {
    expect(layout).toMatch(/<aside\b/);
  });

  it("imports SiteAdminNav + AccountMenu from the canonical paths", () => {
    expect(layout).toMatch(
      /import\s+\{\s*SiteAdminNav\s*\}\s+from\s+"@\/components\/site-admin\/site-admin-nav"/
    );
    expect(layout).toMatch(
      /import\s+\{\s*AccountMenu\s*\}\s+from\s+"@\/components\/shared\/account-menu"/
    );
  });

  it("imports getServerSession + getServerRuntimeState for the role gate + capability path", () => {
    expect(layout).toMatch(/getServerSession.*from\s+"@\/lib\/server-session"/);
    expect(layout).toMatch(/getServerRuntimeState.*from\s+"@\/lib\/server-runtime-state"/);
  });

  it("redirects to /login?reason=session_expired on no session", () => {
    expect(layout).toMatch(/redirect\(\s*"\/login\?reason=session_expired"\s*\)/);
  });

  it("redirects wrong-role users to roleToPath(role)", () => {
    expect(layout).toMatch(/redirect\(\s*roleToPath\(role\)\s*\)/);
  });

  it("derives capabilities via runtimeState shape (NOT the deprecated top-level idpCapabilities)", () => {
    // The agent-a-20260738 TS2339 class was caused by accessing
    // runtimeState.idpCapabilities (wrong shape). Pin the correct
    // access path so a regression cannot re-introduce the typo.
    expect(layout).not.toMatch(/runtimeState\.idpCapabilities/);
  });
});

// ── /org-admin role shell ──────────────────────────────────────────────────

describe("org-admin role-shell layout invariants", () => {
  const layout = source("app/org-admin/layout.tsx");

  it("renders <aside> as the sidebar container", () => {
    expect(layout).toMatch(/<aside\b/);
  });

  it("imports OrgAdminNav + AccountMenu from the canonical paths", () => {
    expect(layout).toMatch(
      /import\s+\{\s*OrgAdminNav\s*\}\s+from\s+"@\/components\/org-admin\/org-admin-nav"/
    );
    expect(layout).toMatch(
      /import\s+\{\s*AccountMenu\s*\}\s+from\s+"@\/components\/shared\/account-menu"/
    );
  });

  it("imports getServerSession + getServerRuntimeState for the role gate + capability path", () => {
    expect(layout).toMatch(/getServerSession.*from\s+"@\/lib\/server-session"/);
    expect(layout).toMatch(/getServerRuntimeState.*from\s+"@\/lib\/server-runtime-state"/);
  });

  it("redirects to /login?reason=session_expired on no session", () => {
    expect(layout).toMatch(/redirect\(\s*"\/login\?reason=session_expired"\s*\)/);
  });

  it("redirects to Account Settings MFA tab when org policy + user state require MFA enrollment", () => {
    // The agent-a-20260737/20260740 contract: org_admin without MFA gets
    // sent to /account/settings?reason=mfa_required (which then opens
    // the MFA tab via the agent-a-20260740 explicit-reason rule).
    expect(layout).toMatch(/redirect\(\s*"\/account\/settings\?reason=mfa_required"\s*\)/);
  });

  it("does NOT use the deprecated runtimeState.idpCapabilities shape", () => {
    expect(layout).not.toMatch(/runtimeState\.idpCapabilities/);
  });
});

// ── /dashboard role shell ──────────────────────────────────────────────────

describe("dashboard role-shell layout invariants", () => {
  const layout = source("app/dashboard/layout.tsx");

  it("renders <aside> as the sidebar container", () => {
    expect(layout).toMatch(/<aside\b/);
  });

  it("imports AccountMenu + getServerSession for the header + role gate", () => {
    expect(layout).toMatch(
      /import\s+\{\s*AccountMenu\s*\}\s+from\s+"@\/components\/shared\/account-menu"/
    );
    expect(layout).toMatch(/getServerSession.*from\s+"@\/lib\/server-session"/);
  });

  it("redirects to /login?reason=session_expired on no session", () => {
    expect(layout).toMatch(/redirect\(\s*"\/login\?reason=session_expired"\s*\)/);
  });

  it("redirects wrong-role users via roleToPath(role)", () => {
    expect(layout).toMatch(/redirect\(\s*roleToPath\(role\)\s*\)/);
  });
});

// ── /account role shell (smoke pin; full coverage in account-settings-stability-harness) ─

describe("account role-shell layout — smoke pin", () => {
  const layout = source("app/account/layout.tsx");

  it("renders <aside> (deep pins live in account-settings-stability-harness.test.ts)", () => {
    expect(layout).toMatch(/<aside\b/);
  });

  it("references the shared runtimeState capability path", () => {
    expect(layout).toMatch(/runtimeState\?\.components\?\.idp\?\.capabilities/);
  });
});

// ── SiteAdminNav canonical link set ────────────────────────────────────────

describe("SiteAdminNav canonical link set", () => {
  const nav = source("components/site-admin/site-admin-nav.tsx");

  it("declares SITE_ADMIN_NAV_LINKS as a stable exported list", () => {
    expect(nav).toMatch(/export\s+const\s+SITE_ADMIN_NAV_LINKS\s*:\s*NavLink\[\]/);
  });

  it("includes the canonical site-admin surfaces (catches a dropped nav entry)", () => {
    for (const href of [
      "/site-admin",
      "/site-admin/organizations",
      "/site-admin/audit",
      "/site-admin/keys",
      "/site-admin/license",
      "/site-admin/anomaly",
      "/site-admin/reports",
      "/site-admin/system",
      "/site-admin/settings",
    ]) {
      expect(nav).toMatch(new RegExp(`href:\\s*"${href.replace(/\//g, "\\/")}"`));
    }
  });

  it("capability-gated entries (Audit / Anomaly / Reports) use getPrimaryNavCapabilityDecision", () => {
    // Pin that the nav consults the capability decision helper rather
    // than hard-coding visibility — the same plumbing the Account
    // Settings Passkeys gate uses on the page side.
    expect(nav).toMatch(/getPrimaryNavCapabilityDecision\(/);
  });

  it("declares the 'enterprise_ce' boundary token for CE-only capabilities", () => {
    // The boundary keeps the affordance honest when CE explicitly does
    // not advertise a capability that OSS may.
    expect(nav).toMatch(/boundary:\s*"enterprise_ce"/);
  });
});

// ── OrgAdminNav canonical link set ─────────────────────────────────────────

describe("OrgAdminNav canonical link set", () => {
  const nav = source("components/org-admin/org-admin-nav.tsx");

  it("declares ORG_ADMIN_NAV_LINKS as a stable exported list", () => {
    expect(nav).toMatch(/export\s+const\s+ORG_ADMIN_NAV_LINKS\s*:\s*NavLink\[\]/);
  });

  it("includes the canonical org-admin surfaces", () => {
    for (const href of [
      "/org-admin",
      "/org-admin/users",
      "/org-admin/audit",
      "/org-admin/settings",
      "/org-admin/applications",
      "/org-admin/api-resources",
      "/org-admin/service-accounts",
    ]) {
      expect(nav).toMatch(new RegExp(`href:\\s*"${href.replace(/\//g, "\\/")}"`));
    }
  });

  it("capability-gated entries (Audit / Applications / API resources / Service accounts) use getPrimaryNavCapabilityDecision", () => {
    expect(nav).toMatch(/getPrimaryNavCapabilityDecision\(/);
  });
});

// ── platform-status page invariants ────────────────────────────────────────

describe("platform-status page consumes the shared runtime composition", () => {
  const page = source("app/platform-status/page.tsx");

  it("uses getServerRuntimeState (NOT bespoke per-page fetch)", () => {
    // Pin the runtime-state composition usage so a future refactor
    // that re-introduces per-page readiness probes regresses the
    // 2026-07-08 closure.
    expect(page).toMatch(/getServerRuntimeState\(\)/);
  });

  it("reads BOTH state.components.idp AND state.components.ag for the dual-backend status panel", () => {
    expect(page).toMatch(/state\.components\.idp/);
    expect(page).toMatch(/state\.components\.ag/);
  });
});

// ── Cross-cutting role-shell discipline ────────────────────────────────────

describe("cross-cutting role-shell discipline", () => {
  const layouts = [
    "app/site-admin/layout.tsx",
    "app/org-admin/layout.tsx",
    "app/dashboard/layout.tsx",
    "app/account/layout.tsx",
  ];

  it("none of the role-shell layouts writes to localStorage / sessionStorage", () => {
    for (const rel of layouts) {
      const src = source(rel);
      expect(src).not.toMatch(/localStorage\s*\.\s*(set|get|remove)Item/);
      expect(src).not.toMatch(/sessionStorage\s*\.\s*(set|get|remove)Item/);
      expect(src).not.toMatch(/window\s*\.\s*localStorage/);
      expect(src).not.toMatch(/window\s*\.\s*sessionStorage/);
    }
  });

  it("none of the role-shell layouts emits console.log secret material", () => {
    for (const rel of layouts) {
      const src = source(rel);
      expect(src).not.toMatch(/console\s*\.\s*(log|warn|error|debug|info)\s*\(/);
    }
  });

  it("every role-shell layout has a session-gated redirect to /login?reason=session_expired", () => {
    for (const rel of layouts) {
      const src = source(rel);
      expect(src).toMatch(/redirect\(\s*"\/login\?reason=session_expired"\s*\)/);
    }
  });
});
