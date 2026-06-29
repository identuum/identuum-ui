/**
 * Source-invariant pins for the new read-only license-status section
 * at the top of `/site-admin/license` (src/app/site-admin/license/page.tsx),
 * added by `agent-a-20260620-idp-ui-site-admin-license-readonly-view`.
 *
 * Two distinct surfaces live on this page; this test pins the
 * PAGE-LEVEL section ONLY. The LicenseManager client component (the
 * bearer-token-gated upload/replace flow at the bottom of the page)
 * legitimately renders a wider field set after the operator pastes
 * an admin token; that surface is pinned by
 * `admin-license-page-source-invariants.test.ts` instead.
 *
 * Specifically, this test asserts that the page-level read-only
 * section:
 *   - Uses the shared `@/lib/license-status` helper (single source of
 *     truth for the safe projection).
 *   - Does NOT reference any unsafe wire field in CODE (comments
 *     describing the safety contract are allowed and recommended).
 *   - Renders a `data-testid="readonly-license-status-card"` block
 *     for Playwright assertability without exposing any unsafe field.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const pageSource = readFileSync(join(root, "src/app/site-admin/license/page.tsx"), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("License page — read-only status section safety invariants", () => {
  it("imports loadLicenseStatus + licenseBadge from the shared lib (no inline duplication)", () => {
    expect(pageSource).toMatch(/from "@\/lib\/license-status"/);
    expect(pageSource).toContain("loadLicenseStatus");
    expect(pageSource).toContain("licenseBadge");
  });

  it("page exports an async server component that calls loadLicenseStatus on each request", () => {
    expect(pageSource).toMatch(/export default async function SiteAdminLicensePage\(\)/);
    expect(pageSource).toContain("await loadLicenseStatus()");
  });

  it("renders a readonly-license-status-card test hook for Playwright assertability", () => {
    expect(pageSource).toContain('data-testid="readonly-license-status-card"');
    expect(pageSource).toContain('data-testid="readonly-license-status-badge"');
  });

  it("page-level source NEVER references unsafe wire fields in CODE", () => {
    const codeOnly = stripComments(pageSource);
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
        `field "${field}" must not appear in non-comment License page source`
      ).not.toContain(field);
    }
  });

  it("page-level source NEVER reads or assigns envelope / signing / admin-bearer-token material in CODE", () => {
    const codeOnly = stripComments(pageSource);
    // `bearer` is allowed in comments and in the section's user-facing
    // copy that describes the LicenseManager below (e.g. "Paste a
    // current admin token below"). The code-level scan strips
    // comments AND JSX string literals. We instead check that the
    // page-level component does NOT include an `Authorization` header,
    // does NOT call any admin helper, and does NOT pass an adminToken
    // anywhere.
    expect(codeOnly).not.toMatch(/Authorization\s*:/);
    expect(codeOnly).not.toContain("adminGetLicenseStatus");
    expect(codeOnly).not.toContain("adminUploadLicense");
    expect(codeOnly).not.toContain("adminToken");
  });

  it("page renders only safe projection fields from the loaded outcome", () => {
    // The status card's JSX must only reach into licenseOutcome.status
    // for the four whitelisted fields. The pattern below intentionally
    // matches the entire status.* member access set.
    expect(pageSource).toMatch(/licenseOutcome\.status\.product/);
    expect(pageSource).toMatch(/licenseOutcome\.status\.distribution/);
    expect(pageSource).toMatch(/licenseOutcome\.status\.tier/);
    // No member access for unsafe fields.
    expect(pageSource).not.toMatch(/licenseOutcome\.status\.licensee/);
    expect(pageSource).not.toMatch(/licenseOutcome\.status\.expiresAt/);
    expect(pageSource).not.toMatch(/licenseOutcome\.status\.licenseId/);
    expect(pageSource).not.toMatch(/licenseOutcome\.status\.licenseType/);
    expect(pageSource).not.toMatch(/licenseOutcome\.status\.nextAction/);
  });

  it("page mounts LicenseManager below the read-only section (upload/replace flow preserved)", () => {
    expect(pageSource).toContain("<LicenseManager />");
    const readonlyIdx = pageSource.indexOf("readonly-license-status-card");
    const managerIdx = pageSource.indexOf("<LicenseManager />");
    expect(readonlyIdx).toBeGreaterThan(-1);
    expect(managerIdx).toBeGreaterThan(-1);
    expect(readonlyIdx, "read-only section must appear before LicenseManager").toBeLessThan(
      managerIdx
    );
  });
});
