/**
 * API-based org-admin fixture producer for the RELEASED appliance.
 *
 * THE-RELEASED-CONTRACT (2026-08-08). This replaces the pre-split producer
 * that shelled into the monolith container (`/app/identuum
 * --e2e-create-org-admin-fixture`, a `/e2e-auth` bind mount, `make
 * local-restart`). Every one of those assumptions is gone: this talks ONLY to
 * the released identuum-idp-oss HTTP API — the same surface a customer's
 * appliance exposes — and writes the SAME JSON envelope `fixture.ts` already
 * validates and every org-admin spec already consumes. Consumer contract
 * unchanged; only the producer moved from "monolith CLI" to "released API".
 *
 * The path, from a fresh appliance:
 *   1. setup: verify-token → complete (site_admin created with a known password)
 *   2. site_admin login → first-login TOTP enrolment → bearer
 *   3. create org (reserved e2e-<runID> name/slug/domain)
 *   4. create org_admin + org_user (POST /users, then PUT email_verified=true —
 *      newly-created accounts are unverified and login refuses them; setting
 *      email_verified is an admin capability, not a bypass — see identuum-idp
 *      tools/devseed)
 *   5. org_admin first-login TOTP enrolment CAPTURES the server-generated
 *      secret — the released API never accepts an injected secret, so the
 *      fixture's totp_secret is whatever the server minted, captured once.
 *
 * SECURITY: passwords and the captured TOTP secret live only in the envelope
 * the loader reads (mode 0600, gitignored e2e/.auth/). This module never
 * console.logs a secret. Progress lines carry only non-secret status.
 */

import { execFileSync } from "node:child_process";
import { generateTOTP } from "./totp";

export const E2E_FIXTURE_MARKER = "identuum-e2e-fixture-v1";
export const E2E_FIXTURE_SCHEMA_VERSION = 1;

// Public, transparent test passwords — never real, and only ever used against a
// throwaway appliance. Shaped like the credential-transparency placeholders.
const SITE_ADMIN_PASSWORD = "e2e-site-admin-not-a-secret-Aa1!";
const ORG_ADMIN_PASSWORD = "e2e-org-admin-not-a-secret-Aa1!";
const ORG_USER_PASSWORD = "e2e-org-user-not-a-secret-Aa1!";

export interface FixtureEnvelope {
  fixture_marker: string;
  schema_version: number;
  run_id: string;
  site_admin: { email: string; password: string; totp_secret: string };
  organization: { name: string; slug: string; domain: string; id: string };
  org_admin: { email: string; password: string; totp_secret: string; user_id: string };
  org_user: { email: string; password: string; user_id: string };
}

interface Json {
  [k: string]: unknown;
}

async function api(
  base: string,
  method: string,
  path: string,
  body?: Json,
  bearer?: string
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { _raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, json };
}

function must(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[e2e fixture] ${msg}`);
}

const SITE_ADMIN_EMAIL = "site_admin@system.local";

/**
 * A site_admin bearer + captured TOTP secret via setup (if needed) +
 * first-login TOTP enrolment. On an already-set-up appliance the enrolment is
 * skipped by the server (login goes straight to mfa_required); in that case the
 * secret is unavailable and this returns an empty secret — but global-setup
 * only ever runs this against a FRESH appliance it just brought up, so the
 * enrolment path is the live one.
 */
async function ensureSetupAndSiteAdmin(base: string, setupCode: string): Promise<LoginResult> {
  const status = await api(base, "GET", "/api/setup/status");
  const state = (status.json.state as string) ?? "";
  if (state === "setup_required") {
    must(setupCode.length > 0, "appliance is setup_required but no setup code was provided");
    const v = await api(base, "POST", "/api/setup/verify-token", { setup_token: setupCode });
    must(v.status === 204, `setup verify-token → ${v.status}, want 204`);
    const c = await api(base, "POST", "/api/setup/complete", {
      setup_token: setupCode,
      organization_name: "E2E System Bootstrap",
      organization_domain: "e2e-bootstrap.test",
      admin_email: "owner@e2e-bootstrap.test",
      admin_password: SITE_ADMIN_PASSWORD,
    });
    must(c.status === 200, `setup complete → ${c.status}, want 200`);
  }
  return firstLoginBearerAsync(base, SITE_ADMIN_EMAIL, SITE_ADMIN_PASSWORD);
}

interface LoginResult {
  bearer: string;
  totpSecret: string;
}

/**
 * Logs a fresh account in through its FIRST-login TOTP enrolment, returning the
 * bearer AND the server-generated TOTP secret. Retries enrol/complete once
 * across a 30s TOTP boundary if the first code straddled the window.
 */
async function firstLoginBearerAsync(
  base: string,
  email: string,
  password: string
): Promise<LoginResult> {
  const login = await api(base, "POST", "/api/v1/auth/login", { email, password });
  must(
    login.status === 401 && Boolean(login.json.session_id),
    `${email}: first login want 401+session_id, got ${login.status}`
  );
  const sessionId = login.json.session_id as string;
  const init = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/initiate", {
    session_id: sessionId,
  });
  must(
    init.status === 200 && Boolean(init.json.secret),
    `${email}: enroll/initiate → ${init.status}`
  );
  const secret = init.json.secret as string;
  let complete = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
    session_id: sessionId,
    code: generateTOTP(secret, 0),
  });
  if (complete.status !== 200) {
    // One retry on the next window in case we straddled a 30s boundary.
    await new Promise((r) => setTimeout(r, 1000));
    complete = await api(base, "POST", "/api/v1/auth/login/mfa/enroll/complete", {
      session_id: sessionId,
      code: generateTOTP(secret, 1),
    });
  }
  must(complete.status === 200, `${email}: enroll/complete → ${complete.status}`);
  const bearer = (complete.json.access_token as string) ?? (complete.json.token as string) ?? "";
  must(bearer.length > 0, `${email}: enrolment returned no bearer`);
  return { bearer, totpSecret: secret };
}

async function createOrg(
  base: string,
  bearer: string,
  runId: string
): Promise<{ id: string; name: string; slug: string; domain: string }> {
  const name = `e2e-fixture-${runId}-org`;
  const slug = `e2e-fixture-${runId}`;
  const domain = `e2e-${runId}.test`;
  // active:true is REQUIRED. Without it the org is created inactive, and the
  // org-liveness boundary (P0-3) refuses login for every user in a
  // non-operational org — surfacing as an opaque invalid_credentials that
  // looks like a wrong password but is a dead tenant.
  const res = await api(
    base,
    "POST",
    "/api/v1/organizations",
    { name, domain, slug, active: true },
    bearer
  );
  must(res.status === 201, `create org → ${res.status}`);
  const id = (res.json.id as string) ?? (res.json.ID as string) ?? "";
  must(id.length > 0, "create org returned no id");
  return { id, name, slug, domain };
}

async function createVerifiedUser(
  base: string,
  bearer: string,
  email: string,
  password: string,
  role: string,
  orgId: string
): Promise<string> {
  const create = await api(
    base,
    "POST",
    "/api/v1/users",
    { email, password, role, organization_id: orgId },
    bearer
  );
  must(create.status >= 200 && create.status < 300, `create ${role} → ${create.status}`);
  const id = (create.json.id as string) ?? (create.json.ID as string) ?? "";
  must(id.length > 0, `create ${role} returned no id`);
  // Newly-created accounts are unverified; login refuses them. email_verified
  // is an admin-settable field (identuum-idp tools/devseed documents this as
  // the supported capability, not a bypass).
  const verify = await api(base, "PUT", `/api/v1/users/${id}`, { email_verified: true }, bearer);
  must(verify.status >= 200 && verify.status < 300, `verify ${role} → ${verify.status}`);
  return id;
}

/**
 * Builds the full fixture envelope against the released appliance at `base`.
 * `setupCode` is consulted only if the appliance is still setup_required.
 */
export async function buildFixtureEnvelope(
  base: string,
  runId: string,
  setupCode: string
): Promise<FixtureEnvelope> {
  const siteAdmin = await ensureSetupAndSiteAdmin(base, setupCode);
  const siteAdminBearer = siteAdmin.bearer;

  const org = await createOrg(base, siteAdminBearer, runId);
  const orgAdminEmail = `admin@e2e-${runId}.test`;
  const orgUserEmail = `user@e2e-${runId}.test`;

  // site_admin delegates the FIRST org_admin of an admin-less org — the one
  // tenant-write the model permits it. A regular org_user, by contrast, is the
  // tenant's own business: site_admin creating one is refused (403), so the
  // org_user is created by the org_admin below.
  const orgAdminId = await createVerifiedUser(
    base,
    siteAdminBearer,
    orgAdminEmail,
    ORG_ADMIN_PASSWORD,
    "org_admin",
    org.id
  );

  // Capture the org_admin's server-generated TOTP secret via first-login
  // enrolment. This is the only way to know the secret — the API never accepts
  // an injected one — and it yields the org_admin bearer used to seed the
  // org_user within the tenant's own authority.
  const orgAdmin = await firstLoginBearerAsync(base, orgAdminEmail, ORG_ADMIN_PASSWORD);
  const orgUserId = await createVerifiedUser(
    base,
    orgAdmin.bearer,
    orgUserEmail,
    ORG_USER_PASSWORD,
    "org_user",
    org.id
  );

  return {
    fixture_marker: E2E_FIXTURE_MARKER,
    schema_version: E2E_FIXTURE_SCHEMA_VERSION,
    run_id: runId,
    site_admin: {
      email: SITE_ADMIN_EMAIL,
      password: SITE_ADMIN_PASSWORD,
      totp_secret: siteAdmin.totpSecret,
    },
    organization: { name: org.name, slug: org.slug, domain: org.domain, id: org.id },
    org_admin: {
      email: orgAdminEmail,
      password: ORG_ADMIN_PASSWORD,
      totp_secret: orgAdmin.totpSecret,
      user_id: orgAdminId,
    },
    org_user: { email: orgUserEmail, password: ORG_USER_PASSWORD, user_id: orgUserId },
  };
}

/**
 * Resolves the available Compose invocation as an argv prefix: prefers Docker
 * Compose v2 (`docker compose`), falls back to the legacy v1 binary
 * (`docker-compose`). Returns null when neither is callable. `composeFile` is
 * appended as `-f <file>` so callers pass only the subcommand.
 */
export function composeCommand(composeFile: string): string[] | null {
  for (const probe of [
    ["docker", ["compose", "version"]],
    ["docker-compose", ["version"]],
  ] as const) {
    try {
      execFileSync(probe[0], probe[1], { stdio: "ignore" });
      return probe[0] === "docker"
        ? ["docker", "compose", "-f", composeFile]
        : ["docker-compose", "-f", composeFile];
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Reads the appliance's current setup code from inside the container. */
export function readSetupCode(compose: string[], service: string): string {
  try {
    const [prog, ...pre] = compose;
    const out = execFileSync(
      prog,
      [...pre, "exec", "-T", service, "/app/identuum-idp", "show-setup-code", "/app/data"],
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString("utf-8");
    const m = out.match(/[A-Z0-9]{40,}/);
    return m ? m[0] : "";
  } catch {
    return "";
  }
}

export { firstLoginBearerAsync };
