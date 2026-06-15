/**
 * Tests for the AG PolicyPacks settings feature.
 *
 * Scope:
 *   - `policy-pack-settings-helpers.ts` pure function unit tests
 *   - `ag-policy-pack-client.ts` source-file structure invariants
 *   - `policy-pack-settings-actions.ts` source-file structure invariants
 *   - `policy-pack-settings-panel.tsx` source-file negative invariants
 *   - `policy-packs/page.tsx` source-file structure invariants
 *   - `AgPolicyPackSettings` type shape in types.ts
 *
 * Tests run in the project's node-only vitest environment (no jsdom /
 * React rendering). Client-component branch coverage is delegated to
 * Playwright e2e specs.
 *
 * SECURITY: all inputs are synthetic. No real tokens, session cookies,
 * operator credentials, or signing material appear in this file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { policyPackSaveErrorMessage } from "../app/ag-admin/(authed)/policy-packs/policy-pack-settings-helpers";
import type { AgPolicyPackSettings } from "../lib/types";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const UI_ROOT = resolve(import.meta.dirname, "../../");
function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_ROOT, "src", relPath), "utf8");
}

// ── policyPackSaveErrorMessage ───────────────────────────────────────────────

describe("policyPackSaveErrorMessage", () => {
  it("status=503 → fail-closed copy mentioning enforcement remains active", () => {
    const msg = policyPackSaveErrorMessage({ status: 503 });
    expect(msg).toContain("fail-closed");
    expect(msg).toContain("enforcement remains active");
    expect(msg).not.toContain("localhost");
  });

  it("status=0 → network error copy", () => {
    const msg = policyPackSaveErrorMessage({ status: 0 });
    expect(msg).toContain("Network error");
    expect(msg).not.toContain("localhost");
  });

  it("other status → generic error copy", () => {
    const msg = policyPackSaveErrorMessage({ status: 500 });
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
    for (const status of [0, 400, 401, 403, 500, 503]) {
      const msg = policyPackSaveErrorMessage({ status });
      for (const term of credentialTerms) {
        expect(msg.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });
});

// ── AgPolicyPackSettings type shape ─────────────────────────────────────────

describe("AgPolicyPackSettings type shape", () => {
  it("accepts policy_packs_enabled=true (enabled state)", () => {
    const s: AgPolicyPackSettings = { policy_packs_enabled: true };
    expect(s.policy_packs_enabled).toBe(true);
  });

  it("accepts policy_packs_enabled=false (disabled state)", () => {
    const s: AgPolicyPackSettings = { policy_packs_enabled: false };
    expect(s.policy_packs_enabled).toBe(false);
  });
});

// ── ag-policy-pack-client.ts — source invariants ─────────────────────────────

describe("ag-policy-pack-client.ts — source invariants", () => {
  const client = readSrc("lib/ag-policy-pack-client.ts");

  it("is server-only", () => {
    expect(client).toContain('"server-only"');
  });

  it("exports getAgPolicyPackSettings", () => {
    expect(client).toContain("export async function getAgPolicyPackSettings");
  });

  it("exports updateAgPolicyPackSettings", () => {
    expect(client).toContain("export async function updateAgPolicyPackSettings");
  });

  it("uses agRequest from ag-client (not hardcoded URLs)", () => {
    expect(client).toContain("agRequest");
    expect(client).not.toMatch(/https?:\/\/localhost/i);
    expect(client).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("calls the correct GET endpoint", () => {
    expect(client).toContain("/api/v1/policy-packs/settings");
  });

  it("PATCH body contains only policy_packs_enabled", () => {
    const fnStart = client.indexOf("export async function updateAgPolicyPackSettings");
    const fnEnd = client.indexOf("\n}", client.indexOf("} catch {", fnStart));
    const fnBody = client.slice(fnStart, fnEnd);
    expect(fnBody).toContain("policy_packs_enabled");
    expect(fnBody).not.toContain("client_secret");
    expect(fnBody).not.toContain("password_hash");
    expect(fnBody).not.toContain("mfa_secret");
  });

  it("sanitizer extracts only policy_packs_enabled (no credential fields)", () => {
    const sanitizerStart = client.indexOf("function sanitizeAgPolicyPackSettings");
    const sanitizerEnd = client.indexOf("\n}", sanitizerStart);
    const body = client.slice(sanitizerStart, sanitizerEnd);
    expect(body).toContain("policy_packs_enabled");
    expect(body).not.toContain("client_secret");
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("mfa_secret");
    expect(body).not.toContain("initial_access_token");
    expect(body).not.toContain("registration_access_token");
  });

  it("handles auth errors (401/403) by returning authError=true", () => {
    expect(client).toContain("authError: true");
    expect(client).toContain("401");
    expect(client).toContain("403");
  });

  it("handles unavailable AG (null response from agRequest)", () => {
    expect(client).toContain('"unavailable"');
  });

  it("does not log raw tokens or error bodies", () => {
    expect(client).not.toContain("console.log");
    expect(client).not.toContain("console.error");
  });
});

// ── policy-pack-settings-helpers.ts — source invariants ─────────────────────

describe("policy-pack-settings-helpers.ts — source invariants", () => {
  const helpers = readSrc("app/ag-admin/(authed)/policy-packs/policy-pack-settings-helpers.ts");

  it("does not import server-only modules", () => {
    expect(helpers).not.toContain('"server-only"');
    expect(helpers).not.toContain("next/headers");
    expect(helpers).not.toContain("cookies()");
  });

  it("does not hardcode internal URLs", () => {
    expect(helpers).not.toMatch(/https?:\/\/localhost/i);
    expect(helpers).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("does not contain raw credential material in code logic", () => {
    expect(helpers).not.toContain("client_secret");
    expect(helpers).not.toContain("password_hash");
    expect(helpers).not.toContain("mfa_secret");
    expect(helpers).not.toContain("eyJhbGciO");
  });
});

// ── policy-pack-settings-actions.ts — source invariants ─────────────────────

describe("policy-pack-settings-actions.ts — source invariants", () => {
  const actions = readSrc("app/ag-admin/(authed)/policy-packs/policy-pack-settings-actions.ts");

  it("is a 'use server' file", () => {
    expect(actions).toContain('"use server"');
  });

  it("validates with Zod (z.enum true/false)", () => {
    expect(actions).toContain("z.enum");
    expect(actions).toContain("policy_packs_enabled");
  });

  it("revalidates policy-packs path on success", () => {
    expect(actions).toContain('"/ag-admin/policy-packs"');
    expect(actions).toContain("revalidatePath");
  });

  it("does not print or log raw token values", () => {
    expect(actions).not.toContain("console.log");
    expect(actions).not.toContain("console.error");
    expect(actions).not.toContain("client_secret");
    expect(actions).not.toContain("eyJhbGciO");
    expect(actions).not.toContain("password_hash");
  });

  it("returns error state for authError (no silent auth failure)", () => {
    expect(actions).toContain("authError");
    expect(actions).toContain("Session expired");
  });
});

// ── policy-pack-settings-panel.tsx — source invariants ──────────────────────

describe("policy-pack-settings-panel.tsx — source invariants", () => {
  const panel = readSrc("app/ag-admin/(authed)/policy-packs/policy-pack-settings-panel.tsx");

  it("is a 'use client' file", () => {
    expect(panel).toContain('"use client"');
  });

  it("uses useActionState", () => {
    expect(panel).toContain("useActionState");
  });

  it("panel title is 'PolicyPacks settings'", () => {
    expect(panel).toContain("PolicyPacks settings");
  });

  it("explains that 503 ≠ disabled (fail-closed note present)", () => {
    expect(panel).toContain("503");
    expect(panel).toContain("fail-closed");
    expect(panel).toContain("not the same as");
  });

  it("shows enabled state copy", () => {
    expect(panel).toContain("Enabled — PolicyPacks are currently enforced");
  });

  it("shows disabled state copy", () => {
    expect(panel).toContain("Disabled — PolicyPacks enforcement is off");
  });

  it("has a graceful unavailable state when initialSettings is null", () => {
    expect(panel).toContain("initialSettings === null");
    expect(panel).toContain("PolicyPacks settings unavailable");
  });

  it("unavailable state explains fail-closed semantics", () => {
    const nullStart = panel.indexOf("initialSettings === null");
    const nullBlock = panel.slice(nullStart, nullStart + 800);
    expect(nullBlock).toContain("fail-closed");
    expect(nullBlock).toContain("not the same as setting PolicyPacks to disabled");
  });

  it("does not imply CE/commercial PolicyPacks features are available", () => {
    const ceTerms = [
      "Enterprise PolicyPacks",
      "requires an Enterprise license",
      "commercial feature",
      "upgrade to unlock",
      "PolicyPacks Pro",
    ];
    for (const term of ceTerms) {
      expect(panel).not.toContain(term);
    }
  });

  it("does not expose tokens, secrets, or credential material", () => {
    const credentialTerms = [
      "client_secret",
      "password_hash",
      "mfa_secret",
      "otpauth",
      "eyJhbGciO",
      "bearer ",
      "ag_operator_session",
    ];
    for (const term of credentialTerms) {
      expect(panel.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("does not hardcode localhost URLs", () => {
    expect(panel).not.toMatch(/https?:\/\/localhost/i);
    expect(panel).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("does not read document.cookie or localStorage", () => {
    expect(panel).not.toContain("document.cookie");
    expect(panel).not.toContain("localStorage");
  });

  it("shows session-org scope copy (organization context explanation)", () => {
    expect(panel).toContain("your current AG operator session");
  });

  it("does not add an unsafe freeform org selector or org ID input", () => {
    const unsafeOrgTerms = [
      'name="organization_id"',
      'name="org_id"',
      "orgIdInput",
      "selectOrganization",
      "organization_id_picker",
      "targetOrgId",
    ];
    for (const term of unsafeOrgTerms) {
      expect(panel).not.toContain(term);
    }
  });
});

// ── policy-packs/page.tsx — source invariants ────────────────────────────────

describe("policy-packs/page.tsx — source invariants", () => {
  const page = readSrc("app/ag-admin/(authed)/policy-packs/page.tsx");

  it("is force-dynamic (not statically rendered)", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("page metadata title set correctly", () => {
    expect(page).toContain("PolicyPacks Settings — Identuum AG");
  });

  it("page heading is 'PolicyPacks'", () => {
    expect(page).toContain(">PolicyPacks<");
  });

  it("redirects to login on auth error", () => {
    expect(page).toContain("auth_error");
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("uses getAgPolicyPackSettings from ag-policy-pack-client", () => {
    expect(page).toContain("getAgPolicyPackSettings");
    expect(page).toContain("ag-policy-pack-client");
  });

  it("passes null to panel when AG is unavailable", () => {
    expect(page).toContain('"unavailable"');
    expect(page).toContain("null");
  });

  it("renders PolicyPackSettingsPanel", () => {
    expect(page).toContain("PolicyPackSettingsPanel");
  });

  it("does not expose raw tokens or AG base URL to browser", () => {
    const forbidden = [
      "ag_operator_session",
      "client_secret",
      "eyJhbGciO",
      "host.docker.internal",
      "Authorization:",
    ];
    for (const term of forbidden) {
      expect(page).not.toContain(term);
    }
  });

  it("does not hardcode localhost URLs", () => {
    expect(page).not.toMatch(/https?:\/\/localhost/i);
    expect(page).not.toMatch(/https?:\/\/127\.0\.0\.1/i);
  });

  it("has quick links to AG surfaces", () => {
    expect(page).toContain("/ag-admin/agents");
    expect(page).toContain("/ag-admin/sessions");
    expect(page).toContain("/ag-admin/hitl");
    expect(page).toContain('href="/ag-admin"');
  });

  it("shows session-org context copy on the page", () => {
    expect(page).toContain("your current AG operator session");
  });

  it("does not add an unsafe freeform org selector or org ID input", () => {
    const unsafeOrgTerms = [
      'name="organization_id"',
      'name="org_id"',
      "orgIdInput",
      "selectOrganization",
      "organization_id_picker",
    ];
    for (const term of unsafeOrgTerms) {
      expect(page).not.toContain(term);
    }
  });
});

// ── ag-admin-nav.tsx — PolicyPacks nav entry ─────────────────────────────────

describe("ag-admin-nav.tsx — PolicyPacks navigation", () => {
  const nav = readSrc("components/ag-admin/ag-admin-nav.tsx");

  it("has a PolicyPacks nav link", () => {
    expect(nav).toContain("PolicyPacks");
    expect(nav).toContain("/ag-admin/policy-packs");
  });

  it("PolicyPacks link uses prefix matching (for sub-routes)", () => {
    const ppIdx = nav.indexOf("/ag-admin/policy-packs");
    const surrounding = nav.slice(Math.max(0, ppIdx - 100), ppIdx + 100);
    expect(surrounding).toContain("prefix");
  });
});
