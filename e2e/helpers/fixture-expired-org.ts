/**
 * Local-only E2E fixture: "Playwright Expired Recovery Org"
 *
 * Produces an organization in the has_admin=true / can_assign_admin=true state:
 *   - An org_admin user row exists (has_admin=true via CountOrgAdminsByOrganization > 0)
 *   - The user has email_verified=false AND activation_token_expires_at <= NOW()
 *     (can_assign_admin=true via CountRecoveryBlockingOrgAdmins == 0)
 *
 * This is the "expired pending invitation" state that the site-admin UI renders as
 * "Invitation expired" badge + "Assign admin" affordance.
 *
 * SCRATCH-ONLY (OSS-MINT-GUARD-2, C2). The expired state needs one SQL
 * time-warp no API offers, so this fixture runs ONLY inside the e2e-full
 * harness's own disposable appliance: the outer-owned dev-loop phase
 * (IDENTUUM_E2E_FIXTURE_OWNER=outer) of Compose project identuum-e2e, whose
 * resolved config full-run.sh validated before creating it. Without that
 * context it REFUSES before any process, query or HTTP request. There is no
 * host psql and no fixed port: SQL runs as
 *   docker compose -p identuum-e2e -f <idp-oss dev compose> -f <mail overlay>
 *     --profile app exec -T postgres-idp-oss psql ...
 * (argv, no shell), over the container's own socket; HTTP goes to the
 * harness's UI base (IDENTUUM_E2E_BASE_URL) and IdP base
 * (IDENTUUM_E2E_FULL_IDP_BASE), and only when each is exactly
 * http://localhost or http://127.0.0.1 on the port full-run.sh selected and
 * carried (IDENTUUM_E2E_FULL_UI_PORT, IDENTUUM_E2E_FULL_APP_PORT; never 5513,
 * 7104, 7113 or 7114). Any other value is a refusal before any call (review G4).
 *
 * Setup strategy (idempotent):
 *   1. Find or create the fixture org (no admin_email → shell org).
 *   2. If no user row exists, create the org FRESH with admin_email so the backend
 *      creates the pending user row (email_verified=false, valid activation token).
 *   3. Expire the activation_token_expires_at via scratch SQL → can_assign_admin=true.
 *
 * Healing for broken states:
 *   - "active" (email_verified=true): reset to email_verified=false + expire token.
 *   - "valid-pending": just expire the token.
 *   - "expired-pending": no action needed.
 *
 * Safety:
 *   - Clearly test-scoped: org domain playwright-expired.local, email expired-admin@playwright-expired.local
 *   - Does NOT print claim URLs, tokens, or credential material.
 *   - No database credential: psql uses the scratch container's local socket.
 *   - API calls go through /api/idp/ proxy to reuse the browser session — no second TOTP.
 *
 * Architecture note: POST /api/v1/organizations with admin_email creates both org AND
 * a pending user (email_verified=false, activation_token_*). This is the only API path
 * that creates a pending user row without claim-consume (which sets email_verified=true).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { uiOriginHeader } from "./ui-origin";

const FIXTURE_ORG_DOMAIN = "playwright-expired.local";
const FIXTURE_ORG_NAME = "Playwright Expired Recovery Org";
const FIXTURE_ADMIN_EMAIL = "expired-admin@playwright-expired.local";

// The e2e-full harness's own Compose project and its database, as
// identuum-idp-oss deployment/docker-compose.dev.yml defines them (service
// postgres-idp-oss, POSTGRES_USER idp_oss_user, POSTGRES_DB identuum_idp_oss).
const SCRATCH_PROJECT = "identuum-e2e";
const SCRATCH_DB_SERVICE = "postgres-idp-oss";
const SCRATCH_DB_USER = "idp_oss_user";
const SCRATCH_DB_NAME = "identuum_idp_oss";

// Ports of the owner's development stack (Postgres 5513, dev UI 7104, dev
// app 7113, compose UI 7114): never a harness endpoint, whatever a variable says.
const OWNER_DEV_PORTS = new Set([5513, 7104, 7113, 7114]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

type AdminState = "active" | "valid-pending" | "expired-pending" | "none";

interface ScratchContext {
  compose: string[];
  /** /api/idp/ proxy on the harness UI; it carries the browser session cookies. */
  idpProxy: string;
  /** The harness appliance's own base (claim consume). */
  idpBase: string;
}

/**
 * The harness context this fixture may act in, or a refusal. Reads only the
 * environment and the presence of two compose files; calls nothing.
 */
function scratchContext(): ScratchContext {
  const refuse = (why: string) =>
    new Error(`[expired-org fixture] refusing: ${why} (scratch e2e-full harness only)`);
  if (process.env.IDENTUUM_E2E_FIXTURE_OWNER !== "outer") {
    throw refuse("not running under the outer-owned e2e-full harness");
  }
  if (process.env.IDENTUUM_IDP_COMPOSE_PROJECT !== SCRATCH_PROJECT) {
    throw refuse(`the harness project is not ${SCRATCH_PROJECT}`);
  }
  const idpDir = process.env.IDENTUUM_E2E_IDP_DIR;
  if (!idpDir) throw refuse("IDENTUUM_E2E_IDP_DIR is not set");
  const devCompose = resolve(idpDir, "deployment", "docker-compose.dev.yml");
  const overlay = resolve(__dirname, "..", "..", "e2e-full", "compose.mail-sink.yml");
  if (!existsSync(devCompose) || !existsSync(overlay)) {
    throw refuse("the harness compose files are missing");
  }
  // The selected owned harness endpoints (review G4): full-run.sh carries its
  // own UI and app ports, and each base must be exactly that port on loopback.
  // Messages name the variable and the rule, never a value.
  const selectedPort = (name: string): string => {
    const raw = process.env[name] ?? "";
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
      throw refuse(`${name} is not a plain decimal port 1-65535`);
    }
    if (OWNER_DEV_PORTS.has(Number(raw))) {
      throw refuse(`${name} names a port of the owner's development stack`);
    }
    return raw;
  };
  const uiPort = selectedPort("IDENTUUM_E2E_FULL_UI_PORT");
  const appPort = selectedPort("IDENTUUM_E2E_FULL_APP_PORT");
  const base = (name: string, port: string, portName: string): string => {
    let url: URL;
    try {
      url = new URL(process.env[name] ?? "");
    } catch {
      throw refuse(`${name} is not set to a URL`);
    }
    if (url.protocol !== "http:") throw refuse(`${name} is not an http URL`);
    if (url.username || url.password) throw refuse(`${name} carries userinfo`);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw refuse(`${name} is not on localhost or 127.0.0.1`);
    }
    if (url.port !== port) throw refuse(`${name} does not use the port in ${portName}`);
    return url.origin;
  };
  const uiBase = base("IDENTUUM_E2E_BASE_URL", uiPort, "IDENTUUM_E2E_FULL_UI_PORT");
  const idpBase = base("IDENTUUM_E2E_FULL_IDP_BASE", appPort, "IDENTUUM_E2E_FULL_APP_PORT");
  return {
    compose: [
      "compose",
      "-p",
      SCRATCH_PROJECT,
      "-f",
      devCompose,
      "-f",
      overlay,
      "--profile",
      "app",
      "exec",
      "-T",
      SCRATCH_DB_SERVICE,
    ],
    idpProxy: `${uiBase}/api/idp`,
    idpBase,
  };
}

/**
 * Ensures the fixture org is in the has_admin=true / can_assign_admin=true state.
 * Uses the already-authenticated siteAdminCtx — no second TOTP needed.
 * Refuses (throws) before any process or HTTP request unless the outer-owned
 * harness context is complete: project identuum-e2e, its compose files present,
 * and both bases on loopback http at the harness's selected ports.
 * @returns the fixture organization UUID
 */
export async function ensureExpiredPendingOrgFixture(
  siteAdminCtx: BrowserContext
): Promise<string> {
  const ctx = scratchContext();
  const state = queryAdminState(ctx);

  if (state === "expired-pending") {
    // Already correct — just return the org ID
    const orgId = await findOrgByDomain(ctx, siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) return orgId;
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  if (state === "valid-pending") {
    // User row exists with email_verified=false, valid token — just expire
    const orgId = await findOrgByDomain(ctx, siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) {
      expireActivationToken(ctx);
      return orgId;
    }
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  if (state === "active") {
    // email_verified=true — psql-reset to email_verified=false + expire token
    resetActiveUserToExpiredPending(ctx);
    const orgId = await findOrgByDomain(ctx, siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) return orgId;
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  // state === "none": no user row yet — create org+user via API
  const orgId = await createFixtureOrgWithAdmin(ctx, siteAdminCtx);
  expireActivationToken(ctx);
  return orgId;
}

// ── scratch SQL (inside the identuum-e2e postgres container only) ─────────────

/**
 * Runs one statement in the scratch project's postgres container: argv, no
 * shell, no host, no port, no password. A failure is an error, never read as
 * an empty answer. The statements are fixed text over the fixed test address.
 */
function scratchSql(ctx: ScratchContext, sql: string): string {
  const { COMPOSE_PROJECT_NAME: _p, COMPOSE_REMOVE_ORPHANS: _o, ...env } = process.env;
  return execFileSync(
    "docker",
    [
      ...ctx.compose,
      "psql",
      "-U",
      SCRATCH_DB_USER,
      "-d",
      SCRATCH_DB_NAME,
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { stdio: ["ignore", "pipe", "pipe"], env }
  )
    .toString()
    .trim();
}

function queryAdminState(ctx: ScratchContext): AdminState {
  const row = scratchSql(
    ctx,
    `SELECT CASE WHEN email_verified THEN 'active' WHEN activation_token_expires_at > NOW() THEN 'valid-pending' ELSE 'expired-pending' END FROM users WHERE email = '${FIXTURE_ADMIN_EMAIL}' AND deleted_at IS NULL AND banned = false AND role = 'org_admin' LIMIT 1;`
  );
  if (!row) return "none";
  if (row === "active" || row === "valid-pending" || row === "expired-pending") return row;
  throw new Error("[expired-org fixture] unexpected fixture-user state from the scratch database");
}

function expireActivationToken(ctx: ScratchContext): void {
  scratchSql(
    ctx,
    `UPDATE users SET activation_token_expires_at = NOW() - INTERVAL '2 hours' WHERE email = '${FIXTURE_ADMIN_EMAIL}' AND deleted_at IS NULL;`
  );
}

function resetActiveUserToExpiredPending(ctx: ScratchContext): void {
  // email_verified=true means CountRecoveryBlockingOrgAdmins counts the user.
  // Resetting to false + expiring the token produces the desired fixture state.
  // Safe for a test account that is never used for real logins.
  scratchSql(
    ctx,
    `UPDATE users SET email_verified = false, activation_token_expires_at = NOW() - INTERVAL '2 hours' WHERE email = '${FIXTURE_ADMIN_EMAIL}' AND deleted_at IS NULL;`
  );
}

// ── API helpers (via /api/idp/ proxy) ─────────────────────────────────────────

async function findOrgByDomain(
  scratch: ScratchContext,
  ctx: BrowserContext,
  domain: string
): Promise<string | null> {
  const res = await ctx.request.get(
    `${scratch.idpProxy}/api/v1/organizations?limit=100&deleted=false`
  );
  if (!res.ok()) return null;
  const data = await res.json();
  const orgs: Array<{ id: string; domain: string }> = data.organizations ?? [];
  return orgs.find((o) => o.domain === domain)?.id ?? null;
}

/**
 * Creates the fixture org with admin_email so the backend creates both the org
 * AND a pending user row (email_verified=false, valid activation_token_*).
 *
 * If the org domain already exists (409 conflict), attempts to find its ID and
 * create the user separately using a fresh invitation + consume cycle.
 */
async function createFixtureOrgWithAdmin(
  scratch: ScratchContext,
  ctx: BrowserContext
): Promise<string> {
  const res = await ctx.request.post(`${scratch.idpProxy}/api/v1/organizations`, {
    headers: uiOriginHeader(),
    data: {
      name: FIXTURE_ORG_NAME,
      domain: FIXTURE_ORG_DOMAIN,
      admin_email: FIXTURE_ADMIN_EMAIL,
    },
  });

  if (res.ok()) {
    const data = await res.json();
    const orgId: string | undefined = data.organization?.id;
    if (!orgId) throw new Error("Fixture org creation returned no org ID");
    return orgId;
  }

  if (res.status() === 409) {
    // Org already exists (domain conflict) — find it, create user via claim+consume
    const orgId = await findOrgByDomain(scratch, ctx, FIXTURE_ORG_DOMAIN);
    if (!orgId)
      throw new Error("Fixture org domain conflict but org not found — manual cleanup needed");
    await createUserViaClaimConsume(scratch, ctx, orgId);
    return orgId;
  }

  throw new Error(`Failed to create fixture org: HTTP ${res.status()}`);
}

/**
 * Fallback: when the org exists but has no admin user, create one via
 * claim generation + immediate consumption.
 *
 * Note: claim consumption sets email_verified=true. The caller must follow
 * this with resetActiveUserToExpiredPending() → expireActivationToken() to
 * reach the desired state. But since ensureExpiredPendingOrgFixture checks
 * the state BEFORE calling this path, after consume the fixture will be
 * in "active" state and will be healed on the NEXT call to ensure...
 *
 * For determinism, this function explicitly calls resetActiveUserToExpiredPending
 * immediately after consuming.
 */
async function createUserViaClaimConsume(
  scratch: ScratchContext,
  ctx: BrowserContext,
  orgId: string
): Promise<void> {
  // Generate invitation claim
  const invRes = await ctx.request.post(
    `${scratch.idpProxy}/api/v1/organizations/${orgId}/invitations`,
    {
      headers: uiOriginHeader(),
      data: { recipient_email: FIXTURE_ADMIN_EMAIL },
    }
  );
  if (!invRes.ok()) {
    throw new Error(`Failed to generate fixture claim: HTTP ${invRes.status()}`);
  }
  const invData = await invRes.json();
  const token = extractToken(invData.claim_url ?? "");
  if (!token) throw new Error("Fixture claim generation returned no token");

  // Consume the claim on the harness appliance — sets email_verified=true
  const consumeRes = await ctx.request.post(`${scratch.idpBase}/api/v1/auth/claim`, {
    data: {
      token,
      email: FIXTURE_ADMIN_EMAIL,
      password: "FixturePassw0rd_Local!",
    },
  });
  if (!consumeRes.ok()) {
    throw new Error(`Failed to consume fixture claim: HTTP ${consumeRes.status()}`);
  }

  // Immediately reset: email_verified=false + expire token → desired state
  resetActiveUserToExpiredPending(scratch);
}

function extractToken(claimUrl: string): string | null {
  try {
    return new URL(claimUrl).searchParams.get("token");
  } catch {
    return null;
  }
}
