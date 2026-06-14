/**
 * Source-invariant pins for the Phase 10 backup automation
 * affordance added to the OSS-to-CE upgrade wizard. Reads the
 * upgrade-client + wizard sources as plain text and asserts:
 *
 *   - The new client helpers go through the same-origin
 *     /api/idp/api/upgrade/backup proxy URL only.
 *   - No direct identuum-idp URL ever appears in either source.
 *   - The wizard does not persist backup contents, backup paths,
 *     DB URLs, or pg_dump stderr to localStorage / sessionStorage
 *     / document.cookie.
 *   - The wizard does not render internal schema vocabulary
 *     (goose_db_version_ce, oauth_clients TEXT[]→JSONB,
 *     local_sessions, retired signing_keys) inside the backup
 *     section's primary copy.
 *   - The wizard renders the documented backup-section data-testid
 *     set so Playwright + Vitest mocks can target it without
 *     depending on copy.
 *   - The wizard does NOT make raw fetch() calls to /api/idp/...
 *     URLs inside the backup section — it goes through the new
 *     helpers exclusively.
 *   - The wizard does not use "demo" / "evaluation" / "playground"
 *     / "toy" framing in the new section.
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
const clientPath = join(root, "src/lib/idp-upgrade-client.ts");

const wizardSource = readWithoutComments(wizardPath);
const clientSource = readWithoutComments(clientPath);

describe("backup helpers route through the same-origin proxy only", () => {
  it("client exposes /api/idp/api/upgrade/backup as the backup path", () => {
    expect(clientSource).toMatch(/backup:\s*"\/api\/idp\/api\/upgrade\/backup"/);
  });

  it("client never names a direct identuum-idp URL", () => {
    expect(clientSource).not.toMatch(/http:\/\/identuum-idp/);
    expect(clientSource).not.toMatch(/http:\/\/localhost:7113/);
    expect(clientSource).not.toMatch(/http:\/\/localhost:7213/);
  });

  it("wizard never names a direct identuum-idp URL", () => {
    expect(wizardSource).not.toMatch(/http:\/\/identuum-idp/);
    expect(wizardSource).not.toMatch(/http:\/\/localhost:7113/);
  });
});

describe("backup section persistence discipline", () => {
  it("wizard does not write to localStorage", () => {
    expect(wizardSource).not.toMatch(/localStorage/);
  });
  it("wizard does not write to sessionStorage", () => {
    expect(wizardSource).not.toMatch(/sessionStorage/);
  });
  it("wizard does not touch document.cookie", () => {
    expect(wizardSource).not.toMatch(/document\.cookie/);
  });
  it("client does not write to localStorage", () => {
    expect(clientSource).not.toMatch(/localStorage/);
  });
  it("client does not write to sessionStorage", () => {
    expect(clientSource).not.toMatch(/sessionStorage/);
  });
  it("client does not touch document.cookie", () => {
    expect(clientSource).not.toMatch(/document\.cookie/);
  });
});

describe("backup section primary copy hides internal schema vocabulary", () => {
  // Find the contiguous slice of the wizard between the
  // "Section 2b — product-managed backup automation" anchor and the
  // "Section 3 — apply form" anchor. Schema vocabulary inside other
  // sections (operator-facing Detail strings from the backend) is
  // out of scope for this pin.
  const startAnchor = "Section 2b";
  const endAnchor = "Section 3 — apply form";
  const wizardRaw = readFileSync(wizardPath, "utf8");
  const startIdx = wizardRaw.indexOf(startAnchor);
  const endIdx = wizardRaw.indexOf(endAnchor, startIdx + startAnchor.length);
  const section = wizardRaw.slice(startIdx, endIdx);

  it.each([
    "goose_db_version_ce",
    "goose_db_version",
    "oauth_clients TEXT[]",
    "TEXT[]→JSONB",
    "local_sessions",
  ])("backup section does not hardcode %q in primary copy", (vocab) => {
    expect(section).not.toContain(vocab);
  });
});

describe("backup section data-testid surface", () => {
  it.each([
    "upgrade-backup-loading",
    "upgrade-backup-automation-card",
    "upgrade-backup-create",
    "upgrade-backup-external-required",
  ])("wizard exposes %s test id", (testid) => {
    expect(wizardSource).toContain(testid);
  });
});

describe("backup section uses the helpers exclusively (no raw fetch in this scope)", () => {
  // Allow getUpgradeStatus / getUpgradePreflight / applyUpgrade /
  // getBackupStatus / createBackup mentions; ban raw fetch() in
  // the wizard.
  it("wizard does not call fetch() directly", () => {
    expect(wizardSource).not.toMatch(/\bfetch\s*\(/);
  });
  it("wizard imports getBackupStatus and createBackup from the helper", () => {
    expect(wizardSource).toMatch(/getBackupStatus/);
    expect(wizardSource).toMatch(/createBackup/);
  });
});

describe("backup section avoids demo / evaluation-only framing", () => {
  const startAnchor = "Section 2b";
  const endAnchor = "Section 3 — apply form";
  const wizardRaw = readFileSync(wizardPath, "utf8");
  const startIdx = wizardRaw.indexOf(startAnchor);
  const endIdx = wizardRaw.indexOf(endAnchor, startIdx + startAnchor.length);
  const section = wizardRaw.slice(startIdx, endIdx);

  it.each(["demo", "Demo", "playground", "Playground", "evaluation only", "toy", "Toy"])(
    "backup section does not use the %q framing word",
    (word) => {
      expect(section).not.toContain(word);
    }
  );
});
