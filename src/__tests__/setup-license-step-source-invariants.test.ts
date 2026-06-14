/**
 * Source-invariant pins for the CE license upload step inside the
 * appliance first-run setup wizard. Reads the license-step client
 * component, the modified wizard component, the setup page server
 * component, and the license client as plain text and asserts:
 *
 *   - No reads or writes of localStorage / sessionStorage /
 *     document.cookie anywhere in the license code paths.
 *   - The wizard imports the license step and the license client
 *     module, and the page fetches license status server-side.
 *   - The license step does not autocomplete the envelope field.
 *   - The license step has the documented test ids so Playwright
 *     and Vitest mocks can target it without depending on copy.
 *   - The license step does not render OSS-only or "demo" framing.
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
  // before running source-discipline pins. The point of those
  // pins is "this file never CALLS localStorage / sessionStorage /
  // document.cookie", not "this file's comments never mention
  // them" — comments that explain the discipline are fine.
  const raw = readFileSync(path, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const stepSource = readWithoutComments(join(root, "src/app/setup/license-step.tsx"));
const stepSourceRaw = readFileSync(join(root, "src/app/setup/license-step.tsx"), "utf8");
const wizardSource = readWithoutComments(join(root, "src/app/setup/setup-wizard.tsx"));
const wizardSourceRaw = readFileSync(join(root, "src/app/setup/setup-wizard.tsx"), "utf8");
const pageSource = readWithoutComments(join(root, "src/app/setup/page.tsx"));
const pageSourceRaw = readFileSync(join(root, "src/app/setup/page.tsx"), "utf8");
const clientSource = readWithoutComments(join(root, "src/lib/idp-license-client.ts"));
const clientSourceRaw = readFileSync(join(root, "src/lib/idp-license-client.ts"), "utf8");

describe("CE license step never persists license content in the browser", () => {
  it.each([
    ["license-step.tsx", stepSource],
    ["setup-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not touch localStorage", (_label, src) => {
    expect(src).not.toMatch(/localStorage/);
  });

  it.each([
    ["license-step.tsx", stepSource],
    ["setup-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not touch sessionStorage", (_label, src) => {
    expect(src).not.toMatch(/sessionStorage/);
  });

  it.each([
    ["license-step.tsx", stepSource],
    ["setup-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-license-client.ts", clientSource],
  ])("%s does not write document.cookie", (_label, src) => {
    expect(src).not.toMatch(/document\.cookie/);
  });
});

describe("CE license step is gated on CE distribution and license-not-valid", () => {
  it("wizard renders the license step only when distribution=ce and state≠license_valid", () => {
    expect(wizardSourceRaw).toMatch(/distributionIsCE/);
    expect(wizardSourceRaw).toMatch(/license_valid/);
    expect(wizardSourceRaw).toMatch(/showLicenseStep/);
  });

  it("wizard imports the LicenseStep component", () => {
    expect(wizardSourceRaw).toMatch(/import \{ LicenseStep \} from "\.\/license-step"/);
  });

  it("page fetches license status server-side and forwards it to the wizard", () => {
    expect(pageSourceRaw).toMatch(/getLicenseStatus/);
    expect(pageSourceRaw).toMatch(/initialLicenseStatus/);
  });

  it("page only forwards a license status when the backend reports distribution=ce", () => {
    expect(pageSourceRaw).toMatch(/distribution === "ce"/);
  });
});

describe("CE license step form has the documented test ids", () => {
  it("has the envelope textarea and the documented test ids", () => {
    expect(stepSourceRaw).toMatch(/data-testid="setup-license-step"/);
    expect(stepSourceRaw).toMatch(/data-testid="setup-license-envelope"/);
    expect(stepSourceRaw).toMatch(/data-testid="setup-license-upload"/);
  });

  it("has the file-upload affordance with documented test ids", () => {
    expect(stepSourceRaw).toMatch(/data-testid="setup-license-file-label"/);
    expect(stepSourceRaw).toMatch(/data-testid="setup-license-file-input"/);
  });

  it("does not autocomplete the envelope textarea", () => {
    expect(stepSourceRaw).toMatch(/id="license_envelope"[\s\S]*?autoComplete="off"/);
  });

  it("uses inline copy that names the appliance install path", () => {
    expect(stepSourceRaw).toMatch(/CE license/);
  });
});

describe("CE license step calls the license client, not a hand-rolled fetch", () => {
  it("imports uploadLicense from the license client module", () => {
    expect(stepSource).toMatch(
      /import \{[^}]*uploadLicense[^}]*\} from "@\/lib\/idp-license-client"/
    );
  });

  it("does not make raw fetch() calls", () => {
    // Comments stripped — fetch() in JSDoc examples is fine.
    expect(stepSource).not.toMatch(/fetch\(/);
  });
});

describe("CE license copy avoids forbidden framing", () => {
  it.each([
    ["license-step.tsx", stepSourceRaw],
    ["idp-license-client.ts", clientSourceRaw],
  ])("%s does not use 'demo' / 'toy' / 'playground' / 'evaluation only' framing", (_label, src) => {
    for (const word of ["demo", "toy", "playground", "evaluation only"]) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\\\]/g, "\\$&")}\\b`, "i");
      expect(re.test(src)).toBe(false);
    }
  });
});

describe("license client surface", () => {
  it("hits the same-origin /api/idp/api/setup/license path", () => {
    expect(clientSourceRaw).toMatch(/\/api\/idp\/api\/setup\/license/);
  });

  it("never names a direct identuum-idp URL", () => {
    expect(clientSourceRaw).not.toMatch(/http:\/\/.*7113/);
    expect(clientSourceRaw).not.toMatch(/https?:\/\/identuum-idp/);
  });
});
