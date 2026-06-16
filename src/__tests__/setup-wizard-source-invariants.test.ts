/**
 * Source-invariant pins for the appliance first-run setup wizard
 * (`/setup`). Reads the wizard server component AND client component
 * as plain text and asserts:
 *
 *   - Customer-facing copy does not use the forbidden "demo" / "local"
 *     / "toy" framing for the OSS install (D-IDP-INSTALL-08 +
 *     D-IDP-INSTALL-25).
 *   - The wizard imports the appliance setup client and does NOT touch
 *     localStorage / sessionStorage / cookies for setup token or
 *     password material.
 *   - The wizard form contains the expected inputs and submit handler
 *     references so a future refactor cannot silently drop them.
 *   - The server page redirects to `/login` when status reports
 *     `setup_complete` (defense-in-depth pin for the open-tab race).
 *
 * Source invariants run fast and can catch regressions without
 * rendering React (the UI repo deliberately ships no React Testing
 * Library / jsdom dependency).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const wizardSource = readFileSync(join(root, "src/app/setup/setup-wizard.tsx"), "utf8");
const pageSource = readFileSync(join(root, "src/app/setup/page.tsx"), "utf8");

// Phrases that would frame the OSS install as a toy / evaluation surface,
// directly contradicting D-IDP-INSTALL-08 + D-IDP-INSTALL-25. Match is
// case-insensitive and word-boundary aware so legitimate substrings
// inside identifiers (e.g. "localStorage" — which we forbid for other
// reasons) are not flagged twice.
const FORBIDDEN_FRAMING_WORDS: ReadonlyArray<string> = [
  "demo",
  "toy",
  "playground",
  "evaluation only",
];

function findForbiddenWord(source: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\\\]/g, "\\$&")}\\b`, "i");
  return re.test(source);
}

describe("setup wizard customer-facing copy", () => {
  it("uses professional first-run framing, not 'demo' or 'toy'", () => {
    for (const word of FORBIDDEN_FRAMING_WORDS) {
      expect(findForbiddenWord(wizardSource, word)).toBe(false);
      expect(findForbiddenWord(pageSource, word)).toBe(false);
    }
  });

  it("uses the approved professional terms in the page chrome", () => {
    expect(pageSource).toMatch(/First-run setup/);
    expect(pageSource).toMatch(/self-hosted Identuum IDP/);
    expect(pageSource).toMatch(/single-node self-hosted install/);
  });

  it("explicitly distinguishes the setup code from the admin password", () => {
    expect(wizardSource).toMatch(/setup code is single-use/);
    expect(wizardSource).toMatch(/not your\s*\n?\s*administrator password/);
  });
});

describe("setup wizard never persists secrets in the browser", () => {
  it("does not read or write localStorage", () => {
    expect(wizardSource).not.toMatch(/localStorage/);
    expect(pageSource).not.toMatch(/localStorage/);
  });

  it("does not read or write sessionStorage", () => {
    expect(wizardSource).not.toMatch(/sessionStorage/);
    expect(pageSource).not.toMatch(/sessionStorage/);
  });

  it("does not write document.cookie", () => {
    expect(wizardSource).not.toMatch(/document\.cookie/);
    expect(pageSource).not.toMatch(/document\.cookie/);
  });
});

describe("setup wizard imports the right client surface", () => {
  it("imports the appliance setup client (verifySetupToken + completeSetup)", () => {
    expect(wizardSource).toMatch(/verifySetupToken/);
    expect(wizardSource).toMatch(/completeSetup/);
    expect(wizardSource).toMatch(/from "@\/lib\/idp-setup-client"/);
  });

  it("page imports getSetupStatus from the same client module", () => {
    expect(pageSource).toMatch(/getSetupStatus/);
    expect(pageSource).toMatch(/from "@\/lib\/idp-setup-client"/);
  });

  it("page redirects to /login on setup_complete", () => {
    expect(pageSource).toMatch(/setup_complete/);
    expect(pageSource).toMatch(/redirect\("\/login"\)/);
  });

  it("wizard treats a failed CE license probe as block-submission, not as 'license OK' (2026-06-15 customer-smoke regression pin)", () => {
    // The pre-fix `licenseAccepted` clause `licenseStatus === null` made
    // a probe failure indistinguishable from a valid license for CE
    // backends, letting setup complete against an unlicensed CE binary.
    // The new shape requires `licenseStatus?.state === "license_valid"`
    // for CE. Also pin the recovery-banner test-id so a future refactor
    // cannot silently drop the operator-facing explanation.
    expect(wizardSource).toMatch(/licenseProbeUnavailableForCE/);
    expect(wizardSource).toMatch(
      /licenseAccepted\s*=\s*\n?\s*!distributionIsCE \|\| licenseStatus\?\.state === "license_valid"/
    );
    expect(wizardSource).toMatch(/data-testid="setup-license-probe-unavailable"/);
    expect(wizardSource).toMatch(/CE license status unavailable/);
  });

  it("page consults the server-runtime composition for setup state (authoritative absolute-URL probe, ahead of the relative-URL proxy probe)", () => {
    // The relative-URL `getSetupStatus()` probe can fall through to
    // a probe-failure on environments where the bundled UI proxy is
    // unreliable but the in-network IDP DNS is reachable (observed
    // during the 2026-06-15 CE customer-smoke). Pin both signals.
    expect(pageSource).toMatch(/getServerRuntimeState/);
    expect(pageSource).toMatch(/from "@\/lib\/server-runtime-state"/);
    expect(pageSource).toMatch(
      /runtime\?\.components\.idp\.setupState\?\.state === "setup_complete"/
    );
  });

  it("page falls back to the runtime composition for `initial` when the relative-URL setup-status probe fails (Node native fetch cannot resolve relative URLs in SSR — 2026-06-15 customer-smoke pin)", () => {
    // Without this fallback the wizard renders with initialStatus=null,
    // distributionIsCE=false, and submit allowed — the customer-smoke
    // would silently let setup complete against an unlicensed CE
    // backend (which then boots oss_compat and fails at login). The
    // runtime composition uses absolute IDP URLs and is reliable in
    // Compose deployments where the bundled-UI proxy fails server-side.
    expect(pageSource).toMatch(/idpRuntime/);
    expect(pageSource).toMatch(/idpRuntime\?\.setupState/);
    // Distribution is derived from the absolute /api/v1/component product
    // identifier — IdpSetupStateView deliberately omits the distribution
    // field, so the page MUST consult product to know it's CE.
    expect(pageSource).toMatch(/idpRuntime\.product === "identuum-idp-ce" \? "ce" : "oss"/);
    // initialLicenseStatus gate must consult the RESOLVED initial
    // (not the relative-URL status) so the license body flows through
    // to the wizard on the runtime-fallback path.
    expect(pageSource).toMatch(/initial\?\.distribution === "ce"/);
  });

  it("page probes the IDP license endpoint via absolute URL when the SSR relative-URL probe fails (so the LicenseStep can render on stacks where the SSR proxy is broken — 2026-06-15 customer-smoke pin)", () => {
    // Without the absolute-URL fallback the SSR-rendered wizard would
    // surface only the 'CE license status unavailable' banner and the
    // operator could never reach the LicenseStep to upload a license
    // through the wizard at all. The fallback uses idp.internal_base_url
    // from the runtime config (the same in-network DNS path the
    // runtime composition uses) so it works even when same-origin
    // proxy SSR resolution does not.
    expect(pageSource).toMatch(/fetchLicenseStatusAbsolute/);
    expect(pageSource).toMatch(/idpBaseUrl\(cfg\)/);
    expect(pageSource).toMatch(/\/api\/setup\/license/);
    // Hard fail-closed surface: the absolute helper itself must NEVER
    // return on errors — it returns null so the wizard renders the
    // recovery banner rather than acting on an unknown license state.
    expect(pageSource).toMatch(/return null/);
  });

  it("page also redirects to /setup-required when the UI is not configured", () => {
    expect(pageSource).toMatch(/loadRuntimeConfig/);
    expect(pageSource).toMatch(/redirect\("\/setup-required"\)/);
  });
});

describe("setup wizard form has the expected inputs", () => {
  it("has the setup-code input with the documented test id", () => {
    expect(wizardSource).toMatch(/data-testid="setup-code-input"/);
    expect(wizardSource).toMatch(/data-testid="setup-code-verify"/);
  });

  it("has the organization + admin fields with the documented test ids", () => {
    expect(wizardSource).toMatch(/data-testid="setup-org-name"/);
    expect(wizardSource).toMatch(/data-testid="setup-org-domain"/);
    expect(wizardSource).toMatch(/data-testid="setup-admin-email"/);
    expect(wizardSource).toMatch(/data-testid="setup-admin-password"/);
    expect(wizardSource).toMatch(/data-testid="setup-admin-password-confirm"/);
    expect(wizardSource).toMatch(/data-testid="setup-submit"/);
  });

  it("enforces a 12-character minimum on the admin password", () => {
    expect(wizardSource).toMatch(/MIN_PASSWORD_LENGTH\s*=\s*12/);
    expect(wizardSource).toMatch(/minLength={MIN_PASSWORD_LENGTH}/);
  });

  it("uses autocomplete='new-password' on the two password inputs", () => {
    const matches = wizardSource.match(/autoComplete="new-password"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("does not autocomplete the setup code field", () => {
    expect(wizardSource).toMatch(/id="setup_token"[\s\S]*?autoComplete="off"/);
  });
});
