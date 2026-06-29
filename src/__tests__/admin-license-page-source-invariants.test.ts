/**
 * Source-invariant pins for the post-setup site-admin license page.
 * Reads the page server component, the LicenseManager client component,
 * and the (already-extended) license client as plain text and asserts:
 *
 *   - No reads or writes of localStorage / sessionStorage /
 *     document.cookie anywhere in the admin license code paths.
 *   - The page renders inside the site-admin route segment so the
 *     /site-admin/layout.tsx guard runs.
 *   - The page uses the LicenseManager client component for state.
 *   - LicenseManager calls the discriminated-union helpers from
 *     idp-license-client.ts (adminGetLicenseStatus / adminUploadLicense)
 *     — NOT raw fetch.
 *   - The license client uses the same-origin proxy path; no direct
 *     identuum-idp URL appears in any browser-reachable file.
 *   - The page does NOT render "demo" / "playground" / "evaluation only"
 *     framing.
 *   - Documented data-testid attributes exist so Playwright + Vitest
 *     mocks can target the page deterministically.
 *
 * Source invariants run fast and can catch regressions without
 * rendering React (the UI repo deliberately ships no React Testing
 * Library / jsdom dependency).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

function readWithoutComments(path: string): string {
  // Strip JSDoc / block comments AND single-line `//` comments
  // before running source-discipline pins.
  const raw = readFileSync(path, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pagePath = join(root, "src/app/site-admin/license/page.tsx");
const managerPath = join(root, "src/app/site-admin/license/license-manager.tsx");
const clientPath = join(root, "src/lib/idp-license-client.ts");

const pageSource = readWithoutComments(pagePath);
const pageSourceRaw = readFileSync(pagePath, "utf8");
const managerSource = readWithoutComments(managerPath);
const managerSourceRaw = readFileSync(managerPath, "utf8");
const clientSource = readWithoutComments(clientPath);

describe("admin license page never persists license/token content in the browser", () => {
  it.each([
    ["page.tsx", pageSource],
    ["license-manager.tsx", managerSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not touch localStorage", (_label, src) => {
    expect(src).not.toMatch(/localStorage/);
  });

  it.each([
    ["page.tsx", pageSource],
    ["license-manager.tsx", managerSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not touch sessionStorage", (_label, src) => {
    expect(src).not.toMatch(/sessionStorage/);
  });

  it.each([
    ["page.tsx", pageSource],
    ["license-manager.tsx", managerSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not touch document.cookie", (_label, src) => {
    expect(src).not.toMatch(/document\.cookie/);
  });
});

describe("admin license page wiring", () => {
  it("page renders inside /site-admin (so the layout guard runs)", () => {
    // The path itself is the wiring contract — pin that page.tsx
    // exists at the expected route segment and exports default.
    expect(pageSourceRaw).toMatch(/export default (?:async )?function/);
    // And pin the path location by re-reading.
    expect(() => readFileSync(pagePath, "utf8")).not.toThrow();
  });

  it("page imports LicenseManager from the sibling client component", () => {
    expect(pageSource).toMatch(
      /import\s*\{\s*LicenseManager\s*\}\s*from\s*["']\.\/license-manager["']/
    );
  });

  it("page renders the LicenseManager component", () => {
    expect(pageSource).toMatch(/<LicenseManager\s*\/>/);
  });
});

describe("LicenseManager uses the discriminated-union helpers", () => {
  it("imports adminGetLicenseStatus from idp-license-client", () => {
    expect(managerSource).toMatch(/adminGetLicenseStatus/);
    expect(managerSource).toMatch(/from\s+["']@\/lib\/idp-license-client["']/);
  });

  it("imports adminUploadLicense from idp-license-client", () => {
    expect(managerSource).toMatch(/adminUploadLicense/);
  });

  it("does not make raw fetch() calls — every network call goes through the helpers", () => {
    expect(managerSource).not.toMatch(/\bfetch\s*\(/);
  });

  it('declares "use client" so React hooks work', () => {
    expect(managerSourceRaw).toMatch(/^\s*["']use client["']/);
  });
});

describe("admin license client uses the same-origin proxy", () => {
  it("does not name a direct identuum-idp URL", () => {
    // Any direct backend URL would defeat the same-origin proxy
    // contract. The full client (including the setup-time half)
    // must only reach the IDP via /api/idp/*.
    expect(clientSource).not.toMatch(/http:\/\/(?!localhost)/);
    expect(clientSource).not.toMatch(/identuum-idp(?:-(?:oss|ce))?\.[a-z]/);
    // Belt and braces: the admin paths must include "/api/idp/admin/license".
    expect(clientSource).toMatch(/\/api\/idp\/admin\/license/);
  });
});

describe("admin license page customer-facing copy hygiene", () => {
  it("does not use demo / playground / evaluation-only framing", () => {
    for (const src of [pageSourceRaw, managerSourceRaw]) {
      expect(src).not.toMatch(/\bdemo\b/i);
      expect(src).not.toMatch(/\bplayground\b/i);
      expect(src).not.toMatch(/\bevaluation only\b/i);
      expect(src).not.toMatch(/\btoy\b/i);
    }
  });
});

describe("LicenseManager exposes the documented test ids", () => {
  const requiredTestIds = [
    "admin-license-token-input",
    "admin-license-check-status",
    "admin-license-clear-token",
    "admin-license-envelope",
    "admin-license-upload",
    "admin-license-file-label",
    "admin-license-file-input",
  ];
  it.each(requiredTestIds)("manager exposes data-testid %s", (id) => {
    expect(managerSourceRaw).toContain(`data-testid="${id}"`);
  });
});

describe("LicenseManager admin-token field hygiene", () => {
  it("renders the admin-token input with type=password (DOM masking)", () => {
    // Browser DOM password fields mask the value visually and opt out of
    // autofill heuristics. Combined with the no-persist invariants above
    // this gives shoulder-surfing protection on the operator's monitor.
    expect(managerSourceRaw).toMatch(/type=["']password["']/);
  });

  it("opts out of autocomplete for the admin-token input", () => {
    expect(managerSourceRaw).toMatch(/autoComplete=["']off["']/);
  });
});
