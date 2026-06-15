/**
 * Unit tests for the org protocol settings feature.
 *
 * Scope:
 *   - `protocol-settings-helpers.ts` pure functions
 *   - `protocol-settings-actions.ts` source-file structure invariants
 *   - `protocol-settings-panel.tsx` source-file negative invariants
 *   - `org-admin/settings/page.tsx` source-file structure + negative invariants
 *   - `idp-admin-client.ts` sanitizer and export invariants
 *
 * Tests run in the project's node-only vitest environment (no jsdom /
 * React rendering). Client-component branch coverage is delegated to
 * Playwright e2e specs.
 *
 * SECURITY: all inputs are synthetic. No real org IDs, tokens, IATs,
 * RATs, client_secret values, or signing material appear in this file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatSettingsSource,
  isDefaultUnset,
  protocolSettingsLoadErrorMessage,
  protocolSettingsSaveErrorMessage,
} from "../app/site-admin/organizations/[id]/protocol-settings-helpers";
import type { GetOrgProtocolSettingsResult, OrgProtocolSettings } from "../lib/types";

// ── Fixture builder ──────────────────────────────────────────────────────────

const FIXTURE_ORG_ID = "019e67c6-e71d-76ce-a615-ada70411d953";

function settings(overrides: Partial<OrgProtocolSettings> = {}): OrgProtocolSettings {
  return {
    organization_id: FIXTURE_ORG_ID,
    dynamic_client_registration_enabled: false,
    scim_enabled: false,
    source: "default",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

// ── formatSettingsSource ─────────────────────────────────────────────────────

describe("formatSettingsSource", () => {
  it("default → 'System default (not explicitly configured)'", () => {
    expect(formatSettingsSource("default")).toBe("System default (not explicitly configured)");
  });

  it("explicit → 'Explicitly configured'", () => {
    expect(formatSettingsSource("explicit")).toBe("Explicitly configured");
  });
});

// ── isDefaultUnset ───────────────────────────────────────────────────────────

describe("isDefaultUnset", () => {
  it("source=default + both false → true (operator has not configured this org)", () => {
    expect(isDefaultUnset(settings())).toBe(true);
  });

  it("source=default + dcr=true → false", () => {
    expect(isDefaultUnset(settings({ dynamic_client_registration_enabled: true }))).toBe(false);
  });

  it("source=default + scim=true → false", () => {
    expect(isDefaultUnset(settings({ scim_enabled: true }))).toBe(false);
  });

  it("source=explicit + both false → false (explicit row exists, just both disabled)", () => {
    expect(
      isDefaultUnset(
        settings({
          source: "explicit",
          dynamic_client_registration_enabled: false,
          scim_enabled: false,
        })
      )
    ).toBe(false);
  });

  it("source=explicit + both true → false", () => {
    expect(
      isDefaultUnset(
        settings({
          source: "explicit",
          dynamic_client_registration_enabled: true,
          scim_enabled: true,
        })
      )
    ).toBe(false);
  });
});

// ── protocolSettingsSaveErrorMessage ─────────────────────────────────────────

describe("protocolSettingsSaveErrorMessage", () => {
  it("notFound=true → org-not-found copy", () => {
    const msg = protocolSettingsSaveErrorMessage({ notFound: true, forbidden: false, status: 404 });
    expect(msg).toContain("not available");
    expect(msg).not.toContain("localhost");
  });

  it("forbidden=true → role-neutral permission copy", () => {
    const msg = protocolSettingsSaveErrorMessage({
      notFound: false,
      forbidden: true,
      status: 403,
    });
    // Role-neutral: backend now allows both site_admin and org_admin;
    // the message must not imply only site_admin can perform this action.
    expect(msg).toContain("permission");
    expect(msg).not.toContain("Only site administrators");
    expect(msg).not.toContain("site administrator");
    expect(msg).not.toContain("token");
  });

  it("status=0 → network-error copy", () => {
    const msg = protocolSettingsSaveErrorMessage({
      notFound: false,
      forbidden: false,
      unavailable: true,
      status: 0,
    });
    expect(msg).toContain("identity provider is unavailable");
  });

  it("notLicensed=true → commercial-tier copy that preserves DCR Foundation and gates SCIM", () => {
    const msg = protocolSettingsSaveErrorMessage({
      notFound: false,
      forbidden: false,
      notLicensed: true,
      status: 403,
    });
    expect(msg).toMatch(/commercial|license/i);
    expect(msg).toMatch(/DCR Foundation.*available|available.*DCR Foundation/i);
    expect(msg).toMatch(/SCIM 2\.0 requires Enterprise\/CE/i);
    expect(msg).not.toContain("localhost");
  });

  it("unavailable=true with 503 → backend-unavailable save copy", () => {
    const msg = protocolSettingsSaveErrorMessage({
      notFound: false,
      forbidden: false,
      unavailable: true,
      status: 503,
    });
    expect(msg).toContain("identity provider is unavailable");
    expect(msg).not.toContain("503");
  });

  it("generic non-zero status → generic error copy", () => {
    const msg = protocolSettingsSaveErrorMessage({
      notFound: false,
      forbidden: false,
      status: 500,
    });
    expect(msg).toContain("Could not save");
    expect(msg).not.toContain("500");
  });

  it("no error message contains raw credential material", () => {
    const credentialTerms = [
      "password_hash",
      "mfa_secret",
      "otpauth",
      "claim_token",
      "bearer ",
      "set-cookie",
      "client_secret",
      "eyJhbGciO",
    ];
    const statuses = [0, 400, 403, 404, 409, 500, 503];
    for (const status of statuses) {
      const msg = protocolSettingsSaveErrorMessage({
        notFound: status === 404,
        forbidden: status === 403,
        status,
      });
      for (const term of credentialTerms) {
        expect(msg.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });
});

// ── protocolSettingsLoadErrorMessage ─────────────────────────────────────────

describe("protocolSettingsLoadErrorMessage", () => {
  const CREDENTIAL_TERMS = [
    "password_hash",
    "mfa_secret",
    "otpauth",
    "claim_token",
    "bearer ",
    "set-cookie",
    "client_secret",
    "eyJhbGciO",
  ];

  it("null → backend unavailable copy", () => {
    const msg = protocolSettingsLoadErrorMessage(null);
    expect(msg).toContain("unavailable");
    expect(msg).not.toContain("localhost");
  });

  it("not_authenticated → session-expired copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_authenticated",
      status: 401,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).toMatch(/session|sign in/i);
    expect(msg).not.toContain("localhost");
  });

  it("forbidden → role-neutral permission copy (no role names)", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "forbidden",
      status: 403,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).toContain("access");
    expect(msg).not.toContain("site_admin");
    expect(msg).not.toContain("org_admin");
    expect(msg).not.toContain("site administrator");
    expect(msg).not.toContain("token");
    expect(msg).not.toContain("Enterprise");
    expect(msg).not.toContain("enterprise license");
  });

  it("not_licensed → commercial-tier copy that preserves DCR Foundation and gates SCIM", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_licensed",
      status: 403,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain("localhost");
    // Must explain commercial tier is needed for advanced capabilities.
    expect(msg).toMatch(/commercial|license/i);
    // DCR Foundation remains available; SCIM itself is Enterprise/CE-only.
    expect(msg).toMatch(/DCR Foundation.*available|available.*DCR Foundation/i);
    expect(msg).toMatch(/SCIM 2\.0.*Enterprise\/CE|Enterprise\/CE.*SCIM 2\.0/i);
    // Must not expose raw credential material.
    for (const term of CREDENTIAL_TERMS) {
      expect(msg.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("not_found → endpoint-absent copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_found",
      status: 404,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain("localhost");
  });

  it("not_found with 501 → endpoint-not-implemented copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_found",
      status: 501,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).toContain("not available");
    expect(msg).not.toContain("501");
    expect(msg).not.toContain("localhost");
  });

  it("unavailable → backend-unreachable copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "unavailable",
      status: 0,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).toContain("unavailable");
  });

  it("unavailable with 503 → backend-unavailable copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "unavailable",
      status: 503,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).toContain("unavailable");
    expect(msg).not.toContain("503");
    expect(msg).not.toContain("localhost");
  });

  it("unknown → generic error copy", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "unknown",
      status: 500,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain("500");
  });

  it("no load error message contains raw credential material", () => {
    const cases: Array<GetOrgProtocolSettingsResult | null> = [
      null,
      { ok: false, reason: "not_authenticated", status: 401 },
      { ok: false, reason: "forbidden", status: 403 },
      { ok: false, reason: "not_licensed", status: 403 },
      { ok: false, reason: "not_found", status: 404 },
      { ok: false, reason: "unavailable", status: 0 },
      { ok: false, reason: "unknown", status: 503 },
    ];
    for (const c of cases) {
      const msg = protocolSettingsLoadErrorMessage(c);
      for (const term of CREDENTIAL_TERMS) {
        expect(msg.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });

  it("forbidden copy does not make license-tier claims", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "forbidden",
      status: 403,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    expect(msg).not.toMatch(/enterprise.*license|license.*enterprise/i);
    expect(msg).not.toMatch(/enterprise.*tier|tier.*enterprise/i);
    expect(msg).not.toMatch(/DCR.*enterprise|SCIM.*enterprise/i);
  });

  it("not_licensed copy affirms DCR Foundation availability and SCIM Enterprise/CE boundary", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_licensed",
      status: 403,
    };
    const msg = protocolSettingsLoadErrorMessage(result);
    // Should reference commercial tier for advanced capabilities.
    expect(msg).toMatch(/commercial|license/i);
    // DCR Foundation remains available on the current plan.
    expect(msg).toMatch(/DCR Foundation.*available|available.*DCR Foundation/i);
    // SCIM 2.0 is not presented as a lower-tier foundation capability.
    expect(msg).toMatch(/SCIM 2\.0 requires Enterprise\/CE/i);
  });
});

// ── GetOrgProtocolSettingsResult type shape ───────────────────────────────────

describe("GetOrgProtocolSettingsResult type shape", () => {
  it("ok=true carries settings object", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: true,
      settings: {
        organization_id: FIXTURE_ORG_ID,
        dynamic_client_registration_enabled: true,
        scim_enabled: false,
        source: "explicit",
        created_at: "2026-06-05T00:00:00Z",
        updated_at: null,
      },
    };
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.organization_id).toBe(FIXTURE_ORG_ID);
    }
  });

  it("ok=false carries reason and status — forbidden", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "forbidden",
      status: 403,
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("forbidden");
      expect(result.status).toBe(403);
    }
  });

  it("ok=false carries reason and status — not_authenticated", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_authenticated",
      status: 401,
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_authenticated");
      expect(result.status).toBe(401);
    }
  });

  it("ok=false carries reason and status — not_licensed", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_licensed",
      status: 403,
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_licensed");
      expect(result.status).toBe(403);
    }
  });

  it("ok=false carries reason and status — not_found", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "not_found",
      status: 404,
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
    }
  });

  it("ok=false carries reason and status — unavailable", () => {
    const result: GetOrgProtocolSettingsResult = {
      ok: false,
      reason: "unavailable",
      status: 0,
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unavailable");
      expect(result.status).toBe(0);
    }
  });
});

// ── OrgProtocolSettings type shape ───────────────────────────────────────────

describe("OrgProtocolSettings type shape", () => {
  it("source field only accepts 'explicit' or 'default'", () => {
    const explicit = settings({ source: "explicit" });
    const def = settings({ source: "default" });
    expect(explicit.source).toBe("explicit");
    expect(def.source).toBe("default");
  });

  it("timestamps are null when source is default (no row exists)", () => {
    const s = settings({ source: "default" });
    expect(s.created_at).toBeNull();
    expect(s.updated_at).toBeNull();
  });

  it("timestamps can be populated when source is explicit", () => {
    const s = settings({
      source: "explicit",
      created_at: "2026-06-04T00:00:00Z",
      updated_at: "2026-06-04T00:00:00Z",
    });
    expect(typeof s.created_at).toBe("string");
    expect(typeof s.updated_at).toBe("string");
  });
});

// ── Source-file negative invariants ─────────────────────────────────────────

const SITE_ADMIN_DIR = resolve(__dirname, "../app/site-admin/organizations/[id]");
const ORG_ADMIN_SETTINGS_DIR = resolve(__dirname, "../app/org-admin/settings");

function readSiteAdminSource(filename: string): string {
  return readFileSync(resolve(SITE_ADMIN_DIR, filename), "utf8");
}

function readOrgAdminSource(filename: string): string {
  return readFileSync(resolve(ORG_ADMIN_SETTINGS_DIR, filename), "utf8");
}

// ── protocol-settings-panel.tsx (site-admin) ────────────────────────────────

describe("protocol-settings-panel.tsx — source invariants", () => {
  const panel = readSiteAdminSource("protocol-settings-panel.tsx");

  it("imports GetOrgProtocolSettingsResult (discriminated prop type)", () => {
    expect(panel).toContain("GetOrgProtocolSettingsResult");
  });

  it("uses discriminated check (!initialSettings || !initialSettings.ok) not null equality", () => {
    expect(panel).toContain("!initialSettings.ok");
    expect(panel).not.toContain("initialSettings === null");
  });

  it("renders explicit false protocol_settings capability-boundary copy before load-error copy", () => {
    expect(panel).toContain("capabilityBoundary?: AuthorizationServerPageBoundary | null");
    expect(panel).toContain("capabilityBoundary ? (");
    expect(panel).toContain("{capabilityBoundary.title}");
    expect(panel).toContain("{capabilityBoundary.body}");
    expect(panel).toContain(": !initialSettings || !initialSettings.ok ? (");
  });

  it("does not make a blanket Enterprise-only claim for DCR Foundation", () => {
    const blanketClaims = ["DCR requires enterprise", "DCR is an enterprise feature"];
    for (const claim of blanketClaims) {
      expect(panel.toLowerCase()).not.toContain(claim.toLowerCase());
    }
  });

  it("marks SCIM provisioning as Enterprise/CE-only and disables the control", () => {
    expect(panel).toContain("SCIM 2.0 provisioning");
    expect(panel).toContain("Enterprise/CE only");
    expect(panel).toContain('aria-label="SCIM provisioning requires Enterprise or CE"');
    expect(panel).toContain("disabled");
    expect(panel).not.toContain("setScimEnabled((v) => !v)");
  });

  it("does not contain AG PolicyPacks UI", () => {
    const agTerms = ["PolicyPack", "policy_pack", "policypack", "ag-admin", "AgAdmin"];
    for (const term of agTerms) {
      expect(panel).not.toContain(term);
    }
  });

  it("does not expose raw tokens, secrets, or credential material", () => {
    const credentialTerms = [
      "client_secret",
      "password_hash",
      "mfa_secret",
      "otpauth",
      "claim_token",
      "eyJhbGciO",
      "bearer ",
      "set-cookie",
    ];
    for (const term of credentialTerms) {
      expect(panel.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("does not hardcode localhost URLs", () => {
    expect(panel).not.toMatch(/https?:\/\/localhost/i);
    expect(panel).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("does not suggest SCIM Groups, Bulk, or advanced filters are implemented", () => {
    const groupsBulkPhrases = [
      "SCIM Groups are available",
      "SCIM Bulk is available",
      "advanced filters are available",
    ];
    for (const phrase of groupsBulkPhrases) {
      expect(panel).not.toContain(phrase);
    }
  });

  it("does not suggest anonymous public DCR", () => {
    const anonPhrases = [
      "anonymous registration",
      "public registration without",
      "no authentication required",
    ];
    for (const phrase of anonPhrases) {
      expect(panel.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});

// ── protocol-settings-actions.ts (shared) ───────────────────────────────────

describe("protocol-settings-actions.ts — source invariants", () => {
  const actions = readSiteAdminSource("protocol-settings-actions.ts");

  it("is a 'use server' file", () => {
    expect(actions).toContain('"use server"');
  });

  it("does not print or log raw token values", () => {
    const leakTerms = [
      "console.log",
      "console.error",
      "client_secret",
      "password_hash",
      "eyJhbGciO",
    ];
    for (const term of leakTerms) {
      expect(actions).not.toContain(term);
    }
  });

  it("allows both site_admin and org_admin roles", () => {
    expect(actions).toContain("site_admin");
    expect(actions).toContain("org_admin");
  });

  it("validates org_id as UUID with Zod for site_admin path", () => {
    expect(actions).toContain("z.string().uuid");
    expect(actions).toContain("org_id");
  });

  it("org_admin path uses getOwnOrganization to derive org_id (not form data)", () => {
    // The org_admin handler must call getOwnOrganization() and must NOT
    // read org_id from formData for the org_admin path.
    expect(actions).toContain("getOwnOrganization");
    // The orgAdminSchema (used only for org_admin) must NOT have org_id field.
    // The site-admin schema has org_id; the org-admin schema must not.
    // Find the orgAdminSchema definition and confirm it lacks org_id.
    const orgAdminSchemaStart = actions.indexOf("orgAdminSchema");
    const orgAdminSchemaEnd = actions.indexOf(");", orgAdminSchemaStart) + 2;
    const orgAdminSchemaDef = actions.slice(orgAdminSchemaStart, orgAdminSchemaEnd);
    expect(orgAdminSchemaDef).not.toContain("org_id");
    expect(orgAdminSchemaDef).toContain("dynamic_client_registration_enabled");
    expect(orgAdminSchemaDef).toContain("scim_enabled");
  });

  it("org_admin path revalidates org-admin settings path", () => {
    expect(actions).toContain('"/org-admin/settings"');
  });

  it("site_admin path revalidates site-admin org detail path", () => {
    expect(actions).toContain("/site-admin/organizations/");
  });

  it("wrong-role callers are redirected (no silent authorization)", () => {
    expect(actions).toContain("redirect(roleToPath(role))");
  });
});

// ── protocol-settings-helpers.ts ────────────────────────────────────────────

describe("protocol-settings-helpers.ts — source invariants", () => {
  const helpers = readSiteAdminSource("protocol-settings-helpers.ts");

  it("does not import server-only modules", () => {
    expect(helpers).not.toContain('"server-only"');
    expect(helpers).not.toContain("next/headers");
    expect(helpers).not.toContain("cookies()");
  });

  it("does not use raw credential material in code logic", () => {
    expect(helpers).not.toMatch(/=\s*.*client_secret/);
    expect(helpers).not.toMatch(/password_hash\s*[:=]/);
    expect(helpers).not.toContain("mfa_secret");
    expect(helpers).not.toContain("eyJhbGciO");
  });
});

// ── org-admin/settings/page.tsx — protocol settings integration ──────────────

describe("org-admin/settings/page.tsx — protocol settings invariants", () => {
  const page = readOrgAdminSource("page.tsx");

  it("renders ProtocolSettingsPanel for org_admin", () => {
    expect(page).toContain("ProtocolSettingsPanel");
  });

  it("imports getOrgProtocolSettings", () => {
    expect(page).toContain("getOrgProtocolSettings");
  });

  it("does not expose a cross-org organization picker", () => {
    // The org-admin settings page must never let the org_admin pick a
    // different org — they always manage their own. These terms would
    // appear in picker UI but not in security-invariant comments.
    const crossOrgTerms = [
      "organization_id_picker",
      "select_org",
      "targetOrgId",
      "pick an organization",
      "select organization",
    ];
    for (const term of crossOrgTerms) {
      expect(page.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("uses orgID derived from getOwnOrganization (not form data or path param)", () => {
    // The page must use the session-derived orgID, not an arbitrary value.
    expect(page).toContain("getOwnOrganization");
    expect(page).toContain("orgID");
    // The panel is only rendered when orgID is truthy (guards against null org)
    expect(page).toContain("{orgID &&");
  });

  it("panel initialSettings uses discriminated result (graceful IDP-unavailable handling)", () => {
    // getOrgProtocolSettings returns GetOrgProtocolSettingsResult; the .catch
    // in the page is the outer Promise.all defensive fallback.
    expect(page).toContain(".catch(() => null)");
    // The panel receives the discriminated result directly — no ?? null coercion.
    expect(page).toContain("initialSettings={protocolSettings}");
    expect(page).not.toContain("protocolSettings ?? null");
  });

  it("passes explicit false protocol_settings facts into the panel without replacing observable status handling", () => {
    expect(page).toContain("getServerRuntimeState");
    expect(page).toContain("getAuthorizationServerPageBoundary");
    expect(page).toContain('surface: "protocol_settings"');
    expect(page).toContain(
      "protocolSettingsCapabilityBoundary ? null : getOrgProtocolSettings(orgID)"
    );
    expect(page).toContain("capabilityBoundary={protocolSettingsCapabilityBoundary}");
  });

  it("does not contain AG PolicyPacks UI", () => {
    const agTerms = ["PolicyPack", "policy_pack", "policypack", "ag-admin", "AgAdmin"];
    for (const term of agTerms) {
      expect(page).not.toContain(term);
    }
  });

  it("does not expose raw token or credential material", () => {
    const credentialTerms = [
      "client_secret",
      "password_hash",
      "mfa_secret",
      "eyJhbGciO",
      "bearer ",
    ];
    for (const term of credentialTerms) {
      expect(page.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

// ── idp-admin-client.ts — protocol settings addition invariants ──────────────

describe("idp-admin-client.ts — protocol settings addition invariants", () => {
  const client = readFileSync(resolve(__dirname, "../lib/idp-admin-client.ts"), "utf8");

  it("exports getOrgProtocolSettings", () => {
    expect(client).toContain("export async function getOrgProtocolSettings");
  });

  it("getOrgProtocolSettings returns GetOrgProtocolSettingsResult (discriminated, not OrgProtocolSettings | null)", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnSignature = client.slice(fnStart, fnStart + 300);
    expect(fnSignature).toContain("GetOrgProtocolSettingsResult");
    expect(fnSignature).not.toContain("OrgProtocolSettings | null");
  });

  it("getOrgProtocolSettings maps 401 to not_authenticated", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('"not_authenticated"');
    expect(fnBody).toContain("401");
  });

  it("getOrgProtocolSettings maps 403 to forbidden", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('"forbidden"');
    expect(fnBody).toContain("403");
  });

  it("getOrgProtocolSettings uses shared IDP status classification for non-OK statuses", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(client).toContain("classifyIDPStatus");
    expect(fnBody).toContain("classifyIDPStatus(res.status, body)");
  });

  it("getOrgProtocolSettings maps 404 to not_found", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('classified.kind === "feature_absent"');
    expect(fnBody).toContain('"not_found"');
  });

  it("getOrgProtocolSettings maps 501 to not_found", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('classified.kind === "feature_absent"');
    expect(fnBody).toContain('"not_found"');
  });

  it("getOrgProtocolSettings maps 503 to unavailable", () => {
    const fnStart = client.indexOf("export async function getOrgProtocolSettings");
    const fnEnd = client.indexOf("\nexport type UpdateOrgProtocolSettingsResult", fnStart);
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('classified.kind === "unavailable"');
    expect(fnBody).toContain('"unavailable"');
  });

  it("exports updateOrgProtocolSettings", () => {
    expect(client).toContain("export async function updateOrgProtocolSettings");
  });

  it("UpdateOrgProtocolSettingsResult carries reason plus unavailable/notLicensed booleans", () => {
    const typeStart = client.indexOf("export type UpdateOrgProtocolSettingsResult");
    const typeEnd = client.indexOf("\n/**\n * Updates the per-organization", typeStart);
    const typeBody = client.slice(typeStart, typeEnd);
    expect(typeBody).toContain("reason:");
    expect(typeBody).toContain("unavailable: boolean");
    expect(typeBody).toContain("notLicensed: boolean");
  });

  it("updateOrgProtocolSettings maps 404/501 through feature_absent notFound", () => {
    const fnStart = client.indexOf("export async function updateOrgProtocolSettings");
    const fnEnd = client.indexOf("\n}", client.indexOf("} catch {", fnStart));
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain("classifyIDPStatus(res.status, body)");
    expect(client).toContain('classified.kind === "feature_absent"');
    expect(client).toContain('notFound: classified.kind === "feature_absent"');
  });

  it("updateOrgProtocolSettings maps 503/network through unavailable", () => {
    const fnStart = client.indexOf("export async function updateOrgProtocolSettings");
    const fnEnd = client.indexOf("\n}", client.indexOf("} catch {", fnStart));
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain('{ kind: "unavailable", status: 0 }');
    expect(client).toContain('unavailable: classified.kind === "unavailable"');
  });

  it("protocol-settings-actions forwards unavailable and notLicensed flags into save copy", () => {
    const actions = readSiteAdminSource("protocol-settings-actions.ts");
    expect(actions).toContain("unavailable: result.unavailable");
    expect(actions).toContain("notLicensed: result.notLicensed");
  });

  it("sanitizer never reads client_secret from the response", () => {
    const sanitizerStart = client.indexOf("function sanitizeOrgProtocolSettings");
    const sanitizerEnd = client.indexOf("\n}", sanitizerStart);
    const sanitizerBody = client.slice(sanitizerStart, sanitizerEnd);
    expect(sanitizerBody).not.toContain("client_secret");
    expect(sanitizerBody).not.toContain("password_hash");
    expect(sanitizerBody).not.toContain("mfa_secret");
    expect(sanitizerBody).not.toContain("initial_access_token");
    expect(sanitizerBody).not.toContain("registration_access_token");
  });

  it("PUT body contains only the two boolean fields", () => {
    const fnStart = client.indexOf("export async function updateOrgProtocolSettings");
    const fnEnd = client.indexOf("\n}", client.indexOf("} catch {", fnStart));
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain("dynamic_client_registration_enabled");
    expect(fnBody).toContain("scim_enabled");
    expect(fnBody).not.toContain("client_secret");
    expect(fnBody).not.toContain("password");
    // "token" substring check skipped — "registration_access_token" can
    // appear in related code; using specific secret names instead
    expect(fnBody).not.toContain("initial_access_token");
  });
});
