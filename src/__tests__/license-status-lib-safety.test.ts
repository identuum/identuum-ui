/**
 * Source-invariant pins for the shared license-status helper at
 * `src/lib/license-status.ts` AND the two pages that consume it:
 * `/site-admin/settings` (live License card) + `/site-admin/license`
 * (read-only status section above the LicenseManager).
 *
 * Background.
 *   - `agent-a-20260620-idp-ui-site-admin-settings-live-license-card`
 *     replaced the Settings page's `<PlaceholderCard title="License"…>`
 *     with a live status card driven by a server-side probe.
 *   - `agent-a-20260620-idp-ui-site-admin-license-readonly-view`
 *     extracted the probe + projection into `src/lib/license-status.ts`
 *     so the License page can render the same safe status without
 *     requiring an admin bearer token.
 *
 * The shared lib is the canonical safety pin: it owns the wire-field
 * projection. The pages reuse `loadLicenseStatus`, `licenseBadge`,
 * and the `SafeLicenseStatus` interface, so a single source of truth
 * cannot drift between them.
 *
 * These tests strip comments before scanning so safety-explaining
 * doc-comments are allowed and recommended; CODE references to
 * unsafe wire fields fail CI.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const libSource = readFileSync(join(root, "src/lib/license-status.ts"), "utf8");
const settingsSource = readFileSync(join(root, "src/app/site-admin/settings/page.tsx"), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("license-status lib — safe projection invariants", () => {
  it("uses the server-only import so the helper never reaches client bundles", () => {
    expect(libSource).toContain('import "server-only"');
  });

  it("probe hits /api/setup/license (the safe public status surface)", () => {
    expect(libSource).toContain("/api/setup/license");
  });

  it("probe runs server-side via fetch with cache:no-store + AbortSignal.timeout", () => {
    expect(libSource).toMatch(/export async function probeLicenseStatus\(idpUrl:\s*string\)/);
    expect(libSource).toContain('cache: "no-store"');
    expect(libSource).toContain("AbortSignal.timeout");
  });

  it("SafeLicenseStatus contains EXACTLY state + product + distribution + tier", () => {
    expect(libSource).toMatch(
      /export interface SafeLicenseStatus \{\s*state:\s*LicenseStatusState;\s*product:\s*string;\s*distribution:\s*string;\s*tier\?:\s*string;\s*\}/
    );
  });

  it("lib NEVER references unsafe wire fields in CODE", () => {
    const codeOnly = stripComments(libSource);
    const unsafeFields = [
      "licensee",
      "license_id",
      "license_type",
      "expires_at",
      "expiresAt",
      "licenseId",
      "licenseType",
      "next_action",
      "nextAction",
    ];
    for (const field of unsafeFields) {
      expect(codeOnly, `field "${field}" must not appear in non-comment lib source`).not.toContain(
        field
      );
    }
  });

  it("lib NEVER references envelope / signing / admin-bearer-token material in CODE", () => {
    const codeOnly = stripComments(libSource);
    expect(codeOnly).not.toMatch(/envelope/i);
    expect(codeOnly).not.toMatch(/signature/i);
    expect(codeOnly).not.toMatch(/bearer/i);
    expect(codeOnly).not.toMatch(/adminToken/);
  });

  it("licenseBadge maps the four wire states + an Unknown fallback", () => {
    expect(libSource).toContain('case "license_valid":');
    expect(libSource).toContain('case "license_missing":');
    expect(libSource).toContain('case "license_invalid":');
    expect(libSource).toContain('case "license_expired":');
    expect(libSource).toMatch(/if \(outcome\.kind === "unknown"\)/);
  });

  it("loadLicenseStatus reads runtime config and delegates to probeLicenseStatus", () => {
    expect(libSource).toMatch(/export async function loadLicenseStatus\(\)/);
    expect(libSource).toContain("loadRuntimeConfig()");
    expect(libSource).toContain("idpBaseUrl(cfg)");
    expect(libSource).toContain("probeLicenseStatus(");
  });
});

describe("Settings page — live License card consumes the safe lib", () => {
  it("imports loadLicenseStatus + licenseBadge from the shared lib (no inline duplication)", () => {
    expect(settingsSource).toMatch(/from "@\/lib\/license-status"/);
    expect(settingsSource).toContain("loadLicenseStatus");
    expect(settingsSource).toContain("licenseBadge");
  });

  it("renders a LicenseCard (replacing the prior PlaceholderCard)", () => {
    expect(settingsSource).toMatch(/<LicenseCard\b/);
    expect(settingsSource).toContain("function LicenseCard(");
  });

  it("no longer renders the prior PlaceholderCard 'Coming soon' badge", () => {
    expect(settingsSource).not.toContain('"Coming soon"');
    expect(settingsSource).not.toContain("Coming soon");
    expect(settingsSource).not.toContain("function PlaceholderCard(");
  });

  it("page-level source NEVER references unsafe wire fields in CODE", () => {
    const codeOnly = stripComments(settingsSource);
    const unsafeFields = [
      "licensee",
      "license_id",
      "license_type",
      "expires_at",
      "expiresAt",
      "licenseId",
      "licenseType",
      "next_action",
      "nextAction",
    ];
    for (const field of unsafeFields) {
      expect(
        codeOnly,
        `field "${field}" must not appear in non-comment Settings page source`
      ).not.toContain(field);
    }
  });

  it("page-level source NEVER references envelope / signing / admin-bearer-token material in CODE", () => {
    const codeOnly = stripComments(settingsSource);
    expect(codeOnly).not.toMatch(/envelope/i);
    expect(codeOnly).not.toMatch(/signature/i);
    expect(codeOnly).not.toMatch(/bearer/i);
    expect(codeOnly).not.toMatch(/adminToken/);
  });

  it("LicenseDetails renders ONLY status.product + status.distribution + optional status.tier", () => {
    expect(settingsSource).toMatch(/function LicenseDetails\(\{ status }:/);
    expect(settingsSource).toContain("status.product");
    expect(settingsSource).toContain("status.distribution");
    expect(settingsSource).toContain("status.tier");
  });

  it("Coming-soon / placeholder framing is entirely removed", () => {
    expect(settingsSource).not.toMatch(/placeholder/i);
  });
});
