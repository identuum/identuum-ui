/**
 * Tests for the dynamic org-admin Playwright fixture loader at
 * identuum-ui/e2e/helpers/fixture.ts.
 *
 * Scope discipline:
 *   - The loader is a pure Node module — no Playwright runtime, no DOM,
 *     no IDP server required. Vitest runs in `environment: "node"` so
 *     readFileSync / statSync against per-test temp files works directly.
 *   - The loader is companion to the IDP CLI's `cli.FixtureMarker` and
 *     `cli.FixtureSchemaVersion` (identuum-idp/internal/cli/e2e_fixture.go).
 *     A drift between the two sides would silently break every dynamic
 *     Playwright run — these tests pin the loader half.
 *
 * SECURITY:
 *   - Every synthetic fixture value uses the documented neutral
 *     placeholder shapes (e2e-<runID>.test, admin@e2e-<runID>.test).
 *   - Real password / TOTP material is not exercised; the loader's
 *     non-empty checks are validated with the literal strings "pw" /
 *     "totp" — they are not credential values, just non-empty sentinels.
 *   - No console.log of fixture contents anywhere in this test file.
 */

import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  E2E_FIXTURE_MARKER,
  E2E_FIXTURE_SCHEMA_VERSION,
  defaultFixturePath,
  fixtureDirectory,
  isDynamicFixtureModeRequested,
  loadOrgAdminFixture,
  loadOrgAdminFixtureSampleClient,
  resolveFixturePath,
  validateFixture,
} from "../../e2e/helpers/fixture";

// ── Constants pinning (must mirror identuum-idp/internal/cli/e2e_fixture.go) ─

describe("E2E fixture marker + schema pinning", () => {
  it("E2E_FIXTURE_MARKER must equal 'identuum-e2e-fixture-v1' (mirror cli.FixtureMarker)", () => {
    expect(E2E_FIXTURE_MARKER).toBe("identuum-e2e-fixture-v1");
  });

  it("E2E_FIXTURE_SCHEMA_VERSION must equal 1 (mirror cli.FixtureSchemaVersion)", () => {
    expect(E2E_FIXTURE_SCHEMA_VERSION).toBe(1);
  });
});

// ── Path resolution ──────────────────────────────────────────────────────────

describe("resolveFixturePath + defaultFixturePath", () => {
  const savedEnv = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = savedEnv;
    }
  });

  it("defaultFixturePath ends with e2e/.auth/e2e-org-admin-fixture.json", () => {
    const p = defaultFixturePath();
    expect(p).toMatch(/[/\\]e2e[/\\]\.auth[/\\]e2e-org-admin-fixture\.json$/);
  });

  it("resolveFixturePath returns the default when no env override", () => {
    delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    expect(resolveFixturePath()).toBe(defaultFixturePath());
  });

  it("resolveFixturePath honors IDENTUUM_E2E_FIXTURE_FILE", () => {
    process.env.IDENTUUM_E2E_FIXTURE_FILE = "/some/custom/path/x.json";
    expect(resolveFixturePath()).toBe("/some/custom/path/x.json");
  });

  it("fixtureDirectory returns the dirname of the resolved path", () => {
    const dir = fixtureDirectory();
    expect(dir).toMatch(/[/\\]e2e[/\\]\.auth$/);
  });
});

// ── isDynamicFixtureModeRequested ────────────────────────────────────────────

describe("isDynamicFixtureModeRequested", () => {
  const saved = process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE;
    } else {
      process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE = saved;
    }
  });

  it("returns true only when env value is exactly 'true'", () => {
    process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE = "true";
    expect(isDynamicFixtureModeRequested()).toBe(true);
  });

  it("returns false when env unset", () => {
    delete process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE;
    expect(isDynamicFixtureModeRequested()).toBe(false);
  });

  it("returns false for non-'true' values (case-sensitive, no 1/yes)", () => {
    for (const v of ["TRUE", "True", "1", "yes", "y", "on", "false", ""]) {
      process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE = v;
      expect(isDynamicFixtureModeRequested()).toBe(false);
    }
  });
});

// ── validateFixture (pure) ───────────────────────────────────────────────────

function goodFixture(runID = "0123456789ab") {
  return {
    fixture_marker: E2E_FIXTURE_MARKER,
    schema_version: E2E_FIXTURE_SCHEMA_VERSION,
    run_id: runID,
    organization: {
      id: "00000000-0000-0000-0000-000000000001",
      name: `e2e-fixture-${runID}-org`,
      domain: `e2e-${runID}.test`,
      slug: `e2e-fixture-${runID}`,
      mfa_policy: "required",
      allow_public_registration: false,
      require_registration_approval: false,
    },
    org_admin: {
      user_id: "00000000-0000-0000-0000-000000000002",
      email: `admin@e2e-${runID}.test`,
      password: "pw",
      totp_secret: "totp",
      mfa_enabled: true,
      email_verified: true,
    },
  };
}

describe("validateFixture — happy path returns trimmed credentials", () => {
  it("returns only email + password + totpSecret", () => {
    const creds = validateFixture(goodFixture(), "/tmp/x");
    expect(creds).toEqual({
      email: "admin@e2e-0123456789ab.test",
      password: "pw",
      totpSecret: "totp",
    });
    // Shape lock: no IDs / metadata leak through.
    expect(Object.keys(creds).sort()).toEqual(["email", "password", "totpSecret"]);
  });
});

describe("validateFixture — refusal cases", () => {
  it("rejects non-object input", () => {
    expect(() => validateFixture(null, "/tmp/x")).toThrow(/top-level must be an object/);
    expect(() => validateFixture("a string", "/tmp/x")).toThrow(/top-level must be an object/);
    expect(() => validateFixture(["array"], "/tmp/x")).toThrow(/top-level must be an object/);
  });

  it("rejects bad fixture_marker", () => {
    const f = goodFixture();
    f.fixture_marker = "not-our-marker";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/fixture_marker must equal/);
  });

  it("rejects bad schema_version", () => {
    const f = goodFixture() as Record<string, unknown>;
    f.schema_version = 99;
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/schema_version must equal 1/);
  });

  it("rejects bad run_id", () => {
    for (const bad of ["", "ABCDEF012345", "abcdef01234", "abcdef01234g"]) {
      const f = goodFixture() as Record<string, unknown>;
      f.run_id = bad;
      expect(() => validateFixture(f, "/tmp/x")).toThrow(/run_id must match/);
    }
  });

  it("rejects missing organization block", () => {
    const f = goodFixture() as Record<string, unknown>;
    delete f.organization;
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/organization block missing/);
  });

  it("rejects non-e2e organization.name prefix", () => {
    const f = goodFixture();
    f.organization.name = "real-customer-org";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/organization\.name must equal reserved e2e prefix/);
  });

  it("rejects non-e2e organization.domain prefix", () => {
    const f = goodFixture();
    f.organization.domain = "example.org";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/organization\.domain must equal reserved e2e prefix/);
  });

  it("rejects non-e2e organization.slug prefix", () => {
    const f = goodFixture();
    f.organization.slug = "real-customer";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/organization\.slug must equal reserved e2e prefix/);
  });

  it("rejects missing org_admin block", () => {
    const f = goodFixture() as Record<string, unknown>;
    delete f.org_admin;
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/org_admin block missing/);
  });

  it("rejects non-e2e org_admin.email prefix", () => {
    const f = goodFixture();
    f.org_admin.email = "admin@example.org";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/org_admin\.email must equal reserved e2e prefix/);
  });

  it("rejects empty password", () => {
    const f = goodFixture();
    f.org_admin.password = "";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/org_admin\.password missing or empty/);
  });

  it("rejects empty totp_secret", () => {
    const f = goodFixture();
    f.org_admin.totp_secret = "";
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/org_admin\.totp_secret missing or empty/);
  });

  it("rejects missing password key", () => {
    const f = goodFixture() as Record<string, unknown>;
    delete (f.org_admin as Record<string, unknown>).password;
    expect(() => validateFixture(f, "/tmp/x")).toThrow(/org_admin\.password missing or empty/);
  });
});

// ── loadOrgAdminFixture (file I/O) ───────────────────────────────────────────

describe("loadOrgAdminFixture — absent file returns null (durable mode signal)", () => {
  const saved = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  beforeEach(() => {
    process.env.IDENTUUM_E2E_FIXTURE_FILE = "/nonexistent/e2e-fixture.json";
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = saved;
    }
  });
  it("returns null when file does not exist", () => {
    expect(loadOrgAdminFixture()).toBeNull();
  });
});

describe("loadOrgAdminFixture — present file is validated", () => {
  let dir: string;
  let path: string;
  const saved = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-fixture-test-"));
    path = join(dir, "fixture.json");
    process.env.IDENTUUM_E2E_FIXTURE_FILE = path;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = saved;
    }
  });

  it("parses a valid fixture and returns the trimmed credentials", () => {
    writeFileSync(path, JSON.stringify(goodFixture()), { mode: 0o600 });
    const creds = loadOrgAdminFixture();
    expect(creds).not.toBeNull();
    expect(creds?.email).toBe("admin@e2e-0123456789ab.test");
  });

  it("throws on invalid JSON", () => {
    writeFileSync(path, "{not json", { mode: 0o600 });
    expect(() => loadOrgAdminFixture()).toThrow(/not valid JSON/);
  });

  it("throws on a fixture whose marker is wrong", () => {
    const bad = goodFixture();
    bad.fixture_marker = "WRONG";
    writeFileSync(path, JSON.stringify(bad), { mode: 0o600 });
    expect(() => loadOrgAdminFixture()).toThrow(/fixture_marker must equal/);
  });
});

// ── Source-text invariants ───────────────────────────────────────────────────

describe("Fixture loader source — security invariants", () => {
  const RAW_LOADER_SRC = readFileSync(
    resolve(__dirname, "..", "..", "e2e", "helpers", "fixture.ts"),
    "utf-8"
  );
  // Strip JS comments so security-rule prose (e.g. "NEVER console.log …")
  // does not trip the no-console.log invariant.
  const LOADER_SRC = RAW_LOADER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  it("contains no console.log call (would leak fixture contents)", () => {
    expect(LOADER_SRC).not.toMatch(/console\.log\b/);
  });

  it("contains no real customer/fixture identifier", () => {
    expect(LOADER_SRC).not.toMatch(/\baudi\b/i);
    expect(LOADER_SRC).not.toMatch(/admin@audi/i);
  });

  it("contains no inlined credential-material literal", () => {
    const blocklist = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
    ];
    for (const pat of blocklist) {
      expect(LOADER_SRC).not.toMatch(pat);
    }
  });
});

describe("login.ts source — fixture precedence", () => {
  const LOGIN_SRC = readFileSync(
    resolve(__dirname, "..", "..", "e2e", "helpers", "login.ts"),
    "utf-8"
  );

  it("imports loadOrgAdminFixture from ./fixture", () => {
    expect(LOGIN_SRC).toMatch(/import\s*\{[^}]*loadOrgAdminFixture[^}]*\}\s*from\s+["']\.\/fixture["']/);
  });

  it("dynamic fixture wins over env vars for email, password, totp_secret", () => {
    // The exact precedence operator is the new feature. A regression that
    // dropped the dynamic-first ordering would be caught here.
    expect(LOGIN_SRC).toMatch(/dynamicOrgAdminFixture\?\.email\s*\?\?\s*process\.env\.IDENTUUM_TEST_ORG_ADMIN_EMAIL/);
    expect(LOGIN_SRC).toMatch(/dynamicOrgAdminFixture\?\.password\s*\?\?\s*process\.env\.IDENTUUM_TEST_ORG_ADMIN_PASSWORD/);
    expect(LOGIN_SRC).toMatch(/dynamicOrgAdminFixture\?\.totpSecret\s*\?\?\s*process\.env\.IDENTUUM_TEST_ORG_ADMIN_TOTP_SECRET/);
  });

  it("does not console.log the resolved credentials", () => {
    // Bounded check: there is no console.log near the new constants.
    const idx = LOGIN_SRC.indexOf("dynamicOrgAdminFixture");
    expect(idx).toBeGreaterThan(-1);
    const slice = LOGIN_SRC.slice(idx, idx + 1500);
    expect(slice).not.toMatch(/console\.log\b/);
  });

  it("site_admin credential resolution is NOT touched by the dynamic-fixture change", () => {
    // The dynamic fixture is org_admin only. site_admin still comes from
    // env. A regression that swapped site_admin to the dynamic helper
    // would be caught here.
    expect(LOGIN_SRC).toMatch(/process\.env\.IDENTUUM_TEST_SITE_ADMIN_PASSWORD\s*\?\?/);
    expect(LOGIN_SRC).toMatch(/process\.env\.IDENTUUM_TEST_SITE_ADMIN_TOTP_SECRET\s*\?\?/);
  });
});

// ── Smoke: ensures a real saved fixture file's mode is honored ───────────────

describe("loadOrgAdminFixture — preserves file mode", () => {
  // The loader does NOT chmod; the IDP CLI writes 0600. This smoke check
  // confirms that when a test fixture is written with 0600 mode, statSync
  // (used by the loader to test existence) returns the mode untouched.
  let dir: string;
  let path: string;
  const saved = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-fixture-mode-"));
    path = join(dir, "fixture.json");
    process.env.IDENTUUM_E2E_FIXTURE_FILE = path;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = saved;
    }
  });

  it("does not chmod the file on load", () => {
    writeFileSync(path, JSON.stringify(goodFixture()), { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    loadOrgAdminFixture();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

// ── loadOrgAdminFixtureSampleClient — non-secret sample client surface ──────

describe("loadOrgAdminFixtureSampleClient — absent file returns null (durable mode signal)", () => {
  const saved = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  beforeEach(() => {
    process.env.IDENTUUM_E2E_FIXTURE_FILE = "/nonexistent/e2e-fixture.json";
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = saved;
    }
  });
  it("returns null when file does not exist", async () => {
    expect(loadOrgAdminFixtureSampleClient()).toBeNull();
  });
});

describe("loadOrgAdminFixtureSampleClient — present file", () => {
  let dir: string;
  let path: string;
  const saved = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-fixture-sample-"));
    path = join(dir, "fixture.json");
    process.env.IDENTUUM_E2E_FIXTURE_FILE = path;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.IDENTUUM_E2E_FIXTURE_FILE;
    } else {
      process.env.IDENTUUM_E2E_FIXTURE_FILE = saved;
    }
  });

  it("returns null when the envelope omits sample_client (older IDP fixture build)", () => {
    writeFileSync(path, JSON.stringify(goodFixture()), { mode: 0o600 });
    expect(loadOrgAdminFixtureSampleClient()).toBeNull();
  });

  it("returns the trimmed non-secret block when sample_client is present and valid", () => {
    const runID = "0123456789ab";
    const env = goodFixture(runID) as Record<string, unknown>;
    env.sample_client = {
      id: "11111111-1111-1111-1111-111111111111",
      client_id: `e2e-fixture-${runID}-app`,
      name: `E2E Sample Application ${runID}`,
      is_public: true,
    };
    writeFileSync(path, JSON.stringify(env), { mode: 0o600 });
    const out = loadOrgAdminFixtureSampleClient();
    expect(out).not.toBeNull();
    expect(out).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      clientId: `e2e-fixture-${runID}-app`,
      name: `E2E Sample Application ${runID}`,
      isPublic: true,
    });
    // Shape lock: NO secret-shaped key crosses the function boundary.
    const keys = Object.keys(out as unknown as Record<string, unknown>).sort();
    expect(keys).toEqual(["clientId", "id", "isPublic", "name"]);
  });

  it("returns null fail-closed when sample_client.id is not UUID-shaped", () => {
    const runID = "0123456789ab";
    const env = goodFixture(runID) as Record<string, unknown>;
    env.sample_client = {
      id: "not-a-uuid",
      client_id: `e2e-fixture-${runID}-app`,
      name: `E2E Sample Application ${runID}`,
      is_public: true,
    };
    writeFileSync(path, JSON.stringify(env), { mode: 0o600 });
    expect(loadOrgAdminFixtureSampleClient()).toBeNull();
  });

  it("returns null fail-closed when sample_client.client_id does not match the reserved e2e-fixture-<runID>-app pattern", () => {
    const runID = "0123456789ab";
    const env = goodFixture(runID) as Record<string, unknown>;
    env.sample_client = {
      id: "11111111-1111-1111-1111-111111111111",
      client_id: "attacker-controlled-client",
      name: `E2E Sample Application ${runID}`,
      is_public: true,
    };
    writeFileSync(path, JSON.stringify(env), { mode: 0o600 });
    expect(loadOrgAdminFixtureSampleClient()).toBeNull();
  });

  it("returns null fail-closed when sample_client.is_public is not boolean", () => {
    const runID = "0123456789ab";
    const env = goodFixture(runID) as Record<string, unknown>;
    env.sample_client = {
      id: "11111111-1111-1111-1111-111111111111",
      client_id: `e2e-fixture-${runID}-app`,
      name: `E2E Sample Application ${runID}`,
      is_public: "true",
    };
    writeFileSync(path, JSON.stringify(env), { mode: 0o600 });
    expect(loadOrgAdminFixtureSampleClient()).toBeNull();
  });

  it("throws when the envelope is malformed (re-runs validateFixture)", () => {
    const env = goodFixture() as Record<string, unknown>;
    env.fixture_marker = "WRONG";
    env.sample_client = {
      id: "11111111-1111-1111-1111-111111111111",
      client_id: "e2e-fixture-0123456789ab-app",
      name: "E2E Sample Application 0123456789ab",
      is_public: true,
    };
    writeFileSync(path, JSON.stringify(env), { mode: 0o600 });
    expect(() => loadOrgAdminFixtureSampleClient()).toThrow(/fixture_marker must equal/);
  });
});

// ── Source-text invariants for the sample-client helper + type ──────────────

describe("Fixture loader source — sample_client invariants", () => {
  const RAW_LOADER_SRC = readFileSync(
    resolve(__dirname, "..", "..", "e2e", "helpers", "fixture.ts"),
    "utf-8"
  );
  // Strip JS comments before negative-substring scans so security-rule
  // prose (e.g. "NEVER expose client_secret") does not trip the no-
  // secret invariant. Real code referencing forbidden fields would
  // survive the strip.
  const LOADER_SRC = RAW_LOADER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  it("declares the OrgAdminFixtureSampleClient type + loader function", () => {
    expect(RAW_LOADER_SRC).toMatch(/export\s+interface\s+OrgAdminFixtureSampleClient\b/);
    expect(RAW_LOADER_SRC).toMatch(
      /export\s+function\s+loadOrgAdminFixtureSampleClient\b/
    );
  });

  it("the OrgAdminFixtureSampleClient interface declares ONLY non-secret fields", () => {
    const start = LOADER_SRC.indexOf("export interface OrgAdminFixtureSampleClient");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = LOADER_SRC.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    const block = LOADER_SRC.slice(start, end);
    // Allowed property names — exactly these four.
    expect(block).toMatch(/\bid:\s*string\b/);
    expect(block).toMatch(/\bclientId:\s*string\b/);
    expect(block).toMatch(/\bname:\s*string\b/);
    expect(block).toMatch(/\bisPublic:\s*boolean\b/);
    // Forbidden property names — none may appear.
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bclientSecret\b/,
      /\bsecret_hash\b/,
      /\bsecretHash\b/,
      /\bprivate_key\b/,
      /\bprivateKey\b/,
      /\bjwks\b/,
      /\bsigning_key\b/,
      /\bsigningKey\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\bpassword\b/,
      /\btotp_secret\b/,
      /\btotpSecret\b/,
    ];
    for (const pat of BANNED) {
      expect(block, `OrgAdminFixtureSampleClient must not declare ${pat}`).not.toMatch(pat);
    }
  });

  it("loadOrgAdminFixtureSampleClient body NEVER reads a secret-shaped field from the envelope", () => {
    const fnStart = LOADER_SRC.indexOf("export function loadOrgAdminFixtureSampleClient");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const tail = LOADER_SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    const BANNED: RegExp[] = [
      /\bclient_secret\b/,
      /\bsecret_hash\b/,
      /\bprivate_key\b/,
      /\bsigning_key\b/,
      /\baccess_token\b/,
      /\brefresh_token\b/,
      /\bauthorization_code\b/,
      /\bauth_code\b/,
      /\.jwks\b/,
      /\bpassword\b/,
      /\btotp_secret\b/,
    ];
    for (const pat of BANNED) {
      expect(
        body,
        `loadOrgAdminFixtureSampleClient body must not reference ${pat}`
      ).not.toMatch(pat);
    }
  });

  it("loadOrgAdminFixtureSampleClient body has NO console.* call (would leak fixture contents)", () => {
    const fnStart = LOADER_SRC.indexOf("export function loadOrgAdminFixtureSampleClient");
    const tail = LOADER_SRC.slice(fnStart);
    const fnEnd = tail.indexOf("\nexport ", 1);
    const body = fnEnd >= 0 ? tail.slice(0, fnEnd) : tail;
    expect(body).not.toMatch(/console\.\w+/);
  });
});
