import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Source-invariant tests for scripts/smoke-org-import-execute.mjs
// ---------------------------------------------------------------------------
//
// The harness is operator-driven and runs out-of-band, so we can't unit-test
// the live HTTP flow here. What we CAN guarantee at the source level is that
// the safety contract is intact: no file reads for credentials, no fallback
// creds, dry_run=false only behind both gates, redaction helper present, no
// bulk path, no token/cookie logging.
//
// These tests are pure string scans of the script source. They will fail
// loudly if a future change weakens any of the contract invariants.

function readSrc(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url).pathname, "utf-8");
}

const HARNESS_PATH = "../../scripts/smoke-org-import-execute.mjs";
const RUNBOOK_PATH = "../../docs/ORG_IMPORT_FIRST_EXECUTE_SMOKE.md";

// Strip line/block comments before scanning code-only invariants. The
// safety contract is documented heavily in the script's docstring; we
// strip docstrings so a comment that *describes* a forbidden pattern
// doesn't false-positive against the code-level scan.
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function expectNotNull<T>(
  value: T | null,
  message = "expected non-null value"
): asserts value is T {
  expect(value, message).not.toBeNull();
  if (value === null) {
    throw new Error(message);
  }
}

describe("smoke-org-import-execute.mjs — file presence and shape", () => {
  it("harness script exists and is non-trivial", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain("smoke-org-import-execute");
  });

  it("runbook doc exists and references the script", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc.length).toBeGreaterThan(1000);
    expect(doc).toContain("scripts/smoke-org-import-execute.mjs");
    expect(doc).toContain("IDENTUUM_CONFIRM_ORG_ONLY");
    expect(doc).toContain("--execute-one");
  });
});

describe("smoke-org-import-execute.mjs — file/credential safety", () => {
  it("script does not auto-discover credential files (code-only)", () => {
    // Strip comments first. The safety-contract docstring legitimately
    // names dev.env.local / .env / .netrc as files the script must NOT
    // auto-discover; those mentions are documentation.
    //
    // The single allowed file-read entry point is readFileSync inside
    // parseEnvFile(), which only runs when the operator explicitly
    // passes `--env-file <path>`. A dedicated test below verifies that
    // readFileSync is called at most once and never against an
    // auto-discovered filename. createReadStream and other read helpers
    // remain forbidden.
    const code = codeOnly(readSrc(HARNESS_PATH));
    expect(code).not.toMatch(/createReadStream/);
    expect(code).not.toMatch(/readdir/i);
    expect(code).not.toContain("require('fs')");
    expect(code).not.toContain('require("fs")');
    // Auto-discovery filenames must NOT appear anywhere in code.
    expect(code).not.toContain("dev.env.local");
    expect(code).not.toContain(".env.local");
    expect(code).not.toContain(".netrc");
    expect(code).not.toContain(".envrc");
  });

  it("script contains no fallback credentials", () => {
    const src = readSrc(HARNESS_PATH);
    const code = codeOnly(src);
    // No assignment of password/token/secret to a string literal anywhere
    // outside comments. Pattern: identifier ending in password/token/secret
    // assigned to a non-empty string literal.
    expect(code).not.toMatch(/(password|secret|token|bearer)\s*=\s*"[^"]+"/i);
    expect(code).not.toMatch(/(password|secret|token|bearer)\s*=\s*'[^']+'/i);
    // No magic-default Bearer values.
    expect(code).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
  });

  it("script never prints cookies/tokens/headers/passwords/secrets", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // No log of headers wholesale or of raw Bearer / Cookie: payloads.
    expect(code).not.toMatch(/console\.log\([^)]*authHeader/);
    expect(code).not.toMatch(/log\([^)]*headers/);
    expect(code).not.toMatch(/log\([^)]*Bearer/);
    expect(code).not.toMatch(/log\([^)]*Cookie:/);
    // The script may legitimately use env.idpAuthHeader / env.agAuthHeader
    // inside a ternary to print "YES"/"NO" indicating presence. It also
    // legitimately interpolates env.agOperatorToken into the Authorization
    // header line construction. The actual safety rule: NEVER pass these
    // values into a log() or err() call.
    //
    // Scan log()/err() calls for template literals containing any of the
    // sensitive identifiers.
    const sensitiveIdentifiers = [
      "idpAuthHeader",
      "agAuthHeader",
      "agOperatorToken",
      "siteAdminPassword",
      "agOperatorPassword",
      "siteAdminTotpSecret",
    ];
    const logCalls = code.match(/(?:log|err)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      for (const id of sensitiveIdentifiers) {
        // A ternary `${env.X ? "..." : "..."}` is allowed because the
        // value is reduced to a literal string before interpolation.
        // A bare `${env.X}` is forbidden.
        const bareRe = new RegExp(`\\$\\{\\s*env\\.${id}\\s*\\}`);
        expect(call).not.toMatch(bareRe);
      }
    }
  });
});

describe("smoke-org-import-execute.mjs — execute gating", () => {
  it("script declares both gates and references them in code", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("--execute-one");
    expect(src).toContain("IDENTUUM_CONFIRM_ORG_ONLY");
    expect(src).toContain("organization_only");
  });

  it("dry_run: false is sent only inside a code path guarded by the execute gate", () => {
    const src = readSrc(HARNESS_PATH);
    // Locate every occurrence of `dry_run: false` (the literal payload key).
    // Each must be preceded somewhere upstream in the same function by the
    // execute-one + confirm-org-only gate. We confirm structurally by
    // verifying the gate appears textually before the first `dry_run: false`.
    const code = codeOnly(src);
    const dryFalseIdx = code.indexOf("dry_run: false");
    expect(dryFalseIdx).toBeGreaterThan(-1);
    const flagsIdx = code.indexOf("flags.executeOne");
    const confirmIdx = code.indexOf('env.confirmOrgOnly !== "organization_only"');
    expect(flagsIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    // Both gates must appear before the first dry_run=false literal.
    expect(flagsIdx).toBeLessThan(dryFalseIdx);
    expect(confirmIdx).toBeLessThan(dryFalseIdx);
    // The script must contain exactly ONE dry_run: false literal in code
    // (the single execute request body). Any additional occurrence would
    // be a second mutation path.
    const matches = code.match(/dry_run:\s*false/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("dry_run: true is sent only inside the dry-run preview request", () => {
    const src = readSrc(HARNESS_PATH);
    const code = codeOnly(src);
    const matches = code.match(/dry_run:\s*true/g) ?? [];
    // Exactly one dry-run preview request body in the entire script.
    expect(matches.length).toBe(1);
  });
});

describe("smoke-org-import-execute.mjs — candidate safety", () => {
  it("script excludes the AG/IDP system organization", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("00000000-0000-0000-0000-000000000001");
    expect(src).toContain("isSystemOrg");
  });

  it("script declares production-looking exclusion regex", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("PRODUCTION_HINT_REGEX");
    expect(src).toContain("looksProduction");
  });

  it("script declares disposable-name preference", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("DISPOSABLE_NAME_REGEX");
    expect(src).toContain("looksDisposable");
  });

  it("script refuses link-existing when matched AG candidate is already linked", () => {
    const src = readSrc(HARNESS_PATH);
    // The selection helper checks link_status === "linked" and the
    // linked_idp_organization_id non-empty fields before accepting a
    // link-existing target.
    expect(src).toMatch(/match\.link_status === "linked"/);
    expect(src).toMatch(/match\.linked_idp_organization_id !== ""/);
  });
});

describe("smoke-org-import-execute.mjs — no bulk, no retry", () => {
  it("script contains no bulk/import-all/loop-over-candidates path", () => {
    const src = readSrc(HARNESS_PATH);
    const code = codeOnly(src);
    // No identifiers suggesting bulk operations.
    for (const pattern of [
      "importAll",
      "bulkImport",
      "for (const cand",
      "for (const idp of idpCandidates",
      "Promise.all(idpCandidates",
      "Promise.all(eligible",
    ]) {
      expect(code).not.toContain(pattern);
    }
  });

  it("execute body is constructed at most once in the script", () => {
    const src = readSrc(HARNESS_PATH);
    const code = codeOnly(src);
    // `execReqBody` is the execute payload variable. It must be declared
    // exactly once and referenced inside a single fetch call.
    const declMatches = code.match(/const\s+execReqBody\b/g) ?? [];
    expect(declMatches.length).toBe(1);
  });

  it("script does not retry the execute request (code-only)", () => {
    // The harness uses the word "retry" in operator-facing safety log
    // messages ("not retrying.", "do not retry."). Those are NOT retry
    // code — they are explicit refusals. We check for actual retry
    // CODE patterns instead: a loop around the execute fetch, or a
    // recursive call to main().
    const code = codeOnly(readSrc(HARNESS_PATH));
    expect(code).not.toMatch(/while[\s\S]{0,400}import-from-idp/);
    expect(code).not.toMatch(/for[\s\S]{0,400}import-from-idp/);
    // No second call to the import-from-idp endpoint anywhere in code.
    const importCallMatches = code.match(/\/api\/v1\/organizations\/import-from-idp/g) ?? [];
    // The script has exactly TWO references to the endpoint path: one
    // for the dry-run POST, one for the execute POST. Anything more is
    // a retry or chained mutation.
    expect(importCallMatches.length).toBe(2);
    // main() must be called exactly once at module load (the .catch tail).
    const mainCallMatches = code.match(/^main\(\)/gm) ?? [];
    expect(mainCallMatches.length).toBe(1);
  });
});

describe("smoke-org-import-execute.mjs — redaction", () => {
  it("script defines an ID-redaction helper that returns first 8 chars + ellipsis", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("redactID");
    // The trim-to-8 + ellipsis pattern.
    expect(src).toMatch(/\$\{trimmed\.slice\(0,\s*8\)\}…/);
  });

  it("printActionSummary redacts IDP and AG org IDs", () => {
    const src = readSrc(HARNESS_PATH);
    // The summary printer must wrap idp_organization_id and ag_organization_id
    // in redactID() rather than emitting the raw string.
    expect(src).toMatch(/redactID\(body\.idp_organization_id/);
    expect(src).toMatch(/redactID\(body\.ag_organization_id/);
  });

  it("candidate row printer wraps both ids in redactID", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toMatch(/printCandidates[\s\S]{0,400}redactID\(c\.id\)/);
    expect(src).toMatch(/redactID\(c\.linked_idp_organization_id\)/);
  });
});

describe("smoke-org-import-execute.mjs — forbidden-field scan", () => {
  it("script scans response bodies for a wide set of sensitive field names", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("FORBIDDEN_FIELD_NAMES");
    expect(src).toContain("scanForbiddenFields");
    // The deny-list must include the major categories.
    for (const term of [
      "users",
      "passwords",
      "mfa_secret",
      "role_bindings",
      "sessions",
      "tokens",
      "license",
      "signature",
      "ciphertext",
      "private_key",
    ]) {
      // Each must appear as a string literal inside the FORBIDDEN_FIELD_NAMES array.
      const re = new RegExp(`"${term}"`);
      expect(src).toMatch(re);
    }
  });
});

// ---------------------------------------------------------------------------
// Automated login mode — new in 20260522-org-import-harness-automated-login
// ---------------------------------------------------------------------------

describe("smoke-org-import-execute.mjs — automated login mode", () => {
  it("automated login env names are all read through the env helper", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // Allowed imports: node:process, node:crypto, plus node:fs+node:path
    // (used ONLY for the explicit --env-file flag — automatic discovery
    // is verified absent by a dedicated test below).
    expect(code).toMatch(/import\s+process\s+from\s+"node:process"/);
    expect(code).toMatch(/import\s+\{\s*createHmac\s*\}\s+from\s+"node:crypto"/);
    expect(code).toMatch(/import\s+\{\s*readFileSync\s*\}\s+from\s+"node:fs"/);
    expect(code).toMatch(/import\s+\{\s*basename\s*\}\s+from\s+"node:path"/);
    // readEnv() must always check process.env. Source-level scan: the
    // helper uses a `get(name)` closure that pulls process.env[name] first.
    expect(code).toMatch(/process\.env\[name\]/);
    // Every new login-related env name must be looked up by name.
    for (const name of [
      "IDENTUUM_SITE_ADMIN_EMAIL",
      "IDENTUUM_SITE_ADMIN_PASSWORD",
      "IDENTUUM_SITE_ADMIN_TOTP_SECRET",
      "IDENTUUM_AG_OPERATOR_EMAIL",
      "IDENTUUM_AG_OPERATOR_PASSWORD",
      "IDENTUUM_AG_OPERATOR_TOKEN",
    ]) {
      expect(code).toContain(name);
    }
  });

  it("manual auth-header fallback is preserved (precedence 1)", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    expect(code).toContain("IDENTUUM_IDP_AUTH_HEADER");
    expect(code).toContain("IDENTUUM_AG_AUTH_HEADER");
    // resolveAuthHeaders() must check the manual header BEFORE attempting
    // automated login on each side.
    const fn = code.match(/async function resolveAuthHeaders\([\s\S]*?\n\}/);
    expectNotNull(fn);
    const body = fn[0];
    // IDP: manual header check comes first, then automated-login check.
    const idpManualIdx = body.indexOf("env.idpAuthHeader");
    const idpLoginIdx = body.indexOf("siteAdminEmail");
    expect(idpManualIdx).toBeGreaterThan(-1);
    expect(idpLoginIdx).toBeGreaterThan(-1);
    expect(idpManualIdx).toBeLessThan(idpLoginIdx);
    // AG: manual header → operator token → automated login.
    const agManualIdx = body.indexOf("env.agAuthHeader");
    const agTokenIdx = body.indexOf("agOperatorToken");
    const agLoginIdx = body.indexOf("agOperatorEmail");
    expect(agManualIdx).toBeGreaterThan(-1);
    expect(agTokenIdx).toBeGreaterThan(-1);
    expect(agLoginIdx).toBeGreaterThan(-1);
    expect(agManualIdx).toBeLessThan(agTokenIdx);
    expect(agTokenIdx).toBeLessThan(agLoginIdx);
  });

  it("login helpers use only the official endpoint paths", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("/api/v1/auth/login");
    expect(src).toContain("/api/v1/auth/login/mfa");
    // AG login endpoint is /login on the identity surface — the script
    // builds the URL via a template literal `${env.agIdentityUrl}/login`.
    expect(src).toContain("${env.agIdentityUrl}/login");
  });

  it("no bypass paths or auth-disable flags exist", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // No bypass / skip-auth / disable-mfa / insecure flags.
    for (const pattern of [
      "auth_bypass",
      "auth-bypass",
      "SkipAuth",
      "skipAuth",
      "skip_auth",
      "DisableAuth",
      "disable_auth",
      "InsecureMFABypass",
      "INSECURE_BYPASS",
      "auth_disable",
    ]) {
      expect(code).not.toContain(pattern);
    }
  });
});

// ---------------------------------------------------------------------------
// --env-file behavior — new in 20260522-org-import-harness-explicit-env-file
// ---------------------------------------------------------------------------

describe("smoke-org-import-execute.mjs — explicit env-file flag", () => {
  it("script uses fs only for explicit --env-file (no auto-discovery)", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // The single allowed fs entry point is readFileSync, used inside
    // parseEnvFile() which only runs when flags.envFile is truthy.
    expect(code).toMatch(/readFileSync\(\s*path\b/);
    // Auto-discovery filenames must never appear in code.
    for (const name of [
      ".env.local",
      ".envrc",
      ".env.production",
      "dev.env.local",
      "dev.env",
      "~/.netrc",
    ]) {
      expect(code).not.toContain(name);
    }
    // No dotenv library, no fallback discovery helper.
    expect(code).not.toContain("dotenv");
    expect(code).not.toContain("findUp");
    expect(code).not.toContain("autoLoad");
    expect(code).not.toContain("loadEnvFile(");
    // readFileSync is called at most once (the parseEnvFile entry).
    const matches = code.match(/readFileSync\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("CLI accepts --env-file <path> and POSIX -- separator", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    expect(code).toMatch(/a === "--env-file"/);
    expect(code).toMatch(/a === "--execute-one"/);
    // POSIX `--` end-of-options marker is a no-op so operators can write
    // `node scripts/... -- --env-file <path>` on Node ≥20.6 (where Node
    // would otherwise consume --env-file at its own CLI level).
    expect(code).toMatch(/a === "--"/);
    // --env-file without a path sets envFileMissingPath.
    expect(code).toContain("envFileMissingPath");
  });

  it("env file path is logged by basename only, never the full path", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // Startup log uses `basename(flags.envFile)` in the PROVIDED branch.
    expect(code).toMatch(/PROVIDED \(\$\{envFileBasename\}\)/);
    // The full path is never interpolated into a log/err call.
    const logCalls = code.match(/(?:log|err)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{\s*flags\.envFile\s*\}/);
      expect(call).not.toMatch(/\$\{\s*path\s*\}/);
    }
  });

  it("env-file VALUES are never logged", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // The parser stores values in `value` then writes them into `out[key]`.
    // No log/err call may interpolate `value`, `out`, or `fileEnv` (the
    // accumulated map returned from parseEnvFile).
    const logCalls = code.match(/(?:log|err)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{\s*value\s*\}/);
      expect(call).not.toMatch(/\$\{[^}]*fileEnv[^}]*\}/);
      expect(call).not.toMatch(/\$\{[^}]*\bout\b[^}]*\}/);
    }
  });

  it("env-file parser rejects malformed lines without printing values", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // Error messages contain the 1-based line number but not the raw line.
    // Source-level: the throw() calls in parseEnvFile reference `i + 1`
    // but never `lines[i]`, `trimmed`, `value`, or `key`.
    const parserMatch = code.match(/function parseEnvFile[\s\S]*?\n\}/);
    expectNotNull(parserMatch);
    const body = parserMatch[0];
    const throwLines = body.match(/throw new Error\([^)]*\)/g) ?? [];
    expect(throwLines.length).toBeGreaterThan(0);
    for (const t of throwLines) {
      expect(t).not.toMatch(/\$\{\s*lines\[/);
      expect(t).not.toMatch(/\$\{\s*trimmed\s*\}/);
      expect(t).not.toMatch(/\$\{\s*value\s*\}/);
      expect(t).not.toMatch(/\$\{\s*key\s*\}/);
    }
  });

  it("env-file parser does not evaluate shell commands or expand ${VAR}", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    const parserMatch = code.match(/function parseEnvFile[\s\S]*?\n\}/);
    expectNotNull(parserMatch);
    const body = parserMatch[0];
    // No child_process, no exec, no spawn — the parser does not invoke
    // any shell at any time.
    expect(body).not.toContain("child_process");
    expect(body).not.toContain("execSync");
    expect(body).not.toContain("spawnSync");
    // No shell-style variable expansion logic.
    expect(body).not.toMatch(/\$\{[A-Z_]+\}/);
    expect(body).not.toContain("substring(");
    // The whole script likewise must not introduce child_process anywhere.
    expect(code).not.toContain("child_process");
  });

  it("process.env wins over env-file (precedence documented in readEnv)", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // readEnv builds a `get(name)` closure that checks process.env FIRST
    // and only falls back to fileEnv when the shell value is empty.
    const readEnvBlock = code.match(/function readEnv\(fileEnv\)[\s\S]*?\n\}/);
    expectNotNull(readEnvBlock);
    const body = readEnvBlock[0];
    const processIdx = body.indexOf("process.env[name]");
    const fileEnvIdx = body.indexOf("fileEnv[name]");
    expect(processIdx).toBeGreaterThan(-1);
    expect(fileEnvIdx).toBeGreaterThan(-1);
    expect(processIdx).toBeLessThan(fileEnvIdx);
  });

  it("env-file branch is gated on flags.envFile being set", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // parseEnvFile is called only inside `if (flags.envFile)`.
    expect(code).toMatch(/if\s*\(\s*flags\.envFile\s*\)\s*\{[\s\S]{0,400}parseEnvFile/);
  });
});

describe("ORG_IMPORT_FIRST_EXECUTE_SMOKE.md — env-file content", () => {
  it("runbook recommends .smoke-org-import.env as the canonical filename", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc).toContain(".smoke-org-import.env");
    expect(doc).toContain("--env-file");
    // POSIX `--` separator is documented for Node ≥20.6.
    expect(doc).toMatch(/-- --env-file/);
  });

  it("runbook explicitly says auto-discovery does not happen", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc).toMatch(/no automatic discovery/i);
    expect(doc).toMatch(/process\.env/i);
    // Precedence note must be present.
    expect(doc).toMatch(/process environment values always WIN/i);
  });
});

describe(".gitignore — operator-supplied smoke env files", () => {
  it(".gitignore excludes .smoke-org-import.env and *.smoke.env", () => {
    const fs = require("node:fs");
    const gi = fs.readFileSync(new URL("../../.gitignore", import.meta.url).pathname, "utf-8");
    expect(gi).toContain(".smoke-org-import.env");
    expect(gi).toContain("*.smoke.env");
  });
});

describe("smoke-org-import-execute.mjs — cookie/token handling", () => {
  it("login uses an in-memory token/cookie value with no disk persistence", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // No file writes anywhere in the script.
    expect(code).not.toMatch(/writeFile/);
    expect(code).not.toMatch(/createWriteStream/);
    expect(code).not.toMatch(/appendFile/);
    // No cookie-jar library imports — the harness uses a single in-memory
    // header line per side, not a multi-cookie persistent jar.
    expect(code).not.toContain("tough-cookie");
    expect(code).not.toContain("cookie-jar");
    expect(code).not.toContain("cookiejar");
  });

  it("Set-Cookie values are never read or logged", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // The harness extracts tokens from the JSON body, not from Set-Cookie.
    // Any reference to Set-Cookie / getSetCookie would indicate a code
    // path that handles cookies in a way that could be logged.
    expect(code).not.toMatch(/[Ss]et-?[Cc]ookie/);
    expect(code).not.toContain("getSetCookie");
    expect(code).not.toContain("headers.raw");
  });
});

describe("smoke-org-import-execute.mjs — TOTP safety", () => {
  it("TOTP generation uses node:crypto stdlib only", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    expect(code).toContain("generateTOTP");
    expect(code).toContain("createHmac");
    // No third-party TOTP/OTP library.
    expect(code).not.toContain("otplib");
    expect(code).not.toContain("speakeasy");
    expect(code).not.toContain("notp");
    expect(code).not.toContain("hotp");
  });

  it("TOTP code is never logged", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // Scan log()/err() calls for bare interpolation of the local TOTP
    // `code` identifier or the source secret.
    const logCalls = code.match(/(?:log|err)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{\s*code\s*\}/);
      expect(call).not.toMatch(/\$\{\s*env\.siteAdminTotpSecret\s*\}/);
    }
  });

  it("password env values are never interpolated into log output", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // The legitimate place a password/token interpolates is into a
    // request body or header (e.g. `Authorization: Bearer ${env.agOperatorToken}`).
    // The safety rule is therefore narrower: log()/err() calls must not
    // bare-interpolate any of the credential-bearing identifiers.
    const sensitive = [
      "siteAdminPassword",
      "agOperatorPassword",
      "agOperatorToken",
      "siteAdminTotpSecret",
    ];
    const logCalls = code.match(/(?:log|err)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      for (const id of sensitive) {
        const bareRe = new RegExp(`\\$\\{\\s*env\\.${id}\\s*\\}`);
        expect(call).not.toMatch(bareRe);
        // Concatenation forms are also forbidden in log calls.
        const concatRe = new RegExp(`\\+\\s*env\\.${id}\\b`);
        expect(call).not.toMatch(concatRe);
      }
    }
  });
});

describe("ORG_IMPORT_FIRST_EXECUTE_SMOKE.md — runbook content", () => {
  it("runbook documents the automated login env var set", () => {
    const doc = readSrc(RUNBOOK_PATH);
    for (const name of [
      "IDENTUUM_SITE_ADMIN_EMAIL",
      "IDENTUUM_SITE_ADMIN_PASSWORD",
      "IDENTUUM_SITE_ADMIN_TOTP_SECRET",
      "IDENTUUM_AG_OPERATOR_EMAIL",
      "IDENTUUM_AG_OPERATOR_PASSWORD",
      "IDENTUUM_AG_OPERATOR_TOKEN",
      "IDENTUUM_CONFIRM_ORG_ONLY",
    ]) {
      expect(doc).toContain(name);
    }
    // Primary workflow uses an explicit env file.
    expect(doc).toContain(".smoke-org-import.env");
    expect(doc).toContain("--env-file");
  });

  it("runbook documents manual-header mode as fallback only", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc).toMatch(/fallback/i);
    // The manual mode reference must still mention both env vars.
    expect(doc).toContain("IDENTUUM_IDP_AUTH_HEADER");
    expect(doc).toContain("IDENTUUM_AG_AUTH_HEADER");
  });

  it("runbook documents the exit-code map including the new login-failure code 6", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc).toContain("`6`");
    expect(doc).toMatch(/automated login failed/i);
  });
});

// ---------------------------------------------------------------------------
// Disposable-only selection — new in 20260522-org-import-harness-
// disposable-only-selection
// ---------------------------------------------------------------------------

describe("smoke-org-import-execute.mjs — disposable-only candidate selection", () => {
  it("DISPOSABLE_NAME_REGEX includes the expanded marker set", () => {
    const src = readSrc(HARNESS_PATH);
    // The regex must include each marker that local fixtures (Playwright,
    // recovery, e2e, fixture, staging, throwaway) commonly use, plus the
    // classic test/demo/local/sandbox/smoke/dev/qa/disposable/tmp/scratch.
    for (const term of [
      "test",
      "demo",
      "local",
      "sandbox",
      "smoke",
      "disposable",
      "tmp",
      "scratch",
      "dev",
      "qa",
      "playwright",
      "recovery",
      "fixture",
      "e2e",
      "staging",
      "throwaway",
    ]) {
      expect(src).toMatch(new RegExp(`DISPOSABLE_NAME_REGEX[\\s\\S]*?\\b${term}\\b`));
    }
  });

  it("PRODUCTION_HINT_REGEX vetoes common legal-entity suffixes", () => {
    const src = readSrc(HARNESS_PATH);
    // The PRODUCTION_HINT_REGEX is now a backstop; selection rejects
    // anything not positively disposable, but this regex still catches
    // obvious company-name patterns. It must include the corporate suffix
    // set the task called out (Inc/LLC/Ltd/GmbH/SA/SAS/BV/AG/Oy/AB/AŞ/AS/
    // Company/Corp/Enterprise).
    for (const term of [
      "inc",
      "llc",
      "ltd",
      "gmbh",
      "sas",
      "bv",
      "oy",
      "ab",
      "as",
      "company",
      "corp",
      "enterprise",
    ]) {
      expect(src).toMatch(new RegExp(`PRODUCTION_HINT_REGEX[\\s\\S]*?\\b${term}\\b`));
    }
  });

  it("automatic-selection fallback to 'any eligible' is removed", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // The old fallback comment ("any eligible that would create new") was
    // load-bearing for the dropped P2 fallback. Asserting its absence
    // catches a regression that would silently re-enable the fallback.
    expect(code).not.toContain("any eligible that would create new");
    expect(code).not.toContain("Priority 2: any eligible");
    // chooseCandidate must filter by looksDisposable BEFORE the for-loop.
    // We verify the body contains the disposable filter and does NOT
    // contain a second for-loop that skips looksDisposable.
    const fn = code.match(/function chooseCandidate\([\s\S]*?\n\}/);
    expectNotNull(fn);
    const body = fn[0];
    // Every selection for-loop that produces a `kind: "create"` or
    // `kind: "link_existing"` must originate from the `disposable`
    // pre-filtered array (constructed via .filter that requires
    // looksDisposable(c)). The body must not contain a non-disposable
    // selection branch outside the override block.
    expect(body).toContain("const disposable = idpCandidates.filter");
    expect(body).toMatch(/if \(!looksDisposable\(c\)\) return false/);
    // No `kind: "create"` or `kind: "link_existing"` outside the override
    // block can reference a list other than `disposable`.
    const fallbackPattern = /for \(const c of eligible\)/;
    expect(body).not.toMatch(fallbackPattern);
  });

  it("override env var is exact-id only and validated", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID");
    expect(src).toContain("allowIDPOrgID");
    // isValidUUID helper exists and is invoked on the override value
    // BEFORE selection runs.
    expect(src).toMatch(/function isValidUUID\b/);
    expect(src).toMatch(/!isValidUUID\(env\.allowIDPOrgID\)/);
    // No name-based override exists. The override is matched against IDP
    // candidate IDs only — no helper that finds an IDP candidate by name
    // for override purposes.
    const code = codeOnly(src);
    expect(code).not.toMatch(/IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_NAME/);
    expect(code).not.toMatch(/IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_SLUG/);
    expect(code).not.toMatch(/findIDPByName\b/);
  });

  it("override still rejects system org and already-linked AG match", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    const fn = code.match(/function chooseCandidate\([\s\S]*?\n\}/);
    expectNotNull(fn);
    const body = fn[0];
    // The override branch (overrideIDPID truthy) must contain its own
    // isSystemOrg check and its own already-linked guard.
    const overrideBranch = body.match(
      /if \(typeof overrideIDPID === "string" && overrideIDPID !== ""\)[\s\S]*?\n {2}\}/
    );
    expectNotNull(overrideBranch);
    const ob = overrideBranch[0];
    expect(ob).toContain("isSystemOrg(target)");
    expect(ob).toMatch(/match\.link_status === "linked"/);
    expect(ob).toMatch(/match\.linked_idp_organization_id !== ""/);
  });

  it("override does not bypass execute gates (gate order preserved)", () => {
    const code = codeOnly(readSrc(HARNESS_PATH));
    // Existing source invariants already enforce that:
    //   - `dry_run: false` literal appears exactly once
    //   - it appears textually AFTER both `flags.executeOne` and
    //     the `env.confirmOrgOnly !== "organization_only"` check
    // The override branch sits in chooseCandidate(), which runs BEFORE
    // any dry-run preview. Re-assert here that the override neither
    // touches dry_run nor sets flags.executeOne.
    const fn = code.match(/function chooseCandidate\([\s\S]*?\n\}/);
    expectNotNull(fn);
    const body = fn[0];
    expect(body).not.toContain("dry_run");
    expect(body).not.toContain("executeOne");
    expect(body).not.toContain("confirmOrgOnly");
  });

  it("blocker message tells the operator about the override", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("no disposable safe IDP candidate found");
    expect(src).toContain("IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID");
    expect(src).toMatch(/override still requires the dry-run \+ execute gates/i);
  });

  it("override candidate output is logged as YES/NO and IDs are redacted", () => {
    const src = readSrc(HARNESS_PATH);
    expect(src).toContain("override candidate selected: YES");
    expect(src).toContain("override candidate selected: NO");
    // Selected-candidate output still goes through redactID for both
    // sides. This is the pre-existing redaction-helpers test reinforced.
    expect(src).toMatch(/redactID\(choice\.idp\.id\)/);
    expect(src).toMatch(/redactID\(choice\.ag\.id\)/);
  });

  it("Vestel-style company names are not matched by DISPOSABLE_NAME_REGEX", () => {
    // Source-level: extract the disposable regex literal and run it
    // against the names that motivated this task. The regex must reject
    // Vestel Inc., Acme Corp, Globex, etc. and accept Playwright/recovery/
    // test/demo/sandbox names.
    const src = readSrc(HARNESS_PATH);
    const m = src.match(/const DISPOSABLE_NAME_REGEX\s*=\s*(\/[\s\S]*?\/[gimsuy]*);/);
    expectNotNull(m);
    // Reconstruct the runtime regex from the source literal.
    const regexSrc = m[1];
    const lastSlash = regexSrc.lastIndexOf("/");
    const body = regexSrc.slice(1, lastSlash);
    const flags = regexSrc.slice(lastSlash + 1);
    const re = new RegExp(body, flags);
    // Must NOT match company-looking names.
    for (const n of [
      "Vestel Inc.",
      "Acme Corp",
      "Globex",
      "Initech",
      "Stark Industries",
      "Wayne Enterprises",
      "Umbrella Corporation",
      "Some Holdings Group",
    ]) {
      expect(re.test(n)).toBe(false);
    }
    // Must match disposable names.
    for (const n of [
      "Playwright Expired Recovery Org",
      "Playwright Test Org",
      "Local Smoke Org",
      "Demo Org",
      "Sandbox Org",
      "Test Org",
      "QA Org",
      "Dev Org",
      "Disposable Org",
      "Scratch Org",
      "e2e fixture org",
      "Throwaway scratch",
    ]) {
      expect(re.test(n)).toBe(true);
    }
  });
});

describe("ORG_IMPORT_FIRST_EXECUTE_SMOKE.md — disposable-only selection content", () => {
  it("runbook explains disposable-only automatic selection and documents override", () => {
    const doc = readSrc(RUNBOOK_PATH);
    expect(doc).toMatch(/disposable[-\s]only/i);
    expect(doc).toContain("IDENTUUM_ORG_IMPORT_ALLOW_IDP_ORG_ID");
    // Warning about real customer/production orgs MUST be present.
    expect(doc).toMatch(/do not use[\s\S]*(real customer|production)/i);
    // Warning that override still requires gates.
    expect(doc).toMatch(/override[\s\S]*?(dry-run|execute)/i);
  });
});
