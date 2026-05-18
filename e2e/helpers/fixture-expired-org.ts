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
 * Setup strategy (idempotent):
 *   1. Find or create the fixture org (no admin_email → shell org).
 *   2. If no user row exists, create the org FRESH with admin_email so the backend
 *      creates the pending user row (email_verified=false, valid activation token).
 *   3. Expire the activation_token_expires_at via psql → can_assign_admin=true.
 *
 * Healing for broken states:
 *   - "active" (email_verified=true): psql reset to email_verified=false + expire token.
 *   - "valid-pending": just expire the token.
 *   - "expired-pending": no action needed.
 *
 * Safety:
 *   - Clearly test-scoped: org domain playwright-expired.local, email expired-admin@playwright-expired.local
 *   - Does NOT print claim URLs, tokens, or credential material.
 *   - psql credentials are public in deployment/docker-compose.local.yml (local-dev only).
 *   - API calls go through /api/idp/ proxy to reuse the browser session — no second TOTP.
 *
 * Architecture note: POST /api/v1/organizations with admin_email creates both org AND
 * a pending user (email_verified=false, activation_token_*). This is the only API path
 * that creates a pending user row without claim-consume (which sets email_verified=true).
 */

import { execSync } from "node:child_process";
import type { BrowserContext } from "@playwright/test";

const FIXTURE_ORG_DOMAIN = "playwright-expired.local";
const FIXTURE_ORG_NAME = "Playwright Expired Recovery Org";
const FIXTURE_ADMIN_EMAIL = "expired-admin@playwright-expired.local";

// /api/idp/ proxy at localhost:7114 carries the browser session cookies
const IDP_PROXY = "http://localhost:7114/api/idp";

// Local dev DB — credentials are public in deployment/docker-compose.local.yml
const PSQL =
  "PGPASSWORD=idp_local_password psql -h localhost -p 5432 -U idp_user -d identuum_idp";

type AdminState = "active" | "valid-pending" | "expired-pending" | "none";

/**
 * Ensures the fixture org is in the has_admin=true / can_assign_admin=true state.
 * Uses the already-authenticated siteAdminCtx — no second TOTP needed.
 * @returns the fixture organization UUID
 */
export async function ensureExpiredPendingOrgFixture(
  siteAdminCtx: BrowserContext
): Promise<string> {
  const state = queryAdminState();

  if (state === "expired-pending") {
    // Already correct — just return the org ID
    const orgId = await findOrgByDomain(siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) return orgId;
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  if (state === "valid-pending") {
    // User row exists with email_verified=false, valid token — just expire
    const orgId = await findOrgByDomain(siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) {
      expireActivationToken();
      return orgId;
    }
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  if (state === "active") {
    // email_verified=true — psql-reset to email_verified=false + expire token
    resetActiveUserToExpiredPending();
    const orgId = await findOrgByDomain(siteAdminCtx, FIXTURE_ORG_DOMAIN);
    if (orgId) return orgId;
    throw new Error("Fixture user exists but fixture org not found — inconsistent state");
  }

  // state === "none": no user row yet — create org+user via API
  const orgId = await createFixtureOrgWithAdmin(siteAdminCtx);
  expireActivationToken();
  return orgId;
}

// ── psql helpers ──────────────────────────────────────────────────────────────

function queryAdminState(): AdminState {
  try {
    const row = execSync(
      `${PSQL} -t -A -c ` +
        `"SELECT CASE WHEN email_verified THEN 'active' ` +
        `WHEN activation_token_expires_at > NOW() THEN 'valid-pending' ` +
        `ELSE 'expired-pending' END ` +
        `FROM users WHERE email = '${FIXTURE_ADMIN_EMAIL}' ` +
        `AND deleted_at IS NULL AND banned = false AND role = 'org_admin' LIMIT 1;"`,
      { stdio: "pipe" }
    )
      .toString()
      .trim();
    if (!row) return "none";
    return row as AdminState;
  } catch {
    return "none";
  }
}

function expireActivationToken(): void {
  execSync(
    `${PSQL} -c ` +
      `"UPDATE users SET activation_token_expires_at = NOW() - INTERVAL '2 hours' ` +
      `WHERE email = '${FIXTURE_ADMIN_EMAIL}' ` +
      `AND deleted_at IS NULL;"`,
    { stdio: "pipe" }
  );
}

function resetActiveUserToExpiredPending(): void {
  // email_verified=true means CountRecoveryBlockingOrgAdmins counts the user.
  // Resetting to false + expiring the token produces the desired fixture state.
  // Safe for a test account that is never used for real logins.
  execSync(
    `${PSQL} -c ` +
      `"UPDATE users SET ` +
      `email_verified = false, ` +
      `activation_token_expires_at = NOW() - INTERVAL '2 hours' ` +
      `WHERE email = '${FIXTURE_ADMIN_EMAIL}' ` +
      `AND deleted_at IS NULL;"`,
    { stdio: "pipe" }
  );
}

// ── API helpers (via /api/idp/ proxy) ─────────────────────────────────────────

async function findOrgByDomain(
  ctx: BrowserContext,
  domain: string
): Promise<string | null> {
  const res = await ctx.request.get(
    `${IDP_PROXY}/api/v1/organizations?limit=100&deleted=false`
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
async function createFixtureOrgWithAdmin(ctx: BrowserContext): Promise<string> {
  const res = await ctx.request.post(`${IDP_PROXY}/api/v1/organizations`, {
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
    const orgId = await findOrgByDomain(ctx, FIXTURE_ORG_DOMAIN);
    if (!orgId) throw new Error("Fixture org domain conflict but org not found — manual cleanup needed");
    await createUserViaClaimConsume(ctx, orgId);
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
  ctx: BrowserContext,
  orgId: string
): Promise<void> {
  // Generate invitation claim
  const invRes = await ctx.request.post(
    `${IDP_PROXY}/api/v1/organizations/${orgId}/invitations`,
    { data: { recipient_email: FIXTURE_ADMIN_EMAIL } }
  );
  if (!invRes.ok()) {
    throw new Error(`Failed to generate fixture claim: HTTP ${invRes.status()}`);
  }
  const invData = await invRes.json();
  const token = extractToken(invData.claim_url ?? "");
  if (!token) throw new Error("Fixture claim generation returned no token");

  // Consume the claim — sets email_verified=true
  const consumeRes = await ctx.request.post(
    `http://localhost:7113/api/v1/auth/claim`,
    {
      data: {
        token,
        email: FIXTURE_ADMIN_EMAIL,
        password: "FixturePassw0rd_Local!",
      },
    }
  );
  if (!consumeRes.ok()) {
    throw new Error(`Failed to consume fixture claim: HTTP ${consumeRes.status()}`);
  }

  // Immediately reset: email_verified=false + expire token → desired state
  resetActiveUserToExpiredPending();
}

function extractToken(claimUrl: string): string | null {
  try {
    return new URL(claimUrl).searchParams.get("token");
  } catch {
    return null;
  }
}
