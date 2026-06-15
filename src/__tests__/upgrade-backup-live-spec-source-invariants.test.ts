/**
 * Source-invariant pins for the 2026-06-17 live-backend Playwright
 * spec at e2e/upgrade-backup-live.spec.ts and its companion
 * harness scripts under e2e/scripts/. Reads the sources as plain
 * text and asserts:
 *
 *   - The live spec never persists secrets / token values / backup
 *     contents to localStorage / sessionStorage / document.cookie.
 *   - The spec never references a direct identuum-idp HOSTNAME
 *     (`identuum-idp:7113` or similar). Browser-side calls all go
 *     through the same-origin proxy; backend-helper calls go
 *     through the operator-supplied host port via `IDP_BASE`, which
 *     is a localhost URL derived from an env var.
 *   - The spec body never includes a plausible token plaintext
 *     literal (no 50+ base32 run).
 *   - The spec body never inlines a Postgres connection string
 *     with credentials (no `postgres://user:pass@host` literal).
 *   - The spec never injects raw backup body bytes (`CREATE TABLE`,
 *     `INSERT INTO`, `COPY`) into assertions in the positive sense.
 *     A negative `expect(...).not.toContain(...)` assertion is
 *     allowed (and present, as a leak pin).
 *   - The harness scripts never echo the upgrade-token value to
 *     stdout; the up.sh script must use redirection into a
 *     mode-0600 file, not `echo`.
 *   - The harness scripts redact / omit the DB password substring
 *     from any error path that could surface on stderr.
 *   - The opt-in gate is wired through `IDENTUUM_E2E_LIVE_UPGRADE_BACKUP`
 *     and the spec auto-skips when unset.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const specPath = join(root, "e2e/upgrade-backup-live.spec.ts");
const upPath = join(root, "e2e/scripts/upgrade-backup-live-up.sh");
const downPath = join(root, "e2e/scripts/upgrade-backup-live-down.sh");
const runPath = join(root, "e2e/scripts/run-upgrade-backup-live.sh");
const sqlPath = join(root, "e2e/scripts/upgrade-backup-live-oss-shape.sql");
const makefilePath = join(root, "Makefile");
const packageJsonPath = join(root, "package.json");
const e2eReadmePath = join(root, "e2e/README.md");

const SPEC = readFileSync(specPath, "utf8");
const UP = readFileSync(upPath, "utf8");
const DOWN = readFileSync(downPath, "utf8");
const RUN = readFileSync(runPath, "utf8");
const SQL = readFileSync(sqlPath, "utf8");
const MAKEFILE = readFileSync(makefilePath, "utf8");
const PACKAGE_JSON = readFileSync(packageJsonPath, "utf8");
const E2E_README = readFileSync(e2eReadmePath, "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SPEC_CODE = stripComments(SPEC);

describe("upgrade-backup-live spec: no-secrets discipline", () => {
  for (const sink of ["localStorage", "sessionStorage", "document.cookie"]) {
    it(`spec source does not touch ${sink}`, () => {
      expect(SPEC_CODE).not.toContain(sink);
    });
  }

  it("spec does not contain a plausible token plaintext literal", () => {
    // The 52-character base32 shape (real upgrade-tokens). The spec
    // never inlines one — it reads from the runtime-only file.
    expect(SPEC).not.toMatch(/[A-Z2-7]{52}/);
  });

  it("spec does not inline a postgres DSN with credentials", () => {
    // postgresql://user:pass@... — must never be a literal in the spec.
    expect(SPEC).not.toMatch(/postgres(?:ql)?:\/\/[^@\s/]*:[^@\s/]+@/);
  });

  it("identuum_idp_ce_local_default only appears inside a negative assertion OR an inline PGPASSWORD argument", () => {
    // The DB password substring appears in:
    //  (a) leak-probe assertions: `expect(logs).not.toContain(...)`.
    //  (b) ONE inline `PGPASSWORD=...` argument passed to
    //      `docker compose exec ... psql` for the post-apply seed-
    //      survival check. The value is the published Compose-
    //      default credential documented in
    //      deployment/docker-compose.yml — not a real secret. Pin
    //      that ONLY ONE such positive occurrence exists; anything
    //      else (e.g. a free-form log line, an env block,
    //      a JSON body) is forbidden.
    const positiveLines = SPEC.split("\n").filter(
      (line) => !line.includes(".not.toContain") && !line.includes(".not.toMatch")
    );
    const positiveHits = positiveLines.filter((line) =>
      line.includes("identuum_idp_ce_local_default")
    );
    expect(positiveHits.length).toBe(1);
    expect(positiveHits[0]).toMatch(/"PGPASSWORD=identuum_idp_ce_local_default"/);
  });
});

describe("upgrade-backup-live spec: opt-in gate", () => {
  it("auto-skips when IDENTUUM_E2E_LIVE_UPGRADE_BACKUP is unset", () => {
    expect(SPEC_CODE).toContain("IDENTUUM_E2E_LIVE_UPGRADE_BACKUP");
    expect(SPEC_CODE).toMatch(/test\.skip\(!LIVE_GATE/);
  });

  it("ports and project default to documented values", () => {
    expect(SPEC_CODE).toMatch(/IDP_PORT[^\n]*\?\?\s*"7129"/);
    expect(SPEC_CODE).toMatch(/idp-ce-upgrade-backup-playwright-20260617/);
  });
});

describe("upgrade-backup-live spec: same-origin / localhost discipline", () => {
  it("browser-side requests use relative paths, not direct identuum-idp", () => {
    // page.goto / page.request.get calls in the spec use relative
    // URLs (`/`, `/upgrade`, `/login`) — they resolve against the
    // Playwright baseURL.
    expect(SPEC_CODE).not.toMatch(/page\.goto\(\s*["']https?:\/\/identuum-idp/);
    expect(SPEC_CODE).not.toMatch(/page\.goto\(\s*["']https?:\/\/127\.0\.0\.1:7113/);
  });

  it("backend helpers use the env-derived IDP_BASE constant only", () => {
    // No hard-coded IDP host:port literal inside backend helpers.
    expect(SPEC_CODE).not.toMatch(/curl[^"']+https?:\/\/identuum-idp:7113/);
  });
});

describe("upgrade-backup-live spec: metadata-only assertions", () => {
  const positiveCode = SPEC_CODE.split("\n")
    .filter((line) => !line.includes(".not.toContain") && !line.includes(".not.toMatch"))
    .join("\n");
  for (const fragment of ["CREATE TABLE", "INSERT INTO", "COPY ", "pg_dump --format"]) {
    it(`spec does not assert ${JSON.stringify(fragment)} positively`, () => {
      expect(positiveCode).not.toContain(fragment);
    });
  }
});

describe("upgrade-backup-live spec: token redaction posture", () => {
  it("the only token-shaped read is from the runtime-only file", () => {
    // The only readFileSync call against the token file is the one
    // loadUpgradeToken helper; spec body must use it, not inline
    // its own reader.
    expect(SPEC_CODE).toMatch(/readFileSync\(TOKEN_FILE/);
    expect(SPEC_CODE).toMatch(/loadUpgradeToken/);
  });

  it("the token is never console.logged or echoed via process.stdout.write", () => {
    expect(SPEC_CODE).not.toMatch(/console\.(log|info|debug|warn)\(\s*token/);
    expect(SPEC_CODE).not.toMatch(/process\.stdout\.write\(\s*token/);
  });

  it("the token-shaped value is forwarded directly to the password input via .fill()", () => {
    // The token is read into a const and passed straight to the
    // input fill — never logged, never serialised.
    expect(SPEC_CODE).toMatch(/getByTestId\("upgrade-token-input"\)\.fill\(token\)/);
  });
});

describe("upgrade-backup-live harness: up.sh discipline", () => {
  it("never echoes the upgrade-token plaintext via echo / printf", () => {
    // The capture path uses redirection into a mode-0600 file:
    //   $COMPOSE exec ... cat /app/data/upgrade-token.txt > $SMOKE_DIR/upgrade-token.txt
    // The script must NEVER `echo "$TOKEN"` or `printf "%s" "$TOKEN"`.
    expect(UP).not.toMatch(/echo\s+"\$TOKEN"/);
    expect(UP).not.toMatch(/printf[^\n]+\$TOKEN/);
  });

  it("captures the upgrade-token to a mode-0600 file under the scratch dir", () => {
    expect(UP).toContain("upgrade-token.txt");
    expect(UP).toMatch(/chmod\s+0600\s+"\$\{SMOKE_DIR\}\/upgrade-token\.txt"/);
  });

  it("uses a unique project name + scratch dir", () => {
    expect(UP).toContain("idp-ce-upgrade-backup-playwright-20260617");
    expect(UP).toMatch(/PROJECT_NAME[^\n]*=/);
    expect(UP).toMatch(/SMOKE_DIR[^\n]*=/);
  });

  it("uses unique host ports (7129 IDP / 7130 UI) by default and unpublishes Postgres", () => {
    expect(UP).toContain("7129");
    expect(UP).toContain("7130");
    expect(UP).toContain("ports: !override []"); // postgres host port stripped
  });

  it("never bakes the DB password into a positive log line", () => {
    // The DB password literal can legitimately appear as the
    // PGPASSWORD env value passed to the `docker compose exec` for
    // seeding. It MUST NOT appear in any echo / printf line.
    const positiveLines = UP.split("\n").filter(
      (line) =>
        !line.trimStart().startsWith("#") && (line.includes("echo ") || line.includes("printf "))
    );
    for (const line of positiveLines) {
      expect(line).not.toContain("identuum_idp_ce_local_default");
    }
  });
});

describe("upgrade-backup-live harness: down.sh discipline", () => {
  it("authorises docker compose down -v for the throwaway project only", () => {
    expect(DOWN).toMatch(/docker compose -p "?\$\{?PROJECT_NAME\}?"?[^\n]*down -v|down -v/);
    expect(DOWN).toContain("idp-ce-upgrade-backup-playwright-20260617");
  });

  it("zero-fills + unlinks the token file before unlink", () => {
    expect(DOWN).toMatch(/dd[^\n]+upgrade-token\.txt[^\n]+/);
    expect(DOWN).toMatch(/rm -f[^\n]+upgrade-token\.txt/);
  });
});

describe("upgrade-backup-live harness: oss-shape.sql discipline", () => {
  it("seeds non-secret marker rows for post-apply preservation checks", () => {
    expect(SQL).toContain("pw-live-smoke-client-1");
    expect(SQL).toContain("pw-live-smoke-kid-1");
    expect(SQL).toContain("pw-live-smoke-validator-1");
  });

  it("does not embed a real password / DSN", () => {
    expect(SQL).not.toMatch(/postgres(?:ql)?:\/\/[^@\s/]*:[^@\s/]+@/);
    expect(SQL).not.toContain("identuum_idp_ce_local_default");
    expect(SQL).not.toMatch(/[A-Z2-7]{52}/); // upgrade-token shape
  });
});

describe("upgrade-backup-live wrapper: run-upgrade-backup-live.sh discipline", () => {
  it("invokes the up + down harness scripts by stable filename", () => {
    expect(RUN).toContain("upgrade-backup-live-up.sh");
    expect(RUN).toContain("upgrade-backup-live-down.sh");
  });

  it("invokes the live spec by its stable relative path", () => {
    expect(RUN).toContain("e2e/upgrade-backup-live.spec.ts");
  });

  it("traps EXIT/INT/TERM/HUP so teardown always runs", () => {
    expect(RUN).toMatch(/trap\s+cleanup\s+EXIT\s+INT\s+TERM\s+HUP/);
  });

  it("teardown function calls the down script and tolerates failure", () => {
    expect(RUN).toMatch(/cleanup\(\)\s*\{[\s\S]*?\$DOWN_SCRIPT[\s\S]*?\|\| true/);
  });

  it("propagates the Playwright exit code rather than masking failures", () => {
    expect(RUN).toMatch(/PLAYWRIGHT_EXIT=\$\?/);
    expect(RUN).toMatch(/exit\s+"\$PLAYWRIGHT_EXIT"/);
  });

  it("never echoes the upgrade-token plaintext via echo/printf", () => {
    expect(RUN).not.toMatch(/echo\s+"\$TOKEN"/);
    expect(RUN).not.toMatch(/printf[^\n]+\$TOKEN/);
    // The runner explicitly states "paths only; no token VALUE printed".
    expect(RUN).toMatch(/no token VALUE/i);
  });

  it("does not bake the DB password into the runner", () => {
    expect(RUN).not.toContain("identuum_idp_ce_local_default");
  });

  it("exports PROJECT_NAME + SMOKE_DIR before invoking the harness so down.sh targets the same project", () => {
    expect(RUN).toMatch(/export\s+PROJECT_NAME/);
    expect(RUN).toMatch(/export\s+SMOKE_DIR/);
  });

  it("uses set -eu so an early step failure surfaces", () => {
    expect(RUN).toMatch(/^set\s+-eu\b/m);
  });
});

describe("upgrade-backup-live target: Makefile + package.json wiring", () => {
  it("Makefile exposes a verify-live-upgrade-backup target on .PHONY", () => {
    expect(MAKEFILE).toMatch(/\.PHONY:[^\n]*\bverify-live-upgrade-backup\b/);
    expect(MAKEFILE).toMatch(/^verify-live-upgrade-backup:/m);
  });

  it("Makefile target invokes the wrapper script (single-command surface)", () => {
    expect(MAKEFILE).toMatch(/verify-live-upgrade-backup:[\s\S]*?run-upgrade-backup-live\.sh/);
  });

  it("Makefile target is NOT folded into the default `verify` recipe", () => {
    // The `verify` recipe must remain biome + tsc + vitest only.
    const verifyMatch = MAKEFILE.match(/^verify:\s*\n((?:\t.*\n)+)/m);
    expect(verifyMatch).not.toBeNull();
    if (!verifyMatch) return;
    expect(verifyMatch[1]).not.toContain("run-upgrade-backup-live.sh");
    expect(verifyMatch[1]).not.toContain("verify-live-upgrade-backup");
    expect(verifyMatch[1]).not.toContain("upgrade-backup-live");
  });

  it("Makefile target documents the opt-in nature in a leading help comment", () => {
    // ## verify-live-upgrade-backup: ... must be present.
    expect(MAKEFILE).toMatch(/##\s+verify-live-upgrade-backup:/);
  });

  it("package.json registers an e2e:upgrade-backup-live script alias", () => {
    const parsed = JSON.parse(PACKAGE_JSON) as { scripts?: Record<string, string> };
    expect(parsed.scripts?.["e2e:upgrade-backup-live"]).toBeDefined();
    expect(parsed.scripts?.["e2e:upgrade-backup-live"]).toMatch(/run-upgrade-backup-live\.sh/);
  });

  it("package.json keeps the default e2e script unchanged (no auto opt-in)", () => {
    const parsed = JSON.parse(PACKAGE_JSON) as { scripts?: Record<string, string> };
    expect(parsed.scripts?.e2e).toBe("playwright test");
  });
});

describe("upgrade-backup-live target: e2e/README.md documentation", () => {
  it("documents the make verify-live-upgrade-backup invocation", () => {
    expect(E2E_README).toMatch(/make\s+verify-live-upgrade-backup/);
  });

  it("documents the pnpm e2e:upgrade-backup-live invocation", () => {
    expect(E2E_README).toMatch(/pnpm\s+e2e:upgrade-backup-live/);
  });

  it("names the wrapper script the two surfaces converge on", () => {
    expect(E2E_README).toMatch(/run-upgrade-backup-live\.sh/);
  });

  it("documents the opt-in gate variable name", () => {
    expect(E2E_README).toMatch(/IDENTUUM_E2E_LIVE_UPGRADE_BACKUP/);
  });

  it("documents the always-on teardown discipline (trap)", () => {
    expect(E2E_README).toMatch(/\btrap\b/);
  });

  it("documents the throwaway Compose project naming + scratch dir discipline", () => {
    expect(E2E_README).toMatch(/idp-ce-upgrade-backup-playwright-20260617/);
  });

  it("documents the host-port choices (7129 IDP, 7130 UI)", () => {
    expect(E2E_README).toMatch(/\b7129\b/);
    expect(E2E_README).toMatch(/\b7130\b/);
  });

  it("documents that the standing :7104 dev container is NOT touched", () => {
    expect(E2E_README).toMatch(/7104/);
  });

  it("does NOT inline a token plaintext literal in the documentation", () => {
    expect(E2E_README).not.toMatch(/[A-Z2-7]{50,}/);
  });

  it("does NOT inline a postgres DSN with credentials in the documentation", () => {
    expect(E2E_README).not.toMatch(/postgres(?:ql)?:\/\/[^@\s"]+:[^@\s"]+@/);
  });
});
