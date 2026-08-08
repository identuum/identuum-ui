/**
 * Dynamic Playwright fixture LOADER (the consumer half).
 *
 * The producer is `e2e/helpers/appliance-fixture.ts`, driven by
 * `e2e/global-setup.ts`, which builds the envelope against the RELEASED
 * appliance's HTTP API (THE-RELEASED-CONTRACT). This module only READS and
 * validates that envelope — it validates every safety invariant (marker, schema
 * version, reserved e2e-<runID> prefixes on org name/domain/admin email) and
 * returns ONLY the credentials login.ts needs — no audit metadata, no UUIDs,
 * no organization JSON. (Prior to THE-RELEASED-CONTRACT the producer was the
 * retired `identuum --e2e-create-org-admin-fixture` monolith CLI; the envelope
 * shape is unchanged, so this loader was untouched by that migration.)
 *
 * Resolution order (path):
 *   1. process.env.IDENTUUM_E2E_FIXTURE_FILE — explicit override.
 *   2. <UI_REPO>/e2e/.auth/e2e-org-admin-fixture.json — the ONE canonical path.
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
import { dirname, resolve } from "node:path";

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
    throw new Error(`e2e fixture: file at ${path} is not valid JSON (${(err as Error).message})`);
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
    throw new Error(`e2e fixture at ${path}: fixture_marker must equal "${E2E_FIXTURE_MARKER}"`);
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
    throw new Error(`e2e fixture at ${path}: organization.name must equal reserved e2e prefix`);
  }
  if (org.slug !== expectedOrgSlug) {
    throw new Error(`e2e fixture at ${path}: organization.slug must equal reserved e2e prefix`);
  }
  if (org.domain !== expectedOrgDomain) {
    throw new Error(`e2e fixture at ${path}: organization.domain must equal reserved e2e prefix`);
  }

  const admin = (input as { org_admin?: unknown }).org_admin;
  if (!isObject(admin)) {
    throw new Error(`e2e fixture at ${path}: org_admin block missing`);
  }
  const expectedAdminEmail = `admin@e2e-${runID}.test`;
  if (admin.email !== expectedAdminEmail) {
    throw new Error(`e2e fixture at ${path}: org_admin.email must equal reserved e2e prefix`);
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
 * The site_admin credentials the released-appliance harness mints during
 * globalSetup (THE-RELEASED-CONTRACT, 2026-08-08). Added so the site-admin
 * specs authenticate against the FRESH appliance the harness stood up, instead
 * of owner-seeded env-file credentials that only exist on a long-lived stack
 * (the census's SEEDED-COUPLING class). Same null-on-absent contract as
 * loadOrgAdminFixture: env-file mode is still valid when no fixture is present.
 *
 * SECURITY: returns ONLY the three site_admin credentials, no envelope
 * metadata; never console.logs them.
 */
export interface SiteAdminFixtureCredentials {
  email: string;
  password: string;
  totpSecret: string;
}

export function loadSiteAdminFixture(): SiteAdminFixtureCredentials | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  // Run the full envelope validation (marker, schema, reserved org prefixes)
  // for side-effect safety before trusting any block.
  validateFixture(parsed, path);
  const sa = (parsed as { site_admin?: unknown }).site_admin;
  if (!isObject(sa)) return null;
  const { email, password, totp_secret } = sa as Record<string, unknown>;
  if (typeof email !== "string" || email.length === 0) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  if (typeof totp_secret !== "string" || totp_secret.length === 0) return null;
  return { email, password, totpSecret: totp_secret };
}

/**
 * The org_user credentials the released-appliance harness mints during
 * globalSetup (THE-ALL-GREEN-SUITE). The three credential types the suite must
 * cover are site_admin, org_admin, and a regular org_user — this is the third.
 * The fixture org carries a REQUIRED MFA policy, so the org_user is TOTP-enrolled
 * like the admins and this block carries a captured totp_secret: the suite
 * exercises TOTP login for every user type.
 *
 * Same null-on-absent contract; returns email + password + totpSecret.
 */
export interface OrgUserFixtureCredentials {
  email: string;
  password: string;
  totpSecret: string;
}

export function loadOrgUserFixture(): OrgUserFixtureCredentials | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  validateFixture(parsed, path);
  const ou = (parsed as { org_user?: unknown }).org_user;
  if (!isObject(ou)) return null;
  const { email, password, totp_secret } = ou as Record<string, unknown>;
  if (typeof email !== "string" || email.length === 0) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  if (typeof totp_secret !== "string" || totp_secret.length === 0) return null;
  return { email, password, totpSecret: totp_secret };
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
 * The non-secret subset of the seeded sample OAuth client the released-API
 * producer (e2e/helpers/appliance-fixture.ts) writes into the JSON envelope:
 * `id`, `client_id`, `name`, `is_public`. NEVER expose `client_secret`,
 * `client_secret_hash`, `private_key`, inline `jwks`, signing material,
 * `access_token`, `refresh_token`, or any other credential-shaped field — the
 * producer creates a PUBLIC client (no secret at all) and never writes secret
 * material into the envelope.
 */
export interface OrgAdminFixtureSampleClient {
  id: string;
  clientId: string;
  name: string;
  isPublic: boolean;
}

/**
 * Returns the disposable sample OAuth client the released-API producer
 * seeded alongside the fixture organization, when the dynamic fixture
 * file is present and valid. Returns null when the file is absent
 * (durable-env mode) OR when the envelope was written by a pre-sample-
 * client producer (the field is optional on the envelope by design,
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
 *   - The released appliance generates the OAuth client_id server-side, so
 *     run-scoping anchors on the reserved `E2E Sample Application <runID>`
 *     NAME (which the producer sets); client_id is validated only as a real
 *     32-hex generated id. A block for a different run fails the name gate.
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
  // The released appliance GENERATES the OAuth client_id server-side
  // (crypto.GenerateRandomString(16) → 32 lowercase-hex chars); a producer
  // cannot inject the readable literal the retired monolith CLI used. Run-
  // scoping therefore anchors on the reserved NAME below (which the released-
  // API producer DOES set), and client_id is validated only as a real
  // generated OAuth id — anything non-hex means the block is malformed.
  if (typeof client_id !== "string" || !/^[0-9a-f]{32}$/.test(client_id)) return null;
  if (typeof name !== "string" || name !== `E2E Sample Application ${runID}`) return null;
  if (typeof is_public !== "boolean") return null;
  return { id, clientId: client_id, name, isPublic: is_public };
}

/**
 * Non-secret subset of the seeded CONFIDENTIAL OAuth client the released-API
 * producer writes alongside the public sample client. The fields are
 * `id`, `client_id`, `name`, `is_public`. NEVER expose `client_secret`,
 * `client_secret_hash`, `private_key`, inline `jwks`, signing material,
 * `access_token`, `refresh_token`, or any other credential-shaped field — the
 * producer creates the client, DISCARDS the one-time client_secret the API
 * returns, and never writes secret material into the envelope. (The rotation
 * spec mints a fresh secret at test time via the UI; it never reads a seeded
 * one.)
 */
export interface OrgAdminFixtureConfidentialSampleClient {
  id: string;
  clientId: string;
  name: string;
  isPublic: boolean;
}

/**
 * Returns the disposable CONFIDENTIAL OAuth client the released-API
 * producer seeded alongside the fixture organization, when the dynamic
 * fixture file is present and valid. Returns null when the file is
 * absent (durable-env mode) OR when the envelope was written by a
 * pre-confidential-client producer (the field is optional on the
 * envelope by design, so older fixtures still round-trip cleanly
 * through validateFixture).
 *
 * SECURITY:
 *   - Returns ONLY non-secret identifiers: id (opaque UUID, used as
 *     the route path segment for /org-admin/applications/[id]),
 *     client_id (operator-visible OAuth2 client_id), name (operator-
 *     visible display name), is_public (always false for this
 *     seeded client). NO client_secret, NO client_secret_hash, NO
 *     private_key, NO inline jwks, NO signing material, NO token-
 *     shaped field crosses this function boundary.
 *   - Re-uses validateFixture so every safety invariant runs (marker,
 *     schema version, reserved e2e-<runID> prefixes); a malformed
 *     file still throws.
 *   - The id is validated against a narrow UUID-shape regex; a non-
 *     UUID id is dropped fail-closed so it cannot be silently
 *     surfaced into a test URL.
 *   - The released appliance generates the OAuth client_id server-side, so
 *     client_id is validated only as a real 32-hex generated id; run-scoping
 *     anchors on the reserved NAME below.
 *   - The name is validated against the reserved
 *     `E2E Confidential Application <runID>` pattern — anything else means the
 *     envelope was written for a different run and is fail-closed dropped.
 *   - is_public is validated to be the boolean literal `false` — if a
 *     future regression flips the seeded client to public, the
 *     loader returns null and the confidential Playwright test
 *     self-skips loudly rather than silently exercising the wrong
 *     branch.
 *   - No console.* anywhere.
 */
export function loadOrgAdminFixtureConfidentialSampleClient(): OrgAdminFixtureConfidentialSampleClient | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  validateFixture(parsed, path);
  const runID = (parsed as { run_id?: unknown }).run_id;
  if (typeof runID !== "string") return null;
  const block = (parsed as { confidential_sample_client?: unknown }).confidential_sample_client;
  if (!isObject(block)) return null;
  const { id, client_id, name, is_public } = block as Record<string, unknown>;
  if (typeof id !== "string" || !/^[0-9a-fA-F-]{32,36}$/.test(id)) return null;
  // Server-generated OAuth client_id (see the public-client loader): validated
  // as a real 32-hex id, not a reserved literal. Run-scoping anchors on the
  // reserved NAME check below, which the released-API producer sets.
  if (typeof client_id !== "string" || !/^[0-9a-f]{32}$/.test(client_id)) {
    return null;
  }
  if (typeof name !== "string" || name !== `E2E Confidential Application ${runID}`) {
    return null;
  }
  if (is_public !== false) return null;
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

/**
 * Returns the fixture organization's opaque UUID when the dynamic
 * fixture file is present and valid — the id site-admin specs need to
 * deep-link /site-admin/organizations/[id] at the disposable org.
 *
 * SECURITY:
 *   - The id is a non-secret opaque row identifier; no credential
 *     crosses this boundary.
 *   - Re-uses validateFixture (marker, schema version, reserved
 *     prefixes); a malformed file still throws.
 *   - The id is validated against a narrow UUID-shape regex and
 *     dropped fail-closed otherwise.
 */
export function loadOrgAdminFixtureOrgId(): string | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  validateFixture(parsed, path);
  const org = (parsed as { organization?: unknown }).organization;
  if (!isObject(org)) return null;
  const id = (org as Record<string, unknown>).id;
  if (typeof id !== "string") return null;
  if (!/^[0-9a-fA-F-]{32,36}$/.test(id)) return null;
  return id;
}

/**
 * Non-secret subset of a seeded API resource: id, audience, name, active,
 * token_ttl_secs. NEVER expose resource_secret, resource_secret_hash,
 * private_key, inline jwks, signing material, access_token, refresh_token, or
 * any other credential-shaped field.
 *
 * NOTE: the released OSS v0.3.0 producer does NOT write an api_resource block —
 * the whole /api/v1/api-resources admin surface is site_admin-gated on OSS
 * (mw.RequireSiteAdmin), so an org_admin can neither create nor read one. This
 * loader consequently returns null and the org-admin-api-resources
 * [dynamic mode only] specs self-skip. The loader is retained as the consumer
 * contract for an overlay that widens api-resources to org_admin.
 */
export interface OrgAdminFixtureApiResource {
  id: string;
  audience: string;
  name: string;
  active: boolean;
  tokenTTLSecs: number;
}

/**
 * Returns a disposable API resource block when the dynamic fixture file is
 * present and carries one. Returns null when the file is absent (durable-env
 * mode) OR when no api_resource block was written — which is the case on the
 * released OSS appliance, where the api-resources admin surface is
 * site_admin-gated and the producer seeds no such block (see the interface
 * note above). The block is optional on the envelope by design, so a fixture
 * without it still round-trips cleanly through validateFixture.
 *
 * SECURITY:
 *   - Returns ONLY non-secret identifiers: id (opaque UUID used as the
 *     route path segment for /org-admin/api-resources/[id]), audience
 *     (operator-visible OAuth aud claim), name (operator-visible
 *     display name), active (always true for this seeded resource),
 *     token_ttl_secs (numeric token TTL). NO resource_secret,
 *     resource_secret_hash, private_key, jwks, signing material, or
 *     token-shaped field crosses this function boundary.
 *   - Re-uses validateFixture so every safety invariant runs (marker,
 *     schema version, reserved e2e-<runID> prefixes); a malformed file
 *     still throws.
 *   - The id is validated against a narrow UUID-shape regex; a non-
 *     UUID id is dropped fail-closed.
 *   - The audience is validated against the reserved
 *     `https://api.e2e-<runID>.test` pattern — anything else means the
 *     envelope was written for a different run and is fail-closed
 *     dropped.
 *   - The name is validated against the reserved `E2E Sample API
 *     <runID>` pattern.
 *   - active is validated to be the boolean literal `true` — if a
 *     future regression flipped the seeded resource to inactive, the
 *     loader returns null and the populated Playwright test self-skips
 *     loudly rather than silently exercising the wrong branch.
 *   - token_ttl_secs is validated to be a positive integer in the
 *     IDP-accepted range [60, 86400].
 *   - No console.* anywhere.
 */
export function loadOrgAdminFixtureApiResource(): OrgAdminFixtureApiResource | null {
  const path = resolveFixturePath();
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  validateFixture(parsed, path);
  const runID = (parsed as { run_id?: unknown }).run_id;
  if (typeof runID !== "string") return null;
  const block = (parsed as { api_resource?: unknown }).api_resource;
  if (!isObject(block)) return null;
  const { id, audience, name, active, token_ttl_secs } = block as Record<string, unknown>;
  if (typeof id !== "string" || !/^[0-9a-fA-F-]{32,36}$/.test(id)) return null;
  if (typeof audience !== "string" || audience !== `https://api.e2e-${runID}.test`) {
    return null;
  }
  if (typeof name !== "string" || name !== `E2E Sample API ${runID}`) return null;
  if (active !== true) return null;
  if (
    typeof token_ttl_secs !== "number" ||
    !Number.isInteger(token_ttl_secs) ||
    token_ttl_secs < 60 ||
    token_ttl_secs > 86400
  ) {
    return null;
  }
  return {
    id,
    audience,
    name,
    active,
    tokenTTLSecs: token_ttl_secs,
  };
}
