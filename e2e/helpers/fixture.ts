/**
 * Dynamic org-admin Playwright fixture loader.
 *
 * Companion to the IDP CLI commands:
 *   identuum --e2e-create-org-admin-fixture --output <path>
 *   identuum --e2e-purge-org-fixture --fixture-file <path> --confirm-e2e-purge
 *
 * The loader reads the JSON envelope written by the IDP CLI. It validates
 * every safety invariant the IDP side enforces (marker, schema version,
 * reserved e2e-<runID> prefixes on org name/domain/admin email) and then
 * returns ONLY the three credentials login.ts needs (email, password,
 * totp_secret) — no audit metadata, no UUIDs, no organization JSON.
 *
 * Resolution order (path):
 *   1. process.env.IDENTUUM_E2E_FIXTURE_FILE — explicit override.
 *   2. <UI_REPO>/e2e/.auth/e2e-org-admin-fixture.json — default.
 *
 * SECURITY:
 *   - NEVER console.log the parsed fixture contents.
 *   - NEVER include the password or totp_secret in error messages.
 *   - Throws when the fixture file is malformed or violates a reserved
 *     prefix — that throws on import only when callers trigger load.
 *   - Returns null (no throw) when the fixture file is simply absent —
 *     the durable-env mode is still a valid runtime.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Canonical marker the IDP CLI writes into every fixture file. Must match
 * `cli.FixtureMarker` in identuum-idp/internal/cli/e2e_fixture.go.
 */
export const E2E_FIXTURE_MARKER = "identuum-e2e-fixture-v1";

/**
 * Canonical schema version. Bump in lock-step with `cli.FixtureSchemaVersion`.
 */
export const E2E_FIXTURE_SCHEMA_VERSION = 1;

/** Strict run-id pattern — 12 lowercase hex characters. */
const RUN_ID_PATTERN = /^[0-9a-f]{12}$/;

/**
 * Default location the IDP CLI writes the fixture file to. The file is
 * gitignored via `e2e/.auth/` in identuum-ui/.gitignore.
 */
export function defaultFixturePath(): string {
  // __dirname inside e2e/helpers → resolve up two levels to repo root.
  return resolve(__dirname, "..", ".auth", "e2e-org-admin-fixture.json");
}

/**
 * Resolves the path the loader will attempt to read.
 *
 * Environment variable IDENTUUM_E2E_FIXTURE_FILE wins; otherwise the default.
 */
export function resolveFixturePath(): string {
  const override = process.env.IDENTUUM_E2E_FIXTURE_FILE;
  if (override && override.length > 0) return override;
  return defaultFixturePath();
}

/**
 * The trimmed shape login.ts consumes. Only the three credentials cross
 * out of this module — no IDs, no metadata, no JSON envelope.
 */
export interface OrgAdminFixtureCredentials {
  email: string;
  password: string;
  totpSecret: string;
}

/**
 * Loads the dynamic fixture file when present and valid. Returns null when
 * the file is absent — that is the normal durable-env-mode signal.
 *
 * Throws when the file exists but is malformed (bad JSON, wrong marker,
 * wrong schema version, non-e2e prefix, missing credentials).
 */
export function loadOrgAdminFixture(): OrgAdminFixtureCredentials | null {
  const path = resolveFixturePath();
  let raw: string;
  try {
    statSync(path);
  } catch {
    return null;
  }
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `e2e fixture: file exists at ${path} but is unreadable (${(err as Error).message})`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `e2e fixture: file at ${path} is not valid JSON (${(err as Error).message})`
    );
  }
  return validateFixture(parsed, path);
}

/**
 * Pure validator — exported for unit tests. Runs every invariant the loader
 * relies on. The path arg is used ONLY for error messages so the operator
 * knows which file to fix.
 */
export function validateFixture(input: unknown, path: string): OrgAdminFixtureCredentials {
  if (!isObject(input)) {
    throw new Error(`e2e fixture at ${path}: top-level must be an object`);
  }
  if (input.fixture_marker !== E2E_FIXTURE_MARKER) {
    throw new Error(
      `e2e fixture at ${path}: fixture_marker must equal "${E2E_FIXTURE_MARKER}"`
    );
  }
  if (input.schema_version !== E2E_FIXTURE_SCHEMA_VERSION) {
    throw new Error(
      `e2e fixture at ${path}: schema_version must equal ${E2E_FIXTURE_SCHEMA_VERSION}`
    );
  }
  if (typeof input.run_id !== "string" || !RUN_ID_PATTERN.test(input.run_id)) {
    throw new Error(`e2e fixture at ${path}: run_id must match ${RUN_ID_PATTERN.source}`);
  }
  const runID = input.run_id;

  const org = (input as { organization?: unknown }).organization;
  if (!isObject(org)) {
    throw new Error(`e2e fixture at ${path}: organization block missing`);
  }
  const expectedOrgName = `e2e-fixture-${runID}-org`;
  const expectedOrgSlug = `e2e-fixture-${runID}`;
  const expectedOrgDomain = `e2e-${runID}.test`;
  if (org.name !== expectedOrgName) {
    throw new Error(
      `e2e fixture at ${path}: organization.name must equal reserved e2e prefix`
    );
  }
  if (org.slug !== expectedOrgSlug) {
    throw new Error(
      `e2e fixture at ${path}: organization.slug must equal reserved e2e prefix`
    );
  }
  if (org.domain !== expectedOrgDomain) {
    throw new Error(
      `e2e fixture at ${path}: organization.domain must equal reserved e2e prefix`
    );
  }

  const admin = (input as { org_admin?: unknown }).org_admin;
  if (!isObject(admin)) {
    throw new Error(`e2e fixture at ${path}: org_admin block missing`);
  }
  const expectedAdminEmail = `admin@e2e-${runID}.test`;
  if (admin.email !== expectedAdminEmail) {
    throw new Error(
      `e2e fixture at ${path}: org_admin.email must equal reserved e2e prefix`
    );
  }
  if (typeof admin.password !== "string" || admin.password.length === 0) {
    throw new Error(`e2e fixture at ${path}: org_admin.password missing or empty`);
  }
  if (typeof admin.totp_secret !== "string" || admin.totp_secret.length === 0) {
    throw new Error(`e2e fixture at ${path}: org_admin.totp_secret missing or empty`);
  }
  return {
    email: admin.email,
    password: admin.password,
    totpSecret: admin.totp_secret,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Returns the fixture org's primary domain (e2e-<runID>.test) when the
 * dynamic fixture file is present and valid. Returns null when the
 * file is absent (durable-env mode) — same null-on-absent contract as
 * `loadOrgAdminFixture`.
 *
 * SECURITY:
 *   - Returns ONLY the org domain string. No password, no TOTP secret,
 *     no UUID, no envelope metadata crosses this function boundary.
 *   - The domain is the non-secret reserved e2e-<runID>.test pattern
 *     — it is already printed in the IDP CLI's own create/purge
 *     banner and on the Organization profile card, so surfacing it
 *     in test code is safe.
 *   - Re-uses validateFixture so every safety invariant runs (marker,
 *     schema version, reserved prefixes); a malformed file still
 *     throws.
 */
export function loadOrgAdminFixtureOrgDomain(): string | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  // Re-run validation for side-effect safety, then read the domain.
  validateFixture(parsed, path);
  // validateFixture already checked the prefix shape — read the field
  // directly without re-asserting type.
  const org = (parsed as { organization?: { domain?: string } }).organization;
  return org?.domain ?? null;
}

/**
 * Returns the fixture org_admin's user_id when the dynamic fixture
 * file is present and valid. Returns null when the file is absent
 * (durable-env mode) — same null-on-absent contract as
 * `loadOrgAdminFixture`.
 *
 * SECURITY:
 *   - Returns ONLY the user_id UUID string. No password, no TOTP
 *     secret, no envelope metadata crosses this function boundary.
 *   - The user_id is a non-secret opaque UUID — it is already printed
 *     in the IDP CLI's own create/purge banner (`org_admin_id: ...`)
 *     and is required as a URL path segment for /org-admin/users/[id]
 *     navigation in tests. Surfacing it here is safe.
 *   - Re-uses validateFixture so every safety invariant runs (marker,
 *     schema version, reserved prefixes); a malformed file still
 *     throws.
 *   - The value is also validated to look like a UUID via a narrow
 *     regex check; an unexpected shape returns null (do not silently
 *     surface a non-UUID into the test URL).
 */
export function loadOrgAdminFixtureUserId(): string | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  validateFixture(parsed, path);
  const admin = (parsed as { org_admin?: { user_id?: unknown } }).org_admin;
  const userID = admin?.user_id;
  if (typeof userID !== "string") return null;
  // Narrow UUID-shape check. The IDP CLI writes a uuid.New() string;
  // anything else is suspicious and dropped fail-closed.
  if (!/^[0-9a-fA-F-]{32,36}$/.test(userID)) return null;
  return userID;
}

/**
 * Helper for ad-hoc operator scripts: returns true when dynamic-mode env
 * toggle is set. The loader itself does NOT depend on this flag — if a
 * fixture file is present, the loader will use it even when this toggle
 * is unset. The flag exists for orchestration helpers (globalSetup,
 * teardown ritual) that want to opt INTO automatic create/purge.
 */
export function isDynamicFixtureModeRequested(): boolean {
  return process.env.IDENTUUM_E2E_USE_DYNAMIC_FIXTURE === "true";
}

/**
 * The non-secret subset of the seeded sample OAuth client surfaced by
 * the IDP fixture CLI. The fields here mirror exactly the four fields
 * `cli.FixtureSampleClientBlock` writes into the JSON envelope:
 * `id`, `client_id`, `name`, `is_public`. NEVER expose
 * `client_secret`, `client_secret_hash`, `private_key`, inline `jwks`,
 * signing material, `access_token`, `refresh_token`, or any other
 * credential-shaped field — the IDP fixture envelope does not write
 * them, and a regression that started doing so would surface in the
 * IDP Vitest pin too.
 */
export interface OrgAdminFixtureSampleClient {
  id: string;
  clientId: string;
  name: string;
  isPublic: boolean;
}

/**
 * Returns the disposable sample OAuth client the IDP fixture CLI
 * seeded alongside the fixture organization, when the dynamic fixture
 * file is present and valid. Returns null when the file is absent
 * (durable-env mode) OR when the envelope was written by a pre-sample-
 * client IDP build (the field is optional on the envelope by design,
 * so older fixtures still round-trip cleanly through validateFixture).
 *
 * SECURITY:
 *   - Returns ONLY non-secret identifiers: id (opaque UUID, used as
 *     the route path segment for /org-admin/applications/[id]),
 *     client_id (operator-visible OAuth2 client_id), name (operator-
 *     visible display name), is_public (true for the seeded client).
 *     No secret hash, signing material, or token-shaped field crosses
 *     this function boundary.
 *   - Re-uses validateFixture so every safety invariant runs (marker,
 *     schema version, reserved e2e-<runID> prefixes); a malformed
 *     file still throws.
 *   - The id is validated against a narrow UUID-shape regex; a non-
 *     UUID id is dropped fail-closed so it cannot be silently
 *     surfaced into a test URL.
 *   - The client_id is validated against the reserved e2e-fixture-
 *     <runID>-app pattern — anything else means the envelope was
 *     written for a different run and is fail-closed dropped.
 */
export function loadOrgAdminFixtureSampleClient(): OrgAdminFixtureSampleClient | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  // Re-run validation for side-effect safety — marker / schema /
  // reserved-prefix gates. A malformed file throws here regardless
  // of whether the sample_client block is present.
  validateFixture(parsed, path);
  const runID = (parsed as { run_id?: unknown }).run_id;
  if (typeof runID !== "string") return null;
  const sample = (parsed as { sample_client?: unknown }).sample_client;
  if (!isObject(sample)) return null;
  const { id, client_id, name, is_public } = sample as Record<string, unknown>;
  if (typeof id !== "string" || !/^[0-9a-fA-F-]{32,36}$/.test(id)) return null;
  if (typeof client_id !== "string" || client_id !== `e2e-fixture-${runID}-app`) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  if (typeof is_public !== "boolean") return null;
  return { id, clientId: client_id, name, isPublic: is_public };
}

/**
 * Convenience for orchestration helpers wanting to ensure the directory
 * exists with restrictive mode before the IDP CLI writes into it.
 * Returns the absolute path of the directory (regardless of pre-existing
 * state). Callers may also want to chmod themselves.
 */
export function fixtureDirectory(): string {
  return dirname(resolveFixturePath());
}
