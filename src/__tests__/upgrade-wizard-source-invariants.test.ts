/**
 * Source-invariant pins for the OSS-to-CE upgrade wizard at
 * /upgrade. Reads the wizard client component, the page server
 * component, and the upgrade client as plain text and asserts:
 *
 *   - No reads or writes of localStorage / sessionStorage /
 *     document.cookie anywhere in the upgrade code paths. The
 *     upgrade token plaintext must never be persisted in the
 *     browser.
 *   - The wizard does not render internal schema vocabulary
 *     (`goose_db_version_ce`, `oauth_clients TEXT[]`, `JSONB`,
 *     `local_sessions`, `signing_keys`) as primary copy. Operator
 *     `Detail` strings may surface this vocabulary, but those
 *     come from the backend body — they are not hardcoded in the
 *     wizard. (Schema vocabulary may appear inside backend-provided
 *     strings rendered at runtime, but never in the static UI
 *     source as primary copy.)
 *   - The wizard does not name a direct identuum-idp URL — every
 *     call flows through the same-origin /api/idp/... proxy.
 *   - The wizard does not use "demo" / "evaluation" / "playground"
 *     / "toy" framing.
 *   - The wizard has the documented data-testid set so Playwright
 *     and Vitest mocks can target it without depending on copy.
 *   - The wizard explicitly drops the upgrade token from React
 *     state after the apply call returns.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

function readWithoutComments(path: string): string {
  // Strip JSDoc / block comments AND single-line `//` comments
  // before running source-discipline pins. Comments that explain
  // the discipline are fine; the pins target executable code.
  const raw = readFileSync(path, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const wizardPath = join(root, "src/app/upgrade/upgrade-wizard.tsx");
const pagePath = join(root, "src/app/upgrade/page.tsx");
const clientPath = join(root, "src/lib/idp-upgrade-client.ts");

const wizardSource = readWithoutComments(wizardPath);
const wizardSourceRaw = readFileSync(wizardPath, "utf8");
const pageSource = readWithoutComments(pagePath);
const pageSourceRaw = readFileSync(pagePath, "utf8");
const clientSource = readWithoutComments(clientPath);
const clientSourceRaw = readFileSync(clientPath, "utf8");

describe("upgrade wizard never persists upgrade tokens or other secrets in the browser", () => {
  it.each([
    ["upgrade-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-upgrade-client.ts", clientSource],
  ])("%s does not touch localStorage", (_label, src) => {
    expect(src).not.toMatch(/localStorage/);
  });

  it.each([
    ["upgrade-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-upgrade-client.ts", clientSource],
  ])("%s does not touch sessionStorage", (_label, src) => {
    expect(src).not.toMatch(/sessionStorage/);
  });

  it.each([
    ["upgrade-wizard.tsx", wizardSource],
    ["page.tsx", pageSource],
    ["idp-upgrade-client.ts", clientSource],
  ])("%s does not write document.cookie", (_label, src) => {
    expect(src).not.toMatch(/document\.cookie/);
  });

  it("wizard drops the upgrade token from React state after the apply call", () => {
    // The wizard MUST call setUpgradeToken("") after applyUpgrade()
    // returns so the token does not linger between renders.
    expect(wizardSourceRaw).toMatch(/setUpgradeToken\(""\)/);
  });
});

describe("upgrade wizard never renders internal schema vocabulary as primary copy", () => {
  // Primary copy = the wizard's own customer-facing strings.
  // Backend-supplied next_action / Detail strings are NOT primary
  // copy — they come from the JSON body and may legitimately mention
  // internal schema names. We only pin that the wizard source code
  // does not hardcode them in JSX text.
  const forbidden = [
    "goose_db_version_ce",
    "goose_db_version",
    "oauth_clients TEXT[]",
    "TEXT[]→JSONB",
    "local_sessions",
    "JSONB",
  ];
  for (const term of forbidden) {
    it(`wizard does not hardcode "${term}" in primary copy`, () => {
      expect(wizardSource).not.toContain(term);
    });
  }
});

describe("upgrade wizard avoids demo/evaluation framing", () => {
  const banned = ["demo", "Demo", "playground", "evaluation only", "toy", "Toy", "Playground"];
  for (const term of banned) {
    it(`wizard does not say "${term}"`, () => {
      expect(wizardSource).not.toContain(term);
    });
    it(`page does not say "${term}"`, () => {
      expect(pageSource).not.toContain(term);
    });
  }
});

describe("upgrade wizard talks to the IDP only via the same-origin proxy", () => {
  it("upgrade client paths start with /api/idp/", () => {
    // Every fetch() in idp-upgrade-client.ts uses the
    // UPGRADE_PATHS constant — pin the proxy prefix.
    const matches = clientSourceRaw.match(/"\/api\/idp\/[^"]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["upgrade-wizard.tsx", wizardSourceRaw],
    ["page.tsx", pageSourceRaw],
  ])("%s does not name a direct identuum-idp URL", (_label, src) => {
    // The wizard MUST go through the same-origin proxy. Direct
    // backend URLs (http://identuum-idp:7113, http://localhost:7113,
    // http://localhost:7213) must not appear in client/server code.
    expect(src).not.toMatch(/http:\/\/identuum-idp/);
    expect(src).not.toMatch(/http:\/\/localhost:7113/);
    expect(src).not.toMatch(/http:\/\/localhost:7213/);
  });

  it("wizard does not make raw fetch() calls — it goes through the client helpers", () => {
    // Allow the helper imports; forbid bare fetch() in the wizard.
    expect(wizardSource).not.toMatch(/\bfetch\(/);
  });
});

describe("upgrade wizard has the documented data-testid set", () => {
  const required = [
    "upgrade-wizard",
    "upgrade-state-card",
    "upgrade-state-title",
    "upgrade-state-copy",
    "upgrade-refresh-status",
    "upgrade-preflight-checks",
    "upgrade-preflight-details-toggle",
    "upgrade-backup-confirm",
    "upgrade-backup-confirm-label",
    "upgrade-token-input",
    "upgrade-apply-submit",
  ];
  for (const id of required) {
    it(`wizard renders data-testid="${id}"`, () => {
      expect(wizardSourceRaw).toContain(`data-testid="${id}"`);
    });
  }
});

describe("upgrade wizard explicitly requires backup confirmation before apply", () => {
  it("wizard guards on backupConfirmed before calling applyUpgrade", () => {
    expect(wizardSourceRaw).toMatch(/backupConfirmed/);
  });
  it("apply submit button is disabled when backup is not confirmed", () => {
    expect(wizardSourceRaw).toMatch(/!backupConfirmed/);
  });
});

describe("upgrade wizard explicitly requires an upgrade token before apply", () => {
  it("apply submit button is disabled when the token is empty", () => {
    expect(wizardSourceRaw).toMatch(/upgradeToken\.trim\(\)\.length === 0/);
  });
  it("wizard does not autocomplete the upgrade token input", () => {
    expect(wizardSourceRaw).toMatch(/autoComplete="off"/);
  });
});

describe("upgrade wizard advises restart-then-setup on completion", () => {
  it("wizard surfaces 'Restart the CE service' as the next action copy", () => {
    expect(wizardSourceRaw).toMatch(/Restart the CE service/);
  });
  it("wizard mentions continuing with first-run setup after restart", () => {
    expect(wizardSourceRaw).toMatch(/first-run setup/);
  });
});

describe("upgrade wizard imports the right client helpers", () => {
  it("wizard imports getUpgradeStatus, getUpgradePreflight, and applyUpgrade", () => {
    expect(wizardSourceRaw).toMatch(/getUpgradeStatus/);
    expect(wizardSourceRaw).toMatch(/getUpgradePreflight/);
    expect(wizardSourceRaw).toMatch(/applyUpgrade/);
  });
  it("page server-renders by fetching status server-side", () => {
    expect(pageSourceRaw).toMatch(/getUpgradeStatus/);
  });
});
