/**
 * Tests for slice identuum-20260530-org-admin-settings-readonly-tabs.
 *
 * Four read-only sections on /org-admin/settings + 4 wire helpers
 * (Identity providers / Webhooks / Roles / Scope templates). All
 * helpers and sections must project EXPLICITLY to safe non-secret
 * fields; this file pins the no-secret / no-mutation / no-console
 * invariants at the source-text level.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WIRE_SRC = readFileSync(resolve(__dirname, "..", "lib", "idp-admin-client.ts"), "utf-8");

const SECTIONS_SRC = readFileSync(
  resolve(__dirname, "..", "app", "org-admin", "settings", "settings-readonly-sections.tsx"),
  "utf-8"
);

const PAGE_SRC = readFileSync(
  resolve(__dirname, "..", "app", "org-admin", "settings", "page.tsx"),
  "utf-8"
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SECTIONS_NO_COMMENTS = stripComments(SECTIONS_SRC);
const PAGE_NO_COMMENTS = stripComments(PAGE_SRC);

// ── Wire helpers — generic invariants ───────────────────────────────────────

const HELPER_NAMES = [
  "listOrganizationIdentityProviders",
  "listOrganizationWebhooks",
  "listOrgRoles",
  "listScopeTemplates",
] as const;

function isolateHelperBody(name: string): string {
  const start = WIRE_SRC.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const tail = WIRE_SRC.slice(start);
  const end = tail.indexOf("\nexport ", 1);
  return end >= 0 ? tail.slice(0, end) : tail;
}

describe("Four new wire helpers — generic GET-only / no-body / no-secret invariants", () => {
  for (const name of HELPER_NAMES) {
    it(`${name} is declared and uses method:"GET" only`, () => {
      expect(WIRE_SRC).toMatch(new RegExp(`export async function ${name}\\b`));
      const body = isolateHelperBody(name);
      expect(body).toMatch(/method:\s*"GET"/);
      expect(body).not.toMatch(/method:\s*"POST"/);
      expect(body).not.toMatch(/method:\s*"PUT"/);
      expect(body).not.toMatch(/method:\s*"PATCH"/);
      expect(body).not.toMatch(/method:\s*"DELETE"/);
    });

    it(`${name} sends NO request body and NO Content-Type header`, () => {
      const body = isolateHelperBody(name);
      const initMatch = body.match(/method:\s*"GET"[\s\S]*?\}\s*\n?\s*\)/);
      expect(initMatch).not.toBeNull();
      const initBlock = initMatch?.[0] ?? "";
      expect(initBlock).not.toMatch(/\bbody:/);
      expect(initBlock).not.toMatch(/"Content-Type"/);
    });

    it(`${name} has NO console.* call`, () => {
      const body = isolateHelperBody(name);
      expect(body).not.toMatch(/console\.\w+/);
    });

    it(`${name} NEVER reads a secret-shaped field from the response`, () => {
      const body = isolateHelperBody(name);
      const stripped = stripComments(body);
      const BANNED: RegExp[] = [
        /\bclient_secret\b/,
        /\bclient_secret_encrypted\b/,
        /\bbind_password\b/,
        /\bbind_password_encrypted\b/,
        /\bsecret_hash\b/,
        /\bprivate_key\b/,
        /\bsigning_cert\b/i,
        /\bsigning_key\b/,
        /\bsaml_private\b/i,
        /\baccess_token\b/,
        /\brefresh_token\b/,
        /\bauthorization_code\b/,
        /\bbearer\b/i,
        /\bauthorization_header\b/i,
        /\.metadata_xml\b/i,
        /\.raw_metadata\b/,
        /\bpassword_hash\b/,
        /\bsession_token\b/,
        /Set-Cookie/i,
        /database_url/i,
        /redis_url/i,
        /env_var/i,
      ];
      for (const pat of BANNED) {
        expect(stripped, `${name} must not reference ${pat}`).not.toMatch(pat);
      }
    });
  }
});

// ── Per-helper explicit allowlist projection pins ───────────────────────────

describe("listOrganizationIdentityProviders — explicit allowlist", () => {
  it("is CROSS-TIER: tries the plural list (CE) first, then the singular OSS route, id URL-encoded", () => {
    const body = isolateHelperBody("listOrganizationIdentityProviders");
    // One URL-encoded org base feeds both fetches.
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}/);
    expect(body).toMatch(/\$\{base\}\/identity-providers/);
    expect(body).toMatch(/\$\{base\}\/identity-provider`/);
    // OSS "none configured" (404 on the singular) normalizes to an EMPTY
    // LIST, not an error.
    expect(body).toMatch(/identity_providers:\s*\[\],\s*count:\s*0/);
  });

  it("projects ONLY id/name/slug/type/priority/active/created_at/updated_at — and DROPS the IDP's `config` block", () => {
    const body = isolateHelperBody("listOrganizationIdentityProviders");
    expect(body).toMatch(/p\.id/);
    expect(body).toMatch(/p\.name/);
    expect(body).toMatch(/p\.slug/);
    expect(body).toMatch(/p\.type/);
    expect(body).toMatch(/p\.priority/);
    expect(body).toMatch(/p\.active/);
    expect(body).toMatch(/p\.created_at/);
    expect(body).toMatch(/p\.updated_at/);
    const stripped = stripComments(body);
    // The IDP's response carries a `config` block with operator-
    // configured fields (issuer_url / client_id / scopes etc.).
    // The wire helper EXPLICITLY drops it; the UI surfaces only
    // the high-level identity fields. A future regression that
    // started reading p.config.* would surface here.
    expect(stripped).not.toMatch(/p\.config/);
    expect(stripped).not.toMatch(/p\.client_id\b/);
    expect(stripped).not.toMatch(/p\.issuer_url\b/);
    expect(stripped).not.toMatch(/p\.scopes\b/);
    expect(stripped).not.toMatch(/p\.attribute_mapping\b/);
    expect(stripped).not.toMatch(/p\.claim_mapping\b/);
  });

  it("routes real failures through the shared IDP status classifier on BOTH tiers' paths", () => {
    const body = isolateHelperBody("listOrganizationIdentityProviders");
    expect(body).toContain("classifyAdminReadFailure(listRes)");
    expect(body).toContain("classifyAdminReadFailure(oneRes)");
    expect(body).not.toMatch(/res\.status\s*===\s*404[\s\S]*?featureUnavailable:\s*true/);
  });
});

describe("listOrganizationWebhooks — explicit allowlist + redacted-secret invariant", () => {
  it("GETs /api/v1/organizations/:id/webhooks", () => {
    const body = isolateHelperBody("listOrganizationWebhooks");
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/webhooks/);
  });

  it("projects ONLY id/url/event_filters/enabled/created_at — and EXPLICITLY DROPS the redacted-secret field plus any header / authorization / payload-shaped field", () => {
    const body = isolateHelperBody("listOrganizationWebhooks");
    expect(body).toMatch(/w\.id/);
    expect(body).toMatch(/w\.url/);
    expect(body).toMatch(/w\.event_filters/);
    expect(body).toMatch(/w\.enabled/);
    expect(body).toMatch(/w\.created_at/);
    const stripped = stripComments(body);
    const BANNED: RegExp[] = [
      /w\.secret\b/,
      /w\.signing_secret\b/,
      /w\.authorization\b/,
      /w\.authorization_header\b/,
      /w\.bearer\b/,
      /w\.headers\b/,
      /w\.payload\b/,
      /w\.raw_payload\b/,
      /w\.body\b/,
    ];
    for (const pat of BANNED) {
      expect(stripped, `listOrganizationWebhooks must not read ${pat}`).not.toMatch(pat);
    }
  });

  it("routes absent/license-gated responses through the shared IDP status classifier", () => {
    const body = isolateHelperBody("listOrganizationWebhooks");
    expect(body).toContain("classifyAdminReadFailure(res)");
    expect(body).not.toMatch(/res\.status\s*===\s*404[\s\S]*?featureUnavailable:\s*true/);
  });
});

describe("listOrgRoles — explicit allowlist", () => {
  it("GETs /api/v1/organizations/:id/roles", () => {
    const body = isolateHelperBody("listOrgRoles");
    expect(body).toMatch(/\/api\/v1\/organizations\/\$\{encodeURIComponent\(orgID\)\}\/roles/);
  });

  it("projects ONLY id/name/description/scopes/created_at/updated_at", () => {
    const body = isolateHelperBody("listOrgRoles");
    expect(body).toMatch(/r\.id/);
    expect(body).toMatch(/r\.name/);
    expect(body).toMatch(/r\.description/);
    expect(body).toMatch(/r\.scopes/);
    expect(body).toMatch(/r\.created_at/);
    expect(body).toMatch(/r\.updated_at/);
  });
});

describe("listScopeTemplates — explicit allowlist + feature gate", () => {
  it("GETs /api/v1/scope-templates", () => {
    const body = isolateHelperBody("listScopeTemplates");
    expect(body).toMatch(/\/api\/v1\/scope-templates/);
  });

  it("projects ONLY id/name/description/scopes/created_at/updated_at", () => {
    const body = isolateHelperBody("listScopeTemplates");
    expect(body).toMatch(/t\.id/);
    expect(body).toMatch(/t\.name/);
    expect(body).toMatch(/t\.description/);
    expect(body).toMatch(/t\.scopes/);
    expect(body).toMatch(/t\.created_at/);
    expect(body).toMatch(/t\.updated_at/);
  });

  it("reads from the raw array envelope (NOT a `data` / `templates` wrapper)", () => {
    const body = isolateHelperBody("listScopeTemplates");
    expect(body).toMatch(/Array\.isArray\(d\)\s*\?\s*d\s*:\s*\[\]/);
  });

  it("routes absent/license-gated responses through the shared IDP status classifier", () => {
    const body = isolateHelperBody("listScopeTemplates");
    expect(body).toContain("classifyAdminReadFailure(res)");
    expect(body).not.toMatch(/res\.status\s*===\s*404[\s\S]*?featureUnavailable:\s*true/);
  });
});

// ── settings-readonly-sections.tsx — per-section invariants ────────────────

describe("Identity providers section — read-only", () => {
  it("exports IdentityProvidersReadOnlySection and renders the documented heading + subtitle", () => {
    expect(SECTIONS_SRC).toMatch(/export function IdentityProvidersReadOnlySection/);
    expect(SECTIONS_SRC).toMatch(/headingId="identity-providers-heading"/);
    expect(SECTIONS_SRC).toMatch(/title="Identity providers"/);
    expect(SECTIONS_SRC).toMatch(/Read-only view of configured SSO providers/i);
  });

  it("uses CE/OSS boundary copy for unavailable federation instead of generic retry copy", () => {
    expect(SECTIONS_SRC).toContain("Identity provider federation is a CE IDP capability");
    expect(SECTIONS_SRC).toContain("IDP OSS deployments show this boundary");
  });

  it("renders only id/name/slug/type/priority/active/created_at/updated_at — never client_secret / private_key / signing_cert / metadata XML", () => {
    const start = SECTIONS_SRC.indexOf("function IdentityProvidersReadOnlySection");
    const end = SECTIONS_SRC.indexOf("\nexport function WebhooksReadOnlySection");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = stripComments(SECTIONS_SRC.slice(start, end));
    // Allowed reads.
    expect(block).toMatch(/p\.name/);
    expect(block).toMatch(/p\.type/);
    expect(block).toMatch(/p\.slug/);
    expect(block).toMatch(/p\.active/);
    expect(block).toMatch(/p\.created_at/);
    expect(block).toMatch(/p\.updated_at/);
    // Forbidden.
    const BANNED: RegExp[] = [
      /p\.client_secret/,
      /p\.client_secret_encrypted/,
      /p\.private_key/,
      /p\.signing_cert/i,
      /p\.metadata_xml/i,
      /p\.raw_metadata/,
      /p\.bind_password/,
      /p\.access_token/,
      /p\.config/,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(block, `IdentityProvidersReadOnlySection must not render ${pat}`).not.toMatch(pat);
    }
  });
});

describe("Webhooks section — read-only", () => {
  it("exports WebhooksReadOnlySection with the documented heading + no-secret subtitle", () => {
    expect(SECTIONS_SRC).toMatch(/export function WebhooksReadOnlySection/);
    expect(SECTIONS_SRC).toMatch(/headingId="webhooks-heading"/);
    expect(SECTIONS_SRC).toMatch(/title="Webhooks"/);
    expect(SECTIONS_SRC).toMatch(/Webhook signing secrets are never displayed/i);
  });

  it("uses CE/OSS boundary copy for unavailable webhooks", () => {
    expect(SECTIONS_SRC).toContain("Webhooks are a CE IDP capability");
    expect(SECTIONS_SRC).toContain("IDP OSS deployments show this boundary");
  });

  it("renders only id/url/event_filters/enabled/created_at — never secret/authorization/payload", () => {
    const start = SECTIONS_SRC.indexOf("function WebhooksReadOnlySection");
    const end = SECTIONS_SRC.indexOf("\nexport function OrgRolesReadOnlySection");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = stripComments(SECTIONS_SRC.slice(start, end));
    expect(block).toMatch(/w\.url/);
    expect(block).toMatch(/w\.event_filters/);
    expect(block).toMatch(/w\.enabled/);
    expect(block).toMatch(/w\.created_at/);
    const BANNED: RegExp[] = [
      /w\.secret/,
      /w\.signing_secret/,
      /w\.authorization/,
      /w\.authorization_header/,
      /w\.bearer/,
      /w\.payload/,
      /w\.raw_payload/,
      /w\.headers/,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(block, `WebhooksReadOnlySection must not render ${pat}`).not.toMatch(pat);
    }
  });
});

describe("Org roles section — read-only", () => {
  it("exports OrgRolesReadOnlySection with the documented heading + no-mutation subtitle", () => {
    expect(SECTIONS_SRC).toMatch(/export function OrgRolesReadOnlySection/);
    expect(SECTIONS_SRC).toMatch(/headingId="org-roles-heading"/);
    expect(SECTIONS_SRC).toMatch(/title="Roles"/);
    expect(SECTIONS_SRC).toMatch(
      /Role create \/ edit \/ delete and user-role assignment are not available/i
    );
  });

  it("renders only id/name/description/scopes/created_at/updated_at", () => {
    const start = SECTIONS_SRC.indexOf("function OrgRolesReadOnlySection");
    const end = SECTIONS_SRC.indexOf("\nexport function ScopeTemplatesReadOnlySection");
    const block = stripComments(SECTIONS_SRC.slice(start, end));
    expect(block).toMatch(/r\.name/);
    expect(block).toMatch(/r\.description/);
    expect(block).toMatch(/r\.scopes/);
    expect(block).not.toMatch(/JSON\.stringify\(/);
  });
});

describe("Scope templates section — read-only", () => {
  it("exports ScopeTemplatesReadOnlySection with the documented heading + no-mutation subtitle", () => {
    expect(SECTIONS_SRC).toMatch(/export function ScopeTemplatesReadOnlySection/);
    expect(SECTIONS_SRC).toMatch(/headingId="scope-templates-heading"/);
    expect(SECTIONS_SRC).toMatch(/title="Scope templates"/);
    expect(SECTIONS_SRC).toMatch(/Create \/ edit \/ delete are not available/i);
  });

  it("does not present scope templates or Authorization Server as license-only", () => {
    expect(SECTIONS_SRC).toContain("OSS/Starter Authorization Server surface");
    expect(SECTIONS_SRC).not.toContain(
      "Scope templates are not included in your current license tier"
    );
  });

  it("accepts explicit false capability-boundary copy without calling it a license gate", () => {
    expect(SECTIONS_SRC).toContain("capabilityBoundary?: AuthorizationServerPageBoundary | null");
    expect(SECTIONS_SRC).toContain(
      "capabilityBoundary && <Unavailable body={capabilityBoundary.body} />"
    );
    expect(SECTIONS_SRC).not.toMatch(/Scope templates.*Enterprise\/CE/i);
  });
});

// ── Cross-section invariants ────────────────────────────────────────────────

describe("settings-readonly-sections.tsx — cross-section invariants", () => {
  it("has NO <form>, NO submit button, NO Create/Edit/Delete/Test buttons", () => {
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<form/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*type="submit"/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Create\b/i);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Edit\b/i);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Delete\b/i);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Test\b/i);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*Add\b/i);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/<button[^>]*>\s*New\b/i);
  });

  it("has NO console.* / no localStorage / sessionStorage / cookies / window.history", () => {
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/console\.\w+/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/localStorage/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/sessionStorage/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/document\.cookie/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/window\.history/);
    expect(SECTIONS_NO_COMMENTS).not.toMatch(/router\.push/);
  });

  it("does NOT reference any secret-shaped field anywhere in the module", () => {
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bclient_secret_encrypted\b/,
      /\bbind_password\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\bsigning_key\b/,
      /\bsigning_cert\b/i,
      /\bsaml_private\b/i,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /\.metadata_xml\b/i,
      /\.raw_metadata\b/,
      /\.raw_payload\b/,
      /\bpassword_hash\b/,
      /\bsession_token\b/,
      /Set-Cookie/i,
      /JSON\.stringify\(/,
    ];
    for (const pat of BANNED) {
      expect(SECTIONS_NO_COMMENTS, `sections module must not reference ${pat}`).not.toMatch(pat);
    }
  });
});

// ── /org-admin/settings page — wires the four sections ─────────────────────

describe("/org-admin/settings/page.tsx — Promise.all + section mounts", () => {
  it("imports the four new wire helpers and the four new section components", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{[\s\S]*?listOrgRoles[\s\S]*?listOrganizationIdentityProviders[\s\S]*?listOrganizationWebhooks[\s\S]*?listScopeTemplates[\s\S]*?\}\s*from\s+["']@\/lib\/idp-admin-client["']/
    );
    expect(PAGE_SRC).toMatch(
      /import\s*\{[\s\S]*?IdentityProvidersReadOnlySection[\s\S]*?OrgRolesReadOnlySection[\s\S]*?ScopeTemplatesReadOnlySection[\s\S]*?WebhooksReadOnlySection[\s\S]*?\}\s*from\s+["']\.\/settings-readonly-sections["']/
    );
  });

  it("fetches the resources in parallel via Promise.all (includes protocol settings)", () => {
    // Original four resources still present
    expect(PAGE_SRC).toContain("listOrganizationDomains(orgID)");
    expect(PAGE_SRC).toContain("listOrganizationIdentityProviders(orgID)");
    expect(PAGE_SRC).toContain("listOrganizationWebhooks(orgID)");
    expect(PAGE_SRC).toContain("listOrgRoles(orgID)");
    expect(PAGE_SRC).toContain("listScopeTemplates()");
    // Protocol settings added in this slice
    expect(PAGE_SRC).toContain("getOrgProtocolSettings(orgID)");
    // All inside a single Promise.all
    expect(PAGE_SRC).toContain("Promise.all([");
  });

  it("uses real capability facts to skip only explicit false scope-template/protocol endpoints", () => {
    expect(PAGE_SRC).toContain("getServerRuntimeState");
    expect(PAGE_SRC).toContain("getAuthorizationServerPageBoundary");
    expect(PAGE_SRC).toContain('surface: "scope_templates"');
    expect(PAGE_SRC).toContain('surface: "protocol_settings"');
    expect(PAGE_SRC).toContain("scopeTemplatesCapabilityBoundary ? null : listScopeTemplates()");
    expect(PAGE_SRC).toContain(
      "protocolSettingsCapabilityBoundary ? null : getOrgProtocolSettings(orgID).catch(() => null)"
    );
    expect(PAGE_SRC).toContain("capabilityBoundary={scopeTemplatesCapabilityBoundary}");
    expect(PAGE_SRC).toContain("capabilityBoundary={protocolSettingsCapabilityBoundary}");
  });

  it("mounts the four sections AFTER DomainsCard and BEFORE the placeholders array map", () => {
    const domainsIdx = PAGE_SRC.indexOf("<DomainsCard");
    const idpsIdx = PAGE_SRC.indexOf("<IdentityProvidersReadOnlySection");
    const webhooksIdx = PAGE_SRC.indexOf("<WebhooksReadOnlySection");
    const rolesIdx = PAGE_SRC.indexOf("<OrgRolesReadOnlySection");
    const templatesIdx = PAGE_SRC.indexOf("<ScopeTemplatesReadOnlySection");
    const placeholderIdx = PAGE_SRC.indexOf("ORG_ADMIN_SETTINGS_PLACEHOLDERS.map");
    expect(domainsIdx).toBeGreaterThan(0);
    expect(idpsIdx).toBeGreaterThan(domainsIdx);
    expect(webhooksIdx).toBeGreaterThan(idpsIdx);
    expect(rolesIdx).toBeGreaterThan(webhooksIdx);
    expect(templatesIdx).toBeGreaterThan(rolesIdx);
    expect(placeholderIdx).toBeGreaterThan(templatesIdx);
  });

  it("PRESERVES the pre-existing OrgProfileForm + MFAPolicyForm + InvitePolicyForm + DomainsCard mounts unchanged", () => {
    expect(PAGE_SRC).toMatch(/<OrgProfileForm\b/);
    expect(PAGE_SRC).toMatch(/<MFAPolicyForm\b/);
    expect(PAGE_SRC).toMatch(/<InvitePolicyForm\b/);
    expect(PAGE_SRC).toMatch(/<DomainsCard\b/);
  });

  it("page has NO console.* call", () => {
    expect(PAGE_NO_COMMENTS).not.toMatch(/console\.\w+/);
  });
});
