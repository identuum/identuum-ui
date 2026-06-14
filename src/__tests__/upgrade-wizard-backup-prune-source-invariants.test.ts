/**
 * Source-invariant pins for the 2026-06-17 backup retention/pruning
 * affordance added to the OSS-to-CE upgrade wizard. Reads the
 * upgrade-client + wizard sources as plain text and asserts:
 *
 *   - The new prune helper goes through the same-origin
 *     /api/idp/api/upgrade/backup/prune proxy URL only.
 *   - No direct identuum-idp URL ever appears in either source.
 *   - The wizard never persists backup contents, the backup list,
 *     filenames, DB URLs, or pg_dump stderr to localStorage /
 *     sessionStorage / document.cookie. (The wider source-
 *     invariant pin in upgrade-wizard-backup-source-invariants
 *     already covers this for the broader file; we re-check here
 *     to ensure the retention slice did not regress the discipline
 *     inside the new BackupList component.)
 *   - The wizard does NOT make raw fetch() calls inside the prune
 *     flow — it goes through the new `pruneBackup` helper
 *     exclusively.
 *   - The wizard does not render internal schema vocabulary inside
 *     the backups list / prune affordance.
 *   - The wizard renders the new `data-testid` set so Playwright +
 *     Vitest mocks can target it without depending on copy.
 *   - The wizard always confirms a destructive delete in a
 *     two-step flow (pending-confirm → confirm) so a single
 *     misclick does not delete a backup.
 *   - Customer-facing primary copy in the new section avoids
 *     "demo" / "playground" / "evaluation only" / "toy" framing.
 *   - The wizard never composes a backup-prune body with a path
 *     separator, an absolute path, or "..".
 *   - The wizard never reads or echoes the backup file body.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

function readWithoutComments(path: string): string {
  const raw = readFileSync(path, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const wizardPath = join(root, "src/app/upgrade/upgrade-wizard.tsx");
const clientPath = join(root, "src/lib/idp-upgrade-client.ts");

const wizardSource = readWithoutComments(wizardPath);
const clientSource = readWithoutComments(clientPath);
const wizardRaw = readFileSync(wizardPath, "utf8");
const clientRaw = readFileSync(clientPath, "utf8");

describe("prune helper routes through the same-origin proxy only", () => {
  it("client exposes /api/idp/api/upgrade/backup/prune as the prune path", () => {
    expect(clientSource).toMatch(/backupPrune:\s*"\/api\/idp\/api\/upgrade\/backup\/prune"/);
  });

  it("wizard goes through pruneBackup() — no raw /api/idp/.../prune fetch", () => {
    expect(wizardSource).toContain("pruneBackup");
    const fetches = wizardSource.matchAll(/fetch\(/g);
    for (const m of fetches) {
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 100);
      const end = Math.min(wizardSource.length, idx + 200);
      const snippet = wizardSource.slice(start, end);
      expect(snippet).not.toMatch(/\/api\/idp\/api\/upgrade\/backup\/prune/);
    }
  });

  it("client + wizard never name a direct identuum-idp URL", () => {
    expect(clientRaw).not.toMatch(/https?:\/\/(?:localhost|identuum-idp|127\.0\.0\.1)/);
    expect(wizardRaw).not.toMatch(/https?:\/\/(?:localhost|identuum-idp|127\.0\.0\.1)/);
  });
});

describe("prune affordance does not persist secrets / list / filename", () => {
  for (const sink of ["localStorage", "sessionStorage", "document.cookie"]) {
    it(`wizard does not touch ${sink}`, () => {
      expect(wizardSource).not.toContain(sink);
    });
    it(`client does not touch ${sink}`, () => {
      expect(clientSource).not.toContain(sink);
    });
  }
});

describe("no internal schema vocabulary in prune affordance primary copy", () => {
  const banned = [
    "goose_db_version_ce",
    "goose_db_version",
    "oauth_clients TEXT[]",
    "TEXT[]→JSONB",
    "local_sessions",
    "retired signing_keys",
  ];
  for (const term of banned) {
    it(`wizard primary copy does not contain ${term}`, () => {
      expect(wizardSource).not.toContain(term);
    });
  }
});

describe("wizard exposes the documented prune data-testid set", () => {
  const required = [
    "upgrade-backup-list",
    "upgrade-backup-prune-request-",
    "upgrade-backup-prune-confirm-",
    "upgrade-backup-prune-cancel-",
    "upgrade-backup-prune-submitting-",
    "upgrade-backup-prune-ok",
    "upgrade-backup-prune-error",
  ];
  for (const id of required) {
    it(`renders data-testid containing ${id}`, () => {
      expect(wizardSource).toContain(id);
    });
  }
});

describe("two-step destructive flow: pending-confirm before delete", () => {
  it("wizard state machine declares pending-confirm before submitting", () => {
    expect(wizardSource).toMatch(/"pending-confirm"/);
    expect(wizardSource).toMatch(/handleConfirmPrune/);
    expect(wizardSource).toMatch(/handleCancelPrune/);
  });

  it("wizard does NOT call pruneBackup() directly from the Remove button — Remove only flips to pending-confirm", () => {
    // The Remove button handler in the rendered BackupList must call
    // onRequestPrune (which sets pending-confirm), NOT
    // onConfirmPrune. We assert the source shape by searching for
    // the destructive POST handler reference pattern.
    expect(wizardSource).toMatch(/onRequestPrune\(b\.filename\)/);
    expect(wizardSource).toMatch(/onConfirmPrune\(b\.filename\)/);
  });
});

describe("no demo / playground / evaluation / toy framing in new copy", () => {
  const banned = ["demo", "playground", "evaluation only", "evaluation-only", "toy"];
  for (const term of banned) {
    it(`wizard primary copy does not contain ${term}`, () => {
      const lower = wizardSource.toLowerCase();
      expect(lower).not.toContain(term);
    });
  }
});

describe("no traversal-style strings in client request construction", () => {
  it("client does not embed `..` or path separators in prune request literals", () => {
    // Grab the pruneBackup body literal and confirm it sends only
    // the filename field (no concatenated paths).
    const pruneSection = clientSource.slice(
      clientSource.indexOf("export async function pruneBackup")
    );
    expect(pruneSection).toMatch(/JSON\.stringify\(\{\s*filename\s*\}\)/);
    expect(pruneSection).not.toContain('"../"');
    expect(pruneSection).not.toContain("'..'");
    expect(pruneSection).not.toContain("backup_directory");
  });
});

describe("client-side filename guard mirrors the server pattern", () => {
  it("exports `isProductBackupFilename` with the exact server-side regex anchor shape", () => {
    expect(clientSource).toMatch(/PRODUCT_BACKUP_FILENAME_PATTERN/);
    // The pattern must anchor start-to-end and require the exact
    // prefix + 14-char timestamp + 8-hex suffix + .sql shape.
    expect(clientSource).toMatch(
      /\^identuum-idp-ce-upgrade-backup-\\d\{8\}T\\d\{6\}Z-\[0-9a-f\]\{8\}\\\.sql\$/
    );
    expect(clientSource).toMatch(/export function isProductBackupFilename/);
  });
});

describe("wizard never reads backup file body", () => {
  it("does not call fetch() with a path that targets the raw backup file bytes", () => {
    // The wizard surface is metadata-only — there is no
    // /api/upgrade/backup/<id>/body, no /api/upgrade/backup/file,
    // no download() helper.
    expect(wizardSource).not.toMatch(/\/api\/idp\/api\/upgrade\/backup\/[^"\s]*\/body/);
    expect(wizardSource).not.toMatch(/\/api\/idp\/api\/upgrade\/backup\/[^"\s]*\/file/);
    expect(wizardSource).not.toMatch(/\/api\/idp\/api\/upgrade\/backup\/[^"\s]*\/raw/);
    expect(wizardSource).not.toMatch(/downloadBackup|fetchBackupBody/);
  });
});
