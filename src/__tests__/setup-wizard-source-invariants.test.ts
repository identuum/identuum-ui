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
